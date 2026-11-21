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
| `gas/` | Apps Script 側のソース（控え。実体は Apps Script プロジェクト） |

## 仕組み
- HTML から GAS の `/exec` に `POST {action, args, key}`（`Content-Type: text/plain`）で呼び出す
- `key` は API パスコード。GAS のスクリプトプロパティ `API_KEY` と照合（初回に画面で入力し、ブラウザに保存）
- パスコードの確認・再発行：Apps Script エディタで `initApiKey`（表示）／`resetApiKey`（再発行）を実行

## GAS を更新したとき
Apps Script エディタ →［デプロイ］→［デプロイを管理］→ 鉛筆 →「新バージョン」→［デプロイ］（URL は変わらない）

## 現在の設定
- Apps Script プロジェクト：「TOJO RMO Accounting System」（会計Ledger にバインド）
- ウェブアプリ：実行ユーザー admin@tojormo.com／アクセス 全員（パスコードで保護）
