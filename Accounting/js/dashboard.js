/* ダッシュボード */
(function () {

  const css = getComputedStyle(document.documentElement);
  const C = { rev: css.getPropertyValue('--lv1').trim(), exp: css.getPropertyValue('--lv2').trim(), ink: css.getPropertyValue('--ink').trim(), grid: css.getPropertyValue('--hair').trim(), text: css.getPropertyValue('--mute').trim() };
  const charts = {};
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.font.size = 11;
  Chart.defaults.color = C.text;

  const baseOpts = (extra) => Object.assign({
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ' ' + ctx.dataset.label + '：' + yen(ctx.chart.options.indexAxis === 'y' ? ctx.parsed.x : ctx.parsed.y) } } },
    scales: {
      x: { grid: { display: false } },
      y: { grid: { color: C.grid }, border: { display: false }, ticks: { callback: v => fmt(v) } },
    },
  }, extra || {});

  function draw(id, cfg) { if (charts[id]) charts[id].destroy(); charts[id] = new Chart(document.getElementById(id), cfg); }

  function render(d) {
    $('#period').textContent = d.fiscalYear + '年度（' + d.period + '）・支払基準・税込　更新 ' + d.generatedAt;
    const sel = $('#fy');
    sel.innerHTML = d.years.map(y => '<option' + (y === d.fiscalYear ? ' selected' : '') + '>' + y + '</option>').join('');

    const w = [];
    if (d.warnings.unbalanced.length) w.push('貸借が一致しない仕訳があります：' + d.warnings.unbalanced.join(', '));
    if (d.warnings.unknownAccounts.length) w.push('勘定科目マスタにない科目が使われています：' + d.warnings.unknownAccounts.join(', '));
    if (d.warnings.bsDiff) w.push('貸借対照表が一致しません（差額 ' + yen(d.warnings.bsDiff) + '）');
    $('#warn').style.display = w.length ? 'block' : 'none';
    $('#warn').innerHTML = w.map(esc).join('<br>');

    const k = [
      ['資金残高', d.bs.cash, '小口現金＋普通預金'],
      ['資産合計', d.bs.assetsTotal, '年度末'],
      ['負債合計', d.bs.liabilitiesTotal, '未払金（立替）など'],
      ['純資産', d.bs.equityTotal, '繰越金＋収支差額'],
      ['当期収益', d.pl.revenueTotal, d.fiscalYear + '年度'],
      ['当期費用', d.pl.expenseTotal, d.fiscalYear + '年度'],
      ['当期収支差額', d.pl.surplus, '収益 − 費用'],
    ];
    $('#kpis').innerHTML = k.map(x => '<div class="stat' + (x[1] < 0 ? ' alert' : '') + '"><div class="l">' + x[0] + '</div><div class="n">' + yen(x[1]) + '</div><div class="s">' + x[2] + '</div></div>').join('');


    // 資金残高は当月まで表示（まだ来ていない月は線を引かない）
    const nowMonth = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }).slice(0, 7);
    const labels = d.monthly.map(m => Number(m.month.slice(5)) + '月');
    draw('cMonthly', { type: 'bar', data: { labels, datasets: [
      { label: '収益', data: d.monthly.map(m => m.revenue), backgroundColor: C.rev, borderRadius: 0, maxBarThickness: 18 },
      { label: '費用', data: d.monthly.map(m => m.expense), backgroundColor: C.exp, borderRadius: 0, maxBarThickness: 18 },
    ] }, options: baseOpts() });
    draw('cCash', { type: 'line', data: { labels, datasets: [
      { label: '資金残高', data: d.monthly.map(m => m.month <= nowMonth ? m.cash : null), borderColor: C.ink, backgroundColor: C.ink, borderWidth: 2, pointRadius: 4, pointHoverRadius: 6, tension: 0 },
    ] }, options: baseOpts() });

    const ex = d.pl.expense;
    $('#expWrap').style.height = Math.max(298, ex.length * 30 + 40) + 'px';
    draw('cExp', { type: 'bar', data: { labels: ex.map(e => e.name), datasets: [
      { label: '費用', data: ex.map(e => e.amount), backgroundColor: C.exp, borderRadius: 0, maxBarThickness: 18 },
    ] }, options: baseOpts({ indexAxis: 'y', interaction: { mode: 'nearest', axis: 'y', intersect: false },
      scales: { x: { grid: { color: C.grid }, border: { display: false }, ticks: { callback: v => fmt(v) } }, y: { grid: { display: false } } } }) });

    const row = (n, v, cls) => '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td>' + esc(n) + '</td><td class="num">' + fmt(v) + '</td></tr>';
    const head = n => '<tr class="sec"><td colspan="2">' + n + '</td></tr>';
    const thead = n => '<thead><tr><th>' + n + '</th><th class="num">金額（円）</th></tr></thead>';
    const none = '<tr><td class="muted">—</td><td></td></tr>';
    const pad = '<tr class="pad"><td>&nbsp;</td><td></td></tr>';
    // 貸借対照表：左に資産、右に負債・純資産
    const L = [head('資産の部')].concat(d.bs.assets.length ? d.bs.assets.map(a => row(a.name, a.amount)) : [none]);
    const R = [head('負債の部')].concat(d.bs.liabilities.length ? d.bs.liabilities.map(a => row(a.name, a.amount)) : [none])
      .concat([row('負債合計', d.bs.liabilitiesTotal, 'sub'), head('純資産の部')])
      .concat(d.bs.equity.map(a => row(a.name, a.amount)))
      .concat([row('前期までの収支差額', d.bs.priorSurplus), row('当期収支差額', d.bs.surplus), row('純資産合計', d.bs.equityTotal, 'sub')]);
    // 損益計算書（事業別）：事業ごとの売上・原価・粗利 → 一般管理費 → 事業損益 → 共通収入 → 最終利益
    // 列は「売上｜原価｜粗利・損益」。一般管理費は右の列にマイナスで置き、右の列を上から足すと最終利益になる
    const p = d.pl;
    const prow = (n, rev, cost, val, cls) => '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td>' + esc(n) + '</td>'
      + [rev, cost, val].map(v => '<td class="num">' + (v === null ? '' : fmt(v)) + '</td>').join('') + '</tr>';
    const phead = n => '<tr class="sec"><td colspan="4">' + n + '</td></tr>';
    const P = [phead('事業別')]
      .concat(p.segments.length ? p.segments.map(x => prow(x.known ? x.name : x.name + '（事業マスタにない）', x.revenue, x.cost, x.gross, x.known ? '' : 'un'))
        : ['<tr><td class="muted">—</td><td></td><td></td><td></td></tr>'])
      .concat([prow('粗利合計', p.revenueBySegment, p.costBySegment, p.grossTotal, 'sub'),
        phead('共通'), prow('一般管理費', null, null, -p.sga), prow('事業損益', null, null, p.operating, 'sub'),
        phead('共通収入')])
      .concat(p.commonRevenue.length ? p.commonRevenue.map(x => prow(x.name, null, null, x.amount)) : ['<tr><td class="muted">—</td><td></td><td></td><td></td></tr>']);
    // 3つの表の最終行（総計）がそろうよう、短い表の総計の直前に空欄行を入れる
    const rows = Math.max(L.length, R.length, P.length);
    [L, R].forEach(t => { while (t.length < rows) t.push(pad); });
    while (P.length < rows) P.push('<tr class="pad"><td>&nbsp;</td><td></td><td></td><td></td></tr>');
    $('#bsL').innerHTML = thead('資産（借方）') + '<tbody>' + L.join('') + row('資産合計', d.bs.assetsTotal, 'total') + '</tbody>';
    $('#bsR').innerHTML = thead('負債・純資産（貸方）') + '<tbody>' + R.join('') + row('負債・純資産合計', d.bs.liabilitiesTotal + d.bs.equityTotal, 'total') + '</tbody>';
    $('#pl').innerHTML = '<thead><tr><th>科目</th><th class="num">売上</th><th class="num">原価</th><th class="num">粗利・損益</th></tr></thead>'
      + '<tbody>' + P.join('') + prow('最終利益（当期収支差額）', null, null, p.surplus, 'total') + '</tbody>';

    $('#recent').innerHTML = '<thead><tr><th>仕訳ID</th><th>日付</th><th>区分</th><th>事業</th><th>借方</th><th>貸方</th><th class="num">金額</th><th>取引先・摘要</th><th>証憑</th></tr></thead><tbody>'
      + (d.recent.length ? d.recent.map(r => '<tr><td>' + esc(r.id) + '-' + r.line + '</td><td>' + r.date + '</td><td><span class="pill">' + esc(r.kind) + '</span></td><td>' + esc(r.debit) + '</td><td>' + esc(r.credit) + '</td><td class="num">' + fmt(r.amount) + '</td><td>' + esc(r.partner) + '<div class="muted" style="font-size:12px">' + esc(r.desc) + '</div></td><td>' + (r.url ? '<a href="' + esc(r.url) + '" target="_blank">開く</a>' : '') + '</td></tr>').join('')
        : '<tr><td colspan="9" class="muted">仕訳がありません</td></tr>') + '</tbody>';
  }

  /* ===== 予算対比（予算 API） ===== */
  const PREF = 'rmo_budget_view';
  const pref = (() => { try { return JSON.parse(localStorage.getItem(PREF) || '{}'); } catch (e) { return {}; } })();
  const savePref = () => { try { localStorage.setItem(PREF, JSON.stringify(pref)); } catch (e) {} };
  let B = null;                       // 予算対比（Model.budgetReport）
  const collapsed = new Set(pref.collapsed || []);
  let level = pref.level || 3;
  let visible = null;                 // 表示する予算バージョン名


  function renderBudget() {
    if (!B) return;
    const vers = B.versions.map(v => v.name);
    if (!visible) visible = (pref.visible || []).filter(v => vers.indexOf(v) >= 0);
    if (!visible.length && vers.length) visible = vers.length > 1 ? [vers[0], vers[vers.length - 1]] : [vers[0]];
    $('#verBtns').innerHTML = vers.length ? vers.map(v => '<button type="button" class="chip' + (visible.indexOf(v) >= 0 ? ' on' : '') + '" data-v="' + esc(v) + '">' + esc(v) + '</button>').join('')
      : '<span class="muted">予算シートがありません</span>';
    document.querySelectorAll('[data-lv]').forEach(b => b.classList.toggle('on', Number(b.dataset.lv) === level));
    const shown = vers.filter(v => visible.indexOf(v) >= 0);
    const base = shown[shown.length - 1] || null;
    $('#budgetNote').textContent = (base ? '残額・執行率は「' + base + '」が基準です。' : '予算を1つ以上選ぶと残額・執行率を表示します。')
      + '実績は ' + B.fiscalYear + '年度の会計Ledgerから集計（' + B.generatedAt + '）。行をクリックすると開閉できます。';

    const tree = Model.budgetTree(B);
    const cols = shown.map(v => '<th class="num">' + esc(v.replace('_', ' ')) + '</th>').join('');
    let html = '<thead><tr><th>予算項目</th><th>コード</th>' + cols + '<th class="num act">実績</th>' + (base ? '<th class="num">残額</th><th class="rate">執行率</th>' : '') + '</tr></thead><tbody>';
    // 予算超過：基準予算に対して実績が超えている（予算 0 で実績ありも超過）
    const isOver = n => {
      if (!base) return false;
      const bud = n.budgets[base] || 0;
      return bud ? n.actual > bud : n.actual > 0;
    };
    // showOver：上位の階層（中項目・大項目）も超過しているときだけ超過表示にする
    const cells = (n, showOver) => {
      const bud = base ? (n.budgets[base] || 0) : 0;
      const rate = bud ? n.actual / bud : (n.actual ? Infinity : 0);
      const over = showOver && isOver(n);
      return shown.map(v => '<td class="num">' + (n.budgets[v] === undefined ? '<span class="muted">—</span>' : fmt(n.budgets[v])) + '</td>').join('')
        + '<td class="num act">' + fmt(n.actual) + '</td>'
        + (base ? '<td class="num' + (over ? ' ng' : '') + '">' + fmt(bud - n.actual) + '</td>'
          + '<td class="rate"><div class="bar' + (over ? ' over' : '') + '"><span style="width:' + Math.min(100, (isFinite(rate) ? rate : 1) * 100) + '%"></span></div><span class="muted" style="font-size:11px">' + (bud ? (rate * 100).toFixed(1) + '%' : (n.actual ? '予算なし' : '')) + '</span></td>' : '');
    };
    const tg = (key, has) => '<span class="tg' + (has ? '' : ' none') + '">' + (collapsed.has(key) ? '▸' : '▾') + '</span>';
    tree.forEach(n1 => {
      const k1 = '1|' + n1.name;
      html += '<tr class="l1" data-k="' + esc(k1) + '"><td>' + (level > 1 ? tg(k1, true) : '') + esc(n1.name) + '</td><td></td>' + cells(n1, true) + '</tr>';
      if (level < 2 || collapsed.has(k1)) return;
      const over1 = isOver(n1);
      n1.children.forEach(n2 => {
        const over2 = over1 && isOver(n2);
        const k2 = '2|' + n1.name + '|' + n2.name;
        html += '<tr class="l2" data-k="' + esc(k2) + '"><td>' + (level > 2 ? tg(k2, true) : '<span class="tg none"></span>') + esc(n2.name) + '</td><td></td>' + cells(n2, over1) + '</tr>';
        if (level < 3 || collapsed.has(k2)) return;
        n2.children.forEach(i => {
          html += '<tr class="l3' + (i.un ? ' un' : '') + '"><td>' + esc(i.l3) + '</td><td class="muted">' + esc(i.code) + '</td>' + cells(i, over2) + '</tr>';
        });
      });
    });
    const total = { budgets: {}, actual: 0 };
    tree.forEach(n => { total.actual += n.actual; Object.keys(n.budgets).forEach(v => total.budgets[v] = (total.budgets[v] || 0) + n.budgets[v]); });
    html += '<tr class="total"><td>合計</td><td></td>' + cells(total, true) + '</tr></tbody>';
    $('#budgetTbl').innerHTML = html;
  }

  $('#verBtns').addEventListener('click', e => {
    const v = e.target.dataset && e.target.dataset.v; if (!v) return;
    const i = visible.indexOf(v);
    if (i >= 0) visible.splice(i, 1); else visible.push(v);
    pref.visible = visible.slice(); savePref(); renderBudget();
  });
  document.querySelectorAll('[data-lv]').forEach(b => b.addEventListener('click', () => {
    level = Number(b.dataset.lv); collapsed.clear(); pref.level = level; pref.collapsed = []; savePref(); renderBudget();
  }));
  $('#budgetTbl').addEventListener('click', e => {
    const tr = e.target.closest('tr[data-k]'); if (!tr) return;
    const k = tr.dataset.k;
    if (tr.classList.contains('l1') && level < 2) return;
    if (tr.classList.contains('l2') && level < 3) return;
    collapsed.has(k) ? collapsed.delete(k) : collapsed.add(k);
    pref.collapsed = Array.from(collapsed); savePref(); renderBudget();
  });

  /* ===== 読み込み：生データを取得し、集計は Model で行う ===== */
  const stamp = () => new Date().toLocaleString('sv-SE', { timeZone: CONFIG.TIMEZONE }).slice(0, 16);

  function show(fy) {
    const ctx = Store.ctx, list = Store.list;
    fy = Number(fy) || ctx.fiscalYear || Store.currentFiscalYear(ctx);
    const d = Model.dashboard(ctx, list, fy);
    d.generatedAt = stamp();
    render(d);
    if (Store.budget) {
      B = Model.budgetReport(Store.budget, ctx, list, fy);
      B.generatedAt = d.generatedAt;
      renderBudget();
    }
  }

  function load(fy, force) {
    $('#period').textContent = '読み込み中…';
    Store.ledger(force).then(() => {
      show(fy);
      return Store.budgetData(force).then(() => show(fy))
        .catch(err => { $('#budgetNote').textContent = '予算を読み込めませんでした：' + (err.message || err); });
    }).catch(err => toast('データを読み込めませんでした\n' + esc(err.message || err), true));
  }
  $('#fy').addEventListener('change', e => show(Number(e.target.value)));
  $('#reload').addEventListener('click', () => load(Number($('#fy').value), true));
  load();
})();
