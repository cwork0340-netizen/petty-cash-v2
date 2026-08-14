const assert = require('node:assert/strict');
const test = require('node:test');

const handler = require('./test-gas.js');

function responseRecorder() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return body; }
  };
}

test('unconfigured test backend is explicit and never falls back to another endpoint', { concurrency: false }, async () => {
  const saved = process.env.V2_TEST_GAS_URL;
  const savedKey = process.env.V2_TEST_GAS_KEY;
  delete process.env.V2_TEST_GAS_URL;
  delete process.env.V2_TEST_GAS_KEY;
  const res = responseRecorder();
  await handler({ method: 'GET', query: { action: 'getHomeData' } }, res);
  if (saved === undefined) delete process.env.V2_TEST_GAS_URL;
  else process.env.V2_TEST_GAS_URL = saved;
  if (savedKey === undefined) delete process.env.V2_TEST_GAS_KEY;
  else process.env.V2_TEST_GAS_KEY = savedKey;

  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, {
    success: false,
    apiVersion: '2026-08-05.v1',
    error: {
      code: 'test_backend_not_configured',
      message: 'V2_TEST_GAS_URL and V2_TEST_GAS_KEY must be configured for this test deployment'
    }
  });
});

test('proxy forwards only allow-listed POST JSON and normalizes the response envelope', { concurrency: false }, async () => {
  const savedUrl = process.env.V2_TEST_GAS_URL;
  const savedKey = process.env.V2_TEST_GAS_KEY;
  const savedFetch = global.fetch;
  process.env.V2_TEST_GAS_URL = 'https://test-backend.invalid/exec';
  process.env.V2_TEST_GAS_KEY = 'test-shared-key';
  let received;
  global.fetch = async (url, options) => {
    received = { url: String(url), options };
    return { ok: true, json: async () => ({ success: true, apiVersion: 'internal-version', transaction: { id: 'tx-test' } }) };
  };
  const res = responseRecorder();
  await handler({ method: 'POST', body: { action: 'addAdvance', companyId: 'company-a-test', amount: 100, requestId: 'req-1' } }, res);
  if (savedUrl === undefined) delete process.env.V2_TEST_GAS_URL;
  else process.env.V2_TEST_GAS_URL = savedUrl;
  if (savedKey === undefined) delete process.env.V2_TEST_GAS_KEY;
  else process.env.V2_TEST_GAS_KEY = savedKey;
  global.fetch = savedFetch;

  assert.equal(received.url, 'https://test-backend.invalid/exec');
  assert.equal(received.options.method, 'POST');
  assert.deepEqual(JSON.parse(received.options.body), { action: 'addAdvance', companyId: 'company-a-test', amount: 100, requestId: 'req-1', testApiKey: 'test-shared-key' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.apiVersion, '2026-08-05.v1');
  assert.deepEqual(res.body.transaction, { id: 'tx-test' });
});
