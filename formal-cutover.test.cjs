const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, 'OPENING_BALANCES.json');
const opening = JSON.parse(fs.readFileSync(file, 'utf8'));

test('formal cutover uses the physical count as the opening ledger', () => {
  assert.equal(opening.cutoverDate, '2026-08-12');
  assert.equal(opening.source, 'physical_cash_count');
  assert.equal(opening.companies.twbio.openingCash, 15943);
  assert.equal(opening.companies.changying.openingCash, 2071);
  assert.equal(opening.companies.twbio.openingDifference, 0);
  assert.equal(opening.companies.changying.openingDifference, 0);
});

test('formal cutover does not replay or reinterpret historical cash', () => {
  assert.equal(opening.historicalPolicy.includeHistoricalTransactionsInOpeningLedger, false);
  assert.equal(opening.historicalPolicy.preserveHistoricalTabs, true);
  assert.equal(opening.historicalPolicy.unresolvedItemsRemainSeparate, true);
  assert.equal(opening.historicalPolicy.returnedCashIsIncome, false);
});

test('formal cutover has an explicit Taiwan cutoff boundary', () => {
  assert.equal(opening.cutoverAt, '2026-08-12T17:00:00+08:00');
  assert.equal(opening.historicalPolicy.unregisteredBeforeCutover, 'historical_pending_only');
  assert.equal(opening.historicalPolicy.augustBeforeCutoverStaysLegacy, true);
});

test('formal cutover defines server-confirmed offline posting', () => {
  assert.equal(opening.offlinePolicy.allowed, true);
  assert.equal(opening.offlinePolicy.offlineStatus, 'pending_sync');
  assert.equal(opening.offlinePolicy.countsAsPostedOnlyAfterServerConfirmation, true);
  assert.equal(opening.offlinePolicy.retryUsesSameRequestId, true);
});

test('formal cutover defines manager-only access and immutable close corrections', () => {
  assert.equal(opening.accessPolicy.displayName, '零用金管理者');
  assert.equal(opening.monthClosePolicy.closedRecordsAreImmutable, true);
  assert.equal(opening.monthClosePolicy.correctionsUseNewRecord, true);
  assert.equal(opening.monthClosePolicy.correctionRequiresOriginalIdAndReason, true);
});
