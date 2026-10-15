// Generative music, one "record" per piece, synthesised live with Web Audio (no audio files, no rights issues).
//   ONDA  - "Smoked Waves": late-night jazz trio, Rhodes + upright bass + brushes
//   ARCOS - "Arcs": slow ambient pads with glass bells
//   AURA  - "Aura": warm lo-fi groove with vinyl crackle
export const RECORDS = {
  onda: { title: 'Smoked Waves', artist: 'ONDA Trio', bpm: 86 },
  arcos: { title: 'Arcs', artist: 'Koda Ensemble', bpm: 64 },
  aura: { title: 'Aura', artist: 'Cove Lights', bpm: 78 },
};

const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

export class Music {
  constructor(ctx) {
    this.ctx = ctx;
    this.out = {};          // piece -> GainNode (routed to the piece's speakers by the caller)
    this.playing = null;    // piece key
    this.step = 0; this.next = 0; this.timer = null;
    this.level = 0;         // smoothed loudness 0..1 for visuals
    this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 256;
    this.buf = new Uint8Array(this.analyser.frequencyBinCount);
    this.noise = this.makeNoise();
    this.verb = this.makeReverb();
    for (const k of Object.keys(RECORDS)) {
      const g = ctx.createGain(); g.gain.value = 0;
      const dry = ctx.createGain(); dry.gain.value = 1; dry.connect(g);
      const wet = ctx.createGain(); wet.gain.value = k === 'arcos' ? 0.55 : 0.22;
      const vIn = ctx.createGain(); vIn.connect(this.verb.input); // shared reverb send
      this.out[k] = g; this[k] = { bus: dry, send: vIn, wet };
      g.connect(this.analyser);
    }
    this.verb.output.connect(this.verbOut = ctx.createGain());
  }
  makeNoise() {
    const b = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  makeReverb() {
    const ctx = this.ctx, len = ctx.sampleRate * 3.2, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
    const input = ctx.createGain(), conv = ctx.createConvolver(), output = ctx.createGain();
    conv.buffer = ir; input.connect(conv); conv.connect(output); output.gain.value = 0.9;
    return { input, output };
  }
  // reverb returns to whichever record is playing
  routeVerb(k) { try { this.verbOut.disconnect(); } catch (e) {} if (k) this.verbOut.connect(this.out[k]); }

  play(k) {
    if (this.playing === k) return;
    this.stop(true);
    this.playing = k; this.routeVerb(k);
    const g = this.out[k].gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t); g.setValueAtTime(0.0001, t); g.exponentialRampToValueAtTime(1, t + 1.2);
    this.step = 0; this.next = t + 0.15;
    this.timer = setInterval(() => this.schedule(), 25);
  }
  stop(quick) {
    if (!this.playing) return;
    const k = this.playing, g = this.out[k].gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(0, t + (quick ? 0.25 : 1.4));
    clearInterval(this.timer); this.timer = null; this.playing = null;
  }
  meter() {
    this.analyser.getByteTimeDomainData(this.buf);
    let s = 0; for (const v of this.buf) { const x = (v - 128) / 128; s += x * x; }
    const rms = Math.sqrt(s / this.buf.length);
    this.level += (Math.min(1, rms * 4) - this.level) * 0.25;
    return this.level;
  }

  schedule() {
    const k = this.playing; if (!k) return;
    const spb = 60 / RECORDS[k].bpm / 4;            // 16th notes
    while (this.next < this.ctx.currentTime + 0.12) { this[k + 'Step'](this.step, this.next, spb); this.step++; this.next += spb * (k === 'onda' && this.step % 2 ? 1.12 : k === 'onda' ? 0.88 : 1); }
  }

  // ── voices
  env(node, t, a, peak, d, s, r, dur) {
    const g = node.gain; g.setValueAtTime(0.0001, t); g.linearRampToValueAtTime(peak, t + a);
    g.exponentialRampToValueAtTime(Math.max(0.0001, peak * s), t + a + d); g.setValueAtTime(Math.max(0.0001, peak * s), t + dur);
    g.exponentialRampToValueAtTime(0.0001, t + dur + r);
  }
  rhodes(k, midi, t, dur, vel = 0.12) {
    const c = this.ctx, f = mtof(midi), o1 = c.createOscillator(), o2 = c.createOscillator(), m = c.createOscillator(), mg = c.createGain(), g = c.createGain();
    o1.frequency.value = f; o2.frequency.value = f * 2.001; o2.type = 'sine'; m.frequency.value = f * 7; mg.gain.value = f * 0.9;
    m.connect(mg); mg.connect(o1.frequency);
    const g2 = c.createGain(); g2.gain.value = 0.18; o2.connect(g2); g2.connect(g); o1.connect(g);
    this.env(g, t, 0.006, vel, 0.9, 0.35, 0.6, dur);
    mg.gain.setValueAtTime(f * 0.9, t); mg.gain.exponentialRampToValueAtTime(f * 0.05, t + 0.5);
    g.connect(this[k].bus); g.connect(this[k].send);
    for (const o of [o1, o2, m]) { o.start(t); o.stop(t + dur + 0.7); }
  }
  pad(k, midi, t, dur, vel = 0.05) {
    const c = this.ctx, f = mtof(midi), lp = c.createBiquadFilter(), g = c.createGain();
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(500, t); lp.frequency.linearRampToValueAtTime(1400, t + dur * 0.5); lp.frequency.linearRampToValueAtTime(600, t + dur);
    for (const det of [-7, 0, 6]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det; o.connect(lp); o.start(t); o.stop(t + dur + 2.5); }
    lp.connect(g); this.env(g, t, dur * 0.35, vel, dur * 0.3, 0.8, 2.2, dur);
    g.connect(this[k].bus); g.connect(this[k].send);
  }
  bell(k, midi, t, vel = 0.05) {
    const c = this.ctx, f = mtof(midi), g = c.createGain();
    for (const [mul, a] of [[1, 1], [2.76, 0.35], [5.4, 0.15]]) { const o = c.createOscillator(); o.frequency.value = f * mul; const og = c.createGain(); og.gain.value = a; o.connect(og); og.connect(g); o.start(t); o.stop(t + 3); }
    this.env(g, t, 0.003, vel, 1.5, 0.2, 1.4, 0.3);
    g.connect(this[k].bus); g.connect(this[k].send);
  }
  bass(k, midi, t, dur, vel = 0.22) {
    const c = this.ctx, o = c.createOscillator(), lp = c.createBiquadFilter(), g = c.createGain();
    o.type = 'triangle'; o.frequency.value = mtof(midi); lp.type = 'lowpass'; lp.frequency.value = 700;
    o.connect(lp); lp.connect(g); this.env(g, t, 0.01, vel, 0.25, 0.4, 0.15, dur);
    g.connect(this[k].bus); o.start(t); o.stop(t + dur + 0.3);
  }
  hit(k, t, { freq = 8000, q = 0.8, type = 'highpass', dur = 0.05, vel = 0.05 } = {}) {
    const c = this.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noise; f.type = type; f.frequency.value = freq; f.Q.value = q;
    s.connect(f); f.connect(g); g.gain.setValueAtTime(vel, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(this[k].bus); s.start(t, Math.random()); s.stop(t + dur + 0.02);
  }
  kick(k, t, vel = 0.5) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
    g.gain.setValueAtTime(vel, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g); g.connect(this[k].bus); o.start(t); o.stop(t + 0.4);
  }

  vibe(k, midi, t, dur, vel = 0.06) {            // vibraphone: two sine partials, motor tremolo
    const c = this.ctx, f = mtof(midi), g = c.createGain(), trem = c.createGain(), lfo = c.createOscillator(), lg = c.createGain();
    for (const [mul, a] of [[1, 1], [4, 0.22], [10.2, 0.04]]) { const o = c.createOscillator(); o.frequency.value = f * mul; const og = c.createGain(); og.gain.value = a; o.connect(og); og.connect(trem); o.start(t); o.stop(t + dur + 2); }
    lfo.frequency.value = 5.2; lg.gain.value = 0.35; lfo.connect(lg); lg.connect(trem.gain); trem.gain.value = 0.65; lfo.start(t); lfo.stop(t + dur + 2);
    trem.connect(g); this.env(g, t, 0.004, vel, 1.2, 0.25, 1.1, dur);
    g.connect(this[k].bus); g.connect(this[k].send);
  }
  pluck(k, midi, t, vel = 0.07) {                 // harp-like: bright attack, filter closing fast
    const c = this.ctx, o = c.createOscillator(), lp = c.createBiquadFilter(), g = c.createGain();
    o.type = 'triangle'; o.frequency.value = mtof(midi); lp.type = 'lowpass'; lp.frequency.setValueAtTime(4200, t); lp.frequency.exponentialRampToValueAtTime(500, t + 0.9);
    o.connect(lp); lp.connect(g); this.env(g, t, 0.002, vel, 1.6, 0.05, 0.8, 0.2);
    g.connect(this[k].bus); g.connect(this[k].send); o.start(t); o.stop(t + 3);
  }
  lead(k, midi, t, dur, vel = 0.05) {             // lo-fi synth lead with tape wobble
    const c = this.ctx, o = c.createOscillator(), o2 = c.createOscillator(), lp = c.createBiquadFilter(), g = c.createGain(), w = c.createOscillator(), wg = c.createGain();
    o.type = 'square'; o2.type = 'triangle'; o.frequency.value = o2.frequency.value = mtof(midi); o2.detune.value = 9;
    w.frequency.value = 0.9; wg.gain.value = 14; w.connect(wg); wg.connect(o.detune); wg.connect(o2.detune);
    lp.type = 'lowpass'; lp.frequency.value = 1500; lp.Q.value = 0.4;
    const mix = c.createGain(); mix.gain.value = 0.5; o.connect(mix); o2.connect(lp); mix.connect(lp); lp.connect(g);
    this.env(g, t, 0.02, vel, 0.3, 0.6, 0.35, dur);
    g.connect(this[k].bus); g.connect(this[k].send);
    for (const x of [o, o2, w]) { x.start(t); x.stop(t + dur + 0.5); }
  }

  // ── records
  ondaStep(i, t, spb) {             // ii-V-I-VI in D minor-ish, swung brushes
    const bar = Math.floor(i / 16) % 8, s = i % 16;
    const prog = [[50, [62, 65, 69, 72, 76]], [55, [65, 69, 71, 76]], [48, [64, 67, 71, 74]], [57, [61, 67, 70, 73]],
                  [50, [62, 65, 69, 72, 77]], [43, [62, 65, 67, 71]], [48, [64, 67, 71, 76]], [45, [61, 64, 67, 70]]][bar];
    if (s === 0 || s === 10) prog[1].forEach((m, j) => this.rhodes('onda', m, t + j * 0.012, spb * (s === 0 ? 9 : 5), 0.07));
    if (s % 4 === 0) this.bass('onda', prog[0] - 12 + [0, 7, 12, 10][s / 4], t, spb * 3.4);
    if (s % 2 === 0) this.hit('onda', t, { freq: 3500, type: 'bandpass', q: 0.6, dur: spb * 1.6, vel: s % 4 === 0 ? 0.03 : 0.018 });
    if (s === 4 || s === 12) this.hit('onda', t, { freq: 2200, type: 'bandpass', q: 0.4, dur: 0.22, vel: 0.05 });
    if (s === 0 || s === 4 || s === 6 || s === 8 || s === 12 || s === 14) this.hit('onda', t, { freq: 7200, dur: s === 6 || s === 14 ? 0.12 : 0.35, vel: s === 6 || s === 14 ? 0.012 : 0.02 });   // ride: ting, ting-ga
    if (bar % 4 >= 2 && s % 2 === 0 && Math.random() < 0.62) { const tones = prog[1]; this.vibe('onda', tones[Math.floor(Math.random() * tones.length)] + (Math.random() < 0.5 ? 12 : 0), t, spb * 1.6, 0.045); }
  }
  arcosStep(i, t, spb) {            // slow pads + bells on a pentatonic
    const bar = Math.floor(i / 16) % 4, s = i % 16;
    const chords = [[48, 55, 64, 67], [45, 52, 60, 67], [41, 53, 60, 64], [43, 55, 62, 67]][bar];
    if (s === 0) chords.forEach(m => this.pad('arcos', m, t, spb * 16, 0.035));
    if (s === 0) this.bass('arcos', chords[0] - 12, t, spb * 14, 0.12);
    if (s % 2 === 0) { const up = [...chords, chords[1] + 12, chords[2] + 12, chords[3] + 12, chords[0] + 24]; this.pluck('arcos', up[(s / 2 + bar) % up.length] + 12, t, 0.045); }
    if (s === 0 && bar === 0) this.pad('arcos', 36, t, spb * 64, 0.03);                                   // drone under the whole cycle
    const pent = [72, 74, 76, 79, 81, 84, 86, 88];
    if ((s === 7 || s === 14) && Math.random() < 0.35) this.bell('arcos', pent[Math.floor(Math.random() * pent.length)], t, 0.035);
  }
  auraStep(i, t, spb) {             // lo-fi: Fmaj7 Em7 Dm7 Cmaj7
    const bar = Math.floor(i / 16) % 4, s = i % 16;
    const prog = [[41, [64, 67, 69, 72]], [40, [62, 67, 71, 74]], [38, [60, 65, 69, 72]], [36, [59, 64, 67, 71]]][bar];
    if (s === 0 || s === 7) prog[1].forEach((m, j) => this.rhodes('aura', m, t + j * 0.02, spb * (s === 0 ? 6.5 : 8.5), 0.06));
    if (s === 0 || s === 10) this.kick('aura', t, 0.45);
    if (s === 4 || s === 12) { this.hit('aura', t, { freq: 1800, type: 'bandpass', q: 0.7, dur: 0.18, vel: 0.09 }); }
    if (s % 2 === 0) this.hit('aura', t + (s % 4 === 2 ? spb * 0.12 : 0), { freq: 9000, dur: 0.03, vel: 0.025 });
    if (s === 0 || s === 6 || s === 10) this.bass('aura', prog[0], t, spb * 3, 0.2);
    const mel = [[76, 0, 3], [74, 4, 2], [72, 6, 2], [69, 10, 4], [72, 16, 3], [74, 20, 2], [76, 22, 2], [79, 26, 5]];       // [note, step, length] over two bars
    const pos = (bar % 2) * 16 + s; for (const [n, st, len] of mel) if (st === pos && bar >= 2) this.lead('aura', n, t, spb * len, 0.04);
    if (s % 4 === 0) this.hit('aura', t, { freq: 4000, type: 'bandpass', q: 0.3, dur: spb * 4, vel: 0.006 });   // crackle bed
    if (Math.random() < 0.08) this.hit('aura', t, { freq: 6000, dur: 0.012, vel: 0.05 });                     // dust pop
  }
}
