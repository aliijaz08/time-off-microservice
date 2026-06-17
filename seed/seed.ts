import 'reflect-metadata';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { DataSource } from 'typeorm';
import { Employee } from '../src/employee/employee.entity';
import { Location } from '../src/location/location.entity';
import { Balance } from '../src/balance/balance.entity';
import { LeaveRequest } from '../src/leave-request/leave-request.entity';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const DB_PATH = process.env.DB_PATH ?? './data/timeoff.db';

const ds = new DataSource({
  type: 'better-sqlite3',
  database: DB_PATH,
  entities: [Employee, Location, Balance, LeaveRequest],
  synchronize: true,
});

const EMPLOYEES = [
  { id: '550e8400-e29b-41d4-a716-446655440001', name: 'Alice Johnson', email: 'alice@example.com' },
  { id: '550e8400-e29b-41d4-a716-446655440002', name: 'Bob Smith',     email: 'bob@example.com'   },
  { id: '550e8400-e29b-41d4-a716-446655440003', name: 'Carol White',   email: 'carol@example.com' },
];

const LOCATIONS = [
  { id: '660e8400-e29b-41d4-a716-446655440001', name: 'New York' },
  { id: '660e8400-e29b-41d4-a716-446655440002', name: 'London'   },
];

const BALANCES = [
  { employeeId: '550e8400-e29b-41d4-a716-446655440001', locationId: '660e8400-e29b-41d4-a716-446655440001', totalDays: 20 },
  { employeeId: '550e8400-e29b-41d4-a716-446655440001', locationId: '660e8400-e29b-41d4-a716-446655440002', totalDays: 10 },
  { employeeId: '550e8400-e29b-41d4-a716-446655440002', locationId: '660e8400-e29b-41d4-a716-446655440001', totalDays: 15 },
  { employeeId: '550e8400-e29b-41d4-a716-446655440003', locationId: '660e8400-e29b-41d4-a716-446655440002', totalDays: 12 },
];

async function seed() {
  await ds.initialize();

  const empRepo = ds.getRepository(Employee);
  const locRepo = ds.getRepository(Location);
  const balRepo = ds.getRepository(Balance);

  for (const emp of EMPLOYEES) {
    await empRepo.upsert(emp, ['id']);
  }
  console.log(`Seeded ${EMPLOYEES.length} employees.`);

  for (const loc of LOCATIONS) {
    await locRepo.upsert(loc, ['id']);
  }
  console.log(`Seeded ${LOCATIONS.length} locations.`);

  for (const { employeeId, locationId, totalDays } of BALANCES) {
    const existing = await balRepo.findOne({ where: { employeeId, locationId } });
    if (!existing) {
      await balRepo.save(balRepo.create({ employeeId, locationId, totalDays, usedDays: 0, pendingDays: 0, isOverdrawn: false }));
    }
  }
  console.log(`Seeded ${BALANCES.length} balances.`);

  await ds.destroy();
  console.log('Seed complete.');
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
