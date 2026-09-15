/* crt.js -- a small cathode screen for the gate.

   A scrolling terminal: lines are typed on character by character, older lines
   scroll off the top, a block cursor sits at the end of the last line. Lines
   queue, so several calls in a row play in order instead of overwriting.

   API
     CRT.mount(el)             one-time, on the lines container
     CRT.line(text, cls)       queue a line; cls: "" | dim | ok | bad | hot
     CRT.clear()
     CRT.tone(t)               screen tone: idle | busy | ok | bad

   Reduced motion prints instantly and does not blink. */
"use strict";
(() => {
  const SPEED = 11;                 // ms per character
  const KEEP = 24;                  // lines retained before the top is dropped
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let box = null, cursor = null, queue = [], typing = false;

  function mount(el) {
    if (!el || box === el) return;
    box = el;
    box.textContent = "";
    cursor = document.createElement("span");
    cursor.className = "crt-cursor";
    cursor.textContent = "\u2588";
  }

  function scroll() { if (box) box.scrollTop = box.scrollHeight; }

  function trim() {
    while (box.querySelectorAll(".crt-line").length > KEEP) box.firstElementChild.remove();
  }

  function next() {
    if (typing || !queue.length || !box) return;
    const {text, cls} = queue.shift();
    typing = true;
    const row = document.createElement("div");
    row.className = `crt-line${cls ? " " + cls : ""}`;
    const span = document.createElement("span");
    row.appendChild(span);
    box.appendChild(row);
    row.appendChild(cursor);
    trim(); scroll();

    if (reduce || !text) {
      span.textContent = text;
      typing = false; scroll(); next();
      return;
    }
    let i = 0;
    const tick = () => {
      span.textContent = text.slice(0, ++i);
      scroll();
      if (i < text.length) setTimeout(tick, SPEED);
      else { typing = false; next(); }
    };
    setTimeout(tick, SPEED);
  }

  function line(text, cls) {
    if (!box) return;
    queue.push({text: String(text), cls: cls || ""});
    next();
  }

  function clear() {
    if (!box) return;
    queue = []; typing = false;
    box.textContent = "";
  }

  function tone(t) {
    const screen = box && box.closest(".crt");
    if (screen) screen.className = `crt tone-${t || "idle"}`;
  }

  window.CRT = {mount, line, clear, tone};
})();
