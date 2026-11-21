/* 仕訳入力 */
(function () {

  let M = null;
  const f = document.getElementById('f');
  const tbody = document.querySelector('#lines tbody');
  const picker = FilePicker($('#drop'), $('#fileInput'), $('#fileList'), $('#preview'));

  function acctSelect(value) {
    const s = document.createElement('select');
    fillSelect(s, M.accounts, { groupBy: 'type', label: a => a.code + ' ' + a.name, placeholder: '—' });
    s.value = value || '';
    return s;
  }
  function addLine(l) {
    l = l || {};
    const tr = document.createElement('tr');
    const td = () => tr.appendChild(document.createElement('td'));
    const amt = v => { const i = document.createElement('input'); i.className = 'num'; i.inputMode = 'numeric'; i.value = v ? Number(v).toLocaleString('ja-JP') : ''; i.addEventListener('blur', () => { const n = toInt(i.value); if (n > 0) i.value = n.toLocaleString('ja-JP'); }); return i; };
    td().appendChild(acctSelect(l.d)); td().appendChild(amt(l.da));
    td().appendChild(acctSelect(l.c)); td().appendChild(amt(l.ca));
    const memo = document.createElement('input'); memo.value = l.memo || ''; td().appendChild(memo);
    const rm = document.createElement('button'); rm.type = 'button'; rm.className = 'rm'; rm.textContent = '削除'; rm.title = '行を削除';
    rm.onclick = () => { tr.remove(); recalc(); }; td().appendChild(rm);
    tbody.appendChild(tr); recalc();
  }
  function readLines() {
    return Array.from(tbody.rows).map(tr => {
      const [d, da, c, ca, memo] = tr.querySelectorAll('select, input');
      return { debitAccount: d.value, debitAmount: toInt(da.value) || 0, creditAccount: c.value, creditAmount: toInt(ca.value) || 0, memo: memo.value };
    });
  }
  function recalc() {
    const ls = readLines();
    const d = ls.reduce((t, l) => t + (l.debitAccount ? l.debitAmount : 0), 0);
    const c = ls.reduce((t, l) => t + (l.creditAccount ? l.creditAmount : 0), 0);
    $('#dSum').textContent = fmt(d); $('#cSum').textContent = fmt(c);
    const ok = d > 0 && d === c && ls.every(l => (!l.debitAccount || l.debitAmount > 0) && (!l.creditAccount || l.creditAmount > 0));
    $('#diff').innerHTML = d === c ? (d > 0 ? '<span class="ok">✓ 貸借一致</span>' : '') : '<span class="ng">✕ 差額 ' + fmt(Math.abs(d - c)) + '</span>';
    $('#submit').disabled = !ok;
  }
  tbody.addEventListener('input', recalc); tbody.addEventListener('change', recalc);
  $('#add').onclick = () => addLine();
  $('#tplOpen').onclick = () => {
    tbody.innerHTML = '';
    addLine({ d: '普通預金', memo: '期首残高' }); addLine({ d: '小口現金', memo: '期首残高' }); addLine({ c: '正味財産（繰越金）', memo: '期首残高' });
    f.description.value = f.description.value || '開始残高';
  };
  $('#tplSettle').onclick = () => {
    tbody.innerHTML = '';
    addLine({ d: '未払金', memo: '立替精算' }); addLine({ c: '普通預金', memo: '立替精算' });
    f.description.value = f.description.value || '立替金の精算';
  };

  f.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('#submit'); busy(btn, true);
    try {
      const data = Object.fromEntries(new FormData(f).entries());
      Object.assign(data, bp ? bp.value() : {}); delete data.bl1; delete data.bl2; delete data.bl3;
      data.lines = readLines().filter(l => l.debitAccount || l.creditAccount);
      data.files = await picker.read();
      const res = await Api.call('submitJournal', data);
      toast('仕訳を登録しました：' + res.id + '（' + res.lines + '行・' + yen(res.total) + '）');
      const keep = { date: f.date.value, enteredBy: f.enteredBy.value };
      f.reset(); f.date.value = keep.date; f.enteredBy.value = keep.enteredBy; if (bp) bp.reset();
      tbody.innerHTML = ''; addLine(); addLine(); picker.clear();
    } catch (err) {
      toast('登録できませんでした\n' + esc(err.message || err), true);
      busy(btn, false); recalc(); return;
    }
    busy(btn, false); recalc();
  });

  let bp = null;
  Store.budgetData().then(Model.budgetItems).then(b => {
    bp = BudgetPicker({ l1: $('#bl1'), l2: $('#bl2'), l3: $('#bl3') }, b.items);
    if (b.version) $('#budgetHint').textContent = '予算「' + b.version + '」から選択。選ぶと実績が予算対比に集計されます';
    
  }).catch(err => toast('予算項目を読み込めませんでした\n' + esc(err.message || err), true));

  Store.config().then(ctx => Store.inputMasters(ctx)).then(m => {
    M = m;
    f.date.value = m.today; f.enteredBy.value = m.user || '';
    fillSelect(f.fund, m.funds, { placeholder: '（任意）' });
    addLine(); addLine();
  }).catch(err => toast('マスタを読み込めませんでした\n' + esc(err.message || err), true));
})();
