/**
 * TOJO RMO Accounting System — 予算 API
 * - 予算: スプレッドシート「TOJO RMO 予算管理」（シート名「当初予算_YYYY-MM-DD」「改訂予算_YYYY-MM-DD」）
 * - 実績: 会計Ledger の仕訳帳から集計（費用科目のみ）
 * - 画面（HTML）: GitHub tojormo/RMO_ADMIN の Accounting フォルダ
 */

const BUDGET_SPREADSHEET_ID = '1gkrn6S4IaJ-pYIoMDXTzuuA2y_VT62RfX-JuA10Tmms';
const LEDGER_SPREADSHEET_ID = '1EdBz2L4jN-4kU1XXIRJf4BzT-az6cfMmqCdMu_497EQ';
const VERSION_RE = /^(当初予算|改訂予算)_(\d{4}-\d{2}-\d{2})$/;
const TZ = 'Asia/Tokyo';

// 仕訳帳の列（1始まり）
const L = { ID: 1, DATE: 3, FY: 5, DR_ACCT: 7, DR_AMT: 8, CR_ACCT: 9, CR_AMT: 10, BUDGET: 16, STATUS: 22, BUDGET_CODE: 23 };

// 予算シートの見出し（列の順番が変わっても見出し名で読む）
const H = {
  code: '予算コード', l1: '予算大項目', l2: '予算中項目', l3: '予算小項目',
  account: '勘定科目', fund: '資金原資', amount: '予算額（総事業費）', rmo: 'うちRMO交付金', own: 'うち自己資金', memo: 'メモ',
};

/* ========== Web API ========== */

const API_ACTIONS = {
  getBudgetItems: () => getBudgetItems(),
  getBudgetReport: fy => getBudgetReport(fy),
};

function doGet(e) {
  return json_({ ok: true, data: { service: 'TOJO RMO Budget API', time: Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss') } });
}

/** POST {action, args:[...], key}（Content-Type: text/plain） */
function doPost(e) {
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const expected = PropertiesService.getScriptProperties().getProperty('API_KEY');
    if (!expected) return json_({ ok: false, code: 'AUTH', error: 'サーバー側のパスコードが未設定です（initApiKey を実行してください）' });
    if (String(req.key || '') !== expected) return json_({ ok: false, code: 'AUTH', error: 'パスコードが違います' });
    const fn = API_ACTIONS[req.action];
    if (!fn) return json_({ ok: false, error: '不明な操作です: ' + req.action });
    return json_({ ok: true, data: fn.apply(null, Array.isArray(req.args) ? req.args : []) });
  } catch (err) {
    return json_({ ok: false, error: err && err.message ? err.message : String(err) });
  }
}

function api(action, args) {
  const fn = API_ACTIONS[action];
  if (!fn) throw new Error('不明な操作です: ' + action);
  return fn.apply(null, args || []);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** 初回に1度エディタから実行：権限の承認と API パスコードの用意（スクリプトプロパティ API_KEY） */
function initApiKey() {
  const props = PropertiesService.getScriptProperties();
  let key = props.getProperty('API_KEY');
  if (!key) {
    key = Utilities.getUuid().replace(/-/g, '').slice(0, 12);
    props.setProperty('API_KEY', key);
  }
  budgetSS_().getName();
  ledgerSS_().getName();
  Logger.log('API パスコード: ' + key);
  return key;
}

/* ========== 予算 ========== */

function budgetSS_() { return SpreadsheetApp.openById(BUDGET_SPREADSHEET_ID); }
function ledgerSS_() { return SpreadsheetApp.openById(LEDGER_SPREADSHEET_ID); }

/** 予算バージョン一覧（日付順。同じ日付なら当初予算が先） */
function listVersions_(ss) {
  return ss.getSheets().map(sh => {
    const m = sh.getName().match(VERSION_RE);
    return m ? { name: sh.getName(), kind: m[1], date: m[2] } : null;
  }).filter(Boolean).sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : (a.kind === '当初予算' ? -1 : 1));
}

function readVersion_(ss, name) {
  const sh = ss.getSheetByName(name);
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  const head = values[0].map(v => String(v).trim());
  const idx = {};
  Object.keys(H).forEach(k => idx[k] = head.indexOf(H[k]));
  if (idx.code < 0 || idx.amount < 0) throw new Error('シート「' + name + '」に「予算コード」「予算額（総事業費）」の見出しがありません');
  const get = (r, k) => idx[k] >= 0 ? r[idx[k]] : '';
  return values.slice(1).filter(r => String(get(r, 'code')).trim() !== '').map(r => ({
    code: String(get(r, 'code')).trim(),
    l1: String(get(r, 'l1') || '（大項目なし）'),
    l2: String(get(r, 'l2') || '（中項目なし）'),
    l3: String(get(r, 'l3') || '（小項目なし）'),
    account: String(get(r, 'account') || ''),
    fund: String(get(r, 'fund') || ''),
    amount: Number(get(r, 'amount')) || 0,
    rmo: Number(get(r, 'rmo')) || 0,
    own: Number(get(r, 'own')) || 0,
    memo: String(get(r, 'memo') || ''),
  }));
}

/** 入力画面用：最新バージョンの予算項目 */
function getBudgetItems() {
  const ss = budgetSS_();
  const versions = listVersions_(ss);
  if (!versions.length) return { version: null, items: [] };
  const latest = versions[versions.length - 1];
  return {
    version: latest.name,
    items: readVersion_(ss, latest.name).map(i => ({ code: i.code, l1: i.l1, l2: i.l2, l3: i.l3, account: i.account, fund: i.fund })),
  };
}

/**
 * ダッシュボード用：全バージョンの予算額と、指定年度の実績（費用）
 * 実績の紐づけ：仕訳帳「予算コード」→ 予算小項目。無い場合は「申請書予算項目」を予算中項目名（なければ大項目名）として集計
 */
function getBudgetReport(fy) {
  const ss = budgetSS_();
  const versions = listVersions_(ss);
  const itemMap = {};
  const order = [];
  versions.forEach(v => {
    readVersion_(ss, v.name).forEach(i => {
      if (!itemMap[i.code]) { itemMap[i.code] = { code: i.code, budgets: {}, actual: 0 }; order.push(i.code); }
      Object.assign(itemMap[i.code], { l1: i.l1, l2: i.l2, l3: i.l3, account: i.account, fund: i.fund, memo: i.memo });
      itemMap[i.code].budgets[v.name] = i.amount;
    });
  });

  // 実績
  const lss = ledgerSS_();
  const types = {};
  lss.getSheetByName('勘定科目マスタ').getDataRange().getValues().slice(1)
    .forEach(r => { if (r[1] !== '') types[String(r[1])] = String(r[2]); });
  const settings = {};
  lss.getSheetByName('設定').getDataRange().getValues().forEach(r => settings[String(r[0]).trim()] = r[1]);
  const startMonth = Number(settings['期首月']) || 4;
  const now = new Date();
  fy = Number(fy) || Number(settings['対象会計年度']) || (now.getMonth() + 1 >= startMonth ? now.getFullYear() : now.getFullYear() - 1);

  const l2Names = {}, l1Names = {};
  order.forEach(c => { const i = itemMap[c]; if (!l2Names[i.l2]) l2Names[i.l2] = i.l1; l1Names[i.l1] = true; });
  const extra = {};
  const years = new Set([fy]);
  const ledger = lss.getSheetByName('仕訳帳');
  const last = ledger.getLastRow();
  const rows = last >= 2 ? ledger.getRange(2, 1, last - 1, Math.max(L.BUDGET_CODE, ledger.getLastColumn())).getValues() : [];
  rows.forEach(r => {
    if (!r[L.ID - 1] || String(r[L.STATUS - 1]) === '取消') return;
    const rowFy = Number(r[L.FY - 1]);
    if (rowFy) years.add(rowFy);
    if (rowFy !== fy) return;
    let amt = 0;
    if (types[String(r[L.DR_ACCT - 1])] === '費用') amt += Number(r[L.DR_AMT - 1]) || 0;
    if (types[String(r[L.CR_ACCT - 1])] === '費用') amt -= Number(r[L.CR_AMT - 1]) || 0;
    if (!amt) return;
    const code = String(r[L.BUDGET_CODE - 1] || '').trim();
    const label = String(r[L.BUDGET - 1] || '').trim();
    if (code && itemMap[code]) { itemMap[code].actual += amt; return; }
    let key;
    if (label && l2Names[label]) key = '2|' + l2Names[label] + '|' + label;
    else if (label && l1Names[label]) key = '1|' + label;
    else key = '0';
    extra[key] = (extra[key] || 0) + amt;
  });

  return {
    fiscalYear: fy,
    years: Array.from(years).sort(),
    versions: versions,
    items: order.map(c => itemMap[c]),
    unassigned: Object.keys(extra).map(k => {
      const p = k.split('|');
      return { level: Number(p[0]), l1: p[1] || '', l2: p[2] || '', actual: extra[k] };
    }),
    generatedAt: Utilities.formatDate(now, TZ, 'yyyy-MM-dd HH:mm'),
  };
}

function testBudget() {
  Logger.log(JSON.stringify(getBudgetItems()).slice(0, 2000));
  Logger.log(JSON.stringify(getBudgetReport()).slice(0, 4000));
}
