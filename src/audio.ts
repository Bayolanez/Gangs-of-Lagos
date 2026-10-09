/**
 * Original synthesized sound only (Web Audio). No music ships in this milestone: the station
 * selector and any licensed tracks come later. "Lagos Boys" must not be added until it is licensed.
 */
export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private volume = 0.7;

  /** Must be called from a user gesture. */
  start(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const ctx = new AudioContext();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(ctx.destination);
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 380;
      const g = ctx.createGain();
      g.gain.value = 0;
      osc.connect(filter).connect(g).connect(this.master);
      osc.start();
      this.engineOsc = osc;
      this.engineGain = g;
    } catch {
      this.ctx = null;
    }
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  /** speed in m/s; null when not driving. */
  engine(speed: number | null, throttle: number): void {
    if (!this.ctx || !this.engineOsc || !this.engineGain) return;
    const t = this.ctx.currentTime;
    if (speed === null) {
      this.engineGain.gain.setTargetAtTime(0, t, 0.1);
      return;
    }
    this.engineOsc.frequency.setTargetAtTime(42 + Math.abs(speed) * 4.2 + Math.abs(throttle) * 12, t, 0.08);
    this.engineGain.gain.setTargetAtTime(0.05 + Math.abs(throttle) * 0.025, t, 0.1);
  }

  private tone(freq: number, dur: number, vol: number, type: OscillatorType = 'sine', delay = 0, slideTo?: number): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  sfx(kind: 'checkpoint' | 'count' | 'go' | 'win' | 'fail' | 'door' | 'greet' | 'crash' | 'horn'): void {
    switch (kind) {
      case 'checkpoint': this.tone(660, 0.12, 0.22); this.tone(990, 0.2, 0.22, 'sine', 0.1); break;
      case 'count': this.tone(520, 0.15, 0.2, 'square'); break;
      case 'go': this.tone(880, 0.35, 0.22, 'square'); break;
      case 'win': [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.25, 0.18, 'square', i * 0.11)); break;
      case 'fail': this.tone(330, 0.45, 0.2, 'sawtooth', 0, 110); break;
      case 'door': this.tone(180, 0.07, 0.2, 'square', 0, 90); break;
      case 'greet': this.tone(740, 0.08, 0.12); this.tone(880, 0.1, 0.1, 'sine', 0.08); break;
      case 'crash': this.tone(90, 0.2, 0.3, 'square', 0, 40); break;
      case 'horn': this.tone(400, 0.3, 0.14, 'square'); this.tone(505, 0.3, 0.12, 'square'); break;
    }
  }
}
