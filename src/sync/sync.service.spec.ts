import { SyncService } from './sync.service';

const mockBalance = {
  id: 'bal-1', employeeId: 'emp-1', locationId: 'loc-1',
  totalDays: 20, usedDays: 3, pendingDays: 2,
  isOverdrawn: false, lastSyncedAt: new Date(),
};

function makeService() {
  const mockQb = {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    distinct: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue([]),
  };
  const balanceRepo = {
    find: jest.fn().mockResolvedValue([mockBalance]),
    findOne: jest.fn().mockResolvedValue(mockBalance),
    create: jest.fn().mockReturnValue({ ...mockBalance }),
    save: jest.fn().mockResolvedValue(mockBalance),
  };
  const lrRepo = { createQueryBuilder: jest.fn().mockReturnValue(mockQb) };
  const dataSource = { transaction: jest.fn() };
  const hcm = { getBalance: jest.fn().mockResolvedValue({ totalDays: 20, availableDays: 15 }) };

  const service = new SyncService(
    balanceRepo as any, lrRepo as any, dataSource as any, hcm as any,
  );
  return { service, balanceRepo, lrRepo, hcm, mockQb };
}

describe('SyncService', () => {
  describe('batchSync', () => {
    it('inserts a new balance when none exists', async () => {
      const { service, balanceRepo } = makeService();
      balanceRepo.findOne.mockResolvedValue(null);
      balanceRepo.create.mockReturnValue({ employeeId: 'emp-1', locationId: 'loc-1', totalDays: 0, usedDays: 0, pendingDays: 0, isOverdrawn: false });
      balanceRepo.save.mockResolvedValue({});

      const result = await service.batchSync([{ employeeId: 'emp-1', locationId: 'loc-1', totalDays: 20 }]);
      expect(result.inserted).toBe(1);
      expect(result.updated).toBe(0);
    });

    it('updates an existing balance', async () => {
      const { service, balanceRepo } = makeService();
      balanceRepo.findOne.mockResolvedValue({ ...mockBalance });
      balanceRepo.save.mockResolvedValue({});

      const result = await service.batchSync([{ employeeId: 'emp-1', locationId: 'loc-1', totalDays: 25 }]);
      expect(result.updated).toBe(1);
      expect(result.inserted).toBe(0);
    });

    it('flags balance as overdrawn when available goes negative', async () => {
      const { service, balanceRepo } = makeService();
      // usedDays=15, pendingDays=5, totalDays=10 → available=-10
      balanceRepo.findOne.mockResolvedValue({ ...mockBalance, usedDays: 15, pendingDays: 5, isOverdrawn: false });
      balanceRepo.save.mockResolvedValue({});

      const result = await service.batchSync([{ employeeId: 'emp-1', locationId: 'loc-1', totalDays: 10 }]);
      expect(result.flagged).toBe(1);
      expect(balanceRepo.save).toHaveBeenCalledWith(expect.objectContaining({ isOverdrawn: true }));
    });

    it('clears isOverdrawn flag when balance is restored', async () => {
      const { service, balanceRepo } = makeService();
      balanceRepo.findOne.mockResolvedValue({ ...mockBalance, usedDays: 3, pendingDays: 2, isOverdrawn: true });
      balanceRepo.save.mockResolvedValue({});

      const result = await service.batchSync([{ employeeId: 'emp-1', locationId: 'loc-1', totalDays: 30 }]);
      expect(result.flagged).toBe(0);
      expect(balanceRepo.save).toHaveBeenCalledWith(expect.objectContaining({ isOverdrawn: false }));
    });

    it('handles multiple records and returns correct counts', async () => {
      const { service, balanceRepo } = makeService();
      balanceRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ ...mockBalance });
      balanceRepo.create.mockReturnValue({ totalDays: 0, usedDays: 0, pendingDays: 0, isOverdrawn: false });
      balanceRepo.save.mockResolvedValue({});

      const result = await service.batchSync([
        { employeeId: 'emp-1', locationId: 'loc-1', totalDays: 20 },
        { employeeId: 'emp-2', locationId: 'loc-1', totalDays: 15 },
      ]);
      expect(result.inserted).toBe(1);
      expect(result.updated).toBe(1);
    });
  });

  describe('handleCronSync', () => {
    it('syncs employees with recent leave requests', async () => {
      const { service, balanceRepo, lrRepo, hcm, mockQb } = makeService();
      mockQb.getRawMany.mockResolvedValue([{ lr_employeeId: 'emp-1', lr_locationId: 'loc-1' }]);
      balanceRepo.find.mockResolvedValue([]);
      balanceRepo.findOne.mockResolvedValue({ ...mockBalance });
      balanceRepo.save.mockResolvedValue({});

      await service.handleCronSync();
      expect(hcm.getBalance).toHaveBeenCalledWith('emp-1', 'loc-1');
    });

    it('falls back to syncing all balances when no recent activity', async () => {
      const { service, balanceRepo, hcm, mockQb } = makeService();
      mockQb.getRawMany.mockResolvedValue([]);
      balanceRepo.find
        .mockResolvedValueOnce([]) // overdrawn query
        .mockResolvedValueOnce([{ employeeId: 'emp-1', locationId: 'loc-1' }]); // fallback all
      balanceRepo.findOne.mockResolvedValue({ ...mockBalance });
      balanceRepo.save.mockResolvedValue({});

      await service.handleCronSync();
      expect(hcm.getBalance).toHaveBeenCalled();
    });

    it('logs error and continues when one HCM call fails', async () => {
      const { service, balanceRepo, lrRepo, hcm, mockQb } = makeService();
      mockQb.getRawMany.mockResolvedValue([
        { lr_employeeId: 'emp-1', lr_locationId: 'loc-1' },
        { lr_employeeId: 'emp-2', lr_locationId: 'loc-2' },
      ]);
      balanceRepo.find.mockResolvedValue([]);
      balanceRepo.findOne.mockResolvedValue({ ...mockBalance });
      balanceRepo.save.mockResolvedValue({});
      hcm.getBalance
        .mockRejectedValueOnce(new Error('HCM error'))
        .mockResolvedValueOnce({ totalDays: 20 });

      await expect(service.handleCronSync()).resolves.not.toThrow();
      expect(hcm.getBalance).toHaveBeenCalledTimes(2);
    });

    it('detects and logs balance drift', async () => {
      const { service, balanceRepo, hcm, mockQb } = makeService();
      mockQb.getRawMany.mockResolvedValue([{ lr_employeeId: 'emp-1', lr_locationId: 'loc-1' }]);
      balanceRepo.find.mockResolvedValue([]);
      balanceRepo.findOne.mockResolvedValue({ ...mockBalance, totalDays: 20 });
      balanceRepo.save.mockResolvedValue({});
      hcm.getBalance.mockResolvedValue({ totalDays: 25 }); // drift

      await service.handleCronSync();
      expect(balanceRepo.save).toHaveBeenCalledWith(expect.objectContaining({ totalDays: 25 }));
    });
  });
});
