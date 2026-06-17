const EMPLOYEES = {
  alice: '550e8400-e29b-41d4-a716-446655440001',
  bob:   '550e8400-e29b-41d4-a716-446655440002',
  carol: '550e8400-e29b-41d4-a716-446655440003',
};

const LOCATIONS = {
  newYork: '660e8400-e29b-41d4-a716-446655440001',
  london:  '660e8400-e29b-41d4-a716-446655440002',
};

// Initial balances: { [employeeId:locationId]: totalDays }
const SEED_BALANCES = {
  [`${EMPLOYEES.alice}:${LOCATIONS.newYork}`]: 20,
  [`${EMPLOYEES.alice}:${LOCATIONS.london}`]:  10,
  [`${EMPLOYEES.bob}:${LOCATIONS.newYork}`]:   15,
  [`${EMPLOYEES.carol}:${LOCATIONS.london}`]:  12,
};

module.exports = { EMPLOYEES, LOCATIONS, SEED_BALANCES };
