/* データモデルと集計（ブラウザと Node の両方で動く純粋関数）
 * GAS（会計API・予算API）は生データを返すだけなので、集計ロジックはすべてここに置く。 */

(function (root) {
  const COLS_ = (typeof COLS !== 'undefined') ? COLS : require('./config.js').COLS;
  const CONFIG_ = (typeof CONFIG !== 'undefined') ? CONFIG : require('./config.js').CONFIG;

  /** { headers, rows } → オブジェクト配列。cols（キー → 見出し名）のキーと、見出し名そのもの（追加列用）の両方で引ける */
  function records(table, cols) {
    const idx = {};
    (table.headers || []).forEach((h, i) => { if (h) idx[h] = i; });
    return (table.rows || []).map(r => {
      const o = {};
      Object.keys(idx).forEach(h => { o[h] = r[idx[h]]; });
      Object.keys(cols).forEach(k => { o[k] = idx[cols[k]] === undefined ? '' : r[idx[cols[k]]]; });
      return o;
    });
  }

  const num = v => Number(v) || 0;
  const str = v => (v === null || v === undefined) ? '' : String(v);
  const isTrue = v => v === true || String(v).toUpperCase() === 'TRUE';

  function fiscalYearOf(dateStr, startMonth) {
    const m = str(dateStr).match(/^(\d{4})-(\d{2})/);
    if (!m) return null;
    const y = Number(m[1]), mo = Number(m[2]);
    return mo >= startMonth ? y : y - 1;
  }

  function fiscalMonths(fy, startMonth) {
    const out = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(fy, startMonth - 1 + i, 1);
      out.push(d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2));
    }
    return out;
  }

  /** 事業マスタ（getConfig の masters）→ [{ name, kind:'事業'|'共通', order, active, note }]（表示順） */
  function businesses(masters) {
    const C = COLS_.business;
    return ((masters || {})[CONFIG_.BUSINESS_MASTER] || [])
      .map(o => ({ name: str(o[C.name]).trim(), kind: str(o[C.kind]).trim() || '事業', order: Number(o[C.order]) || 999, active: isTrue(o[C.active]), note: str(o[C.note]) }))
      .filter(b => b.name)
      .sort((a, b) => a.order - b.order);
  }

  /** 会計API getConfig の結果を画面用に整える */
  function context(config) {
    const s = config.settings || {};
    const bs = businesses(config.masters);
    const common = bs.find(b => b.kind === '共通');
    return {
      businesses: bs,
      activeBusinesses: bs.filter(b => b.active),
      commonBusiness: common ? common.name : '共通',
      // 事業の売上にしない収入科目（設定タブ「共通収入科目」）。PL では一般管理費の後に加算
      commonRevenueAccounts: s.commonRevenueAccounts || str(s['共通収入科目']).split(/[,、，]/).map(x => x.trim()).filter(Boolean),
      settings: s,
      startMonth: Number(s.startMonth) || 4,
      fiscalYear: Number(s.fiscalYear) || null,
      funds: s.funds || [],
      accounts: config.accounts || [],
      activeAccounts: (config.accounts || []).filter(a => a.active),
      sources: (config.sources || []).filter(x => x.active),
      cashAccounts: (config.sources || []).filter(x => x.kind === '現金' || x.kind === '銀行').map(x => x.account),
      masters: config.masters || {},
      ledgerHeaders: config.ledgerHeaders || [],
      today: config.today,
      user: config.user || '',
    };
  }

  /** 仕訳帳（getLedger の結果）→ 有効な仕訳行（取消を除く） */
  function entries(ledgerTable, ctx) {
    return records(ledgerTable, COLS_.ledger)
      .filter(e => e.id !== '' && str(e.status) !== '取消')
      .map(e => Object.assign(e, {
        id: str(e.id), date: str(e.date),
        fy: Number(e.fy) || fiscalYearOf(e.date, ctx.startMonth),
        month: str(e.month) || str(e.date).slice(0, 7),
        drAcct: str(e.drAcct), crAcct: str(e.crAcct), drAmt: num(e.drAmt), crAmt: num(e.crAmt),
        fund: str(e.fund), budgetItem: str(e.budgetItem).trim(), budgetCode: str(e.budgetCode).trim(),
        business: str(e.business).trim(),
      }));
  }

  function years(list, fy) {
    const set = new Set(list.map(e => e.fy).filter(Boolean));
    if (fy) set.add(fy);
    return Array.from(set).sort();
  }

  /**
   * ダッシュボード用の集計（BS・PL・月次・資金残高・資金原資別・直近の仕訳・警告）
   * BS 科目は年度末までの累計、PL 科目は当該年度
   */
  function dashboard(ctx, list, fy) {
    const accounts = ctx.accounts.map(a => ({ code: str(a.code), name: str(a.name), type: str(a.type), side: str(a.side), fundClass: str(a.fundClass) }));
    const byName = {};
    accounts.forEach(a => { byName[a.name] = Object.assign(a, { fyDr: 0, fyCr: 0, cumDr: 0, cumCr: 0, priorDr: 0, priorCr: 0 }); });
    const isPL = t => t === '収益' || t === '費用';
    const months = fiscalMonths(fy, ctx.startMonth);
    const monthly = {};
    months.forEach(m => monthly[m] = { revenue: 0, expense: 0, cashDelta: 0 });
    let cashOpening = 0;
    const unknown = new Set(), balance = {}, recent = [], fundSum = {};
    // 事業別損益：事業マスタで区分「事業」の事業 → 売上・原価。それ以外（空欄・共通）→ 費用は一般管理費、収益は共通収入
    const segKind = {};
    (ctx.businesses || []).forEach(b => { segKind[b.name] = b.kind; });
    const seg = {}, commonRev = {};
    let sga = 0;

    list.forEach(e => {
      if (!e.fy) return;
      balance[e.id] = (balance[e.id] || 0) + e.drAmt - e.crAmt;
      [{ acct: e.drAcct, amt: e.drAmt, dr: true }, { acct: e.crAcct, amt: e.crAmt, dr: false }].forEach(x => {
        if (!x.acct || !x.amt) return;
        const a = byName[x.acct];
        if (!a) { unknown.add(x.acct); return; }
        const isCash = ctx.cashAccounts.indexOf(a.name) >= 0;
        if (e.fy <= fy) { if (x.dr) a.cumDr += x.amt; else a.cumCr += x.amt; }
        if (e.fy < fy) {
          if (x.dr) a.priorDr += x.amt; else a.priorCr += x.amt;
          if (isCash) cashOpening += x.dr ? x.amt : -x.amt;
        }
        if (e.fy === fy) {
          if (x.dr) a.fyDr += x.amt; else a.fyCr += x.amt;
          if (monthly[e.month]) {
            if (a.type === '収益') monthly[e.month].revenue += x.dr ? -x.amt : x.amt;
            if (a.type === '費用') monthly[e.month].expense += x.dr ? x.amt : -x.amt;
            if (isCash) monthly[e.month].cashDelta += x.dr ? x.amt : -x.amt;
          }
        }
        if (isPL(a.type) && e.fy === fy) {
          const v = a.type === '収益' ? (x.dr ? -x.amt : x.amt) : (x.dr ? x.amt : -x.amt);
          const b = e.business;
          const isSeg = b && segKind[b] !== '共通' && ctx.commonRevenueAccounts.indexOf(a.name) < 0;
          if (isSeg) {
            const o = seg[b] = seg[b] || { revenue: 0, cost: 0 };
            if (a.type === '収益') o.revenue += v; else o.cost += v;
          } else if (a.type === '収益') commonRev[a.name] = (commonRev[a.name] || 0) + v;
          else sga += v;
        }
        if (isPL(a.type) && e.fy <= fy) {
          const f = e.fund || a.fundClass || '（未設定）';
          const o = fundSum[f] = fundSum[f] || { rev: 0, exp: 0, cumRev: 0, cumExp: 0, acc: {} };
          const v = a.type === '収益' ? (x.dr ? -x.amt : x.amt) : (x.dr ? x.amt : -x.amt);
          if (a.type === '収益') { o.cumRev += v; if (e.fy === fy) o.rev += v; }
          else { o.cumExp += v; if (e.fy === fy) { o.exp += v; o.acc[a.name] = (o.acc[a.name] || 0) + v; } }
        }
      });
      if (e.fy === fy) {
        recent.push({ id: e.id, line: e.line, date: e.date, kind: str(e.kind), business: e.business, debit: e.drAcct, credit: e.crAcct,
          amount: e.drAmt || e.crAmt, partner: str(e.partner), desc: str(e.description), url: str(e.voucherUrl).split('\n')[0] });
      }
    });

    const bal = a => isPL(a.type)
      ? (a.side === '借方' ? a.fyDr - a.fyCr : a.fyCr - a.fyDr)
      : (a.side === '借方' ? a.cumDr - a.cumCr : a.cumCr - a.cumDr);
    const listOf = type => accounts.filter(a => a.type === type).map(a => ({ code: a.code, name: a.name, amount: bal(a) })).filter(x => x.amount !== 0);
    const sum = arr => arr.reduce((t, x) => t + x.amount, 0);
    const assets = listOf('資産'), liabilities = listOf('負債'), equity = listOf('純資産');
    const revenue = listOf('収益'), expense = listOf('費用').sort((a, b) => b.amount - a.amount);
    const priorSurplus = accounts.filter(a => isPL(a.type))
      .reduce((t, a) => t + (a.type === '収益' ? a.priorCr - a.priorDr : -(a.priorDr - a.priorCr)), 0);
    const revenueTotal = sum(revenue), expenseTotal = sum(expense), surplus = revenueTotal - expenseTotal;
    const equityTotal = sum(equity) + priorSurplus + surplus;

    // 事業別：有効な事業（区分「事業」）は金額が 0 でも表示。マスタに無い事業名は known:false で残す
    const segNames = (ctx.businesses || []).filter(b => b.kind !== '共通' && (b.active || seg[b.name])).map(b => b.name)
      .concat(Object.keys(seg).filter(n => !segKind[n]));
    const segments = segNames.map(n => {
      const o = seg[n] || { revenue: 0, cost: 0 };
      return { name: n, known: segKind[n] === '事業', revenue: o.revenue, cost: o.cost, gross: o.revenue - o.cost };
    });
    const grossTotal = segments.reduce((t, x) => t + x.gross, 0);
    const commonRevenue = Object.keys(commonRev).map(n => ({ name: n, amount: commonRev[n] })).filter(x => x.amount !== 0);
    ctx.commonRevenueAccounts.slice().reverse().forEach(n => {   // 交付金などは 0 でも先頭に表示
      if (!commonRevenue.some(x => x.name === n) && byName[n]) commonRevenue.unshift({ name: n, amount: 0 });
    });
    const commonRevenueTotal = commonRevenue.reduce((t, x) => t + x.amount, 0);

    let running = cashOpening;
    const monthlyArr = months.map(m => { running += monthly[m].cashDelta; return { month: m, revenue: monthly[m].revenue, expense: monthly[m].expense, cash: running }; });

    const funds = ctx.funds.concat(Object.keys(fundSum).filter(f => ctx.funds.indexOf(f) < 0)).map(f => {
      const o = fundSum[f] || { rev: 0, exp: 0, cumRev: 0, cumExp: 0, acc: {} };
      return {
        fund: f, known: ctx.funds.indexOf(f) >= 0, revenue: o.rev, expense: o.exp, balance: o.rev - o.exp,
        cumRevenue: o.cumRev, cumExpense: o.cumExp, cumBalance: o.cumRev - o.cumExp,
        accounts: Object.keys(o.acc).map(n => ({ name: n, amount: o.acc[n] })).filter(x => x.amount !== 0).sort((p, q) => q.amount - p.amount),
      };
    }).filter(x => x.known || x.revenue || x.expense || x.cumRevenue || x.cumExpense);

    return {
      fiscalYear: fy, years: years(list, fy), period: months[0] + ' 〜 ' + months[11], months: months,
      bs: {
        assets, liabilities, equity, priorSurplus, surplus,
        assetsTotal: sum(assets), liabilitiesTotal: sum(liabilities), equityTotal,
        cash: assets.filter(a => ctx.cashAccounts.indexOf(a.name) >= 0).reduce((t, a) => t + a.amount, 0),
      },
      pl: {
        revenue, expense, revenueTotal, expenseTotal, surplus,
        segments: segments,
        revenueBySegment: segments.reduce((t, x) => t + x.revenue, 0),
        costBySegment: segments.reduce((t, x) => t + x.cost, 0),
        grossTotal: grossTotal,
        sga: sga,                                  // 一般管理費
        operating: grossTotal - sga,               // 事業損益
        commonRevenue: commonRevenue, commonRevenueTotal: commonRevenueTotal,
      },
      monthly: monthlyArr,
      funds: funds,
      recent: recent.slice(-15).reverse(),
      warnings: {
        unbalanced: Object.keys(balance).filter(k => balance[k] !== 0),
        unknownAccounts: Array.from(unknown),
        bsDiff: sum(assets) - sum(liabilities) - equityTotal,
      },
    };
  }

  /* ===== 予算 ===== */

  /** 「505_広告宣伝費」→ { code:'505', name:'広告宣伝費' }。コードが無ければ name だけ */
  function splitAccount(v) {
    const m = str(v).trim().match(/^(\d+)[_＿\s　]+(.+)$/);
    return m ? { code: m[1], name: m[2].trim() } : { code: '', name: str(v).trim() };
  }

  /** 予算の勘定科目を勘定科目マスタの行に対応づける（科目名 → コードの順で探す） */
  function findAccount(accounts, name, code) {
    return accounts.find(a => str(a.name) === name) || (code ? accounts.find(a => str(a.code) === code) : null) || null;
  }

  /** 予算API getBudget の結果 → バージョンごとの予算行 */
  function budgetVersions(budget) {
    return ((budget && budget.versions) || []).map(v => ({
      name: v.name, kind: v.kind, date: v.date,
      items: records(v, COLS_.budget).filter(i => str(i.code).trim() !== '').map(i => Object.assign(i, {
        code: str(i.code).trim(),
        l1: str(i.l1) || '（大項目なし）', l2: str(i.l2) || '（中項目なし）', l3: str(i.l3) || '（小項目なし）',
        // 勘定科目は「広告宣伝費」「505_広告宣伝費」「505 広告宣伝費」のどれでも可（コードと科目名に分ける）
        accountLabel: str(i.account), account: splitAccount(i.account).name, accountCode: splitAccount(i.account).code,
        fund: str(i.fund), amount: num(i.amount),
      })),
    }));
  }

  /** 入力画面用：最新バージョンの予算項目 */
  function budgetItems(budget) {
    const vs = budgetVersions(budget);
    const latest = vs[vs.length - 1];
    return { version: latest ? latest.name : null, items: latest ? latest.items : [] };
  }

  /**
   * 予算対比：全バージョンの予算額と、指定年度の実績（費用科目）
   * 実績の紐づけ：仕訳の予算コード → 予算小項目。無ければ申請書予算項目を中項目名（なければ大項目名）として集計
   */
  function budgetReport(budget, ctx, list, fy) {
    const vs = budgetVersions(budget);
    const map = {};
    vs.forEach(v => v.items.forEach(i => {
      if (!map[i.code]) map[i.code] = { code: i.code, budgets: {}, actual: 0 };
      Object.assign(map[i.code], { l1: i.l1, l2: i.l2, l3: i.l3, account: i.account, fund: i.fund, memo: str(i.memo) });
      map[i.code].budgets[v.name] = i.amount;
    }));
    // 並び順は最新バージョンの行順。古いバージョンにしか無い項目はその後ろ
    const order = [];
    vs.slice().reverse().forEach(v => v.items.forEach(i => { if (order.indexOf(i.code) < 0) order.push(i.code); }));
    const types = {};
    ctx.accounts.forEach(a => types[str(a.name)] = str(a.type));
    const l2Of = {}, l1Set = {};
    order.forEach(c => { const i = map[c]; if (!l2Of[i.l2]) l2Of[i.l2] = i.l1; l1Set[i.l1] = true; });
    const extra = {};
    list.filter(e => e.fy === fy).forEach(e => {
      let amt = 0;
      if (types[e.drAcct] === '費用') amt += e.drAmt;
      if (types[e.crAcct] === '費用') amt -= e.crAmt;
      if (!amt) return;
      if (e.budgetCode && map[e.budgetCode]) { map[e.budgetCode].actual += amt; return; }
      const label = e.budgetItem;
      const key = label && l2Of[label] ? '2|' + l2Of[label] + '|' + label : label && l1Set[label] ? '1|' + label : '0';
      extra[key] = (extra[key] || 0) + amt;
    });
    return {
      fiscalYear: fy,
      versions: vs.map(v => ({ name: v.name, kind: v.kind, date: v.date })),
      items: order.map(c => map[c]),
      unassigned: Object.keys(extra).map(k => { const p = k.split('|'); return { level: Number(p[0]), l1: p[1] || '', l2: p[2] || '', actual: extra[k] }; }),
    };
  }

  /** 予算対比の木構造（大項目 → 中項目 → 小項目）。未設定の実績は「（小項目未設定）」として該当位置に置く */
  function budgetTree(rep) {
    const tree = [];
    const find = (arr, name) => arr.find(n => n.name === name) || (arr.push({ name, children: [] }), arr[arr.length - 1]);
    rep.items.forEach(i => find(find(tree, i.l1).children, i.l2).children.push(i));
    rep.unassigned.forEach(u => {
      const leaf = { code: '', l3: '（小項目未設定）', budgets: {}, actual: u.actual, un: true };
      if (u.level === 2) find(find(tree, u.l1).children, u.l2).children.push(leaf);
      else if (u.level === 1) find(find(tree, u.l1).children, '（中項目未設定）').children.push(leaf);
      else find(find(tree, '（予算項目未設定）').children, '（中項目未設定）').children.push(leaf);
    });
    const sum = node => {
      if (!node.children) return node;
      node.budgets = {}; node.actual = 0;
      node.children.forEach(c => { sum(c); node.actual += c.actual; Object.keys(c.budgets).forEach(v => node.budgets[v] = (node.budgets[v] || 0) + c.budgets[v]); });
      return node;
    };
    tree.forEach(sum);
    return tree;
  }

  const Model = { records, businesses, splitAccount, findAccount, fiscalYearOf, fiscalMonths, context, entries, dashboard, budgetVersions, budgetItems, budgetReport, budgetTree };
  if (typeof module !== 'undefined') module.exports = Model; else root.Model = Model;
})(this);
