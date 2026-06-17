import { NotFoundException } from '@nestjs/common';
import { BalanceService } from './balance.service';
import { Balance } from './balance.entity';

function makeService() {
  const balanceRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };
  const locationRepo = { findOne: jest.fn() };
  const hcm = { getBalance: jest.fn() };
  const config = { get: jest.fn().mockReturnValue(15) };

  const service = new BalanceService(
    balanceRepo as any,
    locationRepo as any,
    hcm as any,
    config as any,
  );
  return { service, balanceRepo, locationRepo, hcm, config };
}

const mockLocation = { id: 'loc-1', name: 'New York' };
const mockBalance: Balance = {
  id: 'bal-1',
  employeeId: 'emp-1',
  locationId: 'loc-1',
  totalDays: 20,
  usedDays: 3,
  pendingDays: 2,
  isOverdrawn: false,
  lastSyncedAt: new Date(),
};

describe('BalanceService', () => {
  describe('getAll', () => {
    it('returns all balances for an employee with computed availableDays', async () => {
      const { service, balanceRepo, locationRepo } = makeService();
      balanceRepo.find.mockResolvedValue([mockBalance]);
      locationRepo.findOne.mockResolvedValue(mockLocation);

      const result = await service.getAll('emp-1');
      expect(result).toHaveLength(1);
      expect(result[0].availableDays).toBe(15); // 20 - 3 - 2
      expect(result[0].locationName).toBe('New York');
    });

    it('returns empty array when no balances exist', async () => {
      const { service, balanceRepo } = makeService();
      balanceRepo.find.mockResolvedValue([]);
      const result = await service.getAll('emp-1');
      expect(result).toEqual([]);
    });
  });

  describe('getOne', () => {
    it('returns a single balance with correct shape', async () => {
      const { service, balanceRepo, locationRepo } = makeService();
      balanceRepo.findOne.mockResolvedValue(mockBalance);
      locationRepo.findOne.mockResolvedValue(mockLocation);

      const result = await service.getOne('emp-1', 'loc-1');
      expect(result.id).toBe('bal-1');
      expect(result.availableDays).toBe(15);
    });

    it('throws NotFoundException when balance does not exist', async () => {
      const { service, balanceRepo } = makeService();
      balanceRepo.findOne.mockResolvedValue(null);
      await expect(service.getOne('emp-1', 'loc-1')).rejects.toThrow(NotFoundException);
    });

    it('returns locationName as Unknown when location is not found', async () => {
      const { service, balanceRepo, locationRepo } = makeService();
      balanceRepo.findOne.mockResolvedValue(mockBalance);
      locationRepo.findOne.mockResolvedValue(null);
      const result = await service.getOne('emp-1', 'loc-1');
      expect(result.locationName).toBe('Unknown');
    });
  });

  describe('getFlagged', () => {
    it('returns only overdrawn balances', async () => {
      const { service, balanceRepo, locationRepo } = makeService();
      const overdrawn = { ...mockBalance, isOverdrawn: true };
      balanceRepo.find.mockResolvedValue([overdrawn]);
      locationRepo.findOne.mockResolvedValue(mockLocation);

      const result = await service.getFlagged();
      expect(result).toHaveLength(1);
      expect(result[0].isOverdrawn).toBe(true);
    });
  });

  describe('isStale', () => {
    it('returns true when lastSyncedAt is null', () => {
      const { service } = makeService();
      expect(service.isStale({ ...mockBalance, lastSyncedAt: null })).toBe(true);
    });

    it('returns true when lastSyncedAt exceeds threshold', () => {
      const { service } = makeService();
      const old = new Date(Date.now() - 20 * 60_000); // 20 min ago
      expect(service.isStale({ ...mockBalance, lastSyncedAt: old })).toBe(true);
    });

    it('returns false when lastSyncedAt is within threshold', () => {
      const { service } = makeService();
      const fresh = new Date(Date.now() - 5 * 60_000); // 5 min ago
      expect(service.isStale({ ...mockBalance, lastSyncedAt: fresh })).toBe(false);
    });
  });

  describe('refreshFromHcm', () => {
    it('updates totalDays and lastSyncedAt from HCM', async () => {
      const { service, balanceRepo, hcm } = makeService();
      balanceRepo.findOne.mockResolvedValue({ ...mockBalance, totalDays: 10 });
      balanceRepo.save.mockResolvedValue({ ...mockBalance, totalDays: 25 });
      hcm.getBalance.mockResolvedValue({ totalDays: 25, availableDays: 20 });

      const result = await service.refreshFromHcm('emp-1', 'loc-1');
      expect(balanceRepo.save).toHaveBeenCalledWith(expect.objectContaining({ totalDays: 25 }));
    });

    it('creates a new balance record when none exists', async () => {
      const { service, balanceRepo, hcm } = makeService();
      balanceRepo.findOne.mockResolvedValue(null);
      balanceRepo.create.mockReturnValue({ employeeId: 'emp-1', locationId: 'loc-1', totalDays: 0 });
      balanceRepo.save.mockResolvedValue({ employeeId: 'emp-1', locationId: 'loc-1', totalDays: 20 });
      hcm.getBalance.mockResolvedValue({ totalDays: 20, availableDays: 20 });

      await service.refreshFromHcm('emp-1', 'loc-1');
      expect(balanceRepo.create).toHaveBeenCalled();
      expect(balanceRepo.save).toHaveBeenCalledWith(expect.objectContaining({ totalDays: 20 }));
    });
  });
});
