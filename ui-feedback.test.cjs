const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

test('window.showCompanies is defined exactly once, so the safety-layer version cannot be overwritten', () => {
  const matches = html.match(/window\.showCompanies=/g) || [];
  assert.equal(matches.length, 1);
});

test('index.html includes pressed-state, disabled-state, and toast feedback', () => {
  assert.match(html, /:active/);
  assert.match(html, /button:disabled/);
  assert.match(html, /aria-live/);
});
