const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const code = fs.readFileSync(path.join(__dirname, 'FormalCode.gs'), 'utf8');

test('formal candidate backend binds the new workbook through a script property', () => {
  assert.match(code, /FORMAL_SPREADSHEET_ID/);
  assert.match(code, /V2_開帳/);
  assert.match(code, /V2_全瑩_交易/);
  assert.match(code, /V2_長瑩_交易/);
});

test('formal candidate backend enforces approved opening balances and cutoff', () => {
  assert.match(code, /15943/);
  assert.match(code, /2071/);
  assert.match(code, /2026-08-12T17:00:00\+08:00/);
  assert.match(code, /opening_conflict/);
});

test('formal candidate backend preserves settlement, count, and correction controls', () => {
  assert.match(code, /settlement_difference/);
  assert.match(code, /cash_count/);
  assert.match(code, /period_closed/);
  assert.match(code, /originalId/);
  assert.match(code, /requestId/);
});
