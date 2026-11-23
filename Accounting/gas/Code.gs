/**
 * とうじょうRMO会計システム 会計API（v3：事業別損益に対応）
 *
 * 方針：この GAS は原則として変更しない。
 * - データの読み書きと入力チェックだけを行い、集計・表示は HTML 側（RMO_ADMIN/Accounting）で行う
 * - 列は「見出し名」で読み書きする。スプレッドシートに列を追加しても GAS の変更は不要
 *   （追加列は getConfig / getLedger でそのまま返り、登録時は payload.extra に { 見出し名: 値 } で渡せば書き込まれる）
 * - 「〜マスタ」という名前のシートはすべて getConfig で返す（マスタの行の追加・変更は GAS の変更不要）
 * - 事業（v3）：収益・費用の仕訳には「事業」（事業マスタの有効な行）が必須。設定タブ「共通収入科目」の科目は常に共通の事業
 *
 * API（POST {action, args, key}）
 *   getConfig()                 設定・マスタ・仕訳帳の見出し
 *   getLedger()                 仕訳帳の全行（見出しと値）
 *   submitTransaction(payload)  支払・収入の登録
 *   submitJournal(payload)      仕訳（複合仕訳可）の登録
 */

const SPREADSHEET_ID = '1EdBz2L4jN-4kU1XXIRJf4BzT-az6cfMmqCdMu_497EQ';
const TZ = 'Asia/Tokyo';
const LEDGER_SHEET = '仕訳帳';
const SETTINGS_SHEET = '設定';
const MASTER_SUFFIX = 'マスタ';

// 仕訳帳：システムが書き込む列（キー → 見出し名）
const F = {
  id: '仕訳ID', line: '行No', date: '取引日', month: '計上月', fy: '会計年度', kind: '入力区分',
  drAcct: '借方科目', drAmt: '借方金額', crAcct: '貸方科目', crAmt: '貸方金額',
  taxRate: '税率', taxAmt: '消費税額', partner: '取引先', invoiceNo: 'インボイス登録番号', description: '摘要',
  budgetItem: '申請書予算項目', fund: '資金原資', voucherNo: '証憑番号', voucherUrl: '証憑URL',
  enteredBy: '入力者', created: '登録日時', status: '状態', budgetCode: '予算コード',
  business: '事業',
};
// マスタ：GAS が入力チェックに使う列（キー → 見出し名）
const ACCOUNT_COLS = { code: 'コード', name: '勘定科目', type: '区分', side: '正常残高', usage: '入力画面', active: '有効', note: '説明', fundClass: '資金区分' };
const SOURCE_COLS = { name: '支払元', account: '勘定科目', kind: '種別', memo: '口座情報・メモ', active: '有効' };
const BUSINESS_COLS = { name: '事業', kind: '区分', order: '表示順', active: '有効', note: '説明' };
const BUSINESS_MASTER = '事業マスタ';

/* ========== Web API ========== */

const API_ACTIONS = {
  getConfig: () => getConfig(),
  getLedger: () => getLedger(),
  submitTransaction: p => submitTransaction(p),
  submitJournal: p => submitJournal(p),
};

function doGet() {
  return json_({ ok: true, data: { service: 'とうじょうRMO会計システム 会計API', version: 3, actions: Object.keys(API_ACTIONS), time: now_() } });
}

function doPost(e) {
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const expected = PropertiesService.getScriptProperties().getProperty('API_KEY');
    if (!expected) return json_({ ok: false, code: 'AUTH', error: 'サーバー側のパスコードが未設定です（initApiKey を実行してください）' });
    if (String(req.key || '') !== expected) return json_({ ok: false, code: 'AUTH', error: 'パスコードが違います' });
    return json_({ ok: true, data: api(req.action, req.args) });
  } catch (err) {
    return json_({ ok: false, error: err && err.message ? err.message : String(err) });
  }
}

/** GAS 上の HTML（google.script.run）からも呼べる入口 */
function api(action, args) {
  const fn = API_ACTIONS[action];
  if (!fn) throw new Error('不明な操作です: ' + action);
  return fn.apply(null, Array.isArray(args) ? args : []);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** 初回のみエディタから実行：権限の承認と API_KEY の用意 */
function initApiKey() {
  const props = PropertiesService.getScriptProperties();
  let key = props.getProperty('API_KEY');
  if (!key) { key = Utilities.getUuid().replace(/-/g, '').slice(0, 12); props.setProperty('API_KEY', key); }
  ss_().getName();
  DriveApp.getFolderById(settings_().voucherFolderId).getName();
  Logger.log('API パスコード: ' + key);
  return key;
}

/* ========== シート読み書き（見出し名ベース） ========== */

function ss_() { return SpreadsheetApp.openById(SPREADSHEET_ID); }
function now_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'); }

function sheet_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('シート「' + name + '」が見つかりません');
  return sh;
}

/** シートを { headers, rows } で読む（日付は yyyy-MM-dd の文字列に変換） */
function table_(sh) {
  const values = sh.getDataRange().getValues();
  const headers = (values[0] || []).map(v => String(v).trim());
  const rows = values.slice(1)
    .filter(r => r.some(v => v !== '' && v !== null))
    .map(r => r.map(v => v instanceof Date ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd') : v));
  return { headers: headers, rows: rows };
}

/** { headers, rows } を見出し名キーのオブジェクト配列に */
function objects_(t) {
  return t.rows.map(r => {
    const o = {};
    t.headers.forEach((h, i) => { if (h) o[h] = r[i]; });
    return o;
  });
}

/** 見出し名キーのオブジェクトを、COLS（キー → 見出し名）で短いキーに読み替えて追加 */
function withKeys_(o, cols) {
  Object.keys(cols).forEach(k => { o[k] = o[cols[k]] === undefined ? '' : o[cols[k]]; });
  return o;
}

function isTrue_(v) {
  return v === true || String(v).toUpperCase() === 'TRUE' || v === '○' || v === '有効';
}

/* ========== 設定・マスタ ========== */

function settingsMap_() {
  const map = {};
  table_(sheet_(SETTINGS_SHEET)).rows.forEach(r => { if (r[0] !== '') map[String(r[0]).trim()] = r[1]; });
  return map;
}

function settings_() {
  const m = settingsMap_();
  return {
    startMonth: Number(m['期首月']) || 4,
    fiscalYear: Number(m['対象会計年度']) || null,
    voucherFolderId: String(m['証憑フォルダID'] || '').trim(),
    idPrefix: String(m['仕訳ID接頭辞'] || 'J'),
    funds: String(m['資金原資'] || 'RMO交付金,自己資金').split(/[,、，]/).map(s => s.trim()).filter(String),
    commonRevenueAccounts: String(m['共通収入科目'] || '').split(/[,、，]/).map(s => s.trim()).filter(String),
  };
}

function masters_() {
  const out = {};
  ss_().getSheets().forEach(sh => {
    const name = sh.getName();
    if (name.slice(-MASTER_SUFFIX.length) === MASTER_SUFFIX) out[name] = objects_(table_(sh));
  });
  return out;
}

function accounts_(masters) {
  return (masters['勘定科目マスタ'] || []).map(o => withKeys_(o, ACCOUNT_COLS))
    .filter(a => a.name !== '').map(a => Object.assign(a, { code: String(a.code), active: isTrue_(a.active) }));
}

function sources_(masters) {
  return (masters['支払元マスタ'] || []).map(o => withKeys_(o, SOURCE_COLS))
    .filter(s => s.name !== '').map(s => Object.assign(s, { active: isTrue_(s.active) }));
}

function businesses_(masters) {
  return (masters[BUSINESS_MASTER] || []).map(o => withKeys_(o, BUSINESS_COLS))
    .filter(b => String(b.name).trim() !== '')
    .map(b => Object.assign(b, { name: String(b.name).trim(), kind: String(b.kind).trim() || '事業', active: isTrue_(b.active) }));
}

/**
 * 事業を決める。収益・費用の科目なら必須（事業マスタの有効な行）。共通収入科目は常に共通の事業。
 * 科目が資産・負債・純資産だけのときは、指定があれば有効な事業か確認してそのまま返す（無ければ空欄）
 */
function resolveBusiness_(accts, given, ctx, label, errors) {
  const pl = accts.filter(a => a && (a.type === '収益' || a.type === '費用'));
  const name = String(given || '').trim();
  if (pl.some(a => ctx.common.indexOf(a.name) >= 0)) {
    if (!ctx.commonName) { errors.push('事業マスタに区分「共通」の行がありません'); return ''; }
    return ctx.commonName;
  }
  if (!name) {
    if (pl.length) errors.push(label + '事業を選んでください（どの事業とも特定できない場合は「' + (ctx.commonName || '共通') + '」）');
    return '';
  }
  if (!ctx.active[name]) errors.push(label + '事業「' + name + '」は事業マスタにないか、有効ではありません');
  return name;
}

function businessCtx_(masters, s) {
  const bs = businesses_(masters);
  const active = {};
  bs.filter(b => b.active).forEach(b => active[b.name] = true);
  const common = bs.find(b => b.active && b.kind === '共通');
  return { active: active, commonName: common ? common.name : '', common: s.commonRevenueAccounts };
}

/**
 * 設定・マスタ・仕訳帳の見出し
 * accounts / sources は有効・無効を含む全行（短いキー付き）。masters は「〜マスタ」シートの全列（見出し名キー）
 */
function getConfig() {
  const masters = masters_();
  const s = settings_();
  return {
    settings: Object.assign({}, settingsMap_(), { startMonth: s.startMonth, fiscalYear: s.fiscalYear, funds: s.funds, commonRevenueAccounts: s.commonRevenueAccounts }),
    accounts: accounts_(masters),
    sources: sources_(masters),
    businesses: businesses_(masters),
    masters: masters,
    ledgerHeaders: table_(sheet_(LEDGER_SHEET)).headers,
    today: Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'),
    user: Session.getActiveUser().getEmail() || '',
  };
}

/** 仕訳帳の全行（{ headers, rows }） */
function getLedger() {
  return table_(sheet_(LEDGER_SHEET));
}

/* ========== 登録 ========== */

function fiscalYearOf_(date, startMonth) {
  const y = date.getFullYear(), m = date.getMonth() + 1;
  return m >= startMonth ? y : y - 1;
}

function parseDate_(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) throw new Error('日付の形式が正しくありません: ' + s);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function toInt_(v) {
  const n = Number(String(v === undefined || v === null ? '' : v).replace(/[,，円\s]/g, ''));
  return isFinite(n) ? Math.round(n) : NaN;
}

function calcTax_(amount, rate) {
  const r = { '10%': 10, '8%': 8 }[rate];
  return r ? Math.floor(amount * r / (100 + r)) : 0;
}

function nextId_(sh, idCol, prefix) {
  let max = 0;
  const last = sh.getLastRow();
  if (last >= 2) {
    sh.getRange(2, idCol + 1, last - 1, 1).getValues().forEach(r => {
      const m = String(r[0]).match(/(\d+)$/);
      if (m) max = Math.max(max, Number(m[1]));
    });
  }
  return prefix + ('000000' + (max + 1)).slice(-6);
}

/** 証憑を Drive の「証憑/yyyy-MM」に保存して URL を返す */
function saveVouchers_(files, journalId, date, partner) {
  if (!files || !files.length) return [];
  const s = settings_();
  if (!s.voucherFolderId) throw new Error('設定タブに「証憑フォルダID」がありません');
  const root = DriveApp.getFolderById(s.voucherFolderId);
  const monthName = Utilities.formatDate(date, TZ, 'yyyy-MM');
  const it = root.getFoldersByName(monthName);
  const folder = it.hasNext() ? it.next() : root.createFolder(monthName);
  const ymd = Utilities.formatDate(date, TZ, 'yyyyMMdd');
  const safePartner = String(partner || '').replace(/[\\/:*?"<>|]/g, '').slice(0, 30);
  return files.map((f, i) => {
    const name = [ymd, journalId, safePartner, (files.length > 1 ? (i + 1) + '_' : '') + f.name].filter(String).join('_');
    const blob = Utilities.newBlob(Utilities.base64Decode(f.data), f.mimeType || 'application/octet-stream', name);
    return folder.createFile(blob).getUrl();
  });
}

/**
 * 仕訳帳に行を追加する。values は F のキー、extra は { 見出し名: 値 }（システム列以外の追加列のみ）
 */
function appendRows_(rowsData, extra) {
  const sh = sheet_(LEDGER_SHEET);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(v => String(v).trim());
  const idx = {};
  headers.forEach((h, i) => { if (h) idx[h] = i; });
  Object.keys(F).forEach(k => { if (idx[F[k]] === undefined) throw new Error('仕訳帳に列「' + F[k] + '」がありません'); });
  const system = {};
  Object.keys(F).forEach(k => system[F[k]] = true);
  const rows = rowsData.map(v => {
    const row = new Array(headers.length).fill('');
    Object.keys(v).forEach(k => { if (F[k]) row[idx[F[k]]] = v[k]; });
    Object.keys(extra || {}).forEach(h => { if (idx[h] !== undefined && !system[h]) row[idx[h]] = extra[h]; });
    return row;
  });
  const start = sh.getLastRow() + 1;
  sh.getRange(start, idx[F.month] + 1, rows.length, 1).setNumberFormat('@');
  sh.getRange(start, 1, rows.length, headers.length).setValues(rows);
  return { sheet: sh, idCol: idx[F.id] };
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/**
 * 支払・収入の登録
 * payload: { kind:'支払'|'収入', date:'yyyy-MM-dd', source, account, amount, taxRate, taxAmount, partner, invoiceNo,
 *            description, budgetItem, budgetCode, fund, business, voucherNo, enteredBy, files:[{name,mimeType,data}], extra:{見出し名:値} }
 * 資金原資：収入は勘定科目マスタ「資金区分」で自動決定。費用の支払は必須（設定タブ「資金原資」の選択肢）
 */
function submitTransaction(payload) {
  const p = payload || {};
  const masters = masters_();
  const accounts = accounts_(masters).filter(a => a.active);
  const sources = sources_(masters).filter(s => s.active);
  const s = settings_();
  const errors = [];
  if (p.kind !== '支払' && p.kind !== '収入') errors.push('区分（支払／収入）を選んでください');
  let date;
  try { date = parseDate_(p.date); } catch (e) { errors.push(e.message); }
  const amount = toInt_(p.amount);
  if (!(amount > 0)) errors.push('金額（税込）を正の整数で入力してください');
  const acct = accounts.find(a => a.name === p.account);
  if (!acct) errors.push('勘定科目を選んでください');
  const src = sources.find(x => x.name === p.source);
  if (!src) errors.push((p.kind === '収入' ? '入金先' : '支払元') + 'を選んでください');
  else if (!accounts.find(a => a.name === src.account)) errors.push('支払元マスタの勘定科目「' + src.account + '」が勘定科目マスタにありません');
  if (!String(p.description || '').trim()) errors.push('摘要を入力してください');
  let fund = String(p.fund || '');
  if (acct && p.kind === '収入' && acct.fundClass) fund = String(acct.fundClass);
  if (acct && acct.type === '費用' && !fund) errors.push('資金原資（' + s.funds.join('／') + '）を選んでください');
  if (fund && s.funds.indexOf(fund) < 0) errors.push('資金原資「' + fund + '」は設定タブの選択肢にありません');
  const business = acct ? resolveBusiness_([acct], p.business, businessCtx_(masters, s), '', errors) : '';
  if (errors.length) throw new Error(errors.join('\n'));

  let tax = toInt_(p.taxAmount);
  if (p.taxAmount === '' || p.taxAmount === null || p.taxAmount === undefined || !isFinite(tax)) tax = calcTax_(amount, p.taxRate);
  const isPay = p.kind === '支払';

  return withLock_(() => {
    const sh = sheet_(LEDGER_SHEET);
    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(v => String(v).trim());
    const id = nextId_(sh, headers.indexOf(F.id), s.idPrefix);
    const urls = saveVouchers_(p.files, id, date, p.partner);
    const v = {
      id: id, line: 1, date: date, month: Utilities.formatDate(date, TZ, 'yyyy-MM'), fy: fiscalYearOf_(date, s.startMonth),
      kind: p.kind, drAcct: isPay ? acct.name : src.account, drAmt: amount, crAcct: isPay ? src.account : acct.name, crAmt: amount,
      taxRate: p.taxRate || '', taxAmt: tax, partner: p.partner || '', invoiceNo: p.invoiceNo || '',
      description: String(p.description).trim() + (src.kind === '立替' ? '／' + src.name : ''),
      budgetItem: p.budgetItem || '', fund: fund, voucherNo: p.voucherNo || '', voucherUrl: urls.join('\n'),
      enteredBy: p.enteredBy || Session.getActiveUser().getEmail(), created: now_(), status: '有効', budgetCode: p.budgetCode || '',
      business: business,
    };
    appendRows_([v], p.extra);
    return { id: id, urls: urls, debit: v.drAcct, credit: v.crAcct, amount: amount, fund: fund, business: business };
  });
}

/**
 * 仕訳の登録（複合仕訳可）
 * payload: { date, description, partner, invoiceNo, budgetItem, budgetCode, fund, business, voucherNo, enteredBy,
 *            lines:[{debitAccount, debitAmount, creditAccount, creditAmount, memo, business}], files, extra }
 * 事業は行ごとに指定可（lines[].business）。行に無ければ伝票の business を使う
 */
function submitJournal(payload) {
  const p = payload || {};
  const s = settings_();
  const masters = masters_();
  const accts = accounts_(masters).filter(a => a.active);
  const names = new Set(accts.map(a => a.name));
  const bctx = businessCtx_(masters, s);
  const acctOf = n => accts.find(a => a.name === n);
  const errors = [];
  let date;
  try { date = parseDate_(p.date); } catch (e) { errors.push(e.message); }
  if (!String(p.description || '').trim()) errors.push('摘要を入力してください');
  if (p.fund && s.funds.indexOf(p.fund) < 0) errors.push('資金原資「' + p.fund + '」は設定タブの選択肢にありません');
  const lines = (p.lines || []).map((l, i) => {
    if (!l.debitAccount && !l.creditAccount) return null;
    const dA = l.debitAccount ? toInt_(l.debitAmount) : 0;
    const cA = l.creditAccount ? toInt_(l.creditAmount) : 0;
    if (l.debitAccount && !names.has(l.debitAccount)) errors.push((i + 1) + '行目: 借方科目が不正です');
    if (l.creditAccount && !names.has(l.creditAccount)) errors.push((i + 1) + '行目: 貸方科目が不正です');
    if (l.debitAccount && !(dA > 0)) errors.push((i + 1) + '行目: 借方金額を入力してください');
    if (l.creditAccount && !(cA > 0)) errors.push((i + 1) + '行目: 貸方金額を入力してください');
    const business = resolveBusiness_([acctOf(l.debitAccount), acctOf(l.creditAccount)], l.business || p.business, bctx, (i + 1) + '行目: ', errors);
    return { dAcct: l.debitAccount || '', dAmt: dA || 0, cAcct: l.creditAccount || '', cAmt: cA || 0, memo: String(l.memo || '').trim(), business: business };
  }).filter(Boolean);
  if (!lines.length) errors.push('仕訳行を1行以上入力してください');
  const dSum = lines.reduce((t, l) => t + l.dAmt, 0);
  const cSum = lines.reduce((t, l) => t + l.cAmt, 0);
  if (dSum !== cSum) errors.push('貸借が一致しません（借方 ' + dSum.toLocaleString() + ' ／ 貸方 ' + cSum.toLocaleString() + '）');
  if (errors.length) throw new Error(errors.join('\n'));

  return withLock_(() => {
    const sh = sheet_(LEDGER_SHEET);
    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(v => String(v).trim());
    const id = nextId_(sh, headers.indexOf(F.id), s.idPrefix);
    const urls = saveVouchers_(p.files, id, date, p.partner);
    const created = now_();
    const rows = lines.map((l, i) => ({
      id: id, line: i + 1, date: date, month: Utilities.formatDate(date, TZ, 'yyyy-MM'), fy: fiscalYearOf_(date, s.startMonth),
      kind: '仕訳', drAcct: l.dAcct, drAmt: l.dAcct ? l.dAmt : '', crAcct: l.cAcct, crAmt: l.cAcct ? l.cAmt : '',
      partner: p.partner || '', invoiceNo: p.invoiceNo || '', description: l.memo || String(p.description).trim(),
      budgetItem: p.budgetItem || '', fund: p.fund || '', voucherNo: p.voucherNo || '', voucherUrl: urls.join('\n'),
      enteredBy: p.enteredBy || Session.getActiveUser().getEmail(), created: created, status: '有効', budgetCode: p.budgetCode || '',
      business: l.business,
    }));
    appendRows_(rows, p.extra);
    return { id: id, lines: rows.length, total: dSum, urls: urls };
  });
}

/* ========== 動作確認 ========== */

function testRead() {
  const c = getConfig();
  Logger.log(JSON.stringify({ settings: c.settings, accounts: c.accounts.length, sources: c.sources.length, businesses: c.businesses, masters: Object.keys(c.masters), headers: c.ledgerHeaders }));
  Logger.log(JSON.stringify(getLedger()).slice(0, 2000));
}
