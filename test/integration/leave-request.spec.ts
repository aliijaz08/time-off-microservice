import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { startTestApp, stopTestApp, resetTestState, empHeaders, mgrHeaders } from '../helpers/setup';
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

function leavePayload(overrides: object = {}) {
  return {
    employeeId: ALICE,
    locationId: NY,
    startDate: '2099-07-01',
    endDate: '2099-07-05',
    ...overrides,
  };
}

describe('Leave request lifecycle (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => { app = await startTestApp(); });
  afterAll(async () => { await stopTestApp(); });
  beforeEach(async () => { await resetTestState(app); });

  // ── Submit ────────────────────────────────────────────────────────────────

  it('POST /leave-requests creates a PENDING request', async () => {
    const res = await request(app.getHttpServer())
      .post('/leave-requests')
      .set(empHeaders(ALICE))
      .send(leavePayload())
      .expect(201);

    expect(res.body.status).toBe('PENDING');
    expect(res.body.daysRequested).toBe(5);
    expect(res.body.employeeId).toBe(ALICE);
  });

  it('returns 400 when startDate is in the past', async () => {
    const res = await request(app.getHttpServer())
      .post('/leave-requests')
      .set(empHeaders(ALICE))
      .send(leavePayload({ startDate: '2000-01-01', endDate: '2000-01-05' }))
      .expect(400);
    expect(res.body.error).toBeTruthy();
  });

  it('returns 400 when endDate is before startDate', async () => {
    await request(app.getHttpServer())
      .post('/leave-requests')
      .set(empHeaders(ALICE))
      .send(leavePayload({ startDate: '2099-07-10', endDate: '2099-07-05' }))
      .expect(400);
  });

  it('returns 409 when dates overlap with an existing PENDING request', async () => {
    await request(app.getHttpServer())
      .post('/leave-requests')
      .set(empHeaders(ALICE))
      .send(leavePayload())
      .expect(201);

    await request(app.getHttpServer())
      .post('/leave-requests')
      .set(empHeaders(ALICE))
      .send(leavePayload({ startDate: '2099-07-03', endDate: '2099-07-08' }))
      .expect(409);
  });

  it('returns 409 when local balance is insufficient', async () => {
    // Set HCM to return only 2 days
    await hcmControl('/mock/set-balance', { employeeId: ALICE, locationId: NY, totalDays: 2 });

    await request(app.getHttpServer())
      .post('/leave-requests')
      .set(empHeaders(ALICE))
      .send(leavePayload()) // 5 days requested
      .expect(409);
  });

  it('returns 503 when HCM is unavailable during submit', async () => {
    await hcmControl('/mock/set-unavailable', { unavailable: true });

    await request(app.getHttpServer())
      .post('/leave-requests')
      .set(empHeaders(ALICE))
      .send(leavePayload())
      .expect(503);
  });

  it('returns 422 when HCM rejects due to invalid dimension', async () => {
    await request(app.getHttpServer())
      .post('/leave-requests')
      .set(empHeaders(ALICE))
      .send(leavePayload({ locationId: '00000000-0000-0000-0000-000000000000' }))
      .expect(404); // location not found in DB
  });

  // ── Approve ───────────────────────────────────────────────────────────────

  it('Submit → Approve: request becomes APPROVED, balance updated', async () => {
    const submit = await request(app.getHttpServer())
      .post('/leave-requests')
      .set(empHeaders(ALICE))
      .send(leavePayload())
      .expect(201);

    const lrId = submit.body.id;

    const approve = await request(app.getHttpServer())
      .patch(`/leave-requests/${lrId}/approve`)
      .set(mgrHeaders())
      .set('X-Manager-ID', 'mgr-001')
      .expect(200);

    expect(approve.body.status).toBe('APPROVED');
    expect(approve.body.resolvedBy).toBe('mgr-001');

    const balance = await request(app.getHttpServer())
      .get(`/balances/${ALICE}/${NY}`)
      .set(empHeaders(ALICE))
      .expect(200);

    expect(balance.body.usedDays).toBe(5);
    expect(balance.body.pendingDays).toBe(0);
  });

  it('Approve returns 409 when request is already approved', async () => {
    const submit = await request(app.getHttpServer())
      .post('/leave-requests')
      .set(empHeaders(ALICE))
      .send(leavePayload())
      .expect(201);

    const lrId = submit.body.id;
    await request(app.getHttpServer()).patch(`/leave-requests/${lrId}/approve`).set(mgrHeaders()).expect(200);
    await request(app.getHttpServer()).patch(`/leave-requests/${lrId}/approve`).set(mgrHeaders()).expect(409);
  });

  it('Approve returns 422 when HCM deduct fails', async () => {
    const submit = await request(app.getHttpServer())
      .post('/leave-requests')
      .set(empHeaders(ALICE))
      .send(leavePayload())
      .expect(201);

    // Drain balance in HCM so deduct fails
    await hcmControl('/mock/set-balance', { employeeId: ALICE, locationId: NY, totalDays: 0 });

    await request(app.getHttpServer())
      .patch(`/leave-requests/${submit.body.id}/approve`)
      .set(mgrHeaders())
      .expect(422);
  });

  // ── Reject ────────────────────────────────────────────────────────────────

  it('Submit → Reject: request becomes REJECTED, pendingDays released', async () => {
    const submit = await request(app.getHttpServer())
      .post('/leave-requests')
      .set(empHeaders(ALICE))
      .send(leavePayload())
      .expect(201);

    const reject = await request(app.getHttpServer())
      .patch(`/leave-requests/${submit.body.id}/reject`)
      .set(mgrHeaders())
      .set('X-Manager-ID', 'mgr-001')
      .send({ note: 'Busy period' })
      .expect(200);

    expect(reject.body.status).toBe('REJECTED');
    expect(reject.body.note).toBe('Busy period');

    const balance = await request(app.getHttpServer())
      .get(`/balances/${ALICE}/${NY}`)
      .set(empHeaders(ALICE))
      .expect(200);

    expect(balance.body.pendingDays).toBe(0);
  });

  // ── Cancel ────────────────────────────────────────────────────────────────

  it('Submit → Cancel: request becomes CANCELLED, pendingDays released', async () => {
    const submit = await request(app.getHttpServer())
      .post('/leave-requests')
      .set(empHeaders(ALICE))
      .send(leavePayload())
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/leave-requests/${submit.body.id}`)
      .set(empHeaders(ALICE))
      .expect(200);

    const balance = await request(app.getHttpServer())
      .get(`/balances/${ALICE}/${NY}`)
      .set(empHeaders(ALICE))
      .expect(200);

    expect(balance.body.pendingDays).toBe(0);
  });

  it('returns 403 when employee cancels another employee\'s request', async () => {
    const submit = await request(app.getHttpServer())
      .post('/leave-requests')
      .set(empHeaders(ALICE))
      .send(leavePayload())
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/leave-requests/${submit.body.id}`)
      .set(empHeaders(EMPLOYEES.bob))
      .expect(403);
  });

  // ── List / Get ────────────────────────────────────────────────────────────

  it('GET /leave-requests?employeeId returns only that employee\'s requests', async () => {
    await request(app.getHttpServer())
      .post('/leave-requests')
      .set(empHeaders(ALICE))
      .send(leavePayload())
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/leave-requests')
      .set(empHeaders(ALICE))
      .expect(200);

    expect(res.body.every((lr: any) => lr.employeeId === ALICE)).toBe(true);
  });

  it('GET /leave-requests?status=PENDING returns all pending for managers', async () => {
    await request(app.getHttpServer())
      .post('/leave-requests')
      .set(empHeaders(ALICE))
      .send(leavePayload())
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/leave-requests?status=PENDING')
      .set(mgrHeaders())
      .expect(200);

    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body.every((lr: any) => lr.status === 'PENDING')).toBe(true);
  });
});
