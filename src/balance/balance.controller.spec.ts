import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import request from 'supertest';
import { BalanceController } from './balance.controller';
import { BalanceService } from './balance.service';

describe('BalanceController', () => {
  let app: INestApplication;
  let currentRole: string;
  let currentRequesterId: string;

  const balanceService = {
    getOne: jest.fn(),
    getAll: jest.fn(),
    getFlagged: jest.fn(),
  };

  const mockBalance = {
    id: 'bal-1',
    employeeId: 'emp-1',
    locationId: 'loc-1',
    locationName: 'New York',
    totalDays: 20,
    usedDays: 3,
    pendingDays: 2,
    availableDays: 15,
    isOverdrawn: false,
    lastSyncedAt: null,
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BalanceController],
      providers: [
        { provide: BalanceService, useValue: balanceService },
        {
          provide: APP_GUARD,
          useValue: {
            canActivate: (ctx: any) => {
              const req = ctx.switchToHttp().getRequest();
              req.role = currentRole;
              req.requesterId = currentRequesterId;
              return true;
            },
          },
        },
      ],
    }).compile();

    app = module.createNestApplication();
    await app.init();
  });

  afterAll(() => app.close());
  afterEach(() => jest.clearAllMocks());

  describe('GET /balances/:employeeId/:locationId', () => {
    it('returns balance for own employeeId (employee role)', async () => {
      currentRole = 'employee';
      currentRequesterId = 'emp-1';
      balanceService.getOne.mockResolvedValue(mockBalance);

      const res = await request(app.getHttpServer()).get('/balances/emp-1/loc-1');
      expect(res.status).toBe(200);
      expect(res.body.availableDays).toBe(15);
      expect(balanceService.getOne).toHaveBeenCalledWith('emp-1', 'loc-1');
    });

    it('returns 403 when employee accesses another employee balance', async () => {
      currentRole = 'employee';
      currentRequesterId = 'emp-2';

      const res = await request(app.getHttpServer()).get('/balances/emp-1/loc-1');
      expect(res.status).toBe(403);
      expect(balanceService.getOne).not.toHaveBeenCalled();
    });

    it('allows manager to access any employee balance', async () => {
      currentRole = 'manager';
      currentRequesterId = '';
      balanceService.getOne.mockResolvedValue(mockBalance);

      const res = await request(app.getHttpServer()).get('/balances/emp-1/loc-1');
      expect(res.status).toBe(200);
    });
  });

  describe('GET /balances/:employeeId', () => {
    it('returns all balances for own employeeId (employee role)', async () => {
      currentRole = 'employee';
      currentRequesterId = 'emp-1';
      balanceService.getAll.mockResolvedValue([mockBalance]);

      const res = await request(app.getHttpServer()).get('/balances/emp-1');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(balanceService.getAll).toHaveBeenCalledWith('emp-1');
    });

    it('returns 403 when employee accesses another employee balances', async () => {
      currentRole = 'employee';
      currentRequesterId = 'emp-2';

      const res = await request(app.getHttpServer()).get('/balances/emp-1');
      expect(res.status).toBe(403);
      expect(balanceService.getAll).not.toHaveBeenCalled();
    });

    it('allows manager to access any employee balances', async () => {
      currentRole = 'manager';
      currentRequesterId = '';
      balanceService.getAll.mockResolvedValue([mockBalance]);

      const res = await request(app.getHttpServer()).get('/balances/emp-1');
      expect(res.status).toBe(200);
    });
  });

  describe('GET /admin/flagged-balances', () => {
    it('returns only overdrawn balances', async () => {
      currentRole = 'manager';
      currentRequesterId = '';
      balanceService.getFlagged.mockResolvedValue([{ ...mockBalance, isOverdrawn: true }]);

      const res = await request(app.getHttpServer()).get('/admin/flagged-balances');
      expect(res.status).toBe(200);
      expect(res.body[0].isOverdrawn).toBe(true);
    });

    it('returns empty array when no flagged balances', async () => {
      currentRole = 'manager';
      currentRequesterId = '';
      balanceService.getFlagged.mockResolvedValue([]);

      const res = await request(app.getHttpServer()).get('/admin/flagged-balances');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });
});
