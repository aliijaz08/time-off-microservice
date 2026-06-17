import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';

describe('SyncController', () => {
  let app: INestApplication;
  let dataSourceQuery: jest.Mock;

  const syncService = { batchSync: jest.fn() };

  beforeAll(async () => {
    dataSourceQuery = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SyncController],
      providers: [
        { provide: SyncService, useValue: syncService },
        { provide: getDataSourceToken(), useValue: { query: dataSourceQuery } },
        { provide: APP_GUARD, useValue: { canActivate: () => true } },
      ],
    }).compile();

    app = module.createNestApplication();
    await app.init();
  });

  afterAll(() => app.close());
  afterEach(() => jest.clearAllMocks());

  describe('POST /hcm/batch-sync', () => {
    it('delegates array payload to syncService and returns result', async () => {
      syncService.batchSync.mockResolvedValue({ updated: 2, inserted: 1, flagged: 0 });

      const res = await request(app.getHttpServer())
        .post('/hcm/batch-sync')
        .send([{ employeeId: 'emp-1', locationId: 'loc-1', totalDays: 20 }]);

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ updated: 2, inserted: 1, flagged: 0 });
      expect(syncService.batchSync).toHaveBeenCalled();
    });

    it('returns 400 when body is not an array', async () => {
      const res = await request(app.getHttpServer())
        .post('/hcm/batch-sync')
        .send({ employeeId: 'emp-1' });

      expect(res.status).toBe(400);
      expect(syncService.batchSync).not.toHaveBeenCalled();
    });
  });

  describe('GET /health', () => {
    it('returns 200 with db connected when DB query succeeds', async () => {
      dataSourceQuery.mockResolvedValue([]);

      const res = await request(app.getHttpServer()).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.db).toBe('connected');
      expect(typeof res.body.timestamp).toBe('string');
    });

    it('returns 503 with db error when DB query throws', async () => {
      dataSourceQuery.mockRejectedValue(new Error('connection refused'));

      const res = await request(app.getHttpServer()).get('/health');
      expect(res.status).toBe(503);
      expect(res.body.status).toBe('degraded');
      expect(res.body.db).toBe('error');
    });
  });
});
