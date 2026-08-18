/**
 * 零用金管理｜新版正式後端候選
 *
 * This file is a release-candidate source only. Deploy it only to a new
 * Apps Script project whose FORMAL_SPREADSHEET_ID points to the new workbook.
 * The legacy Apps Script and legacy tabs remain untouched.
 */

var FORMAL_API_VERSION = 'formal-v2-2026-08-12';
var FORMAL_SPREADSHEET_PROPERTY = 'FORMAL_SPREADSHEET_ID';
var FORMAL_API_KEY_PROPERTY = 'FORMAL_API_KEY';
var FORMAL_CUTOFF_AT = '2026-08-12T17:00:00+08:00';
var FORMAL_SHEETS = {
  opening: 'V2_開帳',
  twbio: 'V2_全瑩_交易',
  changying: 'V2_長瑩_交易',
  counts: 'V2_盤點差異',
  audit: 'V2_稽核軌跡',
  historical: 'V2_歷史待整理'
};
// Keep operational tab names ASCII-only so the backend is stable across
// different browser, operating-system, and Google Workspace language settings.
FORMAL_SHEETS = {
  opening: 'V2_OPENING',
  twbio: 'V2_TWBIO_TRANSACTIONS',
  changying: 'V2_CHANGYING_TRANSACTIONS',
  counts: 'V2_CASH_COUNTS',
  audit: 'V2_AUDIT_LOG',
  historical: 'V2_HISTORICAL_PENDING'
};

var FORMAL_COMPANIES = {
  twbio: { name: '全瑩', openingCash: 15943 },
  changying: { name: '長瑩', openingCash: 2071 }
};
var FORMAL_TX_HEADERS = ['id', 'companyId', 'transactionDate', 'transactionType', 'amount', 'purpose', 'handlerId', 'cashStatus', 'actualExpense', 'returnedCash', 'receiptStatus', 'receiptReference', 'settledAt', 'settledBy', 'requestId', 'revision', 'periodStatus', 'originalId', 'correctionReason', 'direction', 'createdAt', 'createdBy', 'updatedAt'];
var FORMAL_COUNT_HEADERS = ['id', 'companyId', 'countedAt', 'countedBy', 'ledgerCash', 'actualCash', 'difference', 'reason', 'status', 'createdAt', 'requestId'];
var FORMAL_AUDIT_HEADERS = ['id', 'companyId', 'entityType', 'entityId', 'action', 'before', 'after', 'reason', 'actorId', 'createdAt'];

function doGet(e) { return json_(dispatch_(String((e.parameter || {}).action || ''), e.parameter || {})); }
function doPost(e) {
  try { return json_(dispatch_('', JSON.parse(e.postData.contents || '{}'))); }
  catch (error) { return json_(failure_(error)); }
}

function dispatch_(unusedAction, payload) {
  try {
    requireFormalApiKey_(payload);
    var action = String(payload.action || '');
    if (action === 'getHomeData') return success_({ home: getHome_(payload) });
    if (action === 'getRecords') return success_({ records: records_(payload) });
    if (action === 'getAudit') return success_({ audit: getAudit_(payload) });
    if (action === 'initializeFormalDatabase') return initializeFormalDatabase_(payload);
    if (action === 'addOpening') return addOpening_(payload);
    if (action === 'closePeriod') return closePeriod_(payload);
    if (action === 'addAdvance') return create_(payload, 'advance');
    if (action === 'addDirectExpense') return create_(payload, 'direct_expense');
    if (action === 'addReplenishment') return create_(payload, 'replenishment');
    if (action === 'settleAdvance') return settle_(payload);
    if (action === 'confirmSync') return confirmSync_(payload);
    if (action === 'addCount') return count_(payload);
    if (action === 'createCorrection') return correction_(payload);
    throw coded_('invalid_action', 'Unsupported formal backend action');
  } catch (error) { return failure_(error); }
}

function initializeFormalDatabase_(payload) {
  sheet_(FORMAL_SHEETS.opening, ['cutoverAt', 'companyId', 'companyName', 'openingCash', 'source', 'includeInIncome', 'includeInExpense', 'createdAt']);
  sheet_(FORMAL_SHEETS.twbio, FORMAL_TX_HEADERS);
  sheet_(FORMAL_SHEETS.changying, FORMAL_TX_HEADERS);
  sheet_(FORMAL_SHEETS.counts, FORMAL_COUNT_HEADERS);
  sheet_(FORMAL_SHEETS.audit, FORMAL_AUDIT_HEADERS);
  sheet_(FORMAL_SHEETS.historical, ['id', 'companyId', 'originalId', 'originalDate', 'originalType', 'originalAmount', 'status', 'enteredBy', 'createdAt', 'note', 'requestId']);
  return success_({ initialized: true, apiVersion: FORMAL_API_VERSION });
}

function confirmSync_(payload) {
  var companyId = requireCompanyId_(payload.companyId); var actor = text_(payload.actorId, 'actorId'); var rows = readTx_(companyId); var tx = rows.filter(function(r) { return r.requestId === payload.requestId; })[0];
  if (!tx) throw coded_('not_found', 'Pending transaction not found');
  if (tx.cashStatus !== 'pending_sync') return success_({ transaction: tx, idempotent: true, ledgerCash: ledger_(companyId, rows) });
  tx.cashStatus = tx.transactionType === 'advance' ? 'open' : 'settled'; tx.settledAt = tx.transactionType === 'advance' ? null : now_(); tx.settledBy = tx.transactionType === 'advance' ? null : actor; tx.updatedAt = now_(); tx.revision = Number(tx.revision || 1) + 1;
  update_(sheet_(FORMAL_SHEETS[companyId], FORMAL_TX_HEADERS), FORMAL_TX_HEADERS, tx); audit_(companyId, 'transaction', tx.id, 'confirm_sync', { cashStatus: 'pending_sync' }, tx, null, actor); return success_({ transaction: tx, ledgerCash: ledger_(companyId, readTx_(companyId)) });
}

function getHome_(payload) {
  var company = company_(payload.companyId);
  var rows = readTx_(payload.companyId);
  var ledger = ledger_(payload.companyId, rows);
  return { apiVersion: FORMAL_API_VERSION, company: company, ledgerCash: ledger,
    openAdvances: rows.filter(function(r) { return r.transactionType === 'advance' && r.cashStatus === 'open'; }),
    pendingReceipts: rows.filter(function(r) { return r.receiptStatus === 'pending' && r.cashStatus === 'settled'; }),
    recent: rows.sort(function(a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); }).slice(0, 10) };
}

function addOpening_(payload) {
  var companyId = requireCompanyId_(payload.companyId);
  var config = company_(companyId);
  var rows = readOpening_();
  var existing = rows.filter(function(r) { return r.companyId === companyId && r.cutoverAt === FORMAL_CUTOFF_AT; })[0];
  if (existing) {
    if (Number(existing.openingCash) !== config.openingCash) throw coded_('opening_conflict', 'Opening balance already exists with a different amount');
    return success_({ opening: existing, idempotent: true });
  }
  if (Number(payload.openingCash) !== config.openingCash) throw coded_('opening_conflict', 'Opening amount does not match approved physical count');
  var opening = { cutoverAt: FORMAL_CUTOFF_AT, companyId: companyId, companyName: config.name, openingCash: config.openingCash, source: 'physical_cash_count', includeInIncome: false, includeInExpense: false, createdAt: now_() };
  var sheet = sheet_(FORMAL_SHEETS.opening, ['cutoverAt', 'companyId', 'companyName', 'openingCash', 'source', 'includeInIncome', 'includeInExpense', 'createdAt']);
  sheet.appendRow(['2026-08-12T17:00:00+08:00', companyId, config.name, config.openingCash, opening.source, false, false, opening.createdAt]);
  audit_(companyId, 'opening', companyId, 'create', null, opening, 'physical_cash_count', text_(payload.actorId, 'actorId'));
  return success_({ opening: opening, idempotent: false });
}

function create_(payload, type) {
  var companyId = requireCompanyId_(payload.companyId); var actor = text_(payload.actorId, 'actorId'); var requestId = text_(payload.requestId, 'requestId');
  var createdAt = now_();
  if (payload.transactionDate && new Date(payload.transactionDate).getTime() < new Date(FORMAL_CUTOFF_AT).getTime()) {
    var historicalHeaders = ['id', 'companyId', 'originalId', 'originalDate', 'originalType', 'originalAmount', 'status', 'enteredBy', 'createdAt', 'note', 'requestId']; var historicalSheet = sheet_(FORMAL_SHEETS.historical, historicalHeaders); var historicalRows = objects_(historicalSheet, historicalHeaders); var historicalDuplicate = historicalRows.filter(function(r) { return r.requestId === requestId; })[0]; if (historicalDuplicate) return success_({ historicalPending: historicalDuplicate, posted: false, idempotent: true, requestId: requestId });
    var historical = { id: 'HIST-' + Utilities.getUuid(), companyId: companyId, originalId: payload.originalId || null, originalDate: payload.transactionDate, originalType: type, originalAmount: amount_(payload.amount), status: 'pending', enteredBy: actor, createdAt: createdAt, note: '切換前交易，保留於歷史待整理，不列入新版帳面', requestId: requestId };
    append_(historicalSheet, historicalHeaders, historical);
    audit_(companyId, 'historical_pending', historical.id, 'create', null, historical, 'before_cutover', actor);
    return success_({ historicalPending: historical, posted: false, requestId: requestId });
  }
  var rows = readTx_(companyId); var duplicate = rows.filter(function(r) { return r.requestId === requestId; })[0];
  if (duplicate) return success_({ transaction: duplicate, ledgerCash: ledger_(companyId, rows), idempotent: true, requestId: requestId });
  var amount = amount_(payload.amount); var pending = payload.syncStatus === 'pending_sync'; var tx = { id: 'TX-' + Utilities.getUuid(), companyId: companyId, transactionDate: payload.transactionDate || createdAt, transactionType: type, amount: amount, purpose: text_(payload.purpose, 'purpose'), handlerId: text_(payload.handlerId || actor, 'handlerId'), cashStatus: pending ? 'pending_sync' : (type === 'advance' ? 'open' : 'settled'), actualExpense: null, returnedCash: null, receiptStatus: payload.receiptStatus || (type === 'replenishment' ? 'not_required' : 'pending'), receiptReference: payload.receiptReference || null, settledAt: pending ? null : (type === 'advance' ? null : createdAt), settledBy: pending ? null : (type === 'advance' ? null : actor), requestId: requestId, revision: 1, periodStatus: 'open', originalId: payload.originalId || null, correctionReason: payload.correctionReason || null, createdAt: createdAt, createdBy: actor, updatedAt: createdAt };
  append_(sheet_(FORMAL_SHEETS[companyId], FORMAL_TX_HEADERS), FORMAL_TX_HEADERS, tx); audit_(companyId, 'transaction', tx.id, 'create', null, tx, null, actor);
  return success_({ transaction: tx, ledgerCash: ledger_(companyId, rows.concat([tx])), requestId: requestId });
}

function settle_(payload) {
  var companyId = requireCompanyId_(payload.companyId); var rows = readTx_(companyId); var tx = rows.filter(function(r) { return r.id === payload.id; })[0];
  if (!tx || tx.transactionType !== 'advance') throw coded_('not_found', 'Advance not found');
  if (tx.periodStatus === 'closed') throw coded_('period_closed', 'Closed records are immutable; create a correction');
  if (tx.cashStatus === 'settled') throw coded_('already_settled', 'Advance already settled');
  if (payload.revision != null && Number(payload.revision) !== Number(tx.revision)) throw coded_('revision_conflict', 'Record changed; refresh before settling');
  var actual = amount_(payload.actualExpense), returned = amount_(payload.returnedCash); var difference = tx.amount - actual - returned;
  if (difference !== 0) throw coded_('settlement_difference', 'Settlement must equal advance = expense + returned cash');
  tx.actualExpense = actual; tx.returnedCash = returned; tx.cashStatus = 'settled'; tx.receiptStatus = payload.receiptStatus || 'pending'; tx.settledAt = now_(); tx.settledBy = text_(payload.actorId, 'actorId'); tx.revision = Number(tx.revision || 1) + 1; tx.updatedAt = now_();
  update_(sheet_(FORMAL_SHEETS[companyId], FORMAL_TX_HEADERS), FORMAL_TX_HEADERS, tx); audit_(companyId, 'transaction', tx.id, 'settle', null, tx, null, tx.settledBy);
  return success_({ transaction: tx, ledgerCash: ledger_(companyId, readTx_(companyId)) });
}

function count_(payload) {
  var companyId = requireCompanyId_(payload.companyId); var requestId = text_(payload.requestId, 'requestId'); var existing = objects_(sheet_(FORMAL_SHEETS.counts, FORMAL_COUNT_HEADERS), FORMAL_COUNT_HEADERS).filter(function(r) { return r.requestId === requestId; })[0]; if (existing) return success_({ cashCount: existing, ledgerCash: existing.ledgerCash, idempotent: true }); var actual = amount_(payload.actualCash); var rows = readTx_(companyId); var ledger = ledger_(companyId, rows); var difference = actual - ledger;
  if (difference !== 0 && !String(payload.reason || '').trim()) throw coded_('reason_required', 'Count difference requires a reason');
  var count = { id: 'COUNT-' + Utilities.getUuid(), companyId: companyId, countedAt: now_(), countedBy: text_(payload.actorId, 'actorId'), ledgerCash: ledger, actualCash: actual, difference: difference, reason: payload.reason || null, status: difference === 0 ? 'resolved' : 'open', createdAt: now_(), requestId: requestId };
  append_(sheet_(FORMAL_SHEETS.counts, FORMAL_COUNT_HEADERS), FORMAL_COUNT_HEADERS, count); audit_(companyId, 'cash_count', count.id, 'create', null, count, count.reason, count.countedBy);
  return success_({ cashCount: count, ledgerCash: ledger });
}

function correction_(payload) {
  var companyId = requireCompanyId_(payload.companyId); var originalId = text_(payload.originalId, 'originalId'); var reason = text_(payload.reason, 'reason');
  var original = readTx_(companyId).filter(function(r) { return r.id === originalId; })[0]; if (!original) throw coded_('not_found', 'Original record not found');
  if (original.periodStatus !== 'closed') throw coded_('period_not_closed', 'Corrections are required only after month close');
  var corrected = create_(Object.assign({}, payload, { purpose: '更正：' + original.purpose, amount: payload.amount, originalId: originalId, correctionReason: reason, transactionDate: now_(), direction: payload.direction || 'credit' }), 'adjustment');
  return corrected;
}

function closePeriod_(payload) {
  var companyId = requireCompanyId_(payload.companyId); var actor = text_(payload.actorId, 'actorId'); var period = text_(payload.period, 'period'); var rows = readTx_(companyId); var changed = 0;
  rows.forEach(function(tx) { if (String(tx.transactionDate).slice(0, 7) === period && tx.periodStatus !== 'closed') { tx.periodStatus = 'closed'; tx.updatedAt = now_(); update_(sheet_(FORMAL_SHEETS[companyId], FORMAL_TX_HEADERS), FORMAL_TX_HEADERS, tx); audit_(companyId, 'period', period, 'close', { id: tx.id, periodStatus: 'open' }, { id: tx.id, periodStatus: 'closed' }, 'month_close', actor); changed += 1; } });
  return success_({ companyId: companyId, period: period, closedRecords: changed });
}

function ledger_(companyId, rows) { var total = company_(companyId).openingCash; rows.forEach(function(r) { if (r.cashStatus === 'voided' || r.cashStatus === 'pending_sync') return; if (r.transactionType === 'replenishment') total += r.amount; if (r.transactionType === 'direct_expense') total -= r.amount; if (r.transactionType === 'adjustment') total += (r.direction === 'debit' ? -1 : 1) * Number(r.amount || 0); if (r.transactionType === 'advance') { total -= r.amount; if (r.cashStatus === 'settled') total += Number(r.returnedCash || 0); } }); return total; }
function records_(payload) { return readTx_(requireCompanyId_(payload.companyId)); }
function getAudit_(payload) { var companyId = requireCompanyId_(payload.companyId); return objects_(sheet_(FORMAL_SHEETS.audit, FORMAL_AUDIT_HEADERS), FORMAL_AUDIT_HEADERS).filter(function(r) { return r.companyId === companyId; }); }
function readTx_(companyId) { return objects_(sheet_(FORMAL_SHEETS[companyId], FORMAL_TX_HEADERS), FORMAL_TX_HEADERS).filter(function(r) { return r.companyId === companyId; }); }
function readOpening_() { return objects_(sheet_(FORMAL_SHEETS.opening, ['cutoverAt', 'companyId', 'companyName', 'openingCash', 'source', 'includeInIncome', 'includeInExpense', 'createdAt']), ['cutoverAt', 'companyId', 'companyName', 'openingCash', 'source', 'includeInIncome', 'includeInExpense', 'createdAt']); }
function company_(id) { return FORMAL_COMPANIES[requireCompanyId_(id)]; }
function requireCompanyId_(id) { if (!FORMAL_COMPANIES[id]) throw coded_('invalid_company', 'Unknown company'); return id; }
function requireFormalApiKey_(payload) { var expected = PropertiesService.getScriptProperties().getProperty(FORMAL_API_KEY_PROPERTY); if (!expected) throw coded_('formal_api_key_not_configured', 'Set FORMAL_API_KEY in Script Properties'); if (!payload || String(payload.formalApiKey || '') !== expected) throw coded_('unauthorized_formal_request', 'Invalid formal backend credential'); }
function sheet_(name, headers) { var sheet = spreadsheet_().getSheetByName(name); if (!sheet) throw new Error('Missing V2 sheet: ' + name); if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, headers.length).setValues([headers]); return sheet; }
function spreadsheet_() { var id = PropertiesService.getScriptProperties().getProperty(FORMAL_SPREADSHEET_PROPERTY); if (!id) throw coded_('not_configured', 'FORMAL_SPREADSHEET_ID is not configured'); return SpreadsheetApp.openById(id); }
function append_(sheet, headers, obj) { sheet.appendRow(headers.map(function(h) { return obj[h] == null ? '' : typeof obj[h] === 'object' ? JSON.stringify(obj[h]) : obj[h]; })); }
function update_(sheet, headers, obj) { var rows = sheet.getDataRange().getValues(); for (var i = 1; i < rows.length; i += 1) if (String(rows[i][0]) === String(obj.id)) { sheet.getRange(i + 1, 1, 1, headers.length).setValues([headers.map(function(h) { return obj[h] == null ? '' : obj[h]; })]); return; } throw new Error('Record disappeared'); }
function objects_(sheet, headers) { if (sheet.getLastRow() < 2) return []; return sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues().map(function(row) { var o = {}; headers.forEach(function(h, i) { o[h] = row[i]; }); return o; }); }
function audit_(companyId, type, entityId, action, before, after, reason, actor) { append_(sheet_(FORMAL_SHEETS.audit, FORMAL_AUDIT_HEADERS), FORMAL_AUDIT_HEADERS, { id: 'AUD-' + Utilities.getUuid(), companyId: companyId, entityType: type, entityId: entityId, action: action, before: before, after: after, reason: reason, actorId: actor, createdAt: now_() }); }
function amount_(v) { var n = Number(v); if (!Number.isInteger(n) || n < 0) throw coded_('validation_error', 'Amount must be a non-negative integer'); return n; }
function text_(v, name) { if (!String(v || '').trim()) throw coded_('validation_error', name + ' is required'); return String(v).trim(); }
function now_() { return new Date().toISOString(); }
function coded_(code, message) { var e = new Error(message); e.code = code; return e; }
function success_(data) { data.success = true; data.apiVersion = FORMAL_API_VERSION; return data; }
function failure_(e) { return { success: false, apiVersion: FORMAL_API_VERSION, error: { code: e.code || 'server_error', message: e.message || String(e) } }; }
function json_(data) { return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON); }
