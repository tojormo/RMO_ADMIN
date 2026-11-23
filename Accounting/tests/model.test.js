/* 集計ロジック（js/model.js）のテスト
 * 実行：node tests/model.test.js（Node.js 18 以上。追加のパッケージは不要）
 * fixture.json は会計API・予算APIが返す形式のテストデータと、旧 GAS 集計で得た期待値です。
 * 画面の集計を変えたときは、このテストが通ることを確認してください。 */
const assert = require('assert');
const path = require('path');
const { COLS } = require(path.join(__dirname, '../js/config.js'));
global.COLS = COLS;
const Model = require(path.join(__dirname, '../js/model.js'));
const fx = require('./fixture.json');

const ctx = Model.context(fx.config);
const list = Model.entries(fx.ledger, ctx);
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok  ' + name); };

t('会計年度の判定（4月始まり）', () => {
  assert.strictEqual(Model.fiscalYearOf('2026-04-01', 4), 2026);
  assert.strictEqual(Model.fiscalYearOf('2027-03-31', 4), 2026);
});

const d = Model.dashboard(ctx, list, 2026);
t('貸借対照表', () => assert.deepStrictEqual(d.bs, fx.expected.fy2026.bs));
const pick = (o, ks) => ks.reduce((r, k) => (r[k] = o[k], r), {});
t('損益計算書', () => assert.deepStrictEqual(pick(d.pl, Object.keys(fx.expected.fy2026.pl)), fx.expected.fy2026.pl));
t('資金残高の推移', () => assert.deepStrictEqual(d.monthly.map(m => m.cash), fx.expected.fy2026.cash));
t('資金原資別', () => assert.deepStrictEqual(d.funds.map(f => [f.fund, f.revenue, f.expense]), fx.expected.fy2026.funds));
t('貸借一致', () => { assert.strictEqual(d.warnings.bsDiff, 0); assert.deepStrictEqual(d.warnings.unbalanced, []); });

const r = Model.budgetReport(fx.budget, ctx, list, 2026);
const byKey = a => a.slice().sort((p, q) => String(p[0]).localeCompare(String(q[0])));
t('予算対比の実績', () => assert.deepStrictEqual(
  byKey(r.items.map(i => [i.code, i.actual]).concat(r.unassigned.map(u => [u.level + ':' + u.l2, u.actual]))),
  byKey(fx.expected.budget2026)));
t('予算の並び順は最新バージョンの行順', () => {
  const latest = fx.budget.versions[fx.budget.versions.length - 1];
  const codes = latest.rows.map(x => String(x[latest.headers.indexOf('予算コード')])).filter(Boolean);
  assert.deepStrictEqual(r.items.map(i => i.code).slice(0, codes.length), codes);
});
t('予算の勘定科目「505_広告宣伝費」形式', () => {
  assert.deepStrictEqual(Model.splitAccount('505_広告宣伝費'), { code: '505', name: '広告宣伝費' });
  assert.deepStrictEqual(Model.splitAccount('広告宣伝費'), { code: '', name: '広告宣伝費' });
  const accts = [{ code: '505', name: '広告宣伝費' }, { code: '515', name: 'ICTソフト費' }];
  assert.strictEqual(Model.findAccount(accts, '広告宣伝費', '505').code, '505');
  assert.strictEqual(Model.findAccount(accts, '旧名称', '515').name, 'ICTソフト費');
  assert.strictEqual(Model.findAccount(accts, '無い科目', ''), null);
});
t('予算の木構造の合計', () => {
  const tree = Model.budgetTree(r);
  const total = tree.reduce((s, n1) => s + n1.actual, 0);
  assert.strictEqual(total, r.items.reduce((s, i) => s + i.actual, 0) + r.unassigned.reduce((s, u) => s + u.actual, 0));
});
t('追加列も見出し名で読める', () => {
  const tbl = { headers: fx.ledger.headers.concat(['担当事業']), rows: fx.ledger.rows.map(x => x.concat(['ICT'])) };
  assert.strictEqual(Model.records(tbl, COLS.ledger)[0]['担当事業'], 'ICT');
});
// ===== 事業別損益 =====
const cfgB = JSON.parse(JSON.stringify(fx.config));
cfgB.settings['共通収入科目'] = 'RMO交付金収入';   // 設定タブの行（GAS v2 形式。v3 は settings.commonRevenueAccounts も返す）
cfgB.masters['事業マスタ'] = [
  { 事業: 'ブランド米事業', 区分: '事業', 表示順: 2, 有効: true },
  { 事業: '農業体験事業', 区分: '事業', 表示順: 1, 有効: true },
  { 事業: 'お弁当販売事業', 区分: '事業', 表示順: 4, 有効: false },
  { 事業: '共通', 区分: '共通', 表示順: 99, 有効: true },
];
const ctxB = Model.context(cfgB);
// 仕訳帳に「事業」列を追加して、行ごとに振り分ける（空欄・共通・マスタにない名前を含める）
const tags = ['ブランド米事業', '農業体験事業', '', '共通', '謎の事業'];
const ledB = { headers: fx.ledger.headers.concat(['事業']), rows: fx.ledger.rows.map((r, i) => r.concat([tags[i % tags.length]])) };
const listB = Model.entries(ledB, ctxB);
const pB = Model.dashboard(ctxB, listB, 2026).pl;
t('事業マスタ：表示順・無効の事業・共通', () => {
  assert.deepStrictEqual(ctxB.businesses.map(b => b.name), ['農業体験事業', 'ブランド米事業', 'お弁当販売事業', '共通']);
  assert.deepStrictEqual(ctxB.activeBusinesses.map(b => b.name), ['農業体験事業', 'ブランド米事業', '共通']);
  assert.strictEqual(ctxB.commonBusiness, '共通');
  assert.deepStrictEqual(ctxB.commonRevenueAccounts, ['RMO交付金収入']);
  assert.deepStrictEqual(Model.context({ settings: { commonRevenueAccounts: ['A', 'B'] } }).commonRevenueAccounts, ['A', 'B']);
});
t('事業別損益：売上・原価は勘定科目の合計と一致', () => {
  assert.strictEqual(pB.revenueBySegment + pB.commonRevenueTotal, pB.revenueTotal);
  assert.strictEqual(pB.costBySegment + pB.sga, pB.expenseTotal);
  assert.strictEqual(pB.operating + pB.commonRevenueTotal, pB.surplus);
  assert.strictEqual(pB.grossTotal, pB.segments.reduce((t, x) => t + x.revenue - x.cost, 0));
});
t('事業別損益：並び順・マスタにない事業・無効の事業', () => {
  const names = pB.segments.map(x => x.name);
  assert.deepStrictEqual(names.slice(0, 2), ['農業体験事業', 'ブランド米事業']);
  assert.ok(names.indexOf('お弁当販売事業') < 0 || pB.segments.find(x => x.name === 'お弁当販売事業').cost !== 0);
  const odd = pB.segments.find(x => x.name === '謎の事業');
  if (odd) assert.strictEqual(odd.known, false);
});
t('事業別損益：交付金は事業を付けても共通収入', () => {
  const led = { headers: ['仕訳ID', '行No', '取引日', '会計年度', '借方科目', '借方金額', '貸方科目', '貸方金額', '状態', '事業'], rows: [
    ['J1', 1, '2026-05-01', 2026, '普通預金', 1000, 'RMO交付金収入', 1000, '有効', 'ブランド米事業'],
    ['J2', 1, '2026-05-02', 2026, '普通預金', 300, '事業収入', 300, '有効', 'ブランド米事業'],
    ['J3', 1, '2026-05-03', 2026, '通信費', 50, '普通預金', 50, '有効', ''],
    ['J4', 1, '2026-05-04', 2026, '通信費', 70, '普通預金', 70, '有効', 'ブランド米事業'],
  ] };
  const p = Model.dashboard(ctxB, Model.entries(led, ctxB), 2026).pl;
  const rice = p.segments.find(x => x.name === 'ブランド米事業');
  assert.deepStrictEqual([rice.revenue, rice.cost, rice.gross], [300, 70, 230]);
  assert.strictEqual(p.sga, 50);
  assert.strictEqual(p.commonRevenue.find(x => x.name === 'RMO交付金収入').amount, 1000);
  assert.strictEqual(p.surplus, 1000 + 300 - 50 - 70);
});

console.log(n + ' tests passed');
