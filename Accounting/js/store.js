/* データ取得（API → Model）。ページ間で共通の読み込み処理 */

const Store = {
  ctx: null, list: null, budget: null,
  /** 設定・マスタ（Model.context） */
  config(force) {
    if (this.ctx && !force) return Promise.resolve(this.ctx);
    return Api.call('getConfig').then(c => (this.ctx = Model.context(c)));
  },
  /** 仕訳帳の有効行（Model.entries） */
  ledger(force) {
    if (this.list && !force) return Promise.resolve(this.list);
    return this.config(force).then(ctx => Api.call('getLedger').then(t => (this.list = Model.entries(t, ctx))));
  },
  /** 予算（予算API getBudget の結果そのまま） */
  budgetData(force) {
    if (this.budget && !force) return Promise.resolve(this.budget);
    return Api.budget('getBudget').then(b => (this.budget = b));
  },
  /** 今日が属する会計年度 */
  currentFiscalYear(ctx) {
    return Model.fiscalYearOf(todayJST(), ctx.startMonth);
  },
  /** 入力画面用のマスタ（有効なものだけ） */
  inputMasters(ctx) {
    return { accounts: ctx.activeAccounts, sources: ctx.sources, funds: ctx.funds, today: ctx.today, user: ctx.user };
  },
};
