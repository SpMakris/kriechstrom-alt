// Small DOM helpers shared by the screens.

/* ------------------------------------------------------------ icons --- */
export const ICONS = {
  play: ["M7 4v16l13-8z", "solid"], stop: ["M6 6h12v12H6z", "solid"],
  left: ["M15 5l-7 7 7 7"], right: ["M9 5l7 7-7 7"], up: ["M5 15l7-7 7 7"], down: ["M5 9l7 7 7-7"],
  close: ["M6 6l12 12M18 6L6 18"], plus: ["M12 5v14M5 12h14"], minus: ["M5 12h14"],
  key: ["M14 10a4 4 0 1 0-3 3.9L4 21v-3h3v-3h3z"],
};
export function ic(name) {
  const [d, kind] = ICONS[name];
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("class", "ic" + (kind ? " " + kind : "")); s.setAttribute("aria-hidden", "true");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path"); p.setAttribute("d", d); s.append(p);
  return s;
}
/* a handler is kept in e.__on and called through one listener per event type, so morph() can give a node it keeps the new handler */
function on(e, type, fn) {
  const h = (e.__on ||= {});
  if (!(type in h)) e.addEventListener(type, (ev) => h[type](ev));
  h[type] = fn;
}
/* mark a node whose listeners were added by hand: morph() never keeps it across a change, it takes the new one */
export const own = (e) => { e.__own = true; return e; };
export function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v; else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) on(e, k.slice(2), v); else e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(k));
  return e;
}


/* a confirmation as a sheet over its screen: the screen's root must be position: relative */
export function askSheet({ title, text, yes = "OK", danger = false, onYes, onNo }) {
  return el("div", { class: "sheet ask", role: "alertdialog", "aria-label": title },
    el("div", { class: "sheethead" }, el("b", { text: title }), el("button", { class: "btn", "aria-label": "Close", onclick: onNo }, ic("close"))),
    el("p", { class: "hint", text }),
    el("div", { class: "row" }, el("button", { class: "btn grow", onclick: onNo, text: "Cancel" }), el("button", { class: "btn grow" + (danger ? " red" : ""), onclick: onYes, text: yes })));
}

/* the same sheet with an input for one line of text */
export function textSheet({ title, text, value = "", max = 12, yes = "OK", onYes, onNo }) {
  const inp = el("input", { type: "text", class: "nm", maxlength: max, value, spellcheck: "false", "aria-label": title });
  return el("div", { class: "sheet ask", role: "dialog", "aria-label": title },
    el("div", { class: "sheethead" }, el("b", { text: title }), el("button", { class: "btn", "aria-label": "Close", onclick: onNo }, ic("close"))),
    text ? el("p", { class: "hint", text }) : null, inp,
    el("div", { class: "row" }, el("button", { class: "btn grow", onclick: onNo, text: "Cancel" }), el("button", { class: "btn grow red", onclick: () => onYes(inp.value), text: yes })));
}

/* A device event or a timer must not rebuild the screen while a finger is down: the node under the finger would vanish and the
 * tap (or the drag) with it. idle(key, fn) runs fn now, or, with a finger down, once all fingers are up (the last call per key
 * wins). A pointer that never reports its end (the page lost focus) stops counting after 10 s. */
const fingers = new Map(), waiting = new Map();
const down = () => { const now = performance.now(); for (const [id, t] of fingers) if (now - t > 10000) fingers.delete(id); return fingers.size > 0; };
const flush = () => { if (down()) return; const fns = [...waiting.values()]; waiting.clear(); fns.forEach((f) => f()); };
addEventListener("pointerdown", (e) => fingers.set(e.pointerId, performance.now()), true);
for (const ev of ["pointerup", "pointercancel"]) addEventListener(ev, (e) => { fingers.delete(e.pointerId); flush(); }, true);
addEventListener("blur", () => { fingers.clear(); flush(); });
export function idle(key, fn) { if (down()) waiting.set(key, fn); else fn(); }

/* ---- repaint in place ----
 * A screen that is redrawn because the machine reported something (or a load finished) must not replace the nodes the user is
 * touching. repaint(root, build) runs build() as before (it fills root), then makes the live nodes look like what it built:
 * a node of the same kind is kept and patched (attributes, text, value, handlers), a different one is replaced. */
const sameKind = (x, y) => {
  if (x === y) return true;
  if (y.isConnected || x.nodeType !== y.nodeType) return false;       /* (a node the build reused from the live screen: it moves, it is not patched) */
  if (x.nodeType !== 1) return true;
  if (x.nodeName !== y.nodeName || x.getAttribute("type") !== y.getAttribute("type") || x.getAttribute("role") !== y.getAttribute("role")) return false;
  if (x.__own || y.__own) return !!(x.__own && y.__own) && x.outerHTML === y.outerHTML;
  return true;
};
function patch(x, y) {
  if (x === y) return;
  if (x.nodeType !== 1) { if (x.data !== y.data) x.data = y.data; return; }
  for (const at of [...x.attributes]) if (!y.hasAttribute(at.name)) x.removeAttribute(at.name);
  for (const at of y.attributes) if (x.getAttribute(at.name) !== at.value) x.setAttribute(at.name, at.value);
  const h = (x.__on ||= {}), g = y.__on || {};
  for (const t in g) { if (!(t in h)) x.addEventListener(t, (ev) => h[t](ev)); h[t] = g[t]; }
  for (const t in h) if (!(t in g)) h[t] = () => {};
  morphChildren(x, [...y.childNodes]);
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(x.nodeName) && x.type !== "file" && x !== document.activeElement && !x.matches(":active") && x.value !== y.value) x.value = y.value;
  if (x.nodeName === "INPUT" && (x.type === "checkbox" || x.type === "radio") && x.checked !== y.checked) x.checked = y.checked;
}
export function morphChildren(parent, fresh) {
  const live = [...parent.childNodes];
  fresh.forEach((y, i) => {
    const x = live[i];
    if (!x) parent.append(y);
    else if (!sameKind(x, y)) x.replaceWith(y);
    else patch(x, y);
  });
  for (let i = fresh.length; i < live.length; i++) live[i].remove();
}
export function repaint(root, build) {
  const live = [...root.childNodes];
  root.replaceChildren();
  try { build(); } finally {
    const fresh = [...root.childNodes];
    root.replaceChildren(...live);
    morphChildren(root, fresh);
  }
}
