import type { Audio } from './audio';

/**
 * In-vehicle radio (Phase 6): fictional stations from public/data/radio.json with a tuning dial.
 * Music is PLACEHOLDER: short loops synthesized live with Web Audio in five styles (no samples, no
 * commercial songs, no real stations). A track with a `src` plays that audio file instead, so licensed
 * music can be dropped in later through the data file. DJ links and adverts show as captions.
 */
export interface RadioTrack {
  title: string;
  artist: string;
  pattern: string;
  placeholder: boolean;
  src: string | null;
  /** For real recordings: who made it and under which licence (shown when it starts). */
  credit?: string | null;
  licence?: string | null;
}
export interface RadioStation {
  id: string;
  name: string;
  freq: string;
  host: string;
  tagline: string;
  links: string[];
  adverts: string[];
  tracks: RadioTrack[];
}

const STYLES: Record<string, { bpm: number }> = {
  afro: { bpm: 108 }, afro2: { bpm: 102 }, highlife: { bpm: 124 }, drums: { bpm: 98 }, logdrum: { bpm: 112 }, talk: { bpm: 70 },
};
// A minor / C major loop: A, F, C, G (roots in Hz) with chord tones.
const ROOTS = [110, 87.31, 130.81, 98];
const CHORDS = [[220, 261.6, 329.6], [174.6, 220, 261.6], [261.6, 329.6, 392], [196, 246.9, 293.7]];

export class Radio {
  stations: RadioStation[] = [];
  /** 0 = off, 1..n = station. */
  index = 1;
  active = false;
  track = 0;
  caption = '';
  captionTimer = 0;
  private talkTimer = 20;
  private trackTimer = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private step = 0;
  private nextTime = 0;
  private out: GainNode | null = null;
  private element: HTMLAudioElement | null = null;
  private noise: AudioBuffer | null = null;
  private turn = 0;

  constructor(private audio: Audio) {}

  async load(url: string): Promise<void> {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as { stations?: RadioStation[] };
      this.stations = (data.stations ?? []).filter((s) => s.name && Array.isArray(s.tracks) && s.tracks.length);
    } catch (err) {
      console.warn('Radio stations could not be loaded; the radio stays off.', err);
    }
  }

  get station(): RadioStation | null {
    return this.index > 0 ? this.stations[this.index - 1] ?? null : null;
  }

  get nowPlaying(): RadioTrack | null {
    const s = this.station;
    return s ? s.tracks[this.track % s.tracks.length] : null;
  }

  /** Short text for the HUD dial. */
  get label(): string {
    const s = this.station;
    if (!s) return 'Radio off';
    const t = this.nowPlaying!;
    return `${s.freq} ${s.name} · ${t.title}${t.placeholder ? ' (placeholder track)' : ''}`;
  }

  /** Turn the dial: +1 next station, -1 previous (wraps through "off"). */
  tune(delta: number): void {
    const n = this.stations.length + 1;
    this.index = (((this.index + delta) % n) + n) % n;
    this.track = 0;
    this.trackTimer = 0;
    this.talkTimer = 6;
    const t = this.nowPlaying;
    if (this.station) this.say(t && t.src && t.credit ? `${this.station.name} ${this.station.freq} · now playing "${t.title}" by ${t.credit}${t.licence ? ` (${t.licence})` : ''}` : `${this.station.name} ${this.station.freq}: ${this.station.tagline}`);
    this.restart();
  }

  /** On while you are in a vehicle. */
  setActive(on: boolean): void {
    if (on === this.active) return;
    this.active = on;
    this.restart();
  }

  private say(text: string): void {
    this.caption = text;
    this.captionTimer = 6;
  }

  update(dt: number): void {
    this.captionTimer = Math.max(0, this.captionTimer - dt);
    if (!this.active || !this.station) return;
    this.talkTimer -= dt;
    this.trackTimer += dt;
    if (this.talkTimer <= 0) {
      const s = this.station;
      this.turn++;
      const pool = this.turn % 3 === 0 ? s.adverts : s.links;
      const line = pool[Math.floor(Math.random() * pool.length)];
      if (line) this.say(this.turn % 3 === 0 ? `Advert (fictional): ${line}` : `${s.host}: ${line}`);
      this.talkTimer = 35 + Math.random() * 20;
      this.audio.sfx('greet', 0.4);
    }
    if (this.trackTimer > 90 && this.station.tracks.length > 1) {
      this.trackTimer = 0;
      this.track++;
      this.restart();
    }
  }

  // ---------- Sound ----------
  private stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.element) {
      this.element.pause();
      this.element = null;
    }
    if (this.out) {
      const ctx = this.audio.context;
      if (ctx) this.out.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
      const old = this.out;
      setTimeout(() => old.disconnect(), 400);
      this.out = null;
    }
  }

  private restart(): void {
    this.stop();
    const ctx = this.audio.context;
    const dest = this.audio.output;
    const t = this.nowPlaying;
    if (!this.active || !t || !ctx || !dest) return;
    this.out = ctx.createGain();
    this.out.gain.value = 0.32;
    this.out.connect(dest);
    if (t.src) {
      // Licensed music dropped in through the data file.
      this.element = new window.Audio(t.src);
      this.element.loop = true;
      ctx.createMediaElementSource(this.element).connect(this.out);
      void this.element.play().catch(() => undefined);
      return;
    }
    if (!this.noise) {
      this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    this.step = 0;
    this.nextTime = ctx.currentTime + 0.05;
    const style = STYLES[t.pattern] ?? STYLES.afro;
    const stepDur = 60 / style.bpm / 4;
    this.timer = setInterval(() => {
      while (this.out && this.nextTime < ctx.currentTime + 0.15) {
        this.play(t.pattern, this.step, this.nextTime, stepDur);
        this.step = (this.step + 1) % 64;
        this.nextTime += stepDur;
      }
    }, 30);
  }

  private env(t: number, peak: number, dur: number): GainNode {
    const ctx = this.audio.context!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(this.out!);
    return g;
  }

  private osc(type: OscillatorType, f0: number, f1: number, t: number, dur: number, peak: number, filter?: number): void {
    const ctx = this.audio.context!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.8);
    const g = this.env(t, peak, dur);
    if (filter) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = filter;
      o.connect(lp).connect(g);
    } else o.connect(g);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private hiss(t: number, dur: number, peak: number, hp: number): void {
    const ctx = this.audio.context!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = hp;
    src.connect(f).connect(this.env(t, peak, dur));
    src.start(t, Math.random() * 0.5, dur + 0.02);
  }

  /** One sixteenth-note step of a placeholder groove. */
  private play(pattern: string, step: number, t: number, sd: number): void {
    const s = step % 16, bar = Math.floor(step / 16) % 4;
    const root = ROOTS[bar], chord = CHORDS[bar];
    const kick = () => this.osc('sine', 130, 42, t, 0.22, 0.7);
    const clap = () => this.hiss(t, 0.12, 0.25, 1500);
    const hat = (p = 0.07) => this.hiss(t, 0.03, p, 7000);
    switch (pattern) {
      case 'afro':
      case 'afro2': {
        const kicks = pattern === 'afro' ? [0, 3, 8, 11] : [0, 6, 8, 14];
        if (kicks.includes(s)) kick();
        if (s === 4 || s === 12) clap();
        hat(s % 2 ? 0.04 : 0.08);
        if ([0, 3, 7, 10].includes(s)) this.osc('sawtooth', root, root, t, sd * 2, 0.22, 420);
        if ([2, 6, 10, 14].includes(s) && bar % 2 === 0) for (const f of chord) this.osc('square', f, f, t, sd * 0.9, 0.035, 1800);
        break;
      }
      case 'highlife': {
        // Bright guitar-like arpeggio over a bouncing bass.
        const tone = [chord[0], chord[1], chord[2], chord[1] * 2][s % 4] * (s >= 8 ? 2 : 1);
        this.osc('triangle', tone, tone, t, sd * 1.5, 0.12);
        if (s === 0 || s === 8) this.osc('sawtooth', root, root, t, sd * 3, 0.2, 380);
        if (s === 6 || s === 14) this.osc('sawtooth', root * 1.5, root * 1.5, t, sd * 2, 0.15, 380);
        if ([0, 3, 6, 10, 12].includes(s)) this.osc('square', 1600, 1600, t, 0.05, 0.03, 3000); // bell
        hat(0.03);
        break;
      }
      case 'drums': {
        // Talking-drum style pitch slides with a bell pattern.
        if ([0, 3, 6, 8, 11, 14].includes(s)) this.osc('sine', s % 2 ? 180 : 140, s % 2 ? 110 : 240, t, 0.25, 0.35);
        if (s === 0 || s === 8) kick();
        if ([0, 2, 5, 7, 9, 12, 14].includes(s)) this.osc('square', 2100, 2100, t, 0.04, 0.025, 4000);
        if (s % 4 === 2) this.hiss(t, 0.06, 0.05, 4000);
        break;
      }
      case 'logdrum': {
        if (s % 4 === 0) kick();
        this.hiss(t, 0.04, s % 2 ? 0.03 : 0.06, 5000);
        if ([3, 6, 10, 14].includes(s)) this.osc('sine', root * 2, root, t, 0.35, 0.45);
        if (s === 0) for (const f of chord) this.osc('sine', f, f, t, sd * 15, 0.04);
        break;
      }
      default: {
        // Talk bed: soft chords under the presenters.
        if (s === 0 && bar % 2 === 0) for (const f of chord) this.osc('sine', f, f, t, sd * 30, 0.025);
      }
    }
  }
}
