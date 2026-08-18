/**
 * Formal V2 Apps Script proxy.
 *
 * The browser never receives the Apps Script credential.  This function is
 * deployed only in the separate formal Vercel project.
 */
'use strict';

const API_VERSION = 'formal-v2-2026-08-12';
const ALLOWED_ACTIONS = new Set(['initializeFormalDatabase', 'getHomeData', 'getRecords', 'getAudit', 'addOpening', 'closePeriod', 'addAdvance', 'settleAdvance', 'addDirectExpense', 'addReplenishment', 'addCount', 'confirmSync', 'createCorrection']);

module.exports = async function formalGasProxy(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return reply(res, 405, { error: error('method_not_allowed', 'Only GET and POST are supported') });
  const target = process.env.V2_FORMAL_GAS_URL;
  const formalApiKey = process.env.V2_FORMAL_GAS_KEY;
  if (!target || !formalApiKey) return reply(res, 503, { error: error('formal_backend_not_configured', 'Formal backend has not been configured') });
  let payload;
  try { payload = Object.assign(readPayload(req), { formalApiKey: formalApiKey }); }
  catch (parseError) { return reply(res, 400, { error: error('invalid_json', parseError.message) }); }
  if (!ALLOWED_ACTIONS.has(typeof payload.action === 'string' ? payload.action : '')) return reply(res, 400, { error: error('invalid_action', 'Unsupported formal API action') });
  let upstream;
  try {
    const url = new URL(target);
    if (req.method === 'GET') Object.keys(payload).forEach((key) => { if (payload[key] != null) url.searchParams.set(key, String(payload[key])); });
    upstream = await fetch(url, { method: req.method, headers: { Accept: 'application/json', ...(req.method === 'POST' ? { 'Content-Type': 'application/json' } : {}) }, body: req.method === 'POST' ? JSON.stringify(payload) : undefined, signal: AbortSignal.timeout(10000) });
  } catch (networkError) { return reply(res, 502, { error: error('formal_backend_unavailable', 'The formal backend could not be reached') }); }
  let data;
  try { data = await upstream.json(); }
  catch (parseError) { return reply(res, 502, { error: error('formal_backend_invalid_response', 'The formal backend did not return JSON') }); }
  if (!data || typeof data !== 'object' || typeof data.success !== 'boolean') return reply(res, 502, { error: error('formal_backend_invalid_response', 'The formal backend returned an invalid response contract') });
  return reply(res, upstream.ok ? 200 : 502, Object.assign({}, data, { success: data.success, apiVersion: API_VERSION }));
};
function readPayload(req) { if (req.method === 'GET') return Object.assign({}, req.query || {}); if (typeof req.body === 'string') return JSON.parse(req.body); return req.body && typeof req.body === 'object' ? req.body : {}; }
function error(code, message) { return { code: code, message: message }; }
function reply(res, status, data) { return res.status(status).json(Object.assign({ success: false, apiVersion: API_VERSION }, data, { apiVersion: API_VERSION })); }
