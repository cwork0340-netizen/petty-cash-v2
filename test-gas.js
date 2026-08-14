/**
 * V2 test-only Apps Script proxy.
 *
 * The browser talks only to this same-origin endpoint.  The upstream target is
 * intentionally supplied at deployment time through V2_TEST_GAS_URL; this file
 * must never contain an Apps Script URL or a production fallback.
 */

'use strict';

const API_VERSION = '2026-08-05.v1';
const ALLOWED_ACTIONS = new Set([
  'initializeTestDatabase',
  'getHomeData',
  'getRecords',
  'getAudit',
  'addAdvance',
  'settleAdvance',
  'addDirectExpense',
  'addReplenishment',
  'addCount',
  'resolveCount'
]);

module.exports = async function testGasProxy(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return reply(res, 405, { error: error('method_not_allowed', 'Only GET and POST are supported') });
  }

  const target = process.env.V2_TEST_GAS_URL;
  const testApiKey = process.env.V2_TEST_GAS_KEY;
  if (!target || !testApiKey) {
    return reply(res, 503, {
      error: error('test_backend_not_configured', 'V2_TEST_GAS_URL and V2_TEST_GAS_KEY must be configured for this test deployment')
    });
  }

  let payload;
  try {
    payload = Object.assign(readPayload(req), { testApiKey: testApiKey });
  } catch (parseError) {
    return reply(res, 400, { error: error('invalid_json', parseError.message) });
  }

  const action = typeof payload.action === 'string' ? payload.action : '';
  if (!ALLOWED_ACTIONS.has(action)) {
    return reply(res, 400, { error: error('invalid_action', 'Unsupported test API action') });
  }

  let upstream;
  try {
    const url = new URL(target);
    if (req.method === 'GET') {
      Object.keys(payload).forEach((key) => {
        if (payload[key] !== undefined && payload[key] !== null) url.searchParams.set(key, String(payload[key]));
      });
    }
    upstream = await fetch(url, {
      method: req.method,
      headers: { Accept: 'application/json', ...(req.method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
      body: req.method === 'POST' ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.timeout(10000)
    });
  } catch (networkError) {
    return reply(res, 502, { error: error('test_backend_unavailable', 'The test backend could not be reached') });
  }

  let data;
  try {
    data = await upstream.json();
  } catch (parseError) {
    return reply(res, 502, { error: error('test_backend_invalid_response', 'The test backend did not return JSON') });
  }
  if (!data || typeof data !== 'object' || typeof data.success !== 'boolean') {
    return reply(res, 502, { error: error('test_backend_invalid_response', 'The test backend returned an invalid response contract') });
  }

  // Keep the public envelope stable even if the Apps Script has implementation metadata.
  return reply(res, upstream.ok ? 200 : 502, Object.assign({}, data, {
    success: data.success,
    apiVersion: API_VERSION
  }));
};

function readPayload(req) {
  if (req.method === 'GET') return Object.assign({}, req.query || {});
  if (typeof req.body === 'string') return JSON.parse(req.body);
  if (req.body && typeof req.body === 'object') return req.body;
  return {};
}

function error(code, message) {
  return { code: code, message: message };
}

function reply(res, status, data) {
  return res.status(status).json(Object.assign({ success: false, apiVersion: API_VERSION }, data, {
    apiVersion: API_VERSION
  }));
}
