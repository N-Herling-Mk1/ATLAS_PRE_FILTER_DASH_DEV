/* sfx.js -- synthesized UI sounds. mk25.

   Ported from nathan_herling js/audio.js: the same noise-burst + pitched-tone
   voices, the same compressor on the master bus. What changed on the way in:

     - no files. The site's audio.js imports sfxdata.js (144 KB of base64 for the
       splash spark) and a preload cache; the deck needs none of it.
     - a REAL mute. On the site the speaker only gates the hover bed and every
       cue ignores it. Here `enabled` gates every voice, so off means silent.
     - not a module. The CSP is script-src 'self' and the app loads plain
       scripts, so this is an IIFE on window.Sfx like Deck and PFD.

   Browsers will not start an AudioContext without a user gesture. If the stored
   setting is ON, the context is created on the first pointerdown/keydown on the
   page, so a returning visitor with sound on is not greeted by silence forever.

   API   Sfx.on() / Sfx.set(bool) / Sfx.unlock()
         Sfx.snap()  detent click, one per face the deck passes
         Sfx.deal()  a card selected
         Sfx.dock()  the deck docking / undocking
*/
"use strict";
(() => {
  const KEY = "pfd.sound";
  let actx = null, master = null, noiseBuf = null;
  // ON unless the user has switched it off (mk25a: default was off)
  let enabled = true;
  try { enabled = localStorage.getItem(KEY) !== "off"; } catch (e) { enabled = true; }

  function unlock() {
    if (actx) { if (actx.state === "suspended") actx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    actx = new AC();
    const n = actx.sampleRate * 0.5;
    noiseBuf = actx.createBuffer(1, n, actx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    master = actx.createGain(); master.gain.value = 1.2;
    const comp = actx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 22; comp.ratio.value = 5;
    comp.attack.value = 0.002; comp.release.value = 0.14;
    master.connect(comp); comp.connect(actx.destination);
  }

  const live = () => enabled && actx && actx.state === "running";

  function burst(o) {
    if (!live()) return;
    const t = actx.currentTime;
    const s = actx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    const f = actx.createBiquadFilter();
    f.type = o.type || "bandpass"; f.frequency.value = o.freq; f.Q.value = o.q || 5;
    const g = actx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(o.gain, t + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t); s.stop(t + o.dur + 0.02);
  }
  function tone(o) {
    if (!live()) return;
    const t = actx.currentTime;
    const osc = actx.createOscillator(); osc.type = o.type || "triangle";
    osc.frequency.setValueAtTime(o.f0, t);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur);
    const g = actx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(o.gain, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    osc.connect(g); g.connect(master);
    osc.start(t); osc.stop(t + o.dur + 0.02);
  }

  /* A detent fires once per face passed, so a fast spin can ask for several in
     one frame. 38 ms apart keeps them audible as clicks rather than a buzz. */
  let lastSnap = 0;
  function snap() {
    const now = performance.now();
    if (now - lastSnap < 38) return;
    lastSnap = now;
    burst({type: "lowpass", freq: 620, q: 0.7, gain: 0.50, dur: 0.062});
    burst({type: "highpass", freq: 2800, q: 0.6, gain: 0.14, dur: 0.012});
    tone({f0: 190, f1: 96, gain: 0.28, dur: 0.07});
  }
  function deal() {
    burst({type: "highpass", freq: 2600, q: 0.5, gain: 0.30, dur: 0.022});
    tone({f0: 420, f1: 260, gain: 0.22, dur: 0.05});
  }
  function dock() {
    burst({type: "lowpass", freq: 900, q: 0.6, gain: 0.30, dur: 0.20});
    tone({f0: 150, f1: 62, gain: 0.16, dur: 0.24});
  }

  function set(on) {
    enabled = !!on;
    try { localStorage.setItem(KEY, enabled ? "on" : "off"); } catch (e) { /* private mode */ }
    if (enabled) unlock();                 // called from a click, so activation is held
    document.dispatchEvent(new CustomEvent("sfx:change", {detail: {on: enabled}}));
  }

  /* ON: arm on the first gesture anywhere. Browsers refuse audio before one, so
     "on at load" means the first click or key already has sound behind it. */
  if (enabled) {
    const arm = () => { unlock(); window.removeEventListener("pointerdown", arm, true);
                        window.removeEventListener("keydown", arm, true); };
    window.addEventListener("pointerdown", arm, true);
    window.addEventListener("keydown", arm, true);
  }

  window.Sfx = {on: () => enabled, set, unlock, snap, deal, dock};
})();
