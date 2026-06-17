import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { startTestApp, stopTestApp, resetTestState, empHeaders, mgrHeaders, sysHeaders } from '../helpers/setup';
import { EMPLOYEES, LOCATIONS } from '../helpers/constants';

describe('Auth guard (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => { app = await startTestApp(); });
  afterAll(async () => { await stopTestApp(); });
  beforeEach(async () => { await resetTestState(app); });

  it('GET /health is public — no key needed', async () => {
    await request(app.getHttpServer()).get('/health').expect(200);
  });

  it('returns 401 when API key is missing', async () => {
    await request(app.getHttpServer()).get(`/balances/${EMPLOYEES.alice}`).expect(401);
  });

  it('returns 401 when API key is invalid', async () => {
    await request(app.getHttpServer())
      .get(`/balances/${EMPLOYEES.alice}`)
      .set('X-API-Key', 'wrong-key')
      .set('X-Employee-ID', EMPLOYEES.alice)
      .expect(401);
  });

  it('returns 401 when employee key is missing X-Employee-ID', async () => {
    await request(app.getHttpServer())
      .get(`/balances/${EMPLOYEES.alice}`)
      .set('X-API-Key', 'employee-secret')
      .expect(401);
  });

  it('returns 200 for employee accessing their own balance', async () => {
    await request(app.getHttpServer())
      .get(`/balances/${EMPLOYEES.alice}`)
      .set(empHeaders(EMPLOYEES.alice))
      .expect(200);
  });

  it('returns 403 when employee accesses another employee\'s balance', async () => {
    await request(app.getHttpServer())
      .get(`/balances/${EMPLOYEES.bob}`)
      .set(empHeaders(EMPLOYEES.alice))
      .expect(403);
  });

  it('returns 403 when employee calls a manager-only endpoint', async () => {
    await request(app.getHttpServer())
      .get('/admin/flagged-balances')
      .set(empHeaders(EMPLOYEES.alice))
      .expect(403);
  });

  it('returns 200 for manager on flagged-balances', async () => {
    await request(app.getHttpServer())
      .get('/admin/flagged-balances')
      .set(mgrHeaders())
      .expect(200);
  });

  it('returns 403 when manager calls system-only batch-sync', async () => {
    await request(app.getHttpServer())
      .post('/hcm/batch-sync')
      .set(mgrHeaders())
      .send([])
      .expect(403);
  });

  it('returns 200 for system key on batch-sync', async () => {
    await request(app.getHttpServer())
      .post('/hcm/batch-sync')
      .set(sysHeaders())
      .send([])
      .expect(201);
  });

  it('returns 403 when employee submits leave for another employee', async () => {
    await request(app.getHttpServer())
      .post('/leave-requests')
      .set(empHeaders(EMPLOYEES.alice))
      .send({
        employeeId: EMPLOYEES.bob,
        locationId: LOCATIONS.newYork,
        startDate: '2099-07-01',
        endDate: '2099-07-03',
      })
      .expect(403);
  });
});
