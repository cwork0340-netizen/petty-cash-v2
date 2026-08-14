const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const proxy = fs.readFileSync(__dirname + '/test-gas.js', 'utf8');

test('V2 proxy does not embed a formal Apps Script URL or a formal spreadsheet identifier', () => {
  assert.doesNotMatch(proxy, /script\.google\.com/i);
  assert.doesNotMatch(proxy, /AKfycbyek_Rbq4ipKjjcGrWQMwOxZDIwWMC9aAqzwI4kSUrpCxvyDl6PHzTyA9T8c4NerS66mQ/);
  assert.doesNotMatch(proxy, /1WjDwixtAbU7rywz-E83z3Bhflkhz4Iswvlek_NvSTI4/);
  assert.match(proxy, /process\.env\.V2_TEST_GAS_URL/);
});

test('V2 proxy only exposes the specified test action allow-list', () => {
  [
    'getHomeData', 'addAdvance', 'settleAdvance', 'addDirectExpense',
    'addReplenishment', 'addCount', 'getRecords', 'getAudit'
  ].forEach((action) => assert.match(proxy, new RegExp("'" + action + "'")));
  assert.match(proxy, /ALLOWED_ACTIONS\.has\(action\)/);
  assert.match(proxy, /invalid_action/);
});

test('V2 proxy has an explicit unconfigured-backend response and a stable response envelope', () => {
  assert.match(proxy, /test_backend_not_configured/);
  assert.match(proxy, /success: false, apiVersion: API_VERSION/);
  assert.match(proxy, /typeof data\.success !== 'boolean'/);
});
