/**
 * とうじょうRMO会計システム 予算API（v2）
 *
 * 方針：この GAS は原則として変更しない。
 * - 予算シートをそのまま返すだけ。実績との突き合わせ・集計は HTML 側で行う
 * - 予算シート：名前が「当初予算_YYYY-MM-DD」「改訂予算_YYYY-MM-DD」のシート（日付順。同日なら当初予算が先）
 * - 列は見出し名のまま返すので、列を追加しても GAS の変更は不要
 *
 * API（POST {action, args, key}）
 *   getBudget()   予算バージョンの一覧と各シートの内容
 */

const BUDGET_SPREADSHEET_ID = '1gkrn6S4IaJ-pYIoMDXTzuuA2y_VT62RfX-JuA10Tmms';
const VERSION_RE = /^(当初予算|改訂予算)_(\d{4}-\d{2}-\d{2})$/;
const TZ = 'Asia/Tokyo';

const API_ACTIONS = {
  getBudget: () => getBudget(),
};

function doGet() {
  return json_({ ok: true, data: { service: 'とうじょうRMO会計システム 予算API', version: 2, actions: Object.keys(API_ACTIONS), time: Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss') } });
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
  SpreadsheetApp.openById(BUDGET_SPREADSHEET_ID).getName();
  Logger.log('API パスコード: ' + key);
  return key;
}

/**
 * 予算バージョン一覧
 * 戻り値：{ versions: [{ name, kind, date, headers, rows }] }（rows は値の2次元配列、日付は yyyy-MM-dd）
 */
function getBudget() {
  const ss = SpreadsheetApp.openById(BUDGET_SPREADSHEET_ID);
  const versions = ss.getSheets().map(sh => {
    const m = sh.getName().match(VERSION_RE);
    if (!m) return null;
    const values = sh.getDataRange().getValues();
    return {
      name: sh.getName(), kind: m[1], date: m[2],
      headers: (values[0] || []).map(v => String(v).trim()),
      rows: values.slice(1)
        .filter(r => r.some(v => v !== '' && v !== null))
        .map(r => r.map(v => v instanceof Date ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd') : v)),
    };
  }).filter(Boolean).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : (a.kind === '当初予算' ? -1 : 1));
  return { versions: versions };
}

function testBudget() {
  Logger.log(JSON.stringify(getBudget()).slice(0, 3000));
}
