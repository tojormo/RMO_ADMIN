/* 支払・収入入力 */
(function () {

  let M = null, kind = '支払';
  const f = document.getElementById('f');
  const picker = FilePicker($('#drop'), $('#fileInput'), $('#fileList'), $('#preview'));

  function refreshAccounts() {
    const all = $('#allAcct').checked;
    const list = M.accounts.filter(a => all ? a.usage !== '支払元' : (a.usage === kind));
    fillSelect(f.account, list, { groupBy: all ? 'type' : null, label: a => a.code + ' ' + a.name });
    refreshFund(); refreshBusiness();
  }
  /** 資金原資：支出は選択（必須）、収入は科目の資金区分で自動（RMO交付金収入→RMO交付金、事業収入→自己資金） */
  function refreshFund() {
    const acct = M && M.accounts.find(a => a.name === f.account.value);
    const auto = kind === '収入' && acct && acct.fundClass;
    const need = acct ? acct.type === '費用' : kind === '支払';
    if (auto) f.fund.value = acct.fundClass;
    f.fund.disabled = !!auto;
    f.fund.required = need;
    $('#fundLabel').innerHTML = '資金原資' + (need ? '<span class="req"></span>' : '') + (auto ? '<span class="auto">自動</span>' : '');
    $('#fundHint').textContent = auto ? '収入科目「' + acct.name + '」は' + acct.fundClass + 'に分類されます'
      : kind === '収入' ? '収入はRMO交付金収入（→RMO交付金）か事業収入（→自己資金）を選ぶと自動で分類されます'
      : '支出の財源（' + (M ? M.funds.join('／') : '') + '）';
  }
  /** 事業：収益・費用の科目は必須。交付金など共通の収入科目は「共通」に固定 */
  function refreshBusiness() {
    const acct = M && M.accounts.find(a => a.name === f.account.value);
    const pl = acct && (acct.type === '収益' || acct.type === '費用');
    const fixed = acct && M.commonRevenueAccounts.indexOf(acct.name) >= 0;
    if (fixed) f.business.value = M.commonBusiness;
    f.business.disabled = !!fixed;
    f.business.required = !!pl && !fixed;
    $('#busLabel').innerHTML = '事業' + (pl ? '<span class="req"></span>' : '') + (fixed ? '<span class="auto">自動</span>' : '');
    $('#busHint').textContent = fixed ? '「' + acct.name + '」は共通の収入として、一般管理費の後に加算されます'
      : acct && acct.type === '収益' ? '事業を選ぶとその事業の売上になります'
      : acct && acct.type === '費用' ? '事業を選ぶとその事業の原価、共通は一般管理費になります'
      : '収益・費用の科目を選んだときは必須です';
  }
  function refreshSummary() {
    const amt = toInt(f.amount.value);
    const src = M && M.sources.find(s => s.name === f.source.value);
    if (!src || !f.account.value || !(amt > 0)) { $('#summary').textContent = '入力すると仕訳イメージが表示されます'; return; }
    const dr = kind === '支払' ? f.account.value : src.account;
    const cr = kind === '支払' ? src.account : f.account.value;
    const tax = toInt(f.taxAmount.value) || 0;
    $('#summary').innerHTML = '仕訳イメージ：（借方）<b>' + esc(dr) + '</b> ' + yen(amt) + ' ／（貸方）<b>' + esc(cr) + '</b> ' + yen(amt)
      + '<span class="muted">　税抜 ' + yen(amt - tax) + '・消費税 ' + yen(tax) + '</span>';
  }
  function calcTax() {
    const amt = toInt(f.amount.value), r = { '10%': 10, '8%': 8 }[f.taxRate.value];
    if (amt > 0 && r) f.taxAmount.value = Math.floor(amt * r / (100 + r));
    else if (!r && f.taxRate.value !== '8%・10%') f.taxAmount.value = 0;
    refreshSummary();
  }

  document.querySelectorAll('#kind button').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('#kind button').forEach(x => x.classList.toggle('on', x === b));
    kind = b.dataset.v;
    $('#srcLabel').innerHTML = (kind === '収入' ? '入金先' : '支払元') + '<span class="req"></span>';
    refreshAccounts(); refreshSummary();
  }));
  $('#allAcct').addEventListener('change', refreshAccounts);
  f.account.addEventListener('change', () => { refreshFund(); refreshBusiness(); });
  f.amount.addEventListener('input', calcTax);
  f.amount.addEventListener('blur', () => { const n = toInt(f.amount.value); if (n > 0) f.amount.value = n.toLocaleString('ja-JP'); });
  f.taxRate.addEventListener('change', calcTax);
  ['change', 'input'].forEach(ev => f.addEventListener(ev, refreshSummary));

  $('#clearBtn').addEventListener('click', () => { const keep = { date: f.date.value, source: f.source.value, enteredBy: f.enteredBy.value }; f.reset(); f.date.value = keep.date; f.source.value = keep.source; f.enteredBy.value = keep.enteredBy; picker.clear(); if (bp) bp.reset(); refreshAccounts(); refreshSummary(); });

  f.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('#submit');
    if (picker.count() === 0 && kind === '支払' && !confirm('証憑が添付されていません。このまま登録しますか？')) return;
    busy(btn, true);
    try {
      const data = Object.fromEntries(new FormData(f).entries());
      data.kind = kind;
      data.amount = toInt(data.amount);
      data.fund = f.fund.value;
      data.business = f.business.value;   // 共通収入科目のときは選択欄が無効でも共通を送る
      Object.assign(data, bp ? bp.value() : {}); delete data.bl1; delete data.bl2; delete data.bl3;
      data.files = await picker.read();
      const res = await Api.call('submitTransaction', data);
      toast('登録しました：' + res.id + '\n（借方）' + res.debit + ' ／（貸方）' + res.credit + '　' + yen(res.amount)
        + (res.urls.length ? '\n証憑 ' + res.urls.length + ' 件を保存しました' : ''));
      $('#clearBtn').click();
    } catch (err) {
      toast('登録できませんでした\n' + esc(err.message || err), true);
    } finally { busy(btn, false); }
  });

  let bp = null;
  Store.budgetData().then(Model.budgetItems).then(b => {
    bp = BudgetPicker({ l1: $('#bl1'), l2: $('#bl2'), l3: $('#bl3') }, b.items);
    if (b.version) $('#budgetHint').textContent = '予算「' + b.version + '」から選択。選ぶと実績が予算対比に集計されます';
    $('#bl3').addEventListener('change', () => {
      const it = bp.item(); if (!it) return;
      const acct = M && Model.findAccount(M.accounts, it.account, it.accountCode);
      if (acct && kind === '支払' && !f.account.value) {
        if (![...f.account.options].some(o => o.value === acct.name)) { $('#allAcct').checked = true; refreshAccounts(); }
        f.account.value = acct.name; refreshFund(); refreshBusiness(); refreshSummary();
      }
      if (it.fund && !f.fund.value && !f.fund.disabled && [...f.fund.options].some(o => o.value === it.fund)) f.fund.value = it.fund;
    });
  }).catch(err => toast('予算項目を読み込めませんでした\n' + esc(err.message || err), true));

  Store.config().then(ctx => Store.inputMasters(ctx)).then(m => {
    M = m;
    f.date.value = m.today;
    f.enteredBy.value = m.user || '';
    fillSelect(f.source, m.sources, { label: s => s.name + '（' + s.account + '）' });
    fillSelect(f.fund, m.funds, { placeholder: '選択してください' });
    fillBusiness(f.business, m);
    refreshAccounts();
  }).catch(err => toast('マスタを読み込めませんでした\n' + esc(err.message || err), true));
})();
