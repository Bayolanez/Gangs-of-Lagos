import type { Audio } from './audio';

/**
 * Afterglow's own music: an original groove made in code with Web Audio (no recordings). 112 BPM,
 * four on the floor with an off-beat kick, claps on two and four, a shaker, a log-drum bass line and
 * warm chord stabs over a four-bar loop (Am7, Dm7, Fmaj7, Em7). Full and bright inside the club;
 * outside you hear it muffled near the door, fading with distance. Nothing plays when you're far away.
 */
const BPM = 112;
const STEP = 60 / BPM / 4; // 16th notes
// Roots and chords per bar (Hz): A2, D3, F2, E2 and their seventh chords an octave up.
const ROOTS = [110, 146.83, 87.31, 82.41];
const CHORDS = [
  [220, 261.63, 329.63, 392],
  [293.66, 349.23, 440, 523.25],
  [174.61, 220, 261.63, 329.63],
  [164.81, 196, 246.94, 293.66],
];
const KICK = [0, 4, 8, 10, 12];
const CLAP = [4, 12];
const BASS: [number, number][] = [[0, 1], [3, 1.5], [6, 1], [10, 2], [11, 1.5], [14, 1.5]];
const STABS = [2, 7, 10];

export class ClubMusic {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private next = 0;
  private step = 0;
  private started = 0;
  private noise: AudioBuffer | null = null;
  /** Current level (0 silent .. 1 inside), for tests. */
  level = 0;

  constructor(private audio: Audio) {}

  /** Seconds of music since it started (the club's lights follow it). */
  get time(): number {
    return this.ctx && this.timer ? this.ctx.currentTime - this.started : 0;
  }

  get playing(): boolean {
    return this.timer !== null;
  }

  /** inside: in the club; dist: metres from the club door when outside. */
  update(inside: boolean, dist: number): void {
    const want = inside ? 1 : dist < 45 ? 0.45 * (1 - dist / 45) : 0;
    this.level = want;
    if (want > 0 && !this.timer) this.start();
    if (!this.ctx || !this.out || !this.filter) return;
    const t = this.ctx.currentTime;
    this.out.gain.setTargetAtTime(want * 0.5, t, 0.25);
    this.filter.frequency.setTargetAtTime(inside ? 16000 : 420, t, 0.2);
    if (want === 0 && this.timer && this.out.gain.value < 0.005) this.stop();
  }

  private start(): void {
    const ctx = this.audio.context, dest = this.audio.output;
    if (!ctx || !dest) return;
    this.ctx = ctx;
    if (!this.out) {
      this.filter = ctx.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.filter.frequency.value = 420;
      this.out = ctx.createGain();
      this.out.gain.value = 0;
      this.filter.connect(this.out).connect(dest);
      const len = ctx.sampleRate * 0.5;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      let seed = 9;
      for (let i = 0; i < len; i++) d[i] = ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    }
    this.started = ctx.currentTime + 0.05;
    this.next = this.started;
    this.step = 0;
    this.timer = setInterval(() => this.schedule(), 25);
  }

  private stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    const ctx = this.ctx!;
    while (this.next < ctx.currentTime + 0.12) {
      this.play(this.step, this.next);
      this.next += STEP;
      this.step = (this.step + 1) % 64;
    }
  }

  private play(step: number, t: number): void {
    const s = step % 16, bar = Math.floor(step / 16);
    if (KICK.includes(s)) this.kick(t, s === 10 ? 0.55 : 1);
    if (CLAP.includes(s)) this.clap(t);
    this.shaker(t, s % 2 ? 0.07 : 0.035);
    for (const [at, len] of BASS) if (at === s) this.bass(ROOTS[bar], t, len * STEP * 1.6);
    if (STABS.includes(s)) this.stab(CHORDS[bar], t);
  }

  private env(t: number, peak: number, dur: number): GainNode {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(this.filter!);
    return g;
  }

  private kick(t: number, k: number): void {
    const o = this.ctx!.createOscillator();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    o.connect(this.env(t, 0.9 * k, 0.28));
    o.start(t);
    o.stop(t + 0.3);
  }

  private hiss(t: number, dur: number, peak: number, hp: number): void {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx!.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = hp;
    src.connect(f).connect(this.env(t, peak, dur));
    src.start(t, Math.random() * 0.3);
    src.stop(t + dur + 0.02);
  }

  private clap(t: number): void {
    for (const d of [0, 0.012, 0.024]) this.hiss(t + d, 0.14, 0.32, 900);
  }

  private shaker(t: number, peak: number): void {
    this.hiss(t, 0.05, peak, 6000);
  }

  /** Log-drum style bass: a sine that drops in pitch, a little grit on top. */
  private bass(f: number, t: number, dur: number): void {
    const o = this.ctx!.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f * 2.02, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
    o.connect(this.env(t, 0.55, dur));
    o.start(t);
    o.stop(t + dur + 0.05);
    const o2 = this.ctx!.createOscillator();
    o2.type = 'triangle';
    o2.frequency.setValueAtTime(f * 2, t);
    o2.connect(this.env(t, 0.12, dur * 0.6));
    o2.start(t);
    o2.stop(t + dur);
  }

  private stab(chord: number[], t: number): void {
    const lp = this.ctx!.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2400, t);
    lp.frequency.exponentialRampToValueAtTime(500, t + 0.25);
    lp.connect(this.env(t, 0.16, 0.32));
    for (const f of chord) {
      const o = this.ctx!.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = (Math.random() - 0.5) * 12;
      o.connect(lp);
      o.start(t);
      o.stop(t + 0.34);
    }
  }
}
