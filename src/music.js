'use strict';
// Музыка, которая следит за боем. Всё синтезируется в WebAudio.
// intensity 0..1: пэд и бас всегда; арпеджио, барабаны и хай-хэт добавляются по мере накала.
// tension 0..1: тревожное тремоло, когда у кого-то мало здоровья.
const midiHz = m => 440 * Math.pow(2, (m - 69) / 12);
const PROG = [[50, 53, 57], [46, 50, 53], [53, 57, 60], [48, 52, 55]];   // Dm, B♭, F, C
const BASS = [38, 34, 41, 36];

class Music {
  constructor(audio) {
    this.audio = audio;
    this.on = false;
    this.intensity = 0; this.tension = 0;
    this.beat = 0; this.chord = 0;
  }

  start() {
    const ctx = this.audio.ctx;
    if (this.on || !ctx) return;
    this.on = true;
    this.bus = this.audio.musicBus;
    // Пэд: три голоса по два расстроенных пилообразных
    this.padFilter = ctx.createBiquadFilter(); this.padFilter.type = 'lowpass'; this.padFilter.frequency.value = 600; this.padFilter.Q.value = 0.7;
    this.padGain = ctx.createGain(); this.padGain.gain.value = 0;
    this.padFilter.connect(this.padGain); this.padGain.connect(this.bus);
    this.voices = [0, 1, 2].map(() => {
      const a = ctx.createOscillator(), b = ctx.createOscillator();
      a.type = b.type = 'sawtooth'; b.detune.value = 9;
      const g = ctx.createGain(); g.gain.value = 0.33;
      a.connect(g); b.connect(g); g.connect(this.padFilter);
      a.start(); b.start();
      return [a, b];
    });
    // Бас
    this.bass = ctx.createOscillator(); this.bass.type = 'sine';
    this.bassGain = ctx.createGain(); this.bassGain.gain.value = 0;
    this.bass.connect(this.bassGain); this.bassGain.connect(this.bus); this.bass.start();
    // Тремоло тревоги
    this.trem = ctx.createOscillator(); this.trem.type = 'triangle';
    const lfo = ctx.createOscillator(); lfo.frequency.value = 9;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.5;
    this.tremGain = ctx.createGain(); this.tremGain.gain.value = 0;
    const tremAmp = ctx.createGain(); tremAmp.gain.value = 0.5;
    lfo.connect(lfoGain); lfoGain.connect(tremAmp.gain);
    this.trem.connect(tremAmp); tremAmp.connect(this.tremGain); this.tremGain.connect(this.bus);
    this.trem.start(); lfo.start();

    this.setChord(0, ctx.currentTime);
    this.nextBeat = ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 50);
  }

  setChord(i, t) {
    this.chord = i % PROG.length;
    const notes = PROG[this.chord];
    this.voices.forEach(([a, b], k) => {
      a.frequency.setTargetAtTime(midiHz(notes[k]), t, 0.25);
      b.frequency.setTargetAtTime(midiHz(notes[k]), t, 0.25);
    });
    this.bass.frequency.setTargetAtTime(midiHz(BASS[this.chord]), t, 0.1);
    this.trem.frequency.setTargetAtTime(midiHz(notes[2] + 24), t, 0.2);
  }

  note(type, freq, t, dur, vol, filter) {
    const ctx = this.audio.ctx;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    if (filter) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filter; o.connect(f); f.connect(g); } else o.connect(g);
    g.connect(this.bus); o.start(t); o.stop(t + dur + 0.05);
    return o;
  }

  drum(t, f0, f1, dur, vol) {
    const o = this.note('sine', f0, t, dur, vol);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  }

  noiseHit(t, type, freq, dur, vol) {
    const ctx = this.audio.ctx, src = ctx.createBufferSource();
    src.buffer = this.audio.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.bus);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  }

  schedule() {
    const ctx = this.audio.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const eighth = 60 / 92 / 2;
    while (this.nextBeat < ctx.currentTime + 0.15) {
      this.playEighth(this.nextBeat, this.beat);
      this.nextBeat += eighth;
      this.beat++;
    }
  }

  playEighth(t, b) {
    const I = this.intensity;
    if (b % 16 === 0) this.setChord(this.chord + (b > 0 ? 1 : 0), t);
    const notes = PROG[this.chord];
    if (I > 0.2 && b % 2 === 0) this.note('triangle', midiHz(notes[(b / 2) % 3] + 12), t, 0.28, 0.025 + 0.045 * I, 2400);
    if (I > 0.3 && b % 4 === 0) this.drum(t, 120, 42, 0.32, 0.18 + 0.35 * I);
    if (I > 0.55 && (b % 8 === 3 || b % 8 === 7)) { this.drum(t, 95, 60, 0.22, 0.2 * I); this.noiseHit(t, 'lowpass', 400, 0.18, 0.12 * I); }
    if (I > 0.7) this.noiseHit(t, 'highpass', 7000, 0.04, 0.035 * I);
  }

  // Каждый кадр: цель накала, напряжение
  update(dt, target, tension) {
    if (!this.on) return;
    this.intensity = lerp(this.intensity, target, 1 - Math.exp(-dt / 1.2));
    this.tension = lerp(this.tension, tension, 1 - Math.exp(-dt / 0.8));
    const t = this.audio.ctx.currentTime, I = this.intensity;
    this.padGain.gain.setTargetAtTime(0.05 + 0.035 * I, t, 0.3);
    this.padFilter.frequency.setTargetAtTime(450 + 2000 * I, t, 0.3);
    this.bassGain.gain.setTargetAtTime(0.06 + 0.1 * I, t, 0.3);
    this.tremGain.gain.setTargetAtTime(0.035 * this.tension, t, 0.3);
  }

  // Аккорд в конце раунда: мажор — победа, минор — поражение
  stinger(win) {
    if (!this.on) return;
    const t = this.audio.ctx.currentTime + 0.02;
    const base = 62, chord = win ? [0, 4, 7, 12] : [0, 3, 7, 10];
    for (const n of chord) { this.note('sawtooth', midiHz(base + n), t, 1.8, 0.05, 1800); this.note('sawtooth', midiHz(base + n) * 1.006, t, 1.8, 0.04, 1800); }
    this.drum(t, 80, 35, 0.9, 0.5);
  }
}
