const { Router } = require('express');
const { SEED_BALANCES } = require('./seed-data');

const router = Router();

// In-memory state
let balances = buildFreshStore();
let unavailable = false;

function buildFreshStore() {
  const store = {};
  for (const [key, totalDays] of Object.entries(SEED_BALANCES)) {
    store[key] = { totalDays, usedDays: 0 };
  }
  return store;
}

function unavailableGuard(req, res, next) {
  if (unavailable) return res.status(503).json({ error: 'HCM_UNAVAILABLE' });
  next();
}

// ── Standard HCM endpoints ───────────────────────────────────────────────────

router.get('/hcm/balance/:employeeId/:locationId', unavailableGuard, (req, res) => {
  const { employeeId, locationId } = req.params;
  const key = `${employeeId}:${locationId}`;
  const record = balances[key];

  if (!record) {
    return res.status(404).json({ error: 'INVALID_DIMENSION' });
  }

  const availableDays = record.totalDays - record.usedDays;
  return res.json({ employeeId, locationId, totalDays: record.totalDays, availableDays });
});

router.post('/hcm/deduct', unavailableGuard, (req, res) => {
  const { employeeId, locationId, days } = req.body;

  if (!employeeId || !locationId || days == null) {
    return res.status(400).json({ error: 'MISSING_FIELDS' });
  }

  const key = `${employeeId}:${locationId}`;
  const record = balances[key];

  if (!record) {
    return res.status(422).json({ error: 'INVALID_DIMENSION' });
  }

  const available = record.totalDays - record.usedDays;
  if (days > available) {
    return res.status(422).json({ error: 'INSUFFICIENT_BALANCE', availableDays: available });
  }

  record.usedDays += days;
  const remainingDays = record.totalDays - record.usedDays;
  return res.json({ employeeId, locationId, remainingDays });
});

// ── Test control endpoints ────────────────────────────────────────────────────

router.post('/mock/set-balance', (req, res) => {
  const { employeeId, locationId, totalDays } = req.body;
  const key = `${employeeId}:${locationId}`;
  if (!balances[key]) balances[key] = { totalDays: 0, usedDays: 0 };
  balances[key].totalDays = totalDays;
  return res.json({ ok: true, key, totalDays });
});

router.post('/mock/trigger-bonus', (req, res) => {
  const { employeeId, locationId, bonusDays } = req.body;
  const key = `${employeeId}:${locationId}`;
  if (!balances[key]) return res.status(404).json({ error: 'BALANCE_NOT_FOUND' });
  balances[key].totalDays += bonusDays;
  return res.json({ ok: true, key, newTotalDays: balances[key].totalDays });
});

router.post('/mock/set-unavailable', (req, res) => {
  unavailable = req.body.unavailable === true;
  return res.json({ ok: true, unavailable });
});

router.post('/mock/reset', (req, res) => {
  balances = buildFreshStore();
  unavailable = false;
  return res.json({ ok: true });
});

router.get('/mock/state', (req, res) => {
  return res.json({ unavailable, balances });
});

module.exports = router;
