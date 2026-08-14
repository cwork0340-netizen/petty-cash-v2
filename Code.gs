/**
 * Petty Cash V2 — TEST BACKEND ONLY
 * Backend version: v2-test-0.1.0
 *
 * This file is deliberately independent from google-apps-script/ and from the
 * production Apps Script project.  Before deploying it, set V2_TEST_SPREADSHEET_ID
 * to a NEW, empty test spreadsheet.  Never put a production spreadsheet ID here.
 *
 * Data contract: v2/PRODUCT_SPEC.md
 */

var V2_API_VERSION = 'v2-test-0.1.0';
// This must be replaced only in a cwork-owned, isolated test deployment.
// Never commit a deployed spreadsheet ID here.
var V2_TEST_SPREADSHEET_ID = 'REPLACE_WITH_A_SEPARATE_TEST_SPREADSHEET_ID';
var V2_TEST_API_KEY_PROPERTY = 'V2_TEST_API_KEY';
var V2_SHEETS = {
  transactions: 'cash_transactions',
  counts: 'cash_counts',
  audit: 'audit_log'
};

// Test-only seed settings.  Production settings must not be copied here.
var V2_COMPANIES = {
  'company-a-test': { name: '測試公司 A', initialCash: 10000 },
  'company-b-test': { name: '測試公司 B', initialCash: 5000 }
};
var V2_TEST_ADMIN_ACTORS = ['test-admin'];

var TX_HEADERS = [
  'id', 'companyId', 'transactionType', 'transactionDate', 'amount', 'purpose',
  'handlerId', 'cashStatus', 'actualExpense', 'returnedCash', 'receiptStatus',
  'receiptReference', 'settledAt', 'settledBy', 'adjustmentReason', 'requestId',
  'revision', 'createdAt', 'createdBy', 'updatedAt', 'settlementRequestId',
  'adjustmentDirection'
];
var COUNT_HEADERS = [
  'id', 'companyId', 'countedAt', 'countedBy', 'ledgerCash', 'actualCash',
  'difference', 'reason', 'status', 'evidence', 'createdAt', 'requestId'
];
var AUDIT_HEADERS = [
  'id', 'companyId', 'entityType', 'entityId', 'action', 'before', 'after',
  'reason', 'actorId', 'createdAt'
];

function doGet(e) {
  return jsonResponse_(dispatch_(String((e.parameter || {}).action || ''), (e.parameter || {})));
}

function doPost(e) {
  try {
    var body = e && e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};
    return jsonResponse_(dispatch_(String(body.action || ''), body));
  } catch (error) {
    return jsonResponse_(failure_(error));
  }
}

/** Action dispatcher used by the test frontend. */
function dispatch_(action, payload) {
  try {
    requireTestApiKey_(payload);
    if (action === 'getHomeData') return success_({ home: getHomeData(payload) });
    if (action === 'initializeTestDatabase') return initializeTestDatabase();
    if (action === 'getRecords') return success_({ records: getRecords(payload) });
    if (action === 'getAudit') return success_({ audit: getAudit(payload) });
    if (action === 'addAdvance') return addAdvance(payload);
    if (action === 'settleAdvance') return settleAdvance(payload);
    if (action === 'addDirectExpense') return addDirectExpense(payload);
    if (action === 'addReplenishment') return addReplenishment(payload);
    if (action === 'addCount') return addCount(payload);
    if (action === 'resolveCount') return resolveCount(payload);
    throw new Error('Unknown action: ' + action);
  } catch (error) {
    return failure_(error);
  }
}

/** The test web app is not a public spreadsheet API. Store this key only in Script Properties. */
function requireTestApiKey_(payload) {
  var expected = PropertiesService.getScriptProperties().getProperty(V2_TEST_API_KEY_PROPERTY);
  if (!expected) throw codedError_('test_api_key_not_configured', 'Set V2_TEST_API_KEY in this test project Script Properties');
  if (!payload || String(payload.testApiKey || '') !== expected) {
    throw codedError_('unauthorized_test_request', 'Invalid test backend credential');
  }
}

/** Run once after creating the separate test spreadsheet; creates only V2 test tabs. */
function initializeTestDatabase() {
  sheet_(V2_SHEETS.transactions, TX_HEADERS);
  sheet_(V2_SHEETS.counts, COUNT_HEADERS);
  sheet_(V2_SHEETS.audit, AUDIT_HEADERS);
  return { apiVersion: V2_API_VERSION, sheets: [V2_SHEETS.transactions, V2_SHEETS.counts, V2_SHEETS.audit] };
}

/** Reads transactions once and derives every homepage number from that snapshot. */
function getHomeData(payload) {
  var companyId = requireCompany_(payload.companyId);
  var transactions = readTransactions_(companyId);
  var counts = readCounts_(companyId);
  var ledgerCash = calculateLedger_(companyId, transactions);
  var openAdvances = transactions.filter(function(tx) {
    return tx.transactionType === 'advance' &&
      (tx.cashStatus === 'open' || tx.cashStatus === 'discrepancy_pending');
  });
  var pendingReceipts = transactions.filter(function(tx) {
    return tx.cashStatus === 'settled' &&
      (tx.receiptStatus === 'pending' || tx.receiptStatus === 'rejected');
  });
  var unresolvedCounts = counts.filter(function(count) { return count.status !== 'resolved'; });
  var latestCount = unresolvedCounts.length ? unresolvedCounts.sort(byDateDesc_)[0] : null;
  return {
    apiVersion: V2_API_VERSION,
    company: publicCompany_(companyId),
    ledgerCash: ledgerCash,
    openAdvanceTotal: sum_(openAdvances, 'amount'),
    openAdvances: openAdvances,
    pendingReceipts: pendingReceipts,
    latestUnresolvedCount: latestCount,
    recent: transactions.sort(byUpdatedDesc_).slice(0, 10)
  };
}

function addAdvance(payload) {
  return createTransaction_(payload, 'advance');
}

function addDirectExpense(payload) {
  return createTransaction_(payload, 'direct_expense');
}

function addReplenishment(payload) {
  return createTransaction_(payload, 'replenishment');
}

/**
 * Updates the original advance instead of inserting an income/change row.
 * A discrepancy is intentionally visible and does not create an automatic adjustment.
 */
function settleAdvance(payload) {
  var companyId = requireCompany_(payload.companyId);
  var actorId = requireText_(payload.actorId, 'actorId');
  var id = requireText_(payload.id, 'id');
  var requestId = requireText_(payload.requestId, 'requestId');
  var actualExpense = requireAmount_(payload.actualExpense, 'actualExpense');
  var returnedCash = requireAmount_(payload.returnedCash, 'returnedCash');
  var receiptStatus = normalizeReceiptStatus_(payload.receiptStatus || 'pending');
  var reason = nullableText_(payload.reason);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var transactions = readTransactions_(companyId);
    var transaction = findById_(transactions, id);
    if (!transaction || transaction.transactionType !== 'advance') throw new Error('Advance not found');
    if (transaction.settlementRequestId === requestId) {
      return successWithLedger_({ transaction: transaction, idempotent: true }, companyId, requestId, transactions);
    }
    if (transaction.cashStatus === 'settled' || transaction.cashStatus === 'voided') {
      throw codedError_('already_settled', 'This advance can no longer be settled');
    }
    if (!isManager_(actorId) && transaction.handlerId !== actorId) {
      throw codedError_('forbidden', 'Only the handler or a manager can settle this advance');
    }
    if (number_(payload.revision) !== transaction.revision) {
      throw codedError_('revision_conflict', 'This advance was changed by another user; reload it first');
    }
    var difference = transaction.amount - actualExpense - returnedCash;
    if (difference !== 0 && !reason) {
      throw codedError_('reason_required', 'A discrepancy reason is required');
    }
    var before = clone_(transaction);
    transaction.actualExpense = actualExpense;
    transaction.returnedCash = returnedCash;
    transaction.receiptStatus = receiptStatus;
    transaction.receiptReference = nullableText_(payload.receiptReference);
    transaction.settledAt = now_();
    transaction.settledBy = actorId;
    transaction.adjustmentReason = difference === 0 ? null : reason;
    transaction.cashStatus = difference === 0 ? 'settled' : 'discrepancy_pending';
    transaction.settlementRequestId = requestId;
    transaction.revision += 1;
    transaction.updatedAt = now_();
    updateTransaction_(transaction);
    appendAudit_(companyId, 'transaction', transaction.id, 'settle', before, transaction,
      transaction.adjustmentReason, actorId);
    return successWithLedger_({ transaction: transaction, difference: difference }, companyId, requestId, readTransactions_(companyId));
  } finally {
    lock.releaseLock();
  }
}

/** A count is a snapshot only; it never writes cash_transactions or ledger cash. */
function addCount(payload) {
  var companyId = requireCompany_(payload.companyId);
  var actorId = requireText_(payload.actorId, 'actorId');
  var requestId = requireText_(payload.requestId, 'requestId');
  var actualCash = requireAmount_(payload.actualCash, 'actualCash');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var duplicate = readCounts_(companyId).filter(function(count) { return count.requestId === requestId; })[0];
    if (duplicate) return success_({ cashCount: duplicate, ledgerCash: duplicate.ledgerCash, requestId: requestId, idempotent: true });
    var transactions = readTransactions_(companyId);
    var ledgerCash = calculateLedger_(companyId, transactions);
    var count = {
      id: newId_('count'), companyId: companyId, countedAt: now_(), countedBy: actorId,
      ledgerCash: ledgerCash, actualCash: actualCash, difference: actualCash - ledgerCash,
      reason: nullableText_(payload.reason), status: payload.reason ? 'explained' : 'open',
      evidence: nullableText_(payload.evidence), createdAt: now_(), requestId: requestId
    };
    appendObject_(sheet_(V2_SHEETS.counts, COUNT_HEADERS), COUNT_HEADERS, count);
    appendAudit_(companyId, 'cash_count', count.id, 'create', null, count, count.reason, actorId);
    return success_({ cashCount: count, ledgerCash: ledgerCash, requestId: requestId });
  } finally {
    lock.releaseLock();
  }
}

/** Resolving a count documents the investigation only.  It never creates an adjustment. */
function resolveCount(payload) {
  var companyId = requireCompany_(payload.companyId);
  var actorId = requireText_(payload.actorId, 'actorId');
  if (!isManager_(actorId)) throw codedError_('forbidden', 'Only a manager can resolve a cash count');
  var id = requireText_(payload.id, 'id');
  var reason = requireText_(payload.reason, 'reason');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var count = findById_(readCounts_(companyId), id);
    if (!count) throw new Error('Cash count not found');
    if (count.status === 'resolved') return success_({ cashCount: count, idempotent: true });
    var before = clone_(count);
    count.status = 'resolved';
    count.reason = reason;
    count.evidence = nullableText_(payload.evidence) || count.evidence;
    updateCount_(count);
    appendAudit_(companyId, 'cash_count', count.id, 'resolve_count', before, count, reason, actorId);
    return success_({ cashCount: count });
  } finally {
    lock.releaseLock();
  }
}

function getRecords(payload) {
  var companyId = requireCompany_(payload.companyId);
  var records = readTransactions_(companyId);
  if (payload.cashStatus) records = records.filter(function(tx) { return tx.cashStatus === payload.cashStatus; });
  if (payload.receiptStatus) records = records.filter(function(tx) { return tx.receiptStatus === payload.receiptStatus; });
  if (payload.transactionType) records = records.filter(function(tx) { return tx.transactionType === payload.transactionType; });
  return { apiVersion: V2_API_VERSION, records: records.sort(byUpdatedDesc_) };
}

function getAudit(payload) {
  var companyId = requireCompany_(payload.companyId);
  return { apiVersion: V2_API_VERSION, audit: readAudit_(companyId).sort(byDateDesc_) };
}

function createTransaction_(payload, transactionType) {
  var companyId = requireCompany_(payload.companyId);
  var actorId = requireText_(payload.actorId, 'actorId');
  var requestId = requireText_(payload.requestId, 'requestId');
  var amount = requireAmount_(payload.amount, 'amount');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var transactions = readTransactions_(companyId);
    var duplicate = transactions.filter(function(tx) { return tx.requestId === requestId; })[0];
    if (duplicate) return successWithLedger_({ transaction: duplicate, idempotent: true }, companyId, requestId, transactions);
    var isAdvance = transactionType === 'advance';
    var transaction = {
      id: newId_('tx'), companyId: companyId, transactionType: transactionType,
      transactionDate: normalizeDate_(payload.transactionDate), amount: amount,
      purpose: requireText_(payload.purpose, 'purpose'), handlerId: requireText_(payload.handlerId || actorId, 'handlerId'),
      cashStatus: isAdvance ? 'open' : 'settled', actualExpense: null, returnedCash: null,
      receiptStatus: normalizeReceiptStatus_(payload.receiptStatus || (transactionType === 'replenishment' ? 'not_required' : 'pending')),
      receiptReference: nullableText_(payload.receiptReference), settledAt: isAdvance ? null : now_(),
      settledBy: isAdvance ? null : actorId, adjustmentReason: null, requestId: requestId,
      revision: 1, createdAt: now_(), createdBy: actorId, updatedAt: now_(),
      settlementRequestId: null, adjustmentDirection: null
    };
    appendObject_(sheet_(V2_SHEETS.transactions, TX_HEADERS), TX_HEADERS, transaction);
    appendAudit_(companyId, 'transaction', transaction.id, 'create', null, transaction, null, actorId);
    return successWithLedger_({ transaction: transaction }, companyId, requestId, transactions.concat([transaction]));
  } finally {
    lock.releaseLock();
  }
}

/** Ledger formula is intentionally transaction-only; cash counts never enter it. */
function calculateLedger_(companyId, transactions) {
  var ledger = V2_COMPANIES[companyId].initialCash;
  transactions.forEach(function(tx) {
    if (tx.cashStatus === 'voided') return;
    if (tx.transactionType === 'replenishment') ledger += tx.amount;
    if (tx.transactionType === 'direct_expense') ledger -= tx.amount;
    if (tx.transactionType === 'advance') {
      ledger -= tx.amount;
      if (tx.cashStatus === 'settled' || tx.cashStatus === 'discrepancy_pending') ledger += number_(tx.returnedCash);
    }
    if (tx.transactionType === 'adjustment') ledger += tx.adjustmentDirection === 'debit' ? -tx.amount : tx.amount;
  });
  return ledger;
}

function successWithLedger_(data, companyId, requestId, transactions) {
  data.ledgerCash = calculateLedger_(companyId, transactions);
  data.requestId = requestId;
  return success_(data);
}

function spreadsheet_() {
  if (V2_TEST_SPREADSHEET_ID === 'REPLACE_WITH_A_SEPARATE_TEST_SPREADSHEET_ID') {
    throw codedError_('test_spreadsheet_not_configured', 'Set V2_TEST_SPREADSHEET_ID to a separate test spreadsheet before deployment');
  }
  return SpreadsheetApp.openById(V2_TEST_SPREADSHEET_ID);
}

function sheet_(name, headers) {
  var ss = spreadsheet_();
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  var current = sheet.getLastRow() ? sheet.getRange(1, 1, 1, headers.length).getValues()[0] : [];
  if (current.join('|') !== headers.join('|')) {
    if (sheet.getLastRow() > 0 && current.join('|') !== '') throw new Error('Unexpected schema in test sheet ' + name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function readTransactions_(companyId) { return readObjects_(sheet_(V2_SHEETS.transactions, TX_HEADERS), TX_HEADERS, companyId); }
function readCounts_(companyId) { return readObjects_(sheet_(V2_SHEETS.counts, COUNT_HEADERS), COUNT_HEADERS, companyId); }
function readAudit_(companyId) { return readObjects_(sheet_(V2_SHEETS.audit, AUDIT_HEADERS), AUDIT_HEADERS, companyId); }

function readObjects_(sheet, headers, companyId) {
  if (sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues().map(function(row) {
    var obj = {};
    headers.forEach(function(key, index) { obj[key] = decode_(key, row[index]); });
    return obj;
  }).filter(function(obj) { return obj.companyId === companyId; });
}

function updateTransaction_(transaction) {
  var sheet = sheet_(V2_SHEETS.transactions, TX_HEADERS);
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i += 1) {
    if (String(values[i][0]) === transaction.id) {
      sheet.getRange(i + 1, 1, 1, TX_HEADERS.length).setValues([TX_HEADERS.map(function(key) { return encode_(transaction[key]); })]);
      return;
    }
  }
  throw new Error('Transaction row disappeared during update');
}

function updateCount_(count) {
  var sheet = sheet_(V2_SHEETS.counts, COUNT_HEADERS);
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i += 1) {
    if (String(values[i][0]) === count.id) {
      sheet.getRange(i + 1, 1, 1, COUNT_HEADERS.length).setValues([COUNT_HEADERS.map(function(key) { return encode_(count[key]); })]);
      return;
    }
  }
  throw new Error('Cash count row disappeared during update');
}

function appendAudit_(companyId, entityType, entityId, action, before, after, reason, actorId) {
  var entry = {
    id: newId_('audit'), companyId: companyId, entityType: entityType, entityId: entityId,
    action: action, before: before, after: after, reason: reason || null,
    actorId: actorId, createdAt: now_()
  };
  appendObject_(sheet_(V2_SHEETS.audit, AUDIT_HEADERS), AUDIT_HEADERS, entry);
}

function appendObject_(sheet, headers, object) {
  sheet.appendRow(headers.map(function(key) { return encode_(object[key]); }));
}

function encode_(value) {
  if (value === null || typeof value === 'undefined') return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}
function decode_(key, value) {
  if (value === '') return null;
  if (key === 'amount' || key === 'actualExpense' || key === 'returnedCash' || key === 'revision' ||
      key === 'ledgerCash' || key === 'actualCash' || key === 'difference') return number_(value);
  if (key === 'before' || key === 'after') return JSON.parse(value);
  return value;
}

function requireCompany_(companyId) {
  if (!V2_COMPANIES[companyId]) throw codedError_('invalid_company', 'Unknown test company');
  return companyId;
}
function publicCompany_(companyId) { return { id: companyId, name: V2_COMPANIES[companyId].name, initialCash: V2_COMPANIES[companyId].initialCash }; }
function requireText_(value, name) { if (typeof value !== 'string' || !value.trim()) throw codedError_('validation_error', name + ' is required'); return value.trim(); }
function nullableText_(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function requireAmount_(value, name) {
  if (value === null || value === '' || typeof value === 'undefined') {
    throw codedError_('validation_error', name + ' is required');
  }
  var number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw codedError_('validation_error', name + ' must be a non-negative integer');
  return number;
}
function number_(value) { return value === null || value === '' || typeof value === 'undefined' ? 0 : Number(value); }
function normalizeDate_(value) { var date = value || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw codedError_('validation_error', 'transactionDate must use YYYY-MM-DD'); return date; }
function normalizeReceiptStatus_(value) { var values = ['not_required', 'pending', 'submitted', 'verified', 'rejected']; if (values.indexOf(value) === -1) throw codedError_('validation_error', 'Invalid receiptStatus'); return value; }
function isManager_(actorId) { return V2_TEST_ADMIN_ACTORS.indexOf(actorId) !== -1; }
function findById_(items, id) { return items.filter(function(item) { return item.id === id; })[0] || null; }
function sum_(items, key) { return items.reduce(function(total, item) { return total + number_(item[key]); }, 0); }
function byUpdatedDesc_(a, b) { return String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)); }
function byDateDesc_(a, b) { return String(b.createdAt || b.countedAt).localeCompare(String(a.createdAt || a.countedAt)); }
function now_() { return new Date().toISOString(); }
function newId_(prefix) { return prefix + '_' + Utilities.getUuid(); }
function clone_(object) { return JSON.parse(JSON.stringify(object)); }
function codedError_(code, message) { var error = new Error(message); error.code = code; return error; }
function success_(data) { data.success = true; data.apiVersion = V2_API_VERSION; return data; }
function failure_(error) { return { success: false, apiVersion: V2_API_VERSION, error: { code: error.code || 'server_error', message: error.message || String(error) } }; }
function jsonResponse_(data) { return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON); }
