/* とうじょうRMO会計システム 設定
 * 画面の変更はこのフォルダ（HTML / JS / CSS）だけで行い、GAS は変更しない方針です。
 * スプレッドシートの列を追加したときは、ここの COLS に「キー: 見出し名」を足すと画面から使えます。 */

const CONFIG = {
  // GAS ウェブアプリ（/exec）
  API_URL: 'https://script.google.com/macros/s/AKfycbyEmlSmcJzUYnCUoAYA39Tl24d7Plqt7Puo6p6cfdS8XOokEv6ceJ9xLdNryeO7GSr4/exec',
  BUDGET_API_URL: 'https://script.google.com/macros/s/AKfycbyooLm09B5XAY8BX5m5pFaG67BtAR11xTydbrrz34VRYIGp_5WtoQ4Vv2UijcIYSz1W/exec',
  // スプレッドシート
  LEDGER_URL: 'https://docs.google.com/spreadsheets/d/1EdBz2L4jN-4kU1XXIRJf4BzT-az6cfMmqCdMu_497EQ/edit',
  BUDGET_URL: 'https://docs.google.com/spreadsheets/d/1gkrn6S4IaJ-pYIoMDXTzuuA2y_VT62RfX-JuA10Tmms/edit',
  SYSTEM_NAME: 'とうじょうRMO会計システム',
  TIMEZONE: 'Asia/Tokyo',
  STORAGE_KEY: 'rmo_accounting_key',
  // 損益計算書の売上区分（勘定科目名）
  SALES_ACCOUNTS: ['RMO交付金収入', '事業収入'],
};

/* 列の対応（キー → スプレッドシートの見出し名） */
const COLS = {
  ledger: {
    id: '仕訳ID', line: '行No', date: '取引日', month: '計上月', fy: '会計年度', kind: '入力区分',
    drAcct: '借方科目', drAmt: '借方金額', crAcct: '貸方科目', crAmt: '貸方金額',
    taxRate: '税率', taxAmt: '消費税額', partner: '取引先', invoiceNo: 'インボイス登録番号', description: '摘要',
    budgetItem: '申請書予算項目', fund: '資金原資', voucherNo: '証憑番号', voucherUrl: '証憑URL',
    enteredBy: '入力者', created: '登録日時', status: '状態', budgetCode: '予算コード',
  },
  budget: {
    code: '予算コード', l1: '予算大項目', l2: '予算中項目', l3: '予算小項目', account: '勘定科目', fund: '資金原資',
    amount: '予算額（総事業費）', rmo: 'うちRMO交付金', own: 'うち自己資金', memo: 'メモ',
  },
};

if (typeof module !== 'undefined') module.exports = { CONFIG, COLS };
