/* とうじょうRMO会計システム 共通スクリプト（デザインは RMO Gantt に準拠） */

// GAS ウェブアプリ（/exec）の URL
const API_URL = 'https://script.google.com/macros/s/AKfycbyEmlSmcJzUYnCUoAYA39Tl24d7Plqt7Puo6p6cfdS8XOokEv6ceJ9xLdNryeO7GSr4/exec';
// 予算 API（予算管理スプレッドシートの GAS ウェブアプリ /exec）
const BUDGET_API_URL = 'https://script.google.com/macros/s/AKfycbyooLm09B5XAY8BX5m5pFaG67BtAR11xTydbrrz34VRYIGp_5WtoQ4Vv2UijcIYSz1W/exec';
// 予算管理（スプレッドシート）
const BUDGET_URL = 'https://docs.google.com/spreadsheets/d/1gkrn6S4IaJ-pYIoMDXTzuuA2y_VT62RfX-JuA10Tmms/edit';
// 会計Ledger（スプレッドシート）
const LEDGER_URL = 'https://docs.google.com/spreadsheets/d/1EdBz2L4jN-4kU1XXIRJf4BzT-az6cfMmqCdMu_497EQ/edit';

const fmt = n => (n < 0 ? '(' + Math.abs(n).toLocaleString('ja-JP') + ')' : Number(n || 0).toLocaleString('ja-JP'));
const yen = n => '¥' + fmt(n);
const $ = s => document.querySelector(s);
const toInt = v => { const n = Number(String(v || '').replace(/[,，円\s]/g, '')); return isFinite(n) ? Math.round(n) : NaN; };
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(msg, isErr) {
  const t = $('#toast');
  t.innerHTML = msg;
  t.className = 'toast' + (isErr ? ' err' : '');
  t.style.display = 'block';
  clearTimeout(t._h);
  t._h = setTimeout(() => t.style.display = 'none', isErr ? 9000 : 6000);
}

/* ===== 読み込みバー ===== */
let pending = 0;
function loading(on) {
  pending = Math.max(0, pending + (on ? 1 : -1));
  const el = document.getElementById('loading');
  if (el) el.classList.toggle('on', pending > 0);
}

/** GAS API 呼び出し（会計 API）。GAS 上で開いた場合は google.script.run、それ以外は fetch */
function run(fn, ...args) { return callApi(API_URL, fn, args); }
/** 予算 API 呼び出し */
function runBudget(fn, ...args) { return callApi(BUDGET_API_URL, fn, args); }

function callApi(url, fn, args) {
  loading(true);
  const done = v => { loading(false); return v; };
  const fail = e => { loading(false); return Promise.reject(e); };
  if (url === API_URL && window.google && google.script && google.script.run) {
    return new Promise((resolve, reject) =>
      google.script.run.withSuccessHandler(resolve).withFailureHandler(reject).api(fn, args)).then(done, fail);
  }
  if (!url || url.indexOf('__') === 0) return fail(new Error('common.js の API の URL が未設定です'));
  return getKey().then(key => fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: fn, args: args, key: key }),
  })).then(r => r.json()).then(j => {
    if (j.ok) return done(j.data);
    if (j.code === 'AUTH') {
      storeKey('');
      loading(false);
      return askKey(j.error).then(() => callApi(url, fn, args));
    }
    return fail(new Error(j.error));
  }, fail);
}

/* ===== パスコード（このブラウザに保存）— Gantt と同じログイン画面 ===== */
const KEY_NAME = 'rmo_accounting_key';
function storeKey(v) { try { v ? localStorage.setItem(KEY_NAME, v) : localStorage.removeItem(KEY_NAME); } catch (e) {} }
function readKey() { try { return localStorage.getItem(KEY_NAME) || ''; } catch (e) { return ''; } }
let keyPromise = null;
function getKey() { const k = readKey(); return k ? Promise.resolve(k) : askKey(); }
function askKey(msg) {
  if (keyPromise) return keyPromise;
  keyPromise = new Promise(resolve => {
    const ov = document.getElementById('loginOv');
    ov.querySelector('.msg').textContent = msg || '';
    ov.classList.add('open');
    const input = ov.querySelector('input'); input.value = ''; input.focus();
    ov.querySelector('form').onsubmit = e => {
      e.preventDefault(); const v = input.value.trim(); if (!v) return;
      storeKey(v); ov.classList.remove('open'); keyPromise = null; resolve(v);
    };
  });
  return keyPromise;
}

/* ===== 共通ヘッダー・ログイン画面 ===== */
const PAGES = [
  ['home', 'index.html', 'Menu', 'メニュー'],
  ['entry', 'entry.html', 'Entry', '支払・収入入力'],
  ['journal', 'journal.html', 'Journal', '仕訳入力'],
  ['dashboard', 'dashboard.html', 'Dashboard', 'BS・PL ダッシュボード'],
];
function renderChrome() {
  const page = document.body.dataset.page;
  const cur = PAGES.find(p => p[0] === page) || PAGES[0];
  const bar = document.createElement('div'); bar.className = 'loading'; bar.id = 'loading'; bar.innerHTML = '<i></i>';
  const h = document.createElement('header');
  h.className = 'hd';
  h.innerHTML = '<div class="brand"><div class="eyebrow">とうじょうRMO会計システム</div><div class="ttl">' + cur[3] + '</div></div><nav>'
    + PAGES.map(p => '<a class="txtbtn' + (p[0] === page ? ' on' : '') + '" href="' + p[1] + '" title="' + p[3] + '">' + p[2] + '</a>').join('')
    + '<span class="sep"></span><a class="txtbtn" href="' + LEDGER_URL + '" target="_blank" rel="noopener" title="会計Ledger（スプレッドシート）">Ledger ↗</a>'
    + '<a class="txtbtn" href="' + BUDGET_URL + '" target="_blank" rel="noopener" title="予算管理（スプレッドシート）">Budget ↗</a>'
    + '<button class="txtbtn" id="btnLogout" type="button" title="保存したパスコードを消去">Logout</button></nav>';
  document.body.prepend(h);
  document.body.prepend(bar);
  const t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t);
  const ov = document.createElement('div'); ov.className = 'ov'; ov.id = 'loginOv';
  ov.innerHTML = '<form class="login"><div class="eyebrow">Restricted Access</div><h2>Enter<br>Password.</h2>'
    + '<input type="password" autocomplete="current-password" placeholder="Password" required><div class="msg"></div>'
    + '<button class="pbtn" type="submit">Open Accounting</button></form>';
  document.body.appendChild(ov);
  document.getElementById('btnLogout').onclick = () => { storeKey(''); location.reload(); };
}
// ページのスクリプトより先にヘッダー等を用意する（common.js は body の末尾で読み込む）
renderChrome();

function fillSelect(sel, items, opts) {
  opts = opts || {};
  sel.innerHTML = (opts.blank !== false ? '<option value="">' + (opts.placeholder || '選択してください') + '</option>' : '');
  if (opts.groupBy) {
    const groups = {};
    items.forEach(i => (groups[i[opts.groupBy]] = groups[i[opts.groupBy]] || []).push(i));
    Object.keys(groups).forEach(g => {
      const og = document.createElement('optgroup'); og.label = g;
      groups[g].forEach(i => og.appendChild(new Option(opts.label ? opts.label(i) : i.name, i.name)));
      sel.appendChild(og);
    });
  } else {
    items.forEach(i => sel.appendChild(typeof i === 'string' ? new Option(i, i) : new Option(opts.label ? opts.label(i) : i.name, i.name)));
  }
}

/** 添付ファイル（ドラッグ＆ドロップ対応） */
function FilePicker(dropEl, inputEl, listEl, previewEl) {
  const files = [];
  const MAX = 15 * 1024 * 1024;
  const render = () => {
    listEl.innerHTML = files.map((f, i) => '<li><span>' + esc(f.name) + ' <span class="muted">(' + Math.ceil(f.size / 1024) + ' KB)</span></span><button type="button" data-i="' + i + '">削除</button></li>').join('');
    previewEl.innerHTML = '';
    files.filter(f => f.type.startsWith('image/')).forEach(f => { const img = document.createElement('img'); img.src = URL.createObjectURL(f); previewEl.appendChild(img); });
  };
  const add = list => { Array.from(list).forEach(f => { if (f.size > MAX) toast(f.name + ' は 15MB を超えています', true); else files.push(f); }); render(); };
  dropEl.addEventListener('click', () => inputEl.click());
  inputEl.addEventListener('change', e => { add(e.target.files); inputEl.value = ''; });
  ['dragenter', 'dragover'].forEach(ev => dropEl.addEventListener(ev, e => { e.preventDefault(); dropEl.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => dropEl.addEventListener(ev, e => { e.preventDefault(); dropEl.classList.remove('over'); }));
  dropEl.addEventListener('drop', e => add(e.dataTransfer.files));
  listEl.addEventListener('click', e => { if (e.target.dataset.i !== undefined) { files.splice(Number(e.target.dataset.i), 1); render(); } });
  return {
    count: () => files.length,
    clear: () => { files.length = 0; render(); },
    read: () => Promise.all(files.map(f => new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res({ name: f.name, mimeType: f.type || 'application/octet-stream', data: String(r.result).split(',')[1] });
      r.onerror = rej; r.readAsDataURL(f);
    }))),
  };
}

function busy(btn, on) { btn.disabled = on; btn.classList.toggle('is-busy', on); }

/**
 * 予算項目の連動プルダウン（大項目 → 中項目 → 小項目）
 * sels: {l1, l2, l3} の select 要素。items: 予算 API getBudgetItems().items
 */
function BudgetPicker(sels, items) {
  const uniq = arr => arr.filter((v, i) => v && arr.indexOf(v) === i);
  const opt = (sel, list, ph) => {
    sel.innerHTML = '<option value="">' + ph + '</option>' + list.map(o => '<option value="' + esc(o.v) + '">' + esc(o.t) + '</option>').join('');
  };
  const fill1 = () => opt(sels.l1, uniq(items.map(i => i.l1)).map(v => ({ v, t: v })), '（任意）大項目を選択');
  const fill2 = () => {
    const l1 = sels.l1.value;
    opt(sels.l2, uniq(items.filter(i => !l1 || i.l1 === l1).map(i => i.l2)).map(v => ({ v, t: v })), l1 ? '中項目を選択' : '（大項目を先に選択）');
    sels.l2.disabled = !l1;
  };
  const fill3 = () => {
    const l1 = sels.l1.value, l2 = sels.l2.value;
    opt(sels.l3, items.filter(i => i.l1 === l1 && i.l2 === l2).map(i => ({ v: i.code, t: i.l3 + '（' + i.code + '）' })), l2 ? '小項目を選択' : '（中項目を先に選択）');
    sels.l3.disabled = !l2;
  };
  sels.l1.addEventListener('change', () => { fill2(); fill3(); });
  sels.l2.addEventListener('change', fill3);
  const reset = () => { fill1(); fill2(); fill3(); };
  reset();
  return {
    reset,
    value: () => ({ budgetItem: sels.l2.value || sels.l1.value || '', budgetCode: sels.l3.value || '' }),
    item: () => items.find(i => i.code === sels.l3.value) || null,
  };
}
