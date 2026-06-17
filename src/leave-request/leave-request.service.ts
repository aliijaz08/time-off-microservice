import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository, DataSource } from 'typeorm';
import { Mutex } from 'async-mutex';
import { LeaveRequest, LeaveStatus } from './leave-request.entity';
import { Balance } from '../balance/balance.entity';
import { Employee } from '../employee/employee.entity';
import { Location } from '../location/location.entity';
import { HcmAdapter } from '../hcm/hcm.adapter';
import { CreateLeaveRequestDto } from './dto/create-leave-request.dto';

@Injectable()
export class LeaveRequestService {
  private readonly logger = new Logger(LeaveRequestService.name);
  private readonly mutexMap = new Map<string, Mutex>();

  constructor(
    @InjectRepository(LeaveRequest) private readonly lrRepo: Repository<LeaveRequest>,
    @InjectRepository(Balance) private readonly balanceRepo: Repository<Balance>,
    @InjectRepository(Employee) private readonly employeeRepo: Repository<Employee>,
    @InjectRepository(Location) private readonly locationRepo: Repository<Location>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly hcm: HcmAdapter,
    private readonly config: ConfigService,
  ) {}

  private getMutex(employeeId: string, locationId: string): Mutex {
    const key = `${employeeId}:${locationId}`;
    if (!this.mutexMap.has(key)) this.mutexMap.set(key, new Mutex());
    return this.mutexMap.get(key)!;
  }

  private calcDays(startDate: string, endDate: string): number {
    const start = new Date(startDate).getTime();
    const end = new Date(endDate).getTime();
    return Math.floor((end - start) / 86_400_000) + 1;
  }

  async submit(dto: CreateLeaveRequestDto): Promise<LeaveRequest> {
    const { employeeId, locationId, startDate, endDate, note } = dto;

    const employee = await this.employeeRepo.findOne({ where: { id: employeeId } });
    if (!employee) throw new NotFoundException('Employee not found');

    const location = await this.locationRepo.findOne({ where: { id: locationId } });
    if (!location) throw new NotFoundException('Location not found');

    const today = new Date().toISOString().split('T')[0];
    if (startDate < today) throw new BadRequestException('startDate cannot be in the past');
    if (endDate < startDate) throw new BadRequestException('endDate must be >= startDate');

    const daysRequested = this.calcDays(startDate, endDate);
    const maxDays = this.config.get<number>('MAX_DAYS_PER_REQUEST', 30);
    if (daysRequested > maxDays) throw new BadRequestException(`Max ${maxDays} days per request`);

    const mutex = this.getMutex(employeeId, locationId);
    const release = await mutex.acquire();

    try {
      const overlap = await this.lrRepo
        .createQueryBuilder('lr')
        .where('lr.employeeId = :employeeId', { employeeId })
        .andWhere('lr.locationId = :locationId', { locationId })
        .andWhere("lr.status IN ('PENDING', 'APPROVED')")
        .andWhere('lr.startDate <= :endDate AND lr.endDate >= :startDate', { startDate, endDate })
        .getOne();

      if (overlap) throw new ConflictException('Overlapping leave request exists');

      let balance = await this.balanceRepo.findOne({ where: { employeeId, locationId } });
      if (!balance) {
        balance = this.balanceRepo.create({ employeeId, locationId, totalDays: 0, usedDays: 0, pendingDays: 0 });
        await this.balanceRepo.save(balance);
      }

      const staleMs = this.config.get<number>('STALENESS_THRESHOLD_MIN', 15) * 60_000;
      const isStale = !balance.lastSyncedAt || Date.now() - new Date(balance.lastSyncedAt).getTime() > staleMs;

      if (isStale) {
        const hcmData = await this.hcm.getBalance(employeeId, locationId);
        balance.totalDays = hcmData.totalDays;
        balance.lastSyncedAt = new Date();
        await this.balanceRepo.save(balance);
      } else {
        await this.hcm.getBalance(employeeId, locationId);
      }

      const available = balance.totalDays - balance.usedDays - balance.pendingDays;
      if (daysRequested > available) {
        throw new ConflictException(`Insufficient balance. Available: ${available} days`);
      }

      return await this.dataSource.transaction(async (manager) => {
        const lr = manager.create(LeaveRequest, {
          employeeId,
          locationId,
          startDate,
          endDate,
          daysRequested,
          note: note ?? null,
          status: LeaveStatus.PENDING,
        });
        await manager.save(LeaveRequest, lr);
        await manager.increment(Balance, { employeeId, locationId }, 'pendingDays', daysRequested);
        return lr;
      });
    } finally {
      release();
    }
  }

  async approve(id: string, resolvedBy: string): Promise<LeaveRequest> {
    const lr = await this.lrRepo.findOne({ where: { id } });
    if (!lr) throw new NotFoundException('Leave request not found');
    if (lr.status !== LeaveStatus.PENDING) throw new ConflictException(`Cannot approve a ${lr.status} request`);

    const mutex = this.getMutex(lr.employeeId, lr.locationId);
    const release = await mutex.acquire();

    try {
      const hcmResult = await this.hcm.deduct(lr.employeeId, lr.locationId, lr.daysRequested);

      try {
        return await this.dataSource.transaction(async (manager) => {
          lr.status = LeaveStatus.APPROVED;
          lr.resolvedAt = new Date();
          lr.resolvedBy = resolvedBy;
          await manager.save(LeaveRequest, lr);

          const balance = await manager.findOne(Balance, { where: { employeeId: lr.employeeId, locationId: lr.locationId } });
          if (balance) {
            balance.pendingDays = Math.max(0, balance.pendingDays - lr.daysRequested);
            balance.usedDays += lr.daysRequested;
            await manager.save(Balance, balance);
          }
          return lr;
        });
      } catch (dbError) {
        this.logger.error(
          `CRITICAL: HCM deducted ${lr.daysRequested} days for ${lr.employeeId}:${lr.locationId} ` +
          `(remainingDays=${hcmResult.remainingDays}) but DB update failed for LeaveRequest ${lr.id}. ` +
          `Manual reconciliation required. DB error: ${(dbError as Error).message}`,
        );
        throw dbError;
      }
    } finally {
      release();
    }
  }

  async reject(id: string, resolvedBy: string, note?: string): Promise<LeaveRequest> {
    const lr = await this.lrRepo.findOne({ where: { id } });
    if (!lr) throw new NotFoundException('Leave request not found');
    if (lr.status !== LeaveStatus.PENDING) throw new ConflictException(`Cannot reject a ${lr.status} request`);

    return await this.dataSource.transaction(async (manager) => {
      lr.status = LeaveStatus.REJECTED;
      lr.resolvedAt = new Date();
      lr.resolvedBy = resolvedBy;
      if (note) lr.note = note;
      await manager.save(LeaveRequest, lr);
      await manager.decrement(Balance, { employeeId: lr.employeeId, locationId: lr.locationId }, 'pendingDays', lr.daysRequested);
      return lr;
    });
  }

  async cancel(id: string, employeeId: string): Promise<LeaveRequest> {
    const lr = await this.lrRepo.findOne({ where: { id } });
    if (!lr) throw new NotFoundException('Leave request not found');
    if (lr.employeeId !== employeeId) throw new ForbiddenException('Not your leave request');
    if (lr.status !== LeaveStatus.PENDING) throw new ConflictException(`Cannot cancel a ${lr.status} request`);

    return await this.dataSource.transaction(async (manager) => {
      lr.status = LeaveStatus.CANCELLED;
      await manager.save(LeaveRequest, lr);
      await manager.decrement(Balance, { employeeId: lr.employeeId, locationId: lr.locationId }, 'pendingDays', lr.daysRequested);
      return lr;
    });
  }

  async findOne(id: string, requesterId?: string): Promise<LeaveRequest> {
    const lr = await this.lrRepo.findOne({ where: { id } });
    if (!lr) throw new NotFoundException('Leave request not found');
    if (requesterId && lr.employeeId !== requesterId) {
      throw new ForbiddenException('Not your leave request');
    }
    return lr;
  }

  async findAll(filters: { employeeId?: string; status?: LeaveStatus }): Promise<LeaveRequest[]> {
    const where: Record<string, string> = {};
    if (filters.employeeId) where.employeeId = filters.employeeId;
    if (filters.status) where.status = filters.status;
    return this.lrRepo.find({ where });
  }
}
