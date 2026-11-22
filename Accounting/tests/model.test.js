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
t('損益計算書', () => assert.deepStrictEqual(d.pl, fx.expected.fy2026.pl));
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
console.log(n + ' tests passed');
