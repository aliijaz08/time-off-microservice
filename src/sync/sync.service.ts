import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { Balance } from '../balance/balance.entity';
import { LeaveRequest } from '../leave-request/leave-request.entity';
import { HcmAdapter } from '../hcm/hcm.adapter';

export interface BatchSyncItem {
  employeeId: string;
  locationId: string;
  totalDays: number;
}

export interface BatchSyncResult {
  updated: number;
  inserted: number;
  flagged: number;
}

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    @InjectRepository(Balance) private readonly balanceRepo: Repository<Balance>,
    @InjectRepository(LeaveRequest) private readonly lrRepo: Repository<LeaveRequest>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly hcm: HcmAdapter,
  ) {}

  @Cron('*/15 * * * *')
  async handleCronSync(): Promise<void> {
    this.logger.log('Starting periodic HCM sync');

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const recentRaw = await this.lrRepo
      .createQueryBuilder('lr')
      .select(['lr.employeeId', 'lr.locationId'])
      .where('lr.requestedAt >= :since', { since })
      .distinct(true)
      .getRawMany();

    const overdawnBalances = await this.balanceRepo.find({ where: { isOverdrawn: true } });

    const pairs = new Map<string, BatchSyncItem>();
    for (const row of recentRaw) {
      const empId: string = row.lr_employeeId;
      const locId: string = row.lr_locationId;
      pairs.set(`${empId}:${locId}`, { employeeId: empId, locationId: locId, totalDays: 0 });
    }
    for (const b of overdawnBalances) {
      pairs.set(`${b.employeeId}:${b.locationId}`, { employeeId: b.employeeId, locationId: b.locationId, totalDays: 0 });
    }

    let targets: { employeeId: string; locationId: string }[];
    if (pairs.size === 0) {
      const all = await this.balanceRepo.find();
      targets = all.map((b) => ({ employeeId: b.employeeId, locationId: b.locationId }));
    } else {
      targets = Array.from(pairs.values());
    }

    for (const { employeeId, locationId } of targets) {
      await this.syncOne(employeeId, locationId);
    }

    this.logger.log(`Periodic sync complete. Synced ${targets.length} balance(s).`);
  }

  private async syncOne(employeeId: string, locationId: string): Promise<void> {
    try {
      const hcmData = await this.hcm.getBalance(employeeId, locationId);
      const balance = await this.balanceRepo.findOne({ where: { employeeId, locationId } });
      if (!balance) return;

      if (hcmData.totalDays !== balance.totalDays) {
        this.logger.warn(
          `Drift detected ${employeeId}:${locationId} — local: ${balance.totalDays}, HCM: ${hcmData.totalDays}`,
        );
        balance.totalDays = hcmData.totalDays;
      }

      balance.lastSyncedAt = new Date();
      balance.isOverdrawn = balance.totalDays - balance.usedDays - balance.pendingDays < 0;
      await this.balanceRepo.save(balance);
    } catch (error) {
      this.logger.error(`Failed to sync ${employeeId}:${locationId} — ${(error as Error).message}`);
    }
  }

  async batchSync(records: BatchSyncItem[]): Promise<BatchSyncResult> {
    let updated = 0;
    let inserted = 0;
    let flagged = 0;

    for (const { employeeId, locationId, totalDays } of records) {
      let balance = await this.balanceRepo.findOne({ where: { employeeId, locationId } });

      if (!balance) {
        balance = this.balanceRepo.create({ employeeId, locationId, totalDays, usedDays: 0, pendingDays: 0 });
        inserted++;
      } else {
        balance.totalDays = totalDays;
        updated++;
      }

      balance.lastSyncedAt = new Date();
      const available = totalDays - balance.usedDays - balance.pendingDays;
      const wasOverdrawn = balance.isOverdrawn;
      balance.isOverdrawn = available < 0;

      if (available < 0) {
        this.logger.warn(`Overdrawn after batch sync ${employeeId}:${locationId}. Available: ${available}`);
        flagged++;
      } else if (wasOverdrawn) {
        this.logger.log(`Balance restored for ${employeeId}:${locationId}`);
      }

      await this.balanceRepo.save(balance);
    }

    return { updated, inserted, flagged };
  }
}
