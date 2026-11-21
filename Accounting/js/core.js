/* 共通：書式・API 呼び出し・ログイン・ヘッダー（デザインは RMO Gantt に準拠） */

const fmt = n => (n < 0 ? '(' + Math.abs(n).toLocaleString('ja-JP') + ')' : Number(n || 0).toLocaleString('ja-JP'));
const yen = n => '¥' + fmt(n);
const $ = s => document.querySelector(s);
const toInt = v => { const n = Number(String(v || '').replace(/[,，円\s]/g, '')); return isFinite(n) ? Math.round(n) : NaN; };
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const todayJST = () => new Date().toLocaleDateString('sv-SE', { timeZone: CONFIG.TIMEZONE });

function toast(msg, isErr) {
  const t = $('#toast');
  t.innerHTML = msg;
  t.className = 'toast' + (isErr ? ' err' : '');
  t.style.display = 'block';
  clearTimeout(t._h);
  t._h = setTimeout(() => t.style.display = 'none', isErr ? 9000 : 6000);
}

function busy(btn, on) { btn.disabled = on; btn.classList.toggle('is-busy', on); }

/* ===== 読み込みバー ===== */
let pending = 0;
function loading(on) {
  pending = Math.max(0, pending + (on ? 1 : -1));
  const el = document.getElementById('loading');
  if (el) el.classList.toggle('on', pending > 0);
}

/* ===== API ===== */
const Api = {
  /** 会計API */
  call: (fn, ...args) => callApi(CONFIG.API_URL, fn, args),
  /** 予算API */
  budget: (fn, ...args) => callApi(CONFIG.BUDGET_API_URL, fn, args),
};

function callApi(url, fn, args) {
  loading(true);
  const done = v => { loading(false); return v; };
  const fail = e => { loading(false); return Promise.reject(e); };
  if (!url) return fail(new Error('js/config.js の API の URL が未設定です'));
  return getKey().then(key => fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // プリフライトを避ける
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
function storeKey(v) { try { v ? localStorage.setItem(CONFIG.STORAGE_KEY, v) : localStorage.removeItem(CONFIG.STORAGE_KEY); } catch (e) {} }
function readKey() { try { return localStorage.getItem(CONFIG.STORAGE_KEY) || ''; } catch (e) { return ''; } }
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
  h.innerHTML = '<div class="brand"><div class="eyebrow">' + esc(CONFIG.SYSTEM_NAME) + '</div><div class="ttl">' + cur[3] + '</div></div><nav>'
    + PAGES.map(p => '<a class="txtbtn' + (p[0] === page ? ' on' : '') + '" href="' + p[1] + '" title="' + p[3] + '">' + p[2] + '</a>').join('')
    + '<span class="sep"></span><a class="txtbtn" href="' + CONFIG.LEDGER_URL + '" target="_blank" rel="noopener" title="会計Ledger（スプレッドシート）">Ledger ↗</a>'
    + '<a class="txtbtn" href="' + CONFIG.BUDGET_URL + '" target="_blank" rel="noopener" title="予算管理（スプレッドシート）">Budget ↗</a>'
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
renderChrome();   // core.js は body の末尾で読み込む
