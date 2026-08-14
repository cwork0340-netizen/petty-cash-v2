const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const code = fs.readFileSync(__dirname + '/Code.gs', 'utf8');

test('V2 test web app requires a Script Properties credential', () => {
  assert.match(code, /V2_TEST_API_KEY_PROPERTY/);
  assert.match(code, /PropertiesService\.getScriptProperties\(\)/);
  assert.match(code, /requireTestApiKey_\(payload\)/);
  assert.match(code, /unauthorized_test_request/);
});

test('V2 後端只綁定隔離測試資料庫', () => {
  assert.match(code, /V2_TEST_SPREADSHEET_ID = 'REPLACE_WITH_A_SEPARATE_TEST_SPREADSHEET_ID'/);
  assert.doesNotMatch(code, /1WjDwixtAbU7rywz-E83z3Bhflkhz4Iswvlek_NvSTI4/);
  assert.match(code, /company-a-test/);
  assert.match(code, /company-b-test/);
});

test('V2 後端提供規格要求的帳務動作與單一首頁彙總', () => {
  ['getHomeData', 'addAdvance', 'settleAdvance', 'addDirectExpense', 'addReplenishment', 'addCount', 'getRecords', 'getAudit'].forEach(action => {
    assert.ok(code.includes('function ' + action + '('), 'missing action ' + action);
  });
  assert.match(code, /var transactions = readTransactions_\(companyId\)/);
  assert.match(code, /calculateLedger_\(companyId, transactions\)/);
});

test('找零、盤點與不平差異遵守不可違反規則', () => {
  assert.match(code, /Updates the original advance instead of inserting an income\/change row/);
  assert.match(code, /transaction\.returnedCash = returnedCash/);
  assert.match(code, /difference !== 0 && !reason/);
  assert.match(code, /transaction\.cashStatus = difference === 0 \? 'settled' : 'discrepancy_pending'/);
  assert.match(code, /A count is a snapshot only/);
  const ledgerBlock = code.slice(code.indexOf('function calculateLedger_'), code.indexOf('function successWithLedger_'));
  assert.doesNotMatch(ledgerBlock, /readCounts_/);
});

test('後端具備冪等、併發與稽核防線', () => {
  assert.match(code, /LockService\.getScriptLock/);
  assert.match(code, /requestId/);
  assert.match(code, /revision_conflict/);
  assert.match(code, /appendAudit_/);
  assert.match(code, /AUDIT_HEADERS/);
});
