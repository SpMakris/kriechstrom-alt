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
export function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v; else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? "" : v);
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
