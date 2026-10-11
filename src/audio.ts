/**
 * Synthesized sound (Web Audio), plus optional recorded samples listed in public/data/sounds.json
 * (openly licensed files with their credit). When a sample is missing the synth version plays.
 * "Lagos Boys" must not be added until it is licensed.
 */
export interface SoundDef {
  src: string | null;
  credit?: string | null;
  licence?: string | null;
  /** Seconds [start, end] of a steady part to loop while the sound is held (the horn). */
  loop?: [number, number];
}
export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private volume = 0.7;
  private gain = 1;
  /** Recorded samples (decoded once sound has started) and their definitions. */
  private defs: Record<string, SoundDef> = {};
  private buffers = new Map<string, AudioBuffer>();
  /** The horn while H is held. */
  private hornNodes: { stop: (t: number) => void } | null = null;

  /** Read the list of recorded samples (sounds.json). Missing or unreadable files fall back to synth. */
  async loadSounds(url: string): Promise<void> {
    try {
      const r = await fetch(url);
      if (!r.ok) return;
      const data = (await r.json()) as { sounds?: Record<string, SoundDef> };
      this.defs = data.sounds ?? {};
      this.decodeAll();
    } catch {
      /* keep the synthesized sounds */
    }
  }

  private decodeAll(): void {
    if (!this.ctx) return;
    const base = new URL('.', location.href);
    for (const [name, d] of Object.entries(this.defs)) {
      if (!d.src || this.buffers.has(name)) continue;
      fetch(new URL(d.src, base))
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((b) => this.ctx!.decodeAudioData(b))
        .then((buf) => this.buffers.set(name, buf))
        .catch((err) => console.warn(`Sound ${name} could not be loaded; using the synth version.`, err));
    }
  }

  /** Is a recorded sample loaded for this sound? */
  hasSample(name: string): boolean {
    return this.buffers.has(name);
  }

  private playSample(name: string, vol: number, loop = false): { src: AudioBufferSourceNode; gain: GainNode } | null {
    const buf = this.buffers.get(name);
    if (!buf || !this.ctx || !this.master) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const region = this.defs[name]?.loop;
    if (loop && region) {
      // Loop only the steady middle of the recording; the attack plays once at the start.
      src.loop = true;
      src.loopStart = region[0];
      src.loopEnd = Math.min(region[1], buf.duration);
    }
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(g).connect(this.master);
    src.start();
    return { src, gain: g };
  }

  /**
   * Hold the horn: a recorded horn when one is listed in sounds.json, otherwise a synthesized
   * car horn (two detuned horn notes a major third apart through a brassy resonance).
   */
  horn(on: boolean): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    if (!on) {
      this.hornNodes?.stop(t);
      this.hornNodes = null;
      return;
    }
    if (this.hornNodes) return;
    const sample = this.playSample('horn', 0.9, true);
    if (sample) {
      this.hornNodes = {
        stop: (at: number) => {
          sample.gain.gain.setTargetAtTime(0, at, 0.02);
          sample.src.stop(at + 0.12);
        },
      };
      return;
    }
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.22, t + 0.015);
    // Brassy body: band-pass round the horn's resonance, a presence peak, gentle clipping.
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1150;
    bp.Q.value = 0.9;
    const peak = ctx.createBiquadFilter();
    peak.type = 'peaking';
    peak.frequency.value = 2600;
    peak.gain.value = 6;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * 2 - 1;
      curve[i] = Math.tanh(x * 2.2);
    }
    shaper.curve = curve;
    const oscs: OscillatorNode[] = [];
    for (const [f, type, g] of [[415, 'sawtooth', 0.5], [419, 'square', 0.18], [522, 'sawtooth', 0.42], [526, 'square', 0.15]] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = g;
      o.connect(og).connect(shaper);
      o.start(t);
      oscs.push(o);
    }
    shaper.connect(bp).connect(peak).connect(out).connect(this.master);
    this.hornNodes = {
      stop: (at: number) => {
        out.gain.cancelScheduledValues(at);
        out.gain.setValueAtTime(out.gain.value, at);
        out.gain.exponentialRampToValueAtTime(0.0001, at + 0.06);
        for (const o of oscs) o.stop(at + 0.08);
      },
    };
  }

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
      this.decodeAll();
    } catch {
      this.ctx = null;
    }
  }

  /** The audio context once sound has started (null before the first click or key). */
  get context(): AudioContext | null {
    return this.ctx;
  }

  /** Where music (the radio) connects: the master volume. */
  get output(): GainNode | null {
    return this.master;
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

  /** Short burst of filtered noise (gunshots, impacts). */
  private noise(dur: number, vol: number, freq: number, delay = 0): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.value = vol * this.gain;
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
  }

  private tone(freq: number, dur: number, vol: number, type: OscillatorType = 'sine', delay = 0, slideTo?: number): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(Math.max(0.0011, vol * this.gain), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** gain scales the sound (e.g. by distance for other drivers' horns). */
  sfx(kind: 'checkpoint' | 'count' | 'go' | 'win' | 'fail' | 'door' | 'greet' | 'crash' | 'horn' | 'horn2' | 'cash' | 'pickup' | 'repair' | 'shot' | 'shot2' | 'swing' | 'empty' | 'reload' | 'hit' | 'hurt' | 'siren', gain = 1): void {
    this.gain = gain;
    switch (kind) {
      case 'checkpoint': this.tone(660, 0.12, 0.22); this.tone(990, 0.2, 0.22, 'sine', 0.1); break;
      case 'count': this.tone(520, 0.15, 0.2, 'square'); break;
      case 'go': this.tone(880, 0.35, 0.22, 'square'); break;
      case 'win': [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.25, 0.18, 'square', i * 0.11)); break;
      case 'fail': this.tone(330, 0.45, 0.2, 'sawtooth', 0, 110); break;
      case 'door': this.tone(180, 0.07, 0.2, 'square', 0, 90); break;
      case 'greet': this.tone(740, 0.08, 0.12); this.tone(880, 0.1, 0.1, 'sine', 0.08); break;
      case 'crash': this.tone(90, 0.2, 0.3, 'square', 0, 40); break;
      case 'horn':
        if (!this.hornNodes) {
          this.horn(true);
          const ctx = this.ctx;
          if (ctx) setTimeout(() => this.horn(false), 350);
        }
        break;
      case 'horn2': this.tone(340, 0.22, 0.12, 'square'); this.tone(340, 0.22, 0.12, 'square', 0.3); break;
      case 'cash': this.tone(1320, 0.07, 0.14, 'square'); this.tone(1760, 0.12, 0.12, 'square', 0.07); break;
      case 'pickup': this.tone(440, 0.1, 0.16, 'triangle'); this.tone(660, 0.14, 0.16, 'triangle', 0.08); break;
      case 'repair': [300, 360, 300, 420].forEach((f, i) => this.tone(f, 0.06, 0.14, 'square', i * 0.09)); break;
      case 'shot': this.noise(0.18, 0.5, 2400); this.tone(140, 0.12, 0.25, 'square', 0, 50); break;
      case 'shot2': this.noise(0.16, 0.3, 1500); break;
      case 'swing': this.noise(0.12, 0.15, 900); break;
      case 'empty': this.tone(1800, 0.03, 0.12, 'square'); break;
      case 'reload': this.tone(600, 0.05, 0.12, 'square'); this.tone(420, 0.06, 0.12, 'square', 0.12); break;
      case 'hit': this.tone(1200, 0.05, 0.15, 'triangle'); break;
      case 'hurt': this.tone(220, 0.15, 0.2, 'sawtooth', 0, 140); break;
      case 'siren': this.tone(700, 0.35, 0.08, 'square', 0, 950); this.tone(950, 0.35, 0.08, 'square', 0.35, 700); break;
    }
  }
}
