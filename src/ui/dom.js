// 輕量 DOM 工具（一律以 textContent 寫入文字）。

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'style') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

/** 以 [標籤, 值, 附註?] 陣列填入 <dl>；null 代表分隔線。 */
export function fillKv(dl, rows) {
  dl.replaceChildren();
  for (const row of rows) {
    if (!row) {
      dl.append(el('div', { class: 'kv__sep' }));
      continue;
    }
    const [k, v, note] = row;
    dl.append(el('dt', {}, k), el('dd', {}, v, note ? el('small', {}, ` ${note}`) : null));
  }
}
