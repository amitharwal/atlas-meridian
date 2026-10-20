// Tiny element builder, shared by every page's script. Text always goes in as
// text, never as HTML. Attributes set to null or undefined are left out;
// `on…` attributes become event listeners.
export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  node.append(...children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false));
  return node;
}
