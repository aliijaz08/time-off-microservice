import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import * as http from 'http';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { EMPLOYEES, LOCATIONS, MOCK_HCM_PORT, KEYS } from './constants';

// Set env before any module is loaded
process.env.DB_PATH = './data/test.db';
process.env.HCM_BASE_URL = `http://localhost:${MOCK_HCM_PORT}`;
process.env.STALENESS_THRESHOLD_MIN = '0';
process.env.EMPLOYEE_API_KEY = KEYS.employee;
process.env.MANAGER_API_KEY = KEYS.manager;
process.env.SYSTEM_API_KEY = KEYS.system;
process.env.HCM_API_KEY = 'mock-hcm-secret';
process.env.MAX_DAYS_PER_REQUEST = '30';

let app: INestApplication;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockHcm = require('../../mock-hcm/server');

export async function startTestApp() {
  await mockHcm.start(MOCK_HCM_PORT);

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.init();

  const ds = app.get(DataSource);
  await seedBaseData(ds);

  return app;
}

export async function stopTestApp() {
  await app.close();
  await mockHcm.stop();
}

export async function resetTestState(app: INestApplication) {
  const ds = app.get(DataSource);
  await ds.query('DELETE FROM leave_requests');
  await ds.query('DELETE FROM balances');

  await request(app.getHttpServer())
    .post('/mock/reset')
    .catch(() => {});

  // hit mock reset via HTTP
  await new Promise<void>((resolve) => {
    const req = http.request(
      { hostname: 'localhost', port: MOCK_HCM_PORT, path: '/mock/reset', method: 'POST', headers: { 'Content-Type': 'application/json' } },
      (res) => { res.resume(); res.on('end', resolve); },
    );
    req.on('error', () => resolve());
    req.end('{}');
  });
}

async function seedBaseData(ds: DataSource) {
  await ds.query(`
    INSERT OR IGNORE INTO employees (id, name, email, createdAt)
    VALUES
      ('${EMPLOYEES.alice}', 'Alice Johnson', 'alice@example.com', datetime('now')),
      ('${EMPLOYEES.bob}',   'Bob Smith',     'bob@example.com',   datetime('now')),
      ('${EMPLOYEES.carol}', 'Carol White',   'carol@example.com', datetime('now'))
  `);
  await ds.query(`
    INSERT OR IGNORE INTO locations (id, name)
    VALUES
      ('${LOCATIONS.newYork}', 'New York'),
      ('${LOCATIONS.london}',  'London')
  `);
}

export function empHeaders(employeeId: string) {
  return { 'X-API-Key': KEYS.employee, 'X-Employee-ID': employeeId };
}

export function mgrHeaders() {
  return { 'X-API-Key': KEYS.manager };
}

export function sysHeaders() {
  return { 'X-API-Key': KEYS.system };
}
