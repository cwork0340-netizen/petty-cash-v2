const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const contract = fs.readFileSync(path.join(__dirname, 'FORMAL_BACKEND_CONTRACT.md'), 'utf8');

test('formal backend gate binds both approved opening balances', () => {
  assert.match(contract, /twbio.*全瑩 opening cash.*15943/s);
  assert.match(contract, /changying.*長瑩 opening cash.*2071/s);
  assert.match(contract, /Opening initialization is idempotent/);
});

test('formal backend gate preserves accounting controls', () => {
  assert.match(contract, /Returned cash is never income/);
  assert.match(contract, /never changes ledger cash/);
  assert.match(contract, /company isolation/);
  assert.match(contract, /Legacy transactions are not replayed/);
});

test('formal deployment remains blocked until integration evidence exists', () => {
  assert.match(contract, /Deployment gate/);
  assert.match(contract, /non-production copy/);
  assert.match(contract, /rollback to the old URL/);
});

