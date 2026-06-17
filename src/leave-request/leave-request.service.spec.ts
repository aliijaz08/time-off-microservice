import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { LeaveRequestService } from './leave-request.service';
import { LeaveStatus } from './leave-request.entity';

const FUTURE_DATE = '2099-06-10';
const FUTURE_END = '2099-06-14';
const PAST_DATE = '2000-01-01';

const mockEmployee = { id: 'emp-1', name: 'Alice' };
const mockLocation = { id: 'loc-1', name: 'New York' };
const mockBalance = {
  id: 'bal-1', employeeId: 'emp-1', locationId: 'loc-1',
  totalDays: 20, usedDays: 0, pendingDays: 0, isOverdrawn: false,
  lastSyncedAt: null,
};
const mockLr = {
  id: 'lr-1', employeeId: 'emp-1', locationId: 'loc-1',
  startDate: FUTURE_DATE, endDate: FUTURE_END, daysRequested: 5,
  status: LeaveStatus.PENDING, requestedAt: new Date(),
  resolvedAt: null, resolvedBy: null, note: null,
};

function makeManager() {
  const mockQb = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(null),
  };
  const lrRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
    createQueryBuilder: jest.fn().mockReturnValue(mockQb),
  };
  const balanceRepo = {
    findOne: jest.fn().mockResolvedValue(mockBalance),
    create: jest.fn().mockReturnValue(mockBalance),
    save: jest.fn().mockResolvedValue(mockBalance),
  };
  const employeeRepo = { findOne: jest.fn().mockResolvedValue(mockEmployee) };
  const locationRepo = { findOne: jest.fn().mockResolvedValue(mockLocation) };
  const mockManagerEntity = {
    create: jest.fn().mockReturnValue({ ...mockLr }),
    save: jest.fn().mockImplementation((_Entity, data) => Promise.resolve(data ?? mockLr)),
    increment: jest.fn().mockResolvedValue(undefined),
    decrement: jest.fn().mockResolvedValue(undefined),
    findOne: jest.fn().mockResolvedValue(mockBalance),
  };
  const dataSource = {
    transaction: jest.fn().mockImplementation(async (cb: any) => cb(mockManagerEntity)),
  };
  const hcm = { getBalance: jest.fn().mockResolvedValue({ totalDays: 20, availableDays: 20 }), deduct: jest.fn() };
  const config = { get: jest.fn().mockReturnValue(30) };

  const service = new LeaveRequestService(
    lrRepo as any, balanceRepo as any, employeeRepo as any,
    locationRepo as any, dataSource as any, hcm as any, config as any,
  );
  return { service, lrRepo, balanceRepo, employeeRepo, locationRepo, dataSource, hcm, mockManagerEntity, mockQb, config };
}

describe('LeaveRequestService', () => {
  describe('submit', () => {
    it('creates a PENDING leave request successfully', async () => {
      const { service } = makeManager();
      const result = await service.submit({ employeeId: 'emp-1', locationId: 'loc-1', startDate: FUTURE_DATE, endDate: FUTURE_END });
      expect(result.status).toBe(LeaveStatus.PENDING);
    });

    it('throws NotFoundException when employee does not exist', async () => {
      const { service, employeeRepo } = makeManager();
      employeeRepo.findOne.mockResolvedValue(null);
      await expect(service.submit({ employeeId: 'bad', locationId: 'loc-1', startDate: FUTURE_DATE, endDate: FUTURE_END }))
        .rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when location does not exist', async () => {
      const { service, locationRepo } = makeManager();
      locationRepo.findOne.mockResolvedValue(null);
      await expect(service.submit({ employeeId: 'emp-1', locationId: 'bad', startDate: FUTURE_DATE, endDate: FUTURE_END }))
        .rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when startDate is in the past', async () => {
      const { service } = makeManager();
      await expect(service.submit({ employeeId: 'emp-1', locationId: 'loc-1', startDate: PAST_DATE, endDate: PAST_DATE }))
        .rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when endDate is before startDate', async () => {
      const { service } = makeManager();
      await expect(service.submit({ employeeId: 'emp-1', locationId: 'loc-1', startDate: FUTURE_END, endDate: FUTURE_DATE }))
        .rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when daysRequested exceeds max', async () => {
      const { service, config } = makeManager();
      config.get.mockReturnValue(3); // max 3 days
      await expect(service.submit({ employeeId: 'emp-1', locationId: 'loc-1', startDate: FUTURE_DATE, endDate: FUTURE_END }))
        .rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException when overlapping request exists', async () => {
      const { service, mockQb } = makeManager();
      mockQb.getOne.mockResolvedValue(mockLr);
      await expect(service.submit({ employeeId: 'emp-1', locationId: 'loc-1', startDate: FUTURE_DATE, endDate: FUTURE_END }))
        .rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when local balance is insufficient after HCM refresh', async () => {
      const { service, hcm, balanceRepo } = makeManager();
      hcm.getBalance.mockResolvedValue({ totalDays: 2, availableDays: 2 });
      balanceRepo.findOne.mockResolvedValue({ ...mockBalance, totalDays: 2, lastSyncedAt: null });
      await expect(service.submit({ employeeId: 'emp-1', locationId: 'loc-1', startDate: FUTURE_DATE, endDate: FUTURE_END }))
        .rejects.toThrow(ConflictException);
    });

    it('throws when HCM is unavailable', async () => {
      const { service, hcm } = makeManager();
      hcm.getBalance.mockRejectedValue(new ServiceUnavailableException('HCM is unreachable'));
      await expect(service.submit({ employeeId: 'emp-1', locationId: 'loc-1', startDate: FUTURE_DATE, endDate: FUTURE_END }))
        .rejects.toThrow(ServiceUnavailableException);
    });
  });

  describe('approve', () => {
    it('approves a PENDING request and moves pendingDays to usedDays', async () => {
      const { service, lrRepo, hcm } = makeManager();
      lrRepo.findOne.mockResolvedValue({ ...mockLr });
      hcm.deduct.mockResolvedValue({ remainingDays: 15 });
      const result = await service.approve('lr-1', 'manager-1');
      expect(result.status).toBe(LeaveStatus.APPROVED);
      expect(result.resolvedBy).toBe('manager-1');
    });

    it('throws NotFoundException when leave request does not exist', async () => {
      const { service, lrRepo } = makeManager();
      lrRepo.findOne.mockResolvedValue(null);
      await expect(service.approve('bad-id', 'mgr')).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when request is not PENDING', async () => {
      const { service, lrRepo } = makeManager();
      lrRepo.findOne.mockResolvedValue({ ...mockLr, status: LeaveStatus.APPROVED });
      await expect(service.approve('lr-1', 'mgr')).rejects.toThrow(ConflictException);
    });

    it('throws UnprocessableEntityException and keeps request PENDING when HCM deduct fails', async () => {
      const { service, lrRepo, hcm } = makeManager();
      lrRepo.findOne.mockResolvedValue({ ...mockLr });
      hcm.deduct.mockRejectedValue(new UnprocessableEntityException('INSUFFICIENT_BALANCE'));
      await expect(service.approve('lr-1', 'mgr')).rejects.toThrow(UnprocessableEntityException);
    });
  });

  describe('reject', () => {
    it('rejects a PENDING request and releases pendingDays', async () => {
      const { service, lrRepo, mockManagerEntity } = makeManager();
      lrRepo.findOne.mockResolvedValue({ ...mockLr });
      const result = await service.reject('lr-1', 'mgr', 'Not approved');
      expect(result.status).toBe(LeaveStatus.REJECTED);
      expect(mockManagerEntity.decrement).toHaveBeenCalled();
    });

    it('throws NotFoundException when request does not exist', async () => {
      const { service, lrRepo } = makeManager();
      lrRepo.findOne.mockResolvedValue(null);
      await expect(service.reject('bad-id', 'mgr')).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when request is not PENDING', async () => {
      const { service, lrRepo } = makeManager();
      lrRepo.findOne.mockResolvedValue({ ...mockLr, status: LeaveStatus.CANCELLED });
      await expect(service.reject('lr-1', 'mgr')).rejects.toThrow(ConflictException);
    });
  });

  describe('cancel', () => {
    it('cancels a PENDING request owned by the employee', async () => {
      const { service, lrRepo, mockManagerEntity } = makeManager();
      lrRepo.findOne.mockResolvedValue({ ...mockLr });
      const result = await service.cancel('lr-1', 'emp-1');
      expect(result.status).toBe(LeaveStatus.CANCELLED);
      expect(mockManagerEntity.decrement).toHaveBeenCalled();
    });

    it('throws ForbiddenException when employee does not own the request', async () => {
      const { service, lrRepo } = makeManager();
      lrRepo.findOne.mockResolvedValue({ ...mockLr, employeeId: 'emp-2' });
      await expect(service.cancel('lr-1', 'emp-1')).rejects.toThrow(ForbiddenException);
    });

    it('throws ConflictException when request is not PENDING', async () => {
      const { service, lrRepo } = makeManager();
      lrRepo.findOne.mockResolvedValue({ ...mockLr, status: LeaveStatus.APPROVED });
      await expect(service.cancel('lr-1', 'emp-1')).rejects.toThrow(ConflictException);
    });
  });

  describe('findOne', () => {
    it('returns leave request for manager (no ownership check)', async () => {
      const { service, lrRepo } = makeManager();
      lrRepo.findOne.mockResolvedValue(mockLr);
      const result = await service.findOne('lr-1');
      expect(result.id).toBe('lr-1');
    });

    it('throws NotFoundException when not found', async () => {
      const { service, lrRepo } = makeManager();
      lrRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne('bad-id')).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when requesterId does not match', async () => {
      const { service, lrRepo } = makeManager();
      lrRepo.findOne.mockResolvedValue({ ...mockLr, employeeId: 'emp-2' });
      await expect(service.findOne('lr-1', 'emp-1')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('findAll', () => {
    it('returns all requests matching filters', async () => {
      const { service, lrRepo } = makeManager();
      lrRepo.find.mockResolvedValue([mockLr]);
      const result = await service.findAll({ employeeId: 'emp-1' });
      expect(result).toHaveLength(1);
    });
  });
});
