import { clamp, lerp } from '../core/noise.js';

/**
 * Fully procedural WebAudio engine: wind, drone, heartbeat, footsteps,
 * creature cues (spatialized), stingers and UI sounds. No audio files.
 */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.fear = 0;
    this._hbTimer = 0;
    this._gust = 0;
    this._gustTarget = 0.1;
    this._listenerPos = { x: 0, y: 0, z: 0 };
  }

  init() {
    if (this.ready) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain(); this.master.gain.value = 0.9; this.master.connect(ctx.destination);
    this.ambBus = ctx.createGain(); this.ambBus.gain.value = 1; this.ambBus.connect(this.master);
    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = 1; this.sfxBus.connect(this.master);
    // simple reverb for the forest: feedback delay network
    this.verb = ctx.createGain(); this.verb.gain.value = 0.25;
    const d1 = ctx.createDelay(1); d1.delayTime.value = 0.21;
    const d2 = ctx.createDelay(1); d2.delayTime.value = 0.33;
    const fb1 = ctx.createGain(); fb1.gain.value = 0.35; const fb2 = ctx.createGain(); fb2.gain.value = 0.3;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800;
    this.verb.connect(d1); this.verb.connect(d2); d1.connect(fb1); fb1.connect(d1); d2.connect(fb2); fb2.connect(d2);
    d1.connect(lp); d2.connect(lp); lp.connect(this.master);

    // noise buffer
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      // pinkish
      b0 = 0.99765 * b0 + w * 0.0990460; b1 = 0.96300 * b1 + w * 0.2965164; b2 = 0.57000 * b2 + w * 1.0526913;
      data[i] = (b0 + b1 + b2 + w * 0.1848) * 0.12;
    }
    this.noiseBuf = buf;
    const wbuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const wd = wbuf.getChannelData(0);
    for (let i = 0; i < len; i++) wd[i] = Math.random() * 2 - 1;
    this.whiteBuf = wbuf;

    this._startWind();
    this._startDrone();
    this.ready = true;
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  _loopNoise(buf) {
    const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s;
  }

  _startWind() {
    const ctx = this.ctx;
    const src = this._loopNoise(this.noiseBuf);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 320; bp.Q.value = 0.5;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0.12;
    src.connect(bp); bp.connect(this.windGain); this.windGain.connect(this.ambBus);
    this.windFilter = bp;
    // treble: needles hissing
    const src2 = this._loopNoise(this.whiteBuf);
    const hp = ctx.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 2600; hp.Q.value = 0.4;
    this.hissGain = ctx.createGain(); this.hissGain.gain.value = 0.006;
    src2.connect(hp); hp.connect(this.hissGain); this.hissGain.connect(this.ambBus);
  }

  _startDrone() {
    const ctx = this.ctx;
    this.droneGain = ctx.createGain(); this.droneGain.gain.value = 0.0;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 160;
    for (const f of [36, 54.3, 72.6]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.start();
      const g = ctx.createGain(); g.gain.value = f === 36 ? 1 : 0.4;
      o.connect(g); g.connect(lp);
    }
    lp.connect(this.droneGain); this.droneGain.connect(this.ambBus);
    // dissonant pad for high fear
    this.padGain = ctx.createGain(); this.padGain.gain.value = 0;
    const plp = ctx.createBiquadFilter(); plp.type = 'lowpass'; plp.frequency.value = 420;
    for (const f of [110, 116.5, 164.8, 174.6]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.start();
      const g = ctx.createGain(); g.gain.value = 0.25;
      o.connect(g); g.connect(plp);
    }
    plp.connect(this.padGain); this.padGain.connect(this.ambBus);
  }

  setListener(pos, fwd, up) {
    if (!this.ready) return;
    const L = this.ctx.listener, t = this.ctx.currentTime;
    this._listenerPos = pos;
    if (L.positionX) {
      L.positionX.setTargetAtTime(pos.x, t, 0.02); L.positionY.setTargetAtTime(pos.y, t, 0.02); L.positionZ.setTargetAtTime(pos.z, t, 0.02);
      L.forwardX.setTargetAtTime(fwd.x, t, 0.02); L.forwardY.setTargetAtTime(fwd.y, t, 0.02); L.forwardZ.setTargetAtTime(fwd.z, t, 0.02);
      L.upX.setTargetAtTime(up.x, t, 0.02); L.upY.setTargetAtTime(up.y, t, 0.02); L.upZ.setTargetAtTime(up.z, t, 0.02);
    } else { L.setPosition(pos.x, pos.y, pos.z); L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z); }
  }

  _panner(pos, ref = 3, max = 70, roll = 1.3) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = ref; p.maxDistance = max; p.rolloffFactor = roll;
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; }
    else p.setPosition(pos.x, pos.y, pos.z);
    p.connect(this.sfxBus); p.connect(this.verb);
    return p;
  }

  _env(g, t, a, d, s = 0, r = 0.05, peak = 1) {
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.linearRampToValueAtTime(s * peak, t + a + d);
    g.gain.linearRampToValueAtTime(0, t + a + d + r);
  }

  _noiseBurst({ dest, dur, type = 'bandpass', freq = 800, q = 1, gain = 0.3, attack = 0.005, white = false, when = 0, sweepTo = null }) {
    const ctx = this.ctx, t = ctx.currentTime + when;
    const s = ctx.createBufferSource(); s.buffer = white ? this.whiteBuf : this.noiseBuf;
    s.loop = true; s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    if (sweepTo) f.frequency.linearRampToValueAtTime(sweepTo, t + dur);
    const g = ctx.createGain();
    this._env(g, t, attack, dur * 0.6, 0.0, dur * 0.4, gain);
    s.connect(f); f.connect(g); g.connect(dest || this.sfxBus);
    s.start(t); s.stop(t + dur + 0.1);
    return g;
  }

  // ---------------- game sounds ----------------
  footstep({ sprint = false, onTrail = true, surface = null } = {}, remotePos = null) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const dest = remotePos ? this._panner(remotePos, 2, 30) : this.sfxBus;
    const g = (sprint ? 0.34 : 0.24) * (remotePos ? 0.8 : 1);
    // soft body thud: lowpassed pink noise with a gentle attack, random start offset so no two steps are identical
    const thud = (freq, gain, dur, attack) => {
      const s = ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
      s.playbackRate.value = 0.85 + Math.random() * 0.3;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq; f.Q.value = 0.4;
      const gn = ctx.createGain();
      this._env(gn, t, attack, dur * 0.5, 0.15, dur * 0.5, gain);
      s.connect(f); f.connect(gn); gn.connect(dest);
      s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.1);
    };
    if (surface === 'water') {
      thud(900, g * 1.1, 0.26, 0.02);
      thud(2200, g * 0.35, 0.18, 0.05);
      return;
    }
    if (onTrail) {
      thud(380 + Math.random() * 120, g, 0.14, 0.012);          // heel
      thud(900, g * 0.28, 0.09, 0.02);                            // gravel texture, muted
    } else {
      thud(320 + Math.random() * 100, g * 0.9, 0.16, 0.015);     // soil
      thud(1600, g * 0.22, 0.2, 0.04);                            // soft leaf rustle
    }
  }

  twig(pos) {
    if (!this.ready) return;
    const p = this._panner(pos, 4, 80, 1.1);
    this._noiseBurst({ dest: p, dur: 0.02, type: 'highpass', freq: 2500, gain: 0.9, white: true, attack: 0.001 });
    this._noiseBurst({ dest: p, dur: 0.05, type: 'bandpass', freq: 900, q: 2, gain: 0.5, when: 0.01 });
  }

  whisper(pos) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const p = this._panner(pos, 3, 50, 1.5);
    const s = ctx.createBufferSource(); s.buffer = this.whiteBuf; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 3;
    f.frequency.linearRampToValueAtTime(2600, t + 0.6); f.frequency.linearRampToValueAtTime(1100, t + 1.3);
    const g = ctx.createGain(); g.gain.value = 0;
    // syllabic tremolo
    for (let i = 0; i < 7; i++) { const tt = t + i * 0.19; g.gain.setValueAtTime(0.0, tt); g.gain.linearRampToValueAtTime(0.25, tt + 0.05); g.gain.linearRampToValueAtTime(0.02, tt + 0.17); }
    g.gain.linearRampToValueAtTime(0, t + 1.5);
    s.connect(f); f.connect(g); g.connect(p);
    s.start(t); s.stop(t + 1.6);
  }

  breath(pos) {
    if (!this.ready) return;
    const p = this._panner(pos, 3, 40, 1.4);
    this._noiseBurst({ dest: p, dur: 0.7, type: 'lowpass', freq: 600, q: 0.5, gain: 0.45, attack: 0.3 });
    this._noiseBurst({ dest: p, dur: 0.6, type: 'lowpass', freq: 400, q: 0.5, gain: 0.3, attack: 0.25, when: 0.9 });
  }

  growl(pos, big = false) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const p = this._panner(pos, 4, 70, 1.2);
    const ws = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 4); }
    ws.curve = curve;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = big ? 400 : 260;
    const g = ctx.createGain();
    const dur = big ? 2.4 : 1.6;
    this._env(g, t, 0.15, dur * 0.5, 0.6, dur * 0.5, big ? 1.1 : 0.6);
    const trem = ctx.createGain(); trem.gain.value = 0.6;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 9 + Math.random() * 4; const lg = ctx.createGain(); lg.gain.value = 0.4;
    lfo.connect(lg); lg.connect(trem.gain); lfo.start(t); lfo.stop(t + dur + 0.2);
    for (const f of [46, 47.8, 69]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f * (big ? 0.8 : 1);
      o.frequency.linearRampToValueAtTime(f * 0.85, t + dur);
      o.connect(ws); o.start(t); o.stop(t + dur + 0.2);
    }
    ws.connect(lp); lp.connect(trem); trem.connect(g); g.connect(p);
  }

  stinger() {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 300;
    const g = ctx.createGain(); this._env(g, t, 0.8, 0.6, 0.5, 0.8, 0.32);
    for (let i = 0; i < 7; i++) {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      const f = 180 + i * 23 + Math.random() * 9;
      o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 4.2, t + 1.6);
      const og = ctx.createGain(); og.gain.value = 0.18;
      o.connect(og); og.connect(hp); o.start(t); o.stop(t + 2.4);
    }
    hp.connect(g); g.connect(this.sfxBus);
    this._noiseBurst({ dest: this.sfxBus, dur: 1.8, type: 'highpass', freq: 800, gain: 0.25, attack: 1.2, white: true });
  }

  scream() {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const hp = ctx.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 1800; hp.Q.value = 0.7;
    const g = ctx.createGain(); this._env(g, t, 0.01, 0.35, 0.5, 0.5, 0.7);
    for (let i = 0; i < 5; i++) {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      const f = 700 + i * 110 + Math.random() * 60;
      o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 1.9, t + 0.12); o.frequency.exponentialRampToValueAtTime(f * 0.7, t + 0.9);
      const og = ctx.createGain(); og.gain.value = 0.2;
      o.connect(og); og.connect(hp); o.start(t); o.stop(t + 1.0);
    }
    hp.connect(g); g.connect(this.sfxBus);
    this._noiseBurst({ dest: this.sfxBus, dur: 0.9, type: 'highpass', freq: 2500, gain: 0.6, white: true, attack: 0.005 });
  }

  grab() {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    this._noiseBurst({ dest: this.sfxBus, dur: 0.5, type: 'lowpass', freq: 900, gain: 1.2, attack: 0.005, white: true });
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(28, t + 0.9);
    const g = ctx.createGain(); this._env(g, t, 0.01, 0.5, 0.3, 0.6, 1.0);
    o.connect(g); g.connect(this.sfxBus); o.start(t); o.stop(t + 1.3);
    this.growl({ x: this._listenerPos.x, y: this._listenerPos.y, z: this._listenerPos.z }, true);
  }

  lampClick() { if (this.ready) this._noiseBurst({ dest: this.sfxBus, dur: 0.012, type: 'highpass', freq: 3000, gain: 0.5, white: true, attack: 0.001 }); }

  pickup() {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (const [f, w] of [[880, 0], [1320, 0.09]]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = ctx.createGain(); this._env(g, t + w, 0.005, 0.06, 0, 0.08, 0.12);
      o.connect(g); g.connect(this.sfxBus); o.start(t + w); o.stop(t + w + 0.2);
    }
  }

  handoff() { if (this.ready) this._noiseBurst({ dest: this.sfxBus, dur: 0.28, type: 'lowpass', freq: 1400, gain: 0.25, attack: 0.03 }); }

  checkpoint() {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (const [f, w] of [[523, 0], [659, 0.12], [784, 0.24]]) {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
      const g = ctx.createGain(); this._env(g, t + w, 0.01, 0.2, 0.2, 0.4, 0.08);
      o.connect(g); g.connect(this.sfxBus); g.connect(this.verb); o.start(t + w); o.stop(t + w + 0.8);
    }
  }

  ping() {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (const [f, w] of [[1180, 0], [1560, 0.07]]) {
      const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f;
      const g = ctx.createGain(); this._env(g, t + w, 0.004, 0.04, 0, 0.05, 0.05);
      o.connect(g); g.connect(this.sfxBus); o.start(t + w); o.stop(t + w + 0.15);
    }
  }

  lever() {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    this._noiseBurst({ dest: this.sfxBus, dur: 0.08, type: 'bandpass', freq: 2200, q: 6, gain: 0.5, white: true, attack: 0.002 });
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(420, t); o.frequency.exponentialRampToValueAtTime(180, t + 0.25);
    const g = ctx.createGain(); this._env(g, t, 0.005, 0.15, 0.2, 0.2, 0.35);
    o.connect(g); g.connect(this.sfxBus); g.connect(this.verb); o.start(t); o.stop(t + 0.5);
  }

  clank() {
    if (!this.ready) return;
    this._noiseBurst({ dest: this.sfxBus, dur: 0.05, type: 'bandpass', freq: 1500 + Math.random() * 800, q: 8, gain: 0.45, white: true, attack: 0.002 });
    this._noiseBurst({ dest: this.sfxBus, dur: 0.12, type: 'lowpass', freq: 300, gain: 0.3, attack: 0.004 });
  }

  creak() {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(90, t); o.frequency.linearRampToValueAtTime(160, t + 1.2); o.frequency.linearRampToValueAtTime(70, t + 2.2);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 500; f.Q.value = 4;
    const g = ctx.createGain(); this._env(g, t, 0.3, 1.2, 0.5, 0.8, 0.25);
    o.connect(f); f.connect(g); g.connect(this.sfxBus); g.connect(this.verb); o.start(t); o.stop(t + 2.5);
    this._noiseBurst({ dest: this.sfxBus, dur: 0.4, type: 'lowpass', freq: 250, gain: 0.5, attack: 0.01, when: 2.0 });
  }

  doorKnock() {
    if (!this.ready) return;
    for (let i = 0; i < 3; i++) this._noiseBurst({ dest: this.sfxBus, dur: 0.08, type: 'lowpass', freq: 500, gain: 0.6, when: i * 0.28 });
  }

  win() {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (const [f, w] of [[261.6, 0], [329.6, 0.3], [392, 0.6], [523.2, 0.9]]) {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
      const g = ctx.createGain(); this._env(g, t + w, 0.05, 1.6, 0.3, 1.5, 0.1);
      o.connect(g); g.connect(this.sfxBus); g.connect(this.verb); o.start(t + w); o.stop(t + w + 3.5);
    }
  }

  // ---------------- continuous ----------------
  setFear(f) { this.fear = clamp(f, 0, 1); }

  update(dt) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    // wind gusts
    if (Math.random() < dt * 0.15) this._gustTarget = 0.06 + Math.random() * 0.2;
    this._gust = lerp(this._gust, this._gustTarget, 1 - Math.exp(-dt * 0.5));
    this.windGain.gain.setTargetAtTime(this._gust, t, 0.3);
    this.windFilter.frequency.setTargetAtTime(240 + this._gust * 700, t, 0.5);
    this.hissGain.gain.setTargetAtTime(0.003 + this._gust * 0.03, t, 0.4);
    // dread
    const f = this.fear;
    this.droneGain.gain.setTargetAtTime(0.03 + f * 0.16, t, 0.5);
    this.padGain.gain.setTargetAtTime(Math.pow(f, 2) * 0.09, t, 0.8);
    // heartbeat
    if (f > 0.15) {
      this._hbTimer -= dt;
      if (this._hbTimer <= 0) {
        this._hbTimer = lerp(1.05, 0.42, f);
        const vol = Math.pow(f, 1.3) * 0.7;
        this._thump(t, vol); this._thump(t + 0.15, vol * 0.6);
      }
    }
  }

  _thump(t, vol) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(62, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.12);
    const g = ctx.createGain(); this._env(g, t, 0.006, 0.07, 0, 0.1, vol);
    o.connect(g); g.connect(this.sfxBus); o.start(t); o.stop(t + 0.3);
  }
}
