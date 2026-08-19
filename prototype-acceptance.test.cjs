const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const script = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));

test('V2 prototype parses and permits only same-origin test or formal proxies', () => {
  assert.doesNotThrow(() => new Function(script));
  assert.doesNotMatch(html, /script\.google\.com|\/api\/gas|petty-cash-pwa\.vercel\.app/);
  assert.match(html, /const endpoint=formalMode\?'\/api\/formal-gas':'\/api\/test-gas'/);
  assert.match(html, /formalMode\?'\/api\/formal-gas':'\/api\/test-gas'/);
  assert.match(html, /testMode==='backend'/);
});

test('four-tab navigation keeps dashboard, operations, records and settings', () => {
  for (const page of ['home', 'operate', 'records', 'settings']) assert.match(html, new RegExp(`data-page="${page}"`));
  assert.match(html, /window\.navigate=page=>/);
  assert.match(html, /onclick="window\.navigate\('operate'\)"/);
  assert.doesNotMatch(html, /data-page="close"|data-page="monthly"/);
});

test('all interactive controls call exported window handlers', () => {
  for (const handler of ['navigate', 'showCompanies', 'start', 'goSettle', 'setFilter', 'openAudit', 'back', 'saveAdvance', 'finishHome', 'completeSettle', 'saveSimple']) {
    assert.match(html, new RegExp(`onclick="window\\.${handler}`));
  }
});

test('change stays on the original advance and is not an income record', () => {
  assert.match(html, /r\.change=c/);
  assert.match(html, /找零不是收入/);
  assert.doesNotMatch(html, /type:'收入'/);
});

test('companies, audit logs, and count records are kept separate', () => {
  assert.match(html, /recordsByCompany/);
  assert.match(html, /auditsByCompany/);
  assert.match(html, /chooseCompany/);
  const ledger = script.slice(script.indexOf('function ledger'), script.indexOf('function pending'));
  assert.doesNotMatch(ledger, /盤點/);
});

test('settlement discrepancy requires a reason and remains pending', () => {
  assert.match(html, /d!==0&&!reason/);
  assert.match(html, /差異待處理/);
});

test('backend read-only mode maps test API records without enabling writes', () => {
  assert.match(html, /function backendRecord/);
  assert.match(html, /getRecords','getAudit/);
  assert.match(html, /const actions=formalMode\?\['getHomeData','getRecords','getAudit','getHandlers'\]:\['getHomeData','getRecords','getAudit'\]/);
  assert.match(html, /Promise\.all\(actions\.map\(async action=>/);
  assert.match(html, /const rawRecords=recordsData\?\.records\?\.records\|\|recordsData\?\.records\|\|\[\]/);
  assert.match(html, /const rawAudit=auditData\?\.audit\?\.audit\|\|auditData\?\.audit\|\|\[\]/);
  assert.match(html, /id="simple-receipt"/);
  assert.match(html, /儲存到測試帳本/);
  assert.match(html, /盤點備註（選填）/);
  assert.match(html, /不會自動補帳或沖銷/);
  assert.match(html, /回來後請從首頁或紀錄的這一筆進行結清/);
  assert.match(html, /\['已完成','已結清'\]\.includes\(r\.status\)/);
  assert.match(html, /async function writeTestBackend/);
  assert.match(html, /隔離測試帳本/);
  assert.match(html, /writeTestBackend\('addAdvance'/);
  assert.match(html, /writeTestBackend\('settleAdvance'/);
  assert.match(html, /submitted:'已附'/);
  assert.match(html, /window\.saveSimple=saveSimple;window\.completeSettle=completeSettle/);
});

test('backend saves are single-flight and keep the last confirmed ledger while refreshing', () => {
  assert.match(html, /ledgerByCompany:\{\},handlers:\[\],saving:false/);
  assert.match(html, /if\(backend\.saving\)throw new Error\('這筆資料正在儲存，請勿重複點選。'\)/);
  assert.match(html, /const requestId=backendRequestId\(\);backend\.saving=true/);
  assert.match(html, /setSavingControls\(true\)/);
  assert.match(html, /\[data-save\]/);
  assert.match(html, /Object\.prototype\.hasOwnProperty\.call\(backend\.ledgerByCompany,state\.company\)/);
  assert.match(html, /正在儲存…/);
});

test('prototype prevents render loops and rejects unsafe money values', () => {
  assert.doesNotMatch(html, /new MutationObserver\(decorateCompanyUI\)/);
  assert.match(html, /decorateCompanyUI\(\) \}/);
  assert.match(html, /function validAmount\(value/);
  assert.match(html, /value<=MAX_AMOUNT/);
  assert.match(html, /expenseValue===''\|\|changeValue===''\|\|!validAmount/);
});

test('company switching keeps the unsaved-draft warning active', () => {
  assert.match(html, /window\.requestCompanySwitch=function/);
  assert.match(html, /尚有未儲存資料/);
  assert.doesNotMatch(html, /window\.showCompanies=showCompanies/);
});
