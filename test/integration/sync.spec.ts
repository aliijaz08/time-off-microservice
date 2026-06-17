import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { startTestApp, stopTestApp, resetTestState, empHeaders, sysHeaders, mgrHeaders } from '../helpers/setup';
import { EMPLOYEES, LOCATIONS, MOCK_HCM_PORT } from '../helpers/constants';
import * as http from 'http';

function hcmControl(path: string, body: object = {}): Promise<void> {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req = http.request(
      {
        hostname: 'localhost', port: MOCK_HCM_PORT,
        path, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      },
      (res) => { res.resume(); res.on('end', resolve); },
    );
    req.on('error', () => resolve());
    req.write(data);
    req.end();
  });
}

const ALICE = EMPLOYEES.alice;
const NY = LOCATIONS.newYork;

describe('Sync (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => { app = await startTestApp(); });
  afterAll(async () => { await stopTestApp(); });
  beforeEach(async () => { await resetTestState(app); });

  describe('POST /hcm/batch-sync', () => {
    it('inserts balances that do not exist', async () => {
      const res = await request(app.getHttpServer())
        .post('/hcm/batch-sync')
        .set(sysHeaders())
        .send([{ employeeId: ALICE, locationId: NY, totalDays: 20 }])
        .expect(201);

      expect(res.body.inserted).toBe(1);
      expect(res.body.updated).toBe(0);
      expect(res.body.flagged).toBe(0);
    });

    it('updates existing balances', async () => {
      // Insert first
      await request(app.getHttpServer())
        .post('/hcm/batch-sync')
        .set(sysHeaders())
        .send([{ employeeId: ALICE, locationId: NY, totalDays: 20 }])
        .expect(201);

      // Update
      const res = await request(app.getHttpServer())
        .post('/hcm/batch-sync')
        .set(sysHeaders())
        .send([{ employeeId: ALICE, locationId: NY, totalDays: 25 }])
        .expect(201);

      expect(res.body.updated).toBe(1);
      expect(res.body.inserted).toBe(0);

      const balance = await request(app.getHttpServer())
        .get(`/balances/${ALICE}/${NY}`)
        .set(empHeaders(ALICE))
        .expect(200);

      expect(balance.body.totalDays).toBe(25);
    });

    it('flags balance as overdrawn when batch sync reduces totalDays below used', async () => {
      // Seed balance with some used days via approve flow
      await request(app.getHttpServer())
        .post('/hcm/batch-sync')
        .set(sysHeaders())
        .send([{ employeeId: ALICE, locationId: NY, totalDays: 20 }]);

      const submit = await request(app.getHttpServer())
        .post('/leave-requests')
        .set(empHeaders(ALICE))
        .send({ employeeId: ALICE, locationId: NY, startDate: '2099-07-01', endDate: '2099-07-05' });

      await request(app.getHttpServer())
        .patch(`/leave-requests/${submit.body.id}/approve`)
        .set(mgrHeaders());

      // Now HCM sends a batch sync with a very low totalDays
      const res = await request(app.getHttpServer())
        .post('/hcm/batch-sync')
        .set(sysHeaders())
        .send([{ employeeId: ALICE, locationId: NY, totalDays: 2 }]);

      expect(res.body.flagged).toBe(1);

      const flagged = await request(app.getHttpServer())
        .get('/admin/flagged-balances')
        .set(mgrHeaders())
        .expect(200);

      expect(flagged.body.some((b: any) => b.employeeId === ALICE)).toBe(true);
    });

    it('clears isOverdrawn flag when totalDays is restored', async () => {
      // Create overdrawn state
      await request(app.getHttpServer())
        .post('/hcm/batch-sync')
        .set(sysHeaders())
        .send([{ employeeId: ALICE, locationId: NY, totalDays: 20 }]);

      const submit = await request(app.getHttpServer())
        .post('/leave-requests')
        .set(empHeaders(ALICE))
        .send({ employeeId: ALICE, locationId: NY, startDate: '2099-07-01', endDate: '2099-07-05' });

      await request(app.getHttpServer())
        .patch(`/leave-requests/${submit.body.id}/approve`)
        .set(mgrHeaders());

      await request(app.getHttpServer())
        .post('/hcm/batch-sync')
        .set(sysHeaders())
        .send([{ employeeId: ALICE, locationId: NY, totalDays: 2 }]);

      // Now restore
      await request(app.getHttpServer())
        .post('/hcm/batch-sync')
        .set(sysHeaders())
        .send([{ employeeId: ALICE, locationId: NY, totalDays: 30 }]);

      const flagged = await request(app.getHttpServer())
        .get('/admin/flagged-balances')
        .set(mgrHeaders())
        .expect(200);

      expect(flagged.body.some((b: any) => b.employeeId === ALICE)).toBe(false);
    });

    it('returns 400 when body is not an array', async () => {
      await request(app.getHttpServer())
        .post('/hcm/batch-sync')
        .set(sysHeaders())
        .send({ employeeId: ALICE, locationId: NY, totalDays: 20 })
        .expect(400);
    });
  });

  describe('Anniversary bonus via cron sync', () => {
    it('reflects HCM-side balance increase on next sync', async () => {
      // Seed initial balance
      await request(app.getHttpServer())
        .post('/hcm/batch-sync')
        .set(sysHeaders())
        .send([{ employeeId: ALICE, locationId: NY, totalDays: 20 }]);

      // Simulate anniversary bonus in mock HCM
      await hcmControl('/mock/trigger-bonus', { employeeId: ALICE, locationId: NY, bonusDays: 5 });

      // Batch sync picks up the new total from HCM
      await request(app.getHttpServer())
        .post('/hcm/batch-sync')
        .set(sysHeaders())
        .send([{ employeeId: ALICE, locationId: NY, totalDays: 25 }]); // HCM now has 25

      const balance = await request(app.getHttpServer())
        .get(`/balances/${ALICE}/${NY}`)
        .set(empHeaders(ALICE))
        .expect(200);

      expect(balance.body.totalDays).toBe(25);
      expect(balance.body.availableDays).toBe(25);
    });
  });

  describe('GET /health', () => {
    it('returns status ok with db connected', async () => {
      const res = await request(app.getHttpServer()).get('/health').expect(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.db).toBe('connected');
      expect(res.body.timestamp).toBeTruthy();
    });
  });
});
