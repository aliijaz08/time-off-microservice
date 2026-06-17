# Time-Off Microservice

A NestJS service that manages the full lifecycle of employee time-off requests, keeping leave balances in sync with an HCM system (e.g. Workday/SAP).

---

## Prerequisites

- Node.js >= 18
- npm >= 9

---

## Install

```bash
npm install
```

---

## Environment Setup

```bash
cp .env.example .env
```

The `.env.example` contains working defaults for local development. No changes required to run locally.

---

## Seed the Database

```bash
npm run seed
```

Creates the `data/` directory (if absent) and inserts employees, locations, and initial balances.

---

## Start Mock HCM Server

In a separate terminal:

```bash
npm run mock-hcm
```

Runs the mock HCM server on port `4000` (configurable via `MOCK_HCM_PORT`).

---

## Start the Service

```bash
npm run start:dev
```

Service starts on port `3000` (configurable via `PORT`).

---

## Run Tests

```bash
# Unit tests
npm test

# Integration tests (requires mock HCM on port 4001 — started automatically)
npm run test:integration

# All tests
npm run test:all
```

---

## Run Tests with Coverage

```bash
npm run test:cov
```

---

## Seed Credentials

Use these values to hit endpoints immediately after seeding:

### API Keys

| Role     | Header      | Value             |
|----------|-------------|-------------------|
| Employee | `X-API-Key` | `employee-secret` |
| Manager  | `X-API-Key` | `manager-secret`  |
| System   | `X-API-Key` | `system-secret`   |

### Employee IDs

| Name         | ID                                     |
|--------------|----------------------------------------|
| Alice Johnson | `550e8400-e29b-41d4-a716-446655440001` |
| Bob Smith     | `550e8400-e29b-41d4-a716-446655440002` |
| Carol White   | `550e8400-e29b-41d4-a716-446655440003` |

### Location IDs

| Name     | ID                                     |
|----------|----------------------------------------|
| New York | `660e8400-e29b-41d4-a716-446655440001` |
| London   | `660e8400-e29b-41d4-a716-446655440002` |

### Example Request

```bash
# Get Alice's balances
curl http://localhost:3000/balances/550e8400-e29b-41d4-a716-446655440001 \
  -H "X-API-Key: employee-secret" \
  -H "X-Employee-ID: 550e8400-e29b-41d4-a716-446655440001"

# Submit a leave request
curl -X POST http://localhost:3000/leave-requests \
  -H "Content-Type: application/json" \
  -H "X-API-Key: employee-secret" \
  -H "X-Employee-ID: 550e8400-e29b-41d4-a716-446655440001" \
  -d '{
    "employeeId": "550e8400-e29b-41d4-a716-446655440001",
    "locationId": "660e8400-e29b-41d4-a716-446655440001",
    "startDate": "2099-08-01",
    "endDate": "2099-08-05"
  }'
```
