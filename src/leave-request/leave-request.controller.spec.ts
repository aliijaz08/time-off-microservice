import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import request from 'supertest';
import { LeaveRequestController } from './leave-request.controller';
import { LeaveRequestService } from './leave-request.service';
import { LeaveStatus } from './leave-request.entity';

describe('LeaveRequestController', () => {
  let app: INestApplication;
  let currentRole: string;
  let currentRequesterId: string;

  const leaveRequestService = {
    submit: jest.fn(),
    findOne: jest.fn(),
    findAll: jest.fn(),
    cancel: jest.fn(),
    approve: jest.fn(),
    reject: jest.fn(),
  };

  const mockLeaveRequest = {
    id: 'lr-1',
    employeeId: 'emp-1',
    locationId: 'loc-1',
    startDate: '2026-05-01',
    endDate: '2026-05-05',
    daysRequested: 5,
    status: LeaveStatus.PENDING,
    requestedAt: new Date().toISOString(),
    resolvedAt: null,
    resolvedBy: null,
    note: null,
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [LeaveRequestController],
      providers: [
        { provide: LeaveRequestService, useValue: leaveRequestService },
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

  describe('POST /leave-requests', () => {
    it('submits leave request for own employeeId', async () => {
      currentRole = 'employee';
      currentRequesterId = 'emp-1';
      leaveRequestService.submit.mockResolvedValue(mockLeaveRequest);

      const res = await request(app.getHttpServer())
        .post('/leave-requests')
        .send({ employeeId: 'emp-1', locationId: 'loc-1', startDate: '2026-05-01', endDate: '2026-05-05' });

      expect(res.status).toBe(201);
      expect(leaveRequestService.submit).toHaveBeenCalled();
    });

    it('returns 403 when employee submits leave for another employee', async () => {
      currentRole = 'employee';
      currentRequesterId = 'emp-2';

      const res = await request(app.getHttpServer())
        .post('/leave-requests')
        .send({ employeeId: 'emp-1', locationId: 'loc-1', startDate: '2026-05-01', endDate: '2026-05-05' });

      expect(res.status).toBe(403);
      expect(leaveRequestService.submit).not.toHaveBeenCalled();
    });
  });

  describe('GET /leave-requests/:id', () => {
    it('passes requesterId when called by employee', async () => {
      currentRole = 'employee';
      currentRequesterId = 'emp-1';
      leaveRequestService.findOne.mockResolvedValue(mockLeaveRequest);

      const res = await request(app.getHttpServer()).get('/leave-requests/lr-1');
      expect(res.status).toBe(200);
      expect(leaveRequestService.findOne).toHaveBeenCalledWith('lr-1', 'emp-1');
    });

    it('passes undefined requesterId when called by manager', async () => {
      currentRole = 'manager';
      currentRequesterId = '';
      leaveRequestService.findOne.mockResolvedValue(mockLeaveRequest);

      const res = await request(app.getHttpServer()).get('/leave-requests/lr-1');
      expect(res.status).toBe(200);
      expect(leaveRequestService.findOne).toHaveBeenCalledWith('lr-1', undefined);
    });
  });

  describe('GET /leave-requests', () => {
    it('filters by requesterId for employee (ignores query employeeId)', async () => {
      currentRole = 'employee';
      currentRequesterId = 'emp-1';
      leaveRequestService.findAll.mockResolvedValue([mockLeaveRequest]);

      const res = await request(app.getHttpServer()).get('/leave-requests?employeeId=emp-99');
      expect(res.status).toBe(200);
      expect(leaveRequestService.findAll).toHaveBeenCalledWith({ employeeId: 'emp-1', status: undefined });
    });

    it('uses query params for manager role', async () => {
      currentRole = 'manager';
      currentRequesterId = '';
      leaveRequestService.findAll.mockResolvedValue([mockLeaveRequest]);

      const res = await request(app.getHttpServer()).get('/leave-requests?status=PENDING&employeeId=emp-1');
      expect(res.status).toBe(200);
      expect(leaveRequestService.findAll).toHaveBeenCalledWith({ employeeId: 'emp-1', status: 'PENDING' });
    });
  });

  describe('DELETE /leave-requests/:id', () => {
    it('cancels leave request using requesterId from request context', async () => {
      currentRole = 'employee';
      currentRequesterId = 'emp-1';
      leaveRequestService.cancel.mockResolvedValue({ ...mockLeaveRequest, status: LeaveStatus.CANCELLED });

      const res = await request(app.getHttpServer()).delete('/leave-requests/lr-1');
      expect(res.status).toBe(200);
      expect(leaveRequestService.cancel).toHaveBeenCalledWith('lr-1', 'emp-1');
    });
  });

  describe('PATCH /leave-requests/:id/approve', () => {
    it('approves leave request and passes x-manager-id header', async () => {
      currentRole = 'manager';
      currentRequesterId = '';
      leaveRequestService.approve.mockResolvedValue({ ...mockLeaveRequest, status: LeaveStatus.APPROVED, resolvedBy: 'mgr-1' });

      const res = await request(app.getHttpServer())
        .patch('/leave-requests/lr-1/approve')
        .set('x-manager-id', 'mgr-1');

      expect(res.status).toBe(200);
      expect(leaveRequestService.approve).toHaveBeenCalledWith('lr-1', 'mgr-1');
    });

    it('defaults managerId to unknown when x-manager-id header is absent', async () => {
      currentRole = 'manager';
      currentRequesterId = '';
      leaveRequestService.approve.mockResolvedValue({ ...mockLeaveRequest, status: LeaveStatus.APPROVED });

      await request(app.getHttpServer()).patch('/leave-requests/lr-1/approve');
      expect(leaveRequestService.approve).toHaveBeenCalledWith('lr-1', 'unknown');
    });
  });

  describe('PATCH /leave-requests/:id/reject', () => {
    it('rejects leave request with optional note', async () => {
      currentRole = 'manager';
      currentRequesterId = '';
      leaveRequestService.reject.mockResolvedValue({ ...mockLeaveRequest, status: LeaveStatus.REJECTED, note: 'Too many pending' });

      const res = await request(app.getHttpServer())
        .patch('/leave-requests/lr-1/reject')
        .set('x-manager-id', 'mgr-1')
        .send({ note: 'Too many pending' });

      expect(res.status).toBe(200);
      expect(leaveRequestService.reject).toHaveBeenCalledWith('lr-1', 'mgr-1', 'Too many pending');
    });

    it('rejects leave request without note', async () => {
      currentRole = 'manager';
      currentRequesterId = '';
      leaveRequestService.reject.mockResolvedValue({ ...mockLeaveRequest, status: LeaveStatus.REJECTED });

      const res = await request(app.getHttpServer())
        .patch('/leave-requests/lr-1/reject')
        .set('x-manager-id', 'mgr-1')
        .send({});

      expect(res.status).toBe(200);
      expect(leaveRequestService.reject).toHaveBeenCalledWith('lr-1', 'mgr-1', undefined);
    });
  });
});
