/* 共通部品：プルダウン・添付ファイル・予算項目の連動プルダウン */

function fillSelect(sel, items, opts) {
  opts = opts || {};
  sel.innerHTML = (opts.blank !== false ? '<option value="">' + (opts.placeholder || '選択してください') + '</option>' : '');
  if (opts.groupBy) {
    const groups = {};
    items.forEach(i => (groups[i[opts.groupBy]] = groups[i[opts.groupBy]] || []).push(i));
    Object.keys(groups).forEach(g => {
      const og = document.createElement('optgroup'); og.label = g;
      groups[g].forEach(i => og.appendChild(new Option(opts.label ? opts.label(i) : i.name, i.name)));
      sel.appendChild(og);
    });
  } else {
    items.forEach(i => sel.appendChild(typeof i === 'string' ? new Option(i, i) : new Option(opts.label ? opts.label(i) : i.name, i.name)));
  }
}

/** 事業の選択肢（事業マスタの有効な行。共通は説明付き） */
function fillBusiness(sel, m) {
  fillSelect(sel, m.businesses || [], { label: b => b.kind === '共通' ? b.name + '（どの事業とも特定できない）' : b.name });
}

/** 添付ファイル（ドラッグ＆ドロップ対応） */
function FilePicker(dropEl, inputEl, listEl, previewEl) {
  const files = [];
  const MAX = 15 * 1024 * 1024;
  const render = () => {
    listEl.innerHTML = files.map((f, i) => '<li><span>' + esc(f.name) + ' <span class="muted">(' + Math.ceil(f.size / 1024) + ' KB)</span></span><button type="button" data-i="' + i + '">削除</button></li>').join('');
    previewEl.innerHTML = '';
    files.filter(f => f.type.startsWith('image/')).forEach(f => { const img = document.createElement('img'); img.src = URL.createObjectURL(f); previewEl.appendChild(img); });
  };
  const add = list => { Array.from(list).forEach(f => { if (f.size > MAX) toast(f.name + ' は 15MB を超えています', true); else files.push(f); }); render(); };
  dropEl.addEventListener('click', () => inputEl.click());
  inputEl.addEventListener('change', e => { add(e.target.files); inputEl.value = ''; });
  ['dragenter', 'dragover'].forEach(ev => dropEl.addEventListener(ev, e => { e.preventDefault(); dropEl.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => dropEl.addEventListener(ev, e => { e.preventDefault(); dropEl.classList.remove('over'); }));
  dropEl.addEventListener('drop', e => add(e.dataTransfer.files));
  listEl.addEventListener('click', e => { if (e.target.dataset.i !== undefined) { files.splice(Number(e.target.dataset.i), 1); render(); } });
  return {
    count: () => files.length,
    clear: () => { files.length = 0; render(); },
    read: () => Promise.all(files.map(f => new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res({ name: f.name, mimeType: f.type || 'application/octet-stream', data: String(r.result).split(',')[1] });
      r.onerror = rej; r.readAsDataURL(f);
    }))),
  };
}

/**
 * 予算項目の連動プルダウン（大項目 → 中項目 → 小項目）
 * sels: {l1, l2, l3} の select 要素。items: Model.budgetItems() の items
 */
function BudgetPicker(sels, items) {
  const uniq = arr => arr.filter((v, i) => v && arr.indexOf(v) === i);
  const opt = (sel, list, ph) => {
    sel.innerHTML = '<option value="">' + ph + '</option>' + list.map(o => '<option value="' + esc(o.v) + '">' + esc(o.t) + '</option>').join('');
  };
  const fill1 = () => opt(sels.l1, uniq(items.map(i => i.l1)).map(v => ({ v, t: v })), '（任意）大項目を選択');
  const fill2 = () => {
    const l1 = sels.l1.value;
    opt(sels.l2, uniq(items.filter(i => !l1 || i.l1 === l1).map(i => i.l2)).map(v => ({ v, t: v })), l1 ? '中項目を選択' : '（大項目を先に選択）');
    sels.l2.disabled = !l1;
  };
  const fill3 = () => {
    const l1 = sels.l1.value, l2 = sels.l2.value;
    opt(sels.l3, items.filter(i => i.l1 === l1 && i.l2 === l2).map(i => ({ v: i.code, t: i.l3 + '（' + i.code + '）' })), l2 ? '小項目を選択' : '（中項目を先に選択）');
    sels.l3.disabled = !l2;
  };
  sels.l1.addEventListener('change', () => { fill2(); fill3(); });
  sels.l2.addEventListener('change', fill3);
  const reset = () => { fill1(); fill2(); fill3(); };
  reset();
  return {
    reset,
    value: () => ({ budgetItem: sels.l2.value || sels.l1.value || '', budgetCode: sels.l3.value || '' }),
    item: () => items.find(i => i.code === sels.l3.value) || null,
  };
}
