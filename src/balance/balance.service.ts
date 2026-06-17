import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { Balance } from './balance.entity';
import { Location } from '../location/location.entity';
import { HcmAdapter } from '../hcm/hcm.adapter';

export interface BalanceResponse {
  id: string;
  employeeId: string;
  locationId: string;
  locationName: string;
  totalDays: number;
  usedDays: number;
  pendingDays: number;
  availableDays: number;
  isOverdrawn: boolean;
  lastSyncedAt: Date | null;
}

@Injectable()
export class BalanceService {
  constructor(
    @InjectRepository(Balance) private readonly balanceRepo: Repository<Balance>,
    @InjectRepository(Location) private readonly locationRepo: Repository<Location>,
    private readonly hcm: HcmAdapter,
    private readonly config: ConfigService,
  ) {}

  async getAll(employeeId: string): Promise<BalanceResponse[]> {
    const balances = await this.balanceRepo.find({ where: { employeeId } });
    return Promise.all(balances.map((b) => this.toResponse(b)));
  }

  async getOne(employeeId: string, locationId: string): Promise<BalanceResponse> {
    const balance = await this.balanceRepo.findOne({ where: { employeeId, locationId } });
    if (!balance) throw new NotFoundException('Balance not found');
    return this.toResponse(balance);
  }

  async getFlagged(): Promise<BalanceResponse[]> {
    const balances = await this.balanceRepo.find({ where: { isOverdrawn: true } });
    return Promise.all(balances.map((b) => this.toResponse(b)));
  }

  isStale(balance: Balance): boolean {
    if (!balance.lastSyncedAt) return true;
    const thresholdMs = this.config.get<number>('STALENESS_THRESHOLD_MIN', 15) * 60_000;
    return Date.now() - new Date(balance.lastSyncedAt).getTime() > thresholdMs;
  }

  async refreshFromHcm(employeeId: string, locationId: string): Promise<Balance> {
    const hcmData = await this.hcm.getBalance(employeeId, locationId);
    let balance = await this.balanceRepo.findOne({ where: { employeeId, locationId } });
    if (!balance) {
      balance = this.balanceRepo.create({ employeeId, locationId, totalDays: 0, usedDays: 0, pendingDays: 0 });
    }
    balance.totalDays = hcmData.totalDays;
    balance.lastSyncedAt = new Date();
    return this.balanceRepo.save(balance);
  }

  private async toResponse(balance: Balance): Promise<BalanceResponse> {
    const location = await this.locationRepo.findOne({ where: { id: balance.locationId } });
    return {
      id: balance.id,
      employeeId: balance.employeeId,
      locationId: balance.locationId,
      locationName: location?.name ?? 'Unknown',
      totalDays: balance.totalDays,
      usedDays: balance.usedDays,
      pendingDays: balance.pendingDays,
      availableDays: balance.totalDays - balance.usedDays - balance.pendingDays,
      isOverdrawn: balance.isOverdrawn,
      lastSyncedAt: balance.lastSyncedAt,
    };
  }
}
