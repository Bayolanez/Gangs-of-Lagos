import * as THREE from 'three';
import { FACADE_NIGHT } from './look';
import { STYLE } from './visual';

/**
 * Time of day and weather, following Lagos.
 *
 * Time: by default the real time in Lagos (West Africa Time, UTC+1, no daylight saving) from this
 * device's clock. The sun is placed with the real solar geometry for Lagos (latitude 6.45 N, longitude
 * 3.39 E) on today's date, so sunrise, noon and sunset happen when they do in the city. Settings can
 * switch to a fast cycle (a game day in 24 minutes) or hold day, dusk or night.
 *
 * Weather: by default the current conditions in Lagos from Open-Meteo (open data, no key), refreshed
 * every 15 minutes. If that can't be reached (offline, or a host that blocks outside requests) it
 * falls back to an estimate from Lagos' climate for today's date and hour: the rainy seasons (April to
 * July and September to October) with afternoon and evening storms, the August break, and harmattan
 * haze from December to February. The HUD says which one you are seeing.
 *
 * Everything visual follows from those two inputs: sun and moon light, sky colours, stars, clouds,
 * fog, lit windows after dark, rain, lightning and haze.
 */
export type TimeMode = 'live' | 'fast' | 'day' | 'dusk' | 'night';
export type WeatherMode = 'live' | 'clear' | 'cloudy' | 'rain' | 'storm' | 'haze';
export type WeatherKind = 'clear' | 'partly' | 'cloudy' | 'rain' | 'storm' | 'haze' | 'fog';

export interface Weather {
  kind: WeatherKind;
  /** 0 to 1 */
  cloud: number;
  rain: number;
  haze: number;
  tempC: number;
  windMs: number;
  source: 'live' | 'estimate' | 'fixed';
  label: string;
}

export const LAGOS = { lat: 6.4541, lon: 3.3947, utcOffset: 1 };
const WEATHER_URL = `https://api.open-meteo.com/v1/forecast?latitude=${LAGOS.lat}&longitude=${LAGOS.lon}&current=temperature_2m,weather_code,cloud_cover,precipitation,wind_speed_10m,visibility&wind_speed_unit=ms&timezone=Africa%2FLagos`;
const TKEY = 'gangs-of-lagos/time', WKEY = 'gangs-of-lagos/weather';
const TIME_MODES: TimeMode[] = ['live', 'fast', 'day', 'dusk', 'night'];
const WEATHER_MODES: WeatherMode[] = ['live', 'clear', 'cloudy', 'rain', 'storm', 'haze'];

function stored<T extends string>(key: string, allowed: T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    if (v && allowed.includes(v)) return v;
  } catch {
    /* storage blocked */
  }
  return fallback;
}
function store(key: string, v: string): void {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* storage blocked */
  }
}

// ---------- Sun ----------
/** Lagos local time (hours, 0 to 24) for a moment. */
export function lagosHours(d: Date): number {
  return (((d.getUTCHours() + LAGOS.utcOffset + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600) % 24) + 24) % 24;
}

/** Sun elevation and azimuth (degrees; azimuth clockwise from north) over Lagos at local time `hours` on `date`. */
export function sunPosition(date: Date, hours: number): { elevation: number; azimuth: number } {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const n = Math.floor((date.getTime() - start) / 86400000);
  const rad = Math.PI / 180;
  const decl = 23.44 * Math.sin(((2 * Math.PI) / 365) * (284 + n)) * rad;
  const b = ((2 * Math.PI) / 364) * (n - 81);
  const eot = 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b); // minutes
  const solar = hours + (4 * (LAGOS.lon - 15 * LAGOS.utcOffset) + eot) / 60;
  const ha = (solar - 12) * 15 * rad;
  const lat = LAGOS.lat * rad;
  const sinEl = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
  const el = Math.asin(sinEl);
  const az = Math.atan2(-Math.cos(decl) * Math.sin(ha), Math.sin(decl) * Math.cos(lat) - Math.cos(decl) * Math.cos(ha) * Math.sin(lat));
  return { elevation: el / rad, azimuth: ((az / rad) + 360) % 360 };
}

/** Direction towards a sky position in game coordinates (x east, y up, z south). */
function skyDir(elevation: number, azimuth: number, out: THREE.Vector3): THREE.Vector3 {
  const e = (elevation * Math.PI) / 180, a = (azimuth * Math.PI) / 180;
  return out.set(Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a)).normalize();
}

// ---------- Weather ----------
/** WMO weather code (as Open-Meteo reports it) to the game's weather. */
export function fromWeatherCode(code: number, cloudPct: number, precipMm: number, visibilityM: number | null): Pick<Weather, 'kind' | 'cloud' | 'rain' | 'haze' | 'label'> {
  const cloud = Math.min(1, Math.max(0, cloudPct / 100));
  if (code >= 95) return { kind: 'storm', cloud: 1, rain: 1, haze: 0, label: 'Thunderstorm' };
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) {
    const heavy = code === 65 || code === 82 || code === 67 || precipMm > 4;
    const light = code === 51 || code === 61 || code === 80 || code === 53;
    return { kind: 'rain', cloud: Math.max(cloud, 0.85), rain: heavy ? 1 : light ? 0.45 : 0.75, haze: 0, label: heavy ? 'Heavy rain' : light ? 'Light rain' : 'Rain' };
  }
  if (code === 45 || code === 48) return { kind: 'fog', cloud: Math.max(cloud, 0.6), rain: 0, haze: 0.8, label: 'Fog' };
  if (visibilityM !== null && visibilityM < 5000) return { kind: 'haze', cloud, rain: 0, haze: Math.min(1, (5000 - visibilityM) / 4000 + 0.4), label: 'Hazy' };
  if (code === 3 || cloud > 0.8) return { kind: 'cloudy', cloud: Math.max(cloud, 0.85), rain: 0, haze: 0, label: 'Overcast' };
  if (code === 1 || code === 2 || cloud > 0.3) return { kind: 'partly', cloud: Math.max(cloud, 0.4), rain: 0, haze: 0, label: 'Partly cloudy' };
  return { kind: 'clear', cloud, rain: 0, haze: 0, label: 'Clear' };
}

const RAIN_CHANCE = [0.04, 0.07, 0.15, 0.3, 0.42, 0.55, 0.45, 0.25, 0.42, 0.38, 0.15, 0.05];
const HIGH_C = [32, 33, 33, 32, 31, 29, 28, 28, 29, 30, 31, 32];
const LOW_C = [23, 25, 25, 25, 24, 23, 23, 23, 23, 23, 24, 23];
function hash(n: number): number {
  const v = Math.sin(n * 12.9898) * 43758.5453;
  return v - Math.floor(v);
}

/** Lagos weather estimated from the climate for this date and hour (used when live data can't be fetched). */
export function estimateWeather(date: Date, hours: number): Weather {
  const m = new Date(date.getTime() + LAGOS.utcOffset * 3600000).getUTCMonth();
  const day = Math.floor(date.getTime() / 86400000);
  const block = Math.floor(hours / 3);
  const r = hash(day * 8 + block), r2 = hash(day * 13 + block * 7 + 1);
  // Rain and storms come mostly in the afternoon and evening.
  const afternoon = hours >= 13 && hours < 21 ? 1.5 : hours >= 21 || hours < 6 ? 0.8 : 0.6;
  const rainy = r < RAIN_CHANCE[m] * afternoon;
  const harmattan = m === 11 || m <= 1;
  const tempC = Math.round(LOW_C[m] + (HIGH_C[m] - LOW_C[m]) * Math.max(0, Math.sin(((hours - 7) / 14) * Math.PI)) - (rainy ? 2 : 0));
  const base = { tempC, windMs: 2 + r2 * 4, source: 'estimate' as const };
  if (rainy) return r2 < 0.3 ? { ...base, kind: 'storm', cloud: 1, rain: 1, haze: 0, label: 'Thunderstorm' } : { ...base, kind: 'rain', cloud: 0.9, rain: 0.5 + r2 * 0.4, haze: 0, label: 'Rain' };
  if (harmattan && r2 < 0.6) return { ...base, kind: 'haze', cloud: 0.2, rain: 0, haze: 0.55 + r2 * 0.4, label: 'Harmattan haze' };
  const wet = RAIN_CHANCE[m] > 0.3;
  const cloud = Math.min(1, r2 * (wet ? 1.1 : 0.7));
  if (cloud > 0.75) return { ...base, kind: 'cloudy', cloud, rain: 0, haze: 0, label: 'Overcast' };
  if (cloud > 0.35) return { ...base, kind: 'partly', cloud, rain: 0, haze: 0, label: 'Partly cloudy' };
  return { ...base, kind: 'clear', cloud, rain: 0, haze: 0, label: 'Clear' };
}

const FIXED: Record<Exclude<WeatherMode, 'live'>, Pick<Weather, 'kind' | 'cloud' | 'rain' | 'haze' | 'label'>> = {
  clear: { kind: 'clear', cloud: 0.1, rain: 0, haze: 0, label: 'Clear' },
  cloudy: { kind: 'cloudy', cloud: 0.9, rain: 0, haze: 0, label: 'Overcast' },
  rain: { kind: 'rain', cloud: 0.9, rain: 0.7, haze: 0, label: 'Rain' },
  storm: { kind: 'storm', cloud: 1, rain: 1, haze: 0, label: 'Thunderstorm' },
  haze: { kind: 'haze', cloud: 0.2, rain: 0, haze: 0.85, label: 'Harmattan haze' },
};

// ---------- Light and sky by sun height ----------
interface Key {
  el: number;
  zenith: string; indigo: string; magenta: string; coral: string; horizon: string; haze: string;
  sun: string; sunI: number; sky: string; ground: string; hemiI: number; stars: number; disc: string;
  cloudLow: string; cloudSun: string;
}
const KEYS: Key[] = [
  { el: -12, zenith: '#0e1a3c', indigo: '#182756', magenta: '#223266', coral: '#2c3d72', horizon: '#3d4d86', haze: '#2a3558', sun: '#b4c6f4', sunI: 1.35, sky: '#8299d8', ground: '#4c4a6a', hemiI: 2.5, stars: 1, disc: '#dfe6ff', cloudLow: '#2a3150', cloudSun: '#3a4468' },
  { el: -4, zenith: '#16255a', indigo: '#2a2c6c', magenta: '#73407f', coral: '#cf6878', horizon: '#f29a6c', haze: '#7d5876', sun: '#ff9a6a', sunI: 0.95, sky: '#7a8ac8', ground: '#544470', hemiI: 2.1, stars: 0.35, disc: '#ffd0a0', cloudLow: '#e07a90', cloudSun: '#f6b27a' },
  { el: 7, zenith: '#123a5a', indigo: '#2d2f72', magenta: '#b8468f', coral: '#f06f7c', horizon: '#ffb072', haze: '#e58f86', sun: '#ffbe86', sunI: 2.4, sky: '#7f9fe0', ground: '#5b3a68', hemiI: 1.6, stars: 0, disc: '#ffe2a8', cloudLow: '#ff85a8', cloudSun: '#ffcc8c' },
  { el: 22, zenith: '#86b6e6', indigo: '#a9cbee', magenta: '#cfe1f5', coral: '#e8eef8', horizon: '#f6f2ee', haze: '#e4e9f2', sun: '#fff4e6', sunI: 2.6, sky: '#e4ecff', ground: '#d2c9de', hemiI: 1.55, stars: 0, disc: '#fff6e0', cloudLow: '#ffffff', cloudSun: '#fffaf0' },
];


const tmpA = new THREE.Color(), tmpB = new THREE.Color();
function mixHex(a: string, b: string, t: number, out: THREE.Color): THREE.Color {
  return out.copy(tmpA.set(a)).lerp(tmpB.set(b), t);
}

export interface EnvTargets {
  sky: Record<string, THREE.IUniform>;
  sun: THREE.DirectionalLight;
  sunDir: THREE.Vector3;
  hemi: THREE.HemisphereLight;
  fog: THREE.Fog;
  renderer: THREE.WebGLRenderer;
  /** Base fog distances (clear daylight). */
  fogNear: number;
  fogFar: number;
}

export class Environment {
  timeMode: TimeMode = stored(TKEY, TIME_MODES, 'live');
  weatherMode: WeatherMode = stored(WKEY, WEATHER_MODES, 'live');
  /** Lagos local time, hours 0 to 24. */
  hours = 18.5;
  elevation = 10;
  azimuth = 270;
  /** 0 in daylight to 1 at night. */
  night = 0;
  /** What the weather is heading to, and what is shown now (eased over a few seconds). */
  weather: Weather = { ...FIXED.clear, tempC: 30, windMs: 3, source: 'estimate' };
  shown = { cloud: 0, rain: 0, haze: 0 };
  /** Last live fetch: when, and why it failed (for the HUD and tests). */
  lastFetch: { at: number; ok: boolean; error?: string } | null = null;
  /** Fog distances this frame (before aircraft altitude widens them). */
  fogNear = 150;
  fogFar = 700;
  private fastHours = 7;
  /** Under a roof: no rain streaks drawn. */
  indoors = false;
  /** Sleeping: on the fast clock, wake at this hour (live Lagos time keeps real time). Returns true if it moved. */
  wakeAt(hour: number): boolean {
    if (this.timeMode !== 'fast') return false;
    this.fastHours = this.hours = hour;
    return true;
  }
  private fetchTimer = 0;
  private flash = 0;
  /** Lightning strikes so far (tests). */
  lightning = 0;
  private flashWait = 6;
  private rain: THREE.LineSegments;
  private rainPos: Float32Array;
  private readonly N = 2200;
  private thunder: (() => void) | null = null;
  /** Bumps when the light changes enough to redo the sky reflections. */
  envVersion = 0;
  private envKey = '';
  private date = new Date();
  /** Live weather requests are skipped in automated tests (?debug) unless ?liveweather is added. */
  liveAllowed = true;

  constructor(scene: THREE.Scene, private t: EnvTargets) {
    this.rainPos = new Float32Array(this.N * 6);
    for (let i = 0; i < this.N; i++) this.seedDrop(i, Math.random() * 30);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
    this.rain = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#c9d6ea', transparent: true, opacity: 0.5, depthWrite: false }));
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.rain.name = 'rain';
    scene.add(this.rain);
    this.applyWeatherMode();
  }

  /** Sound for lightning (wired to the game's audio). */
  onThunder(fn: () => void): void {
    this.thunder = fn;
  }

  setTimeMode(m: TimeMode): void {
    this.timeMode = m;
    store(TKEY, m);
    if (m === 'fast') this.fastHours = this.hours;
  }

  setWeatherMode(m: WeatherMode): void {
    this.weatherMode = m;
    store(WKEY, m);
    this.applyWeatherMode();
  }

  private applyWeatherMode(): void {
    if (this.weatherMode === 'live') {
      this.weather = estimateWeather(new Date(), lagosHours(new Date()));
      this.fetchTimer = 0; // fetch soon
    } else this.weather = { ...FIXED[this.weatherMode], tempC: this.weather.tempC, windMs: this.weather.windMs, source: 'fixed' };
  }

  /** Take an Open-Meteo "current" response (live Lagos weather). */
  applyLive(json: { current?: { temperature_2m?: number; weather_code?: number; cloud_cover?: number; precipitation?: number; wind_speed_10m?: number; visibility?: number } }): boolean {
    const c = json.current;
    if (!c || typeof c.weather_code !== 'number') return false;
    const w = fromWeatherCode(c.weather_code, c.cloud_cover ?? 0, c.precipitation ?? 0, typeof c.visibility === 'number' ? c.visibility : null);
    this.weather = { ...w, tempC: Math.round(c.temperature_2m ?? this.weather.tempC), windMs: c.wind_speed_10m ?? 3, source: 'live' };
    return true;
  }

  /** Fetch the current Lagos weather (falls back to the climate estimate). */
  async fetchLive(): Promise<boolean> {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 7000);
      const r = await fetch(WEATHER_URL, { signal: ctl.signal });
      clearTimeout(timer);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const ok = this.weatherMode === 'live' && this.applyLive(await r.json());
      this.lastFetch = { at: Date.now(), ok };
      return ok;
    } catch (e) {
      this.lastFetch = { at: Date.now(), ok: false, error: String((e as Error)?.message ?? e) };
      if (this.weatherMode === 'live') this.weather = estimateWeather(new Date(), lagosHours(new Date()));
      return false;
    }
  }

  /** Text for the HUD: time and weather. */
  get clockText(): string {
    const m = Math.floor(this.hours * 60) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }
  get weatherText(): string {
    const w = this.weather;
    const src = w.source === 'live' ? 'live' : w.source === 'estimate' ? 'estimated' : 'set in Settings';
    const time = this.timeMode === 'live' ? 'Lagos time' : this.timeMode === 'fast' ? 'fast time' : `always ${this.timeMode}`;
    return `${w.label} · ${w.tempC}°C · ${time} · weather ${src}`;
  }

  private seedDrop(i: number, y?: number): void {
    const o = i * 6;
    const x = (Math.random() - 0.5) * 70, z = (Math.random() - 0.5) * 70, h = y ?? 30;
    this.rainPos[o] = x;
    this.rainPos[o + 1] = h;
    this.rainPos[o + 2] = z;
    this.rainPos[o + 3] = x + 0.12;
    this.rainPos[o + 4] = h - 0.9;
    this.rainPos[o + 5] = z;
  }

  update(dt: number, camPos: THREE.Vector3): void {
    // ---- Time
    this.date = new Date();
    if (this.timeMode === 'live') this.hours = lagosHours(this.date);
    else if (this.timeMode === 'fast') this.hours = this.fastHours = (this.fastHours + dt / 60) % 24; // a game minute per real second
    else this.hours = this.timeMode === 'day' ? 13 : this.timeMode === 'dusk' ? 18.55 : 22.5;
    const sp = sunPosition(this.date, this.hours);
    this.elevation = sp.elevation;
    this.azimuth = sp.azimuth;

    // ---- Weather: refresh live data every 15 minutes; ease the visible amounts.
    if (this.weatherMode === 'live' && this.liveAllowed) {
      this.fetchTimer -= dt;
      if (this.fetchTimer <= 0) {
        this.fetchTimer = 900;
        void this.fetchLive();
      }
    }
    const k = Math.min(1, dt * 0.5);
    for (const key of ['cloud', 'rain', 'haze'] as const) this.shown[key] += (this.weather[key] - this.shown[key]) * k;
    const { cloud, rain, haze } = this.shown;

    // ---- Sky and light from the sun's height, blended between keys.
    const el = this.elevation;
    let i = 0;
    while (i < KEYS.length - 2 && el > KEYS[i + 1].el) i++;
    const a = KEYS[i], b = KEYS[i + 1];
    const u = THREE.MathUtils.clamp((el - a.el) / (b.el - a.el), 0, 1);
    const s = this.t.sky;
    for (const name of ['zenith', 'indigo', 'magenta', 'coral', 'horizon'] as const) mixHex(a[name], b[name], u, s[name].value as THREE.Color);
    mixHex(a.cloudLow, b.cloudLow, u, s.cloudLow.value as THREE.Color);
    mixHex(a.cloudSun, b.cloudSun, u, s.cloudSun.value as THREE.Color);
    const disc = mixHex(a.disc, b.disc, u, s.discCol.value as THREE.Color);
    disc.multiplyScalar(1.25);
    this.night = 1 - THREE.MathUtils.smoothstep(el, -8, 2);
    s.stars.value = THREE.MathUtils.lerp(a.stars, b.stars, u);
    s.cover.value = cloud;
    s.overcast.value = Math.max(cloud - 0.45, 0) * 1.5 * (1 - haze * 0.5) + haze * 0.55;
    const day = 1 - this.night;
    const greyL = 0.12 + 0.5 * day;
    (s.overcastCol.value as THREE.Color).setRGB(greyL * (1 + haze * 0.35), greyL * (1 + haze * 0.18), greyL * (1.06 - haze * 0.15));
    s.sunGlow.value = (STYLE === 'clean' ? 0.15 : 0.45) * (1 - cloud * 0.8);

    // Light: the sun by day, a dim blue moon at night (the moon rides opposite the sun, up high).
    const lightEl = el > -3 ? Math.max(el, 4) : 55;
    const lightAz = el > -3 ? this.azimuth : (this.azimuth + 180) % 360;
    skyDir(lightEl, lightAz, this.t.sunDir);
    if (el > -3) (s.sun.value as THREE.Vector3).copy(this.t.sunDir);
    else skyDir(Math.max(el, -30), this.azimuth, s.sun.value as THREE.Vector3);
    mixHex(a.sun, b.sun, u, this.t.sun.color);
    this.t.sun.intensity = THREE.MathUtils.lerp(a.sunI, b.sunI, u) * (1 - cloud * 0.7) * (1 - haze * 0.4) * (1 - rain * 0.2);
    mixHex(a.sky, b.sky, u, this.t.hemi.color);
    mixHex(a.ground, b.ground, u, this.t.hemi.groundColor);
    const hemiBase = THREE.MathUtils.lerp(a.hemiI, b.hemiI, u) * (1 + cloud * 0.15);

    // Fog: weather pulls it in (rain greys it, harmattan turns it dusty).
    const fogC = mixHex(a.haze, b.haze, u, this.t.fog.color);
    fogC.lerp(tmpA.setRGB(0.45 * (0.35 + day), 0.48 * (0.35 + day), 0.52 * (0.35 + day)), Math.min(1, cloud * 0.4 + rain * 0.6));
    fogC.lerp(tmpA.setRGB(0.82 * (0.3 + day * 0.7), 0.7 * (0.3 + day * 0.7), 0.52 * (0.3 + day * 0.7)), haze * 0.8);
    this.fogNear = this.t.fogNear * (1 - rain * 0.7) * (1 - haze * 0.75);
    this.fogFar = this.t.fogFar * (1 - rain * 0.62) * (1 - haze * 0.72);

    // Lit windows after dark.
    FACADE_NIGHT.value = this.night;

    // Lightning in storms: a flash, then thunder.
    let flash = 0;
    if (this.weather.kind === 'storm' && rain > 0.6) {
      this.flashWait -= dt;
      if (this.flashWait <= 0) {
        this.flash = 0.35;
        this.lightning++;
        this.flashWait = 5 + Math.random() * 10;
        const thunder = this.thunder;
        if (thunder) setTimeout(thunder, 400 + Math.random() * 1200);
      }
    }
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt);
      flash = (this.flash / 0.35) * (Math.random() < 0.7 ? 1 : 0.4);
    }
    s.flash.value = flash * 0.6;
    this.t.hemi.intensity = hemiBase + flash * 3;
    this.t.renderer.toneMappingExposure = (STYLE === 'clean' ? 0.92 : 0.95) + this.night * 0.4;

    // Rain: streaks falling round the camera.
    this.rain.visible = rain > 0.04 && !this.indoors;
    if (this.rain.visible) {
      const count = Math.floor(this.N * Math.min(1, rain));
      this.rain.geometry.setDrawRange(0, count * 2);
      this.rain.position.set(camPos.x, camPos.y - 12, camPos.z);
      const fall = (20 + rain * 6) * dt, drift = (this.weather.windMs * 0.15) * dt;
      for (let j = 0; j < count; j++) {
        const o = j * 6;
        this.rainPos[o + 1] -= fall;
        this.rainPos[o + 4] -= fall;
        this.rainPos[o] += drift;
        this.rainPos[o + 3] += drift;
        if (this.rainPos[o + 4] < 0) this.seedDrop(j);
      }
      (this.rain.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (this.rain.material as THREE.LineBasicMaterial).opacity = 0.25 + 0.35 * rain;
    }

    // Redo the sky reflections when the light has changed noticeably.
    const key = `${Math.round(el / 4)}|${Math.round(cloud * 4)}|${Math.round(haze * 4)}`;
    if (key !== this.envKey) {
      this.envKey = key;
      this.envVersion++;
    }
  }

  /** For tests: the colour of the sky straight up, and how bright the sun is. */
  get debug(): { zenith: string; sunIntensity: number; night: number; rainVisible: boolean; fogFar: number } {
    return {
      zenith: `#${(this.t.sky.zenith.value as THREE.Color).getHexString()}`,
      sunIntensity: this.t.sun.intensity,
      night: this.night,
      rainVisible: this.rain.visible,
      fogFar: this.fogFar,
    };
  }
}

export const ENV_LABELS = {
  time: { live: 'Live Lagos time', fast: 'Fast day (24 minutes)', day: 'Always day', dusk: 'Always dusk', night: 'Always night' } as Record<TimeMode, string>,
  weather: { live: 'Live Lagos weather', clear: 'Clear', cloudy: 'Overcast', rain: 'Rain', storm: 'Thunderstorm', haze: 'Harmattan haze' } as Record<WeatherMode, string>,
};

