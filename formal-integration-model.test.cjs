const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const opening = JSON.parse(fs.readFileSync(path.join(__dirname, 'OPENING_BALANCES.json'), 'utf8'));
const cutoff = new Date(opening.cutoverAt).getTime();

function routeEntry(entry) {
  const at = new Date(entry.createdAt).getTime();
  if (at < cutoff) return { status: 'historical_pending', includeInLedger: false, source: 'legacy' };
  return { status: entry.serverConfirmed ? 'posted' : 'pending_sync', includeInLedger: Boolean(entry.serverConfirmed), source: 'new_ledger' };
}

function settle(advance, actualExpense, returnedCash) {
  const difference = advance.amount - actualExpense - returnedCash;
  if (difference !== 0) return { status: 'discrepancy_pending', difference };
  return { status: 'settled', ledgerDelta: -actualExpense, returnedCashIsIncome: false };
}

function correctClosed(original, corrected, reason) {
  if (original.periodStatus === 'closed') {
    return { allowed: Boolean(reason && original.id && corrected.originalId === original.id), createsNewRecord: true };
  }
  return { allowed: true, createsNewRecord: false };
}

test('cutoff routes pre-17:00 entries to legacy and post-17:00 entries to new ledger', () => {
  assert.equal(routeEntry({ createdAt: '2026-08-12T16:59:59+08:00', serverConfirmed: true }).includeInLedger, false);
  assert.equal(routeEntry({ createdAt: '2026-08-12T16:59:59+08:00', serverConfirmed: true }).status, 'historical_pending');
  assert.equal(routeEntry({ createdAt: '2026-08-12T17:00:00+08:00', serverConfirmed: false }).status, 'pending_sync');
  assert.equal(routeEntry({ createdAt: '2026-08-12T17:00:00+08:00', serverConfirmed: true }).includeInLedger, true);
});

test('opening balances are physical counts and never income or expense', () => {
  assert.equal(opening.companies.twbio.openingCash, 15943);
  assert.equal(opening.companies.changying.openingCash, 2071);
  assert.equal(opening.historicalPolicy.returnedCashIsIncome, false);
});

test('offline pending entry is excluded until server confirmation', () => {
  const pending = routeEntry({ createdAt: '2026-08-12T17:01:00+08:00', serverConfirmed: false });
  const confirmed = routeEntry({ createdAt: '2026-08-12T17:01:00+08:00', serverConfirmed: true });
  assert.equal(pending.includeInLedger, false);
  assert.equal(confirmed.includeInLedger, true);
});

test('settlement stays on original advance and returned cash is not income', () => {
  assert.deepEqual(settle({ amount: 1000 }, 800, 200), { status: 'settled', ledgerDelta: -800, returnedCashIsIncome: false });
  assert.deepEqual(settle({ amount: 1000 }, 800, 150), { status: 'discrepancy_pending', difference: 50 });
});

test('closed records reject direct edit and require a linked correction record', () => {
  assert.deepEqual(correctClosed({ id: 'TX-1', periodStatus: 'closed' }, { originalId: 'TX-1' }, ''), { allowed: false, createsNewRecord: true });
  assert.deepEqual(correctClosed({ id: 'TX-1', periodStatus: 'closed' }, { originalId: 'TX-1' }, '發票更正'), { allowed: true, createsNewRecord: true });
});

