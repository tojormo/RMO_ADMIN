# Accounting（TOJO RMO Accounting System）

支払基準・税込の簡易会計システム。画面（HTML）はこのフォルダ、処理は Google Apps Script（GAS）の Web API、データは Google スプレッドシート「会計Ledger」。

| ファイル | 内容 |
|---|---|
| `index.html` | メニュー |
| `entry.html` | 支払・収入入力（証憑添付 → Drive「TOJO RMO Accounting System/証憑/年-月」に保存） |
| `journal.html` | 仕訳直接入力（複合仕訳、開始残高・立替精算テンプレート） |
| `dashboard.html` | BS・PL ダッシュボード（月次推移、資金残高、費用内訳、予算対比） |
| `common.js` | API 呼び出し・共通ヘッダー。`API_URL` に GAS ウェブアプリ（/exec）の URL |
| `style.css` | 共通スタイル |
| `gas/` | 会計 API（Apps Script「TOJO RMO Accounting System」、会計Ledger にバインド）のソース控え |
| `gas-budget/` | 予算 API（Apps Script「TOJO RMO Budget API」、TOJO RMO 予算管理 にバインド）のソース控え |

## 仕組み
- HTML から GAS の `/exec` に `POST {action, args, key}`（`Content-Type: text/plain`）で呼び出す
- `key` は API パスコード。GAS のスクリプトプロパティ `API_KEY` と照合（初回に画面で入力し、ブラウザに保存）
- パスコードの確認・再発行：Apps Script エディタで `initApiKey`（表示）／`resetApiKey`（再発行）を実行

## GAS を更新したとき
Apps Script エディタ →［デプロイ］→［デプロイを管理］→ 鉛筆 →「新バージョン」→［デプロイ］（URL は変わらない）

## 現在の設定
- Apps Script プロジェクト：「TOJO RMO Accounting System」（会計Ledger にバインド）
- ウェブアプリ：実行ユーザー admin@tojormo.com／アクセス 全員（パスコードで保護）

## 予算管理
- スプレッドシート「TOJO RMO 予算管理」。予算はバージョンごとに1シート：`当初予算_YYYY-MM-DD`／`改訂予算_YYYY-MM-DD`
- 階層：予算大項目 ＞ 予算中項目 ＞ 予算小項目。行は「予算コード」（B001…）で識別し、改訂しても同じ項目は同じコード
- 改訂するときは最新シートを複製し、名前を `改訂予算_改訂日` にして金額を直す
- 実績は会計Ledger 仕訳帳の費用科目から集計。紐づけは仕訳帳「予算コード」列（入力画面で予算小項目を選ぶと入る）、無い場合は「申請書予算項目」列を予算中項目として集計
- ダッシュボードの予算対比：表示する予算バージョンを選択、階層（大項目／中項目まで／小項目まで）の切替、行クリックで開閉。残額・執行率は表示中の最新バージョンが基準
- 予算 API の URL は `common.js` の `BUDGET_API_URL`。パスコードは会計 API と同じ（各 Apps Script のスクリプトプロパティ `API_KEY`）
