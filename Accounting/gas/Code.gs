/**
 * TOJO RMO Accounting System（支払基準）
 * - 支払・収入入力（証憑添付） / 仕訳直接入力 / BS・PL ダッシュボード の API
 * - Ledger: スプレッドシート「会計Ledger」
 * - 画面（HTML）: GitHub tojormo/RMO_ADMIN の Accounting フォルダ
 */

// 会計Ledger のスプレッドシートID（コンテナバインドで使う場合は空文字でも可）
const SPREADSHEET_ID = '1EdBz2L4jN-4kU1XXIRJf4BzT-az6cfMmqCdMu_497EQ';

const SHEETS = {
  LEDGER: '仕訳帳',
  ACCOUNTS: '勘定科目マスタ',
  SOURCES: '支払元マスタ',
  SETTINGS: '設定',
};

// 仕訳帳の列（1始まり）
const COL = {
  ID: 1, LINE: 2, DATE: 3, MONTH: 4, FY: 5, KIND: 6,
  DR_ACCT: 7, DR_AMT: 8, CR_ACCT: 9, CR_AMT: 10,
  TAX_RATE: 11, TAX_AMT: 12, PARTNER: 13, INVOICE: 14, DESC: 15,
  BUDGET: 16, FUND: 17, VOUCHER_NO: 18, VOUCHER_URL: 19,
  USER: 20, CREATED: 21, STATUS: 22, BUDGET_CODE: 23,
};
const LEDGER_WIDTH = 23;
const TZ = 'Asia/Tokyo';

/* ========== Web API（HTML は GitHub: RMO_ADMIN/Accounting 側） ========== */

// HTML から呼び出せる関数
const API_ACTIONS = {
  getMasters: () => getMasters(),
  submitTransaction: p => submitTransaction(p),
  submitJournal: p => submitJournal(p),
  getDashboardData: fy => getDashboardData(fy),
};

/** 動作確認用（ブラウザで /exec を開くと応答を返す） */
function doGet(e) {
  return json_({ ok: true, data: { service: 'TOJO RMO Accounting API', time: Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss') } });
}

/**
 * POST {action, args:[...], key}
 * Content-Type: text/plain で送る（CORS プリフライト回避）
 */
function doPost(e) {
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const expected = PropertiesService.getScriptProperties().getProperty('API_KEY');
    if (!expected) return json_({ ok: false, code: 'AUTH', error: 'サーバー側のパスコードが未設定です（initApiKey を実行してください）' });
    if (String(req.key || '') !== expected) return json_({ ok: false, code: 'AUTH', error: 'パスコードが違います' });
    const fn = API_ACTIONS[req.action];
    if (!fn) return json_({ ok: false, error: '不明な操作です: ' + req.action });
    const args = Array.isArray(req.args) ? req.args : [];
    return json_({ ok: true, data: fn.apply(null, args) });
  } catch (err) {
    return json_({ ok: false, error: err && err.message ? err.message : String(err) });
  }
}

/** GAS 上の HTML（google.script.run）から呼ぶ場合の入口 */
function api(action, args) {
  const fn = API_ACTIONS[action];
  if (!fn) throw new Error('不明な操作です: ' + action);
  return fn.apply(null, args || []);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * 初回に1度エディタから実行：API パスコードを生成してスクリプトプロパティに保存し、ログに表示する
 * （既にある場合はそれを表示。変更したいときは resetApiKey を実行）
 */
function initApiKey() {
  const props = PropertiesService.getScriptProperties();
  let key = props.getProperty('API_KEY');
  if (!key) {
    key = Utilities.getUuid().replace(/-/g, '').slice(0, 12);
    props.setProperty('API_KEY', key);
  }
  // 権限の承認をまとめて行うため、シートと Drive に一度アクセスする
  ss_().getName();
  DriveApp.getFolderById(getSettings_().voucherFolderId).getName();
  Logger.log('API パスコード: ' + key);
  return key;
}

function resetApiKey() {
  PropertiesService.getScriptProperties().deleteProperty('API_KEY');
  return initApiKey();
}

/* ========== 共通 ========== */

function ss_() {
  return SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
}

function sheet_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('シート「' + name + '」が見つかりません');
  return sh;
}

function rows_(name) {
  const sh = sheet_(name);
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
}

function isTrue_(v) {
  return v === true || String(v).toUpperCase() === 'TRUE' || v === '○' || v === '有効';
}

function getSettings_() {
  const map = {};
  rows_(SHEETS.SETTINGS).forEach(r => { if (r[0] !== '') map[String(r[0]).trim()] = r[1]; });
  return {
    startMonth: Number(map['期首月']) || 4,
    fiscalYear: Number(map['対象会計年度']) || null,
    voucherFolderId: String(map['証憑フォルダID'] || '').trim(),
    funds: String(map['資金原資'] || 'RMO交付金,自己資金,要確認').split(/[,、，]/).map(s => s.trim()).filter(String),
    idPrefix: String(map['仕訳ID接頭辞'] || 'J'),
  };
}

function fiscalYearOf_(date, startMonth) {
  const y = date.getFullYear(), m = date.getMonth() + 1;
  return m >= startMonth ? y : y - 1;
}

function parseDate_(s) {
  if (s instanceof Date) return s;
  const m = String(s || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) throw new Error('日付の形式が正しくありません: ' + s);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function toInt_(v) {
  const n = Number(String(v === undefined || v === null ? '' : v).replace(/[,，円\s]/g, ''));
  return isFinite(n) ? Math.round(n) : NaN;
}

function calcTax_(amountInclTax, rate) {
  const r = { '10%': 10, '8%': 8 }[rate];
  return r ? Math.floor(amountInclTax * r / (100 + r)) : 0;
}

/* ========== マスタ ========== */

function getAccounts_() {
  return rows_(SHEETS.ACCOUNTS)
    .filter(r => r[1] !== '' && isTrue_(r[5]))
    .map(r => ({ code: String(r[0]), name: String(r[1]), type: String(r[2]), side: String(r[3]), usage: String(r[4]), note: String(r[6] || '') }));
}

function getSources_() {
  return rows_(SHEETS.SOURCES)
    .filter(r => r[0] !== '' && isTrue_(r[4]))
    .map(r => ({ name: String(r[0]), account: String(r[1]), kind: String(r[2]), memo: String(r[3] || '') }));
}

/** 資金原資の選択肢（設定タブ「資金原資」をカンマ区切りで） */
function getFunds_() {
  return getSettings_().funds;
}

/** 入力画面の初期データ */
function getMasters() {
  const s = getSettings_();
  const today = new Date();
  return {
    accounts: getAccounts_(),
    sources: getSources_(),
    funds: getFunds_(),
    today: Utilities.formatDate(today, TZ, 'yyyy-MM-dd'),
    fiscalYear: s.fiscalYear || fiscalYearOf_(today, s.startMonth),
    user: Session.getActiveUser().getEmail() || '',
  };
}

/* ========== 書き込み ========== */

function nextIds_(sh, prefix, count) {
  const last = sh.getLastRow();
  let max = 0;
  if (last >= 2) {
    sh.getRange(2, COL.ID, last - 1, 1).getValues().forEach(r => {
      const m = String(r[0]).match(/(\d+)$/);
      if (m) max = Math.max(max, Number(m[1]));
    });
  }
  const ids = [];
  for (let i = 1; i <= count; i++) ids.push(prefix + ('000000' + (max + i)).slice(-6));
  return ids;
}

function appendLedger_(rows) {
  const sh = sheet_(SHEETS.LEDGER);
  const start = sh.getLastRow() + 1;
  sh.getRange(start, COL.MONTH, rows.length, 1).setNumberFormat('@');
  sh.getRange(start, 1, rows.length, LEDGER_WIDTH).setValues(rows);
  return start;
}

/** 証憑ファイルを Drive に保存して URL を返す（計上月ごとのサブフォルダ） */
function saveVouchers_(files, journalId, date, partner) {
  if (!files || !files.length) return [];
  const s = getSettings_();
  if (!s.voucherFolderId) throw new Error('設定タブに「証憑フォルダID」がありません');
  const root = DriveApp.getFolderById(s.voucherFolderId);
  const monthName = Utilities.formatDate(date, TZ, 'yyyy-MM');
  const it = root.getFoldersByName(monthName);
  const folder = it.hasNext() ? it.next() : root.createFolder(monthName);
  const ymd = Utilities.formatDate(date, TZ, 'yyyyMMdd');
  const safePartner = String(partner || '').replace(/[\\/:*?"<>|]/g, '').slice(0, 30);
  return files.map((f, i) => {
    const bytes = Utilities.base64Decode(f.data);
    const name = [ymd, journalId, safePartner, (files.length > 1 ? (i + 1) + '_' : '') + f.name].filter(String).join('_');
    const blob = Utilities.newBlob(bytes, f.mimeType || 'application/octet-stream', name);
    return folder.createFile(blob).getUrl();
  });
}

/**
 * 支払・収入の登録
 * payload: {kind:'支払'|'収入', date, source, account, amount, taxRate, taxAmount,
 *           partner, invoiceNo, description, budgetItem, budgetCode, fund, voucherNo, enteredBy, files:[{name,mimeType,data}]}
 * budgetItem: 予算中項目名（申請書予算項目列）／budgetCode: 予算小項目のコード（予算管理スプレッドシート）
 */
function submitTransaction(payload) {
  const p = payload || {};
  const errors = [];
  if (p.kind !== '支払' && p.kind !== '収入') errors.push('区分（支払／収入）を選んでください');
  let date;
  try { date = parseDate_(p.date); } catch (e) { errors.push(e.message); }
  const amount = toInt_(p.amount);
  if (!(amount > 0)) errors.push('金額（税込）を正の整数で入力してください');
  const accounts = getAccounts_();
  const acct = accounts.find(a => a.name === p.account);
  if (!acct) errors.push('勘定科目を選んでください');
  const src = getSources_().find(s => s.name === p.source);
  if (!src) errors.push((p.kind === '収入' ? '入金先' : '支払元') + 'を選んでください');
  else if (!accounts.find(a => a.name === src.account)) errors.push('支払元マスタの勘定科目「' + src.account + '」が勘定科目マスタにありません');
  if (!String(p.description || '').trim()) errors.push('摘要を入力してください');
  if (errors.length) throw new Error(errors.join('\n'));

  let tax = toInt_(p.taxAmount);
  if (!isFinite(tax) || p.taxAmount === '' || p.taxAmount === null || p.taxAmount === undefined) tax = calcTax_(amount, p.taxRate);

  const s = getSettings_();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = sheet_(SHEETS.LEDGER);
    const id = nextIds_(sh, s.idPrefix, 1)[0];
    const urls = saveVouchers_(p.files, id, date, p.partner);
    const isPay = p.kind === '支払';
    const row = new Array(LEDGER_WIDTH).fill('');
    row[COL.ID - 1] = id;
    row[COL.LINE - 1] = 1;
    row[COL.DATE - 1] = date;
    row[COL.MONTH - 1] = Utilities.formatDate(date, TZ, 'yyyy-MM');
    row[COL.FY - 1] = fiscalYearOf_(date, s.startMonth);
    row[COL.KIND - 1] = p.kind;
    row[COL.DR_ACCT - 1] = isPay ? acct.name : src.account;
    row[COL.DR_AMT - 1] = amount;
    row[COL.CR_ACCT - 1] = isPay ? src.account : acct.name;
    row[COL.CR_AMT - 1] = amount;
    row[COL.TAX_RATE - 1] = p.taxRate || '';
    row[COL.TAX_AMT - 1] = tax;
    row[COL.PARTNER - 1] = p.partner || '';
    row[COL.INVOICE - 1] = p.invoiceNo || '';
    row[COL.DESC - 1] = String(p.description).trim() + (src.kind === '立替' ? '／' + src.name : '');
    row[COL.BUDGET - 1] = p.budgetItem || '';
    row[COL.FUND - 1] = p.fund || '';
    row[COL.VOUCHER_NO - 1] = p.voucherNo || '';
    row[COL.VOUCHER_URL - 1] = urls.join('\n');
    row[COL.USER - 1] = p.enteredBy || Session.getActiveUser().getEmail();
    row[COL.CREATED - 1] = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
    row[COL.STATUS - 1] = '有効';
    row[COL.BUDGET_CODE - 1] = p.budgetCode || '';
    appendLedger_([row]);
    return { id: id, urls: urls, debit: row[COL.DR_ACCT - 1], credit: row[COL.CR_ACCT - 1], amount: amount };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 仕訳の直接入力（複合仕訳可）
 * payload: {date, description, partner, invoiceNo, budgetItem, fund, voucherNo, enteredBy,
 *           lines:[{debitAccount, debitAmount, creditAccount, creditAmount, memo}], files}
 */
function submitJournal(payload) {
  const p = payload || {};
  const errors = [];
  let date;
  try { date = parseDate_(p.date); } catch (e) { errors.push(e.message); }
  if (!String(p.description || '').trim()) errors.push('摘要を入力してください');
  const names = new Set(getAccounts_().map(a => a.name));
  const lines = (p.lines || []).map((l, i) => {
    const dA = l.debitAccount ? toInt_(l.debitAmount) : 0;
    const cA = l.creditAccount ? toInt_(l.creditAmount) : 0;
    if (!l.debitAccount && !l.creditAccount) return null;
    if (l.debitAccount && !names.has(l.debitAccount)) errors.push((i + 1) + '行目: 借方科目が不正です');
    if (l.creditAccount && !names.has(l.creditAccount)) errors.push((i + 1) + '行目: 貸方科目が不正です');
    if (l.debitAccount && !(dA > 0)) errors.push((i + 1) + '行目: 借方金額を入力してください');
    if (l.creditAccount && !(cA > 0)) errors.push((i + 1) + '行目: 貸方金額を入力してください');
    return { dAcct: l.debitAccount || '', dAmt: dA || 0, cAcct: l.creditAccount || '', cAmt: cA || 0, memo: String(l.memo || '').trim() };
  }).filter(Boolean);
  if (!lines.length) errors.push('仕訳行を1行以上入力してください');
  const dSum = lines.reduce((a, l) => a + l.dAmt, 0);
  const cSum = lines.reduce((a, l) => a + l.cAmt, 0);
  if (dSum !== cSum) errors.push('貸借が一致しません（借方 ' + dSum.toLocaleString() + ' ／ 貸方 ' + cSum.toLocaleString() + '）');
  if (errors.length) throw new Error(errors.join('\n'));

  const s = getSettings_();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = sheet_(SHEETS.LEDGER);
    const id = nextIds_(sh, s.idPrefix, 1)[0];
    const urls = saveVouchers_(p.files, id, date, p.partner);
    const created = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
    const rows = lines.map((l, i) => {
      const row = new Array(LEDGER_WIDTH).fill('');
      row[COL.ID - 1] = id;
      row[COL.LINE - 1] = i + 1;
      row[COL.DATE - 1] = date;
      row[COL.MONTH - 1] = Utilities.formatDate(date, TZ, 'yyyy-MM');
      row[COL.FY - 1] = fiscalYearOf_(date, s.startMonth);
      row[COL.KIND - 1] = '仕訳';
      row[COL.DR_ACCT - 1] = l.dAcct;
      row[COL.DR_AMT - 1] = l.dAcct ? l.dAmt : '';
      row[COL.CR_ACCT - 1] = l.cAcct;
      row[COL.CR_AMT - 1] = l.cAcct ? l.cAmt : '';
      row[COL.PARTNER - 1] = p.partner || '';
      row[COL.INVOICE - 1] = p.invoiceNo || '';
      row[COL.DESC - 1] = l.memo || String(p.description).trim();
      row[COL.BUDGET - 1] = p.budgetItem || '';
      row[COL.FUND - 1] = p.fund || '';
      row[COL.VOUCHER_NO - 1] = p.voucherNo || '';
      row[COL.VOUCHER_URL - 1] = urls.join('\n');
      row[COL.USER - 1] = p.enteredBy || Session.getActiveUser().getEmail();
      row[COL.CREATED - 1] = created;
      row[COL.STATUS - 1] = '有効';
      row[COL.BUDGET_CODE - 1] = p.budgetCode || '';
      return row;
    });
    appendLedger_(rows);
    return { id: id, lines: rows.length, total: dSum, urls: urls };
  } finally {
    lock.releaseLock();
  }
}

/* ========== ダッシュボード ========== */

/**
 * Ledger を読んで BS / PL / 月次推移 を返す（予算対比は予算 API 側）
 * @param {number} fy 会計年度（省略時は設定値）
 */
function getDashboardData(fy) {
  const s = getSettings_();
  const today = new Date();
  fy = Number(fy) || s.fiscalYear || fiscalYearOf_(today, s.startMonth);

  const accounts = rows_(SHEETS.ACCOUNTS).filter(r => r[1] !== '')
    .map(r => ({ code: String(r[0]), name: String(r[1]), type: String(r[2]), side: String(r[3]) }));
  const byName = {};
  accounts.forEach(a => { byName[a.name] = Object.assign(a, { fyDr: 0, fyCr: 0, cumDr: 0, cumCr: 0, priorDr: 0, priorCr: 0 }); });
  const isPL = t => t === '収益' || t === '費用';
  const cashAccounts = getSources_().filter(x => x.kind === '現金' || x.kind === '銀行').map(x => x.account);

  // 年度の月リスト
  const months = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(fy, s.startMonth - 1 + i, 1);
    months.push(Utilities.formatDate(d, TZ, 'yyyy-MM'));
  }
  const monthly = {};
  months.forEach(m => monthly[m] = { revenue: 0, expense: 0, cashDelta: 0 });
  let cashOpening = 0;

  const years = new Set();
  const unknown = new Set();
  const journalBalance = {};
  const recent = [];

  rows_(SHEETS.LEDGER).forEach(r => {
    if (!r[COL.ID - 1] || String(r[COL.STATUS - 1]) === '取消') return;
    const d = r[COL.DATE - 1] instanceof Date ? r[COL.DATE - 1] : null;
    const rowFy = Number(r[COL.FY - 1]) || (d ? fiscalYearOf_(d, s.startMonth) : null);
    if (!rowFy) return;
    years.add(rowFy);
    const month = String(r[COL.MONTH - 1] || (d ? Utilities.formatDate(d, TZ, 'yyyy-MM') : ''));
    const id = String(r[COL.ID - 1]);
    const sides = [
      { acct: String(r[COL.DR_ACCT - 1] || ''), amt: Number(r[COL.DR_AMT - 1]) || 0, dr: true },
      { acct: String(r[COL.CR_ACCT - 1] || ''), amt: Number(r[COL.CR_AMT - 1]) || 0, dr: false },
    ];
    journalBalance[id] = (journalBalance[id] || 0) + sides[0].amt - sides[1].amt;

    sides.forEach(x => {
      if (!x.acct || !x.amt) return;
      const a = byName[x.acct];
      if (!a) { unknown.add(x.acct); return; }
      if (rowFy <= fy) { if (x.dr) a.cumDr += x.amt; else a.cumCr += x.amt; }
      if (rowFy < fy) { if (x.dr) a.priorDr += x.amt; else a.priorCr += x.amt; }
      if (rowFy === fy) {
        if (x.dr) a.fyDr += x.amt; else a.fyCr += x.amt;
        if (monthly[month]) {
          if (a.type === '収益') monthly[month].revenue += x.dr ? -x.amt : x.amt;
          if (a.type === '費用') monthly[month].expense += x.dr ? x.amt : -x.amt;
          if (cashAccounts.indexOf(a.name) >= 0) monthly[month].cashDelta += x.dr ? x.amt : -x.amt;
        }
      }
      if (rowFy < fy && cashAccounts.indexOf(a.name) >= 0) cashOpening += x.dr ? x.amt : -x.amt;
    });

    if (rowFy === fy) {
      recent.push({
        id: id, line: r[COL.LINE - 1], date: d ? Utilities.formatDate(d, TZ, 'yyyy-MM-dd') : '',
        kind: String(r[COL.KIND - 1]), debit: sides[0].acct, credit: sides[1].acct,
        amount: sides[0].amt || sides[1].amt, partner: String(r[COL.PARTNER - 1] || ''),
        desc: String(r[COL.DESC - 1] || ''), url: String(r[COL.VOUCHER_URL - 1] || '').split('\n')[0],
      });
    }
  });

  const bal = a => isPL(a.type)
    ? (a.side === '借方' ? a.fyDr - a.fyCr : a.fyCr - a.fyDr)
    : (a.side === '借方' ? a.cumDr - a.cumCr : a.cumCr - a.cumDr);
  const list = type => accounts.filter(a => a.type === type)
    .map(a => ({ code: a.code, name: a.name, amount: bal(a) }))
    .filter(x => x.amount !== 0);
  const sum = arr => arr.reduce((t, x) => t + x.amount, 0);

  const assets = list('資産'), liabilities = list('負債'), equity = list('純資産');
  const revenue = list('収益'), expense = list('費用').sort((a, b) => b.amount - a.amount);
  const priorSurplus = accounts.filter(a => isPL(a.type))
    .reduce((t, a) => t + (a.type === '収益' ? a.priorCr - a.priorDr : -(a.priorDr - a.priorCr)), 0);
  const revenueTotal = sum(revenue), expenseTotal = sum(expense);
  const surplus = revenueTotal - expenseTotal;
  const equityTotal = sum(equity) + priorSurplus + surplus;

  let running = cashOpening;
  const monthlyArr = months.map(m => {
    running += monthly[m].cashDelta;
    return { month: m, revenue: monthly[m].revenue, expense: monthly[m].expense, cash: running };
  });

  const unbalanced = Object.keys(journalBalance).filter(k => journalBalance[k] !== 0);
  years.add(fy);

  return {
    fiscalYear: fy,
    years: Array.from(years).sort(),
    period: months[0] + ' 〜 ' + months[11],
    generatedAt: Utilities.formatDate(today, TZ, 'yyyy-MM-dd HH:mm'),
    bs: {
      assets: assets, liabilities: liabilities, equity: equity,
      priorSurplus: priorSurplus, surplus: surplus,
      assetsTotal: sum(assets), liabilitiesTotal: sum(liabilities), equityTotal: equityTotal,
      cash: assets.filter(a => cashAccounts.indexOf(a.name) >= 0).reduce((t, a) => t + a.amount, 0),
    },
    pl: { revenue: revenue, expense: expense, revenueTotal: revenueTotal, expenseTotal: expenseTotal, surplus: surplus },
    monthly: monthlyArr,
    recent: recent.slice(-15).reverse(),
    warnings: {
      unbalanced: unbalanced,
      unknownAccounts: Array.from(unknown),
      bsDiff: sum(assets) - sum(liabilities) - equityTotal,
    },
  };
}

/* ========== 動作確認用 ========== */

function testReadMasters() {
  Logger.log(JSON.stringify(getMasters(), null, 2));
  Logger.log(JSON.stringify(getDashboardData(), null, 2));
}
