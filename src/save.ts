/**
 * Local, versioned save in localStorage (single-player only; nothing leaves the browser).
 * Version 2 (Milestone 2) adds paint jobs, your car's condition and job stats.
 * Version 3 (Milestone 3) adds your outfit, bought clothes and finished chapters (replacing the v2
 * finale flag). Version 1 and 2 saves are migrated step by step.
 * Bump SAVE_VERSION and extend migrate() whenever the format changes.
 */
import { ITEM_IDS, Outfit, validOutfit, DEFAULT_OUTFIT } from './outfits';

export const SAVE_VERSION = 3;
const KEY = 'gangs-of-lagos/save';
const PAINT_IDS = ['green', 'blue', 'red', 'danfo', 'gold'];

export interface Settings {
  masterVolume: number;   // 0..1
  lookSensitivity: number; // 0.2..2.5
  invertY: boolean;
}

export interface Stats {
  races: number;
  deliveries: number;
  shifts: number;
  fares: number;
  tows: number;
  repairs: number;
}

export interface SaveData {
  version: number;
  cash: number;
  completedMissions: string[];
  bestTimes: Record<string, number>;
  /** Best pay per job id (deliveries and shifts pay depend on how well you did). */
  bestPay: Record<string, number>;
  paints: { owned: string[]; active: string };
  /** Your hatchback's condition, 0..100 %. */
  carHealth: number;
  stats: Stats;
  /** Story chapters finished: 1 = Harbour Bend Hustle (opens the bridge), 2 = Marina Point. */
  chaptersDone: number[];
  outfit: Outfit;
  /** Clothing items bought in shops (free and earned items are not stored). */
  clothes: string[];
  /** False until the player has been through "Choose your look" once. */
  lookChosen: boolean;
  settings: Settings;
}

export function defaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    cash: 0,
    completedMissions: [],
    bestTimes: {},
    bestPay: {},
    paints: { owned: ['green'], active: 'green' },
    carHealth: 100,
    stats: { races: 0, deliveries: 0, shifts: 0, fares: 0, tows: 0, repairs: 0 },
    chaptersDone: [],
    outfit: { ...DEFAULT_OUTFIT },
    clothes: [],
    lookChosen: false,
    settings: { masterVolume: 0.7, lookSensitivity: 1, invertY: false },
  };
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const count = (v: unknown) => Math.max(0, Math.floor(Number(v) || 0));
function numberMap(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (v && typeof v === 'object') for (const [k, n] of Object.entries(v)) if (Number.isFinite(Number(n))) out[k] = Number(n);
  return out;
}

function sanitize(raw: Partial<SaveData>): SaveData {
  const d = defaultSave();
  const s: Partial<Settings> = raw.settings ?? {};
  const st: Partial<Stats> = raw.stats ?? {};
  const owned = Array.isArray(raw.paints?.owned) ? raw.paints.owned.filter((x) => PAINT_IDS.includes(x)) : [];
  if (!owned.includes('green')) owned.unshift('green');
  const active = raw.paints?.active && owned.includes(raw.paints.active) ? raw.paints.active : 'green';
  return {
    version: SAVE_VERSION,
    cash: count(raw.cash),
    completedMissions: Array.isArray(raw.completedMissions) ? [...new Set(raw.completedMissions.filter((x) => typeof x === 'string'))] : [],
    bestTimes: numberMap(raw.bestTimes),
    bestPay: numberMap(raw.bestPay),
    paints: { owned: [...new Set(owned)], active },
    carHealth: clamp(Number(raw.carHealth ?? 100) || 0, 0, 100),
    stats: { races: count(st.races), deliveries: count(st.deliveries), shifts: count(st.shifts), fares: count(st.fares), tows: count(st.tows), repairs: count(st.repairs) },
    chaptersDone: Array.isArray(raw.chaptersDone) ? [...new Set(raw.chaptersDone.map(Number).filter((n) => Number.isInteger(n) && n > 0))] : [],
    outfit: validOutfit(raw.outfit),
    clothes: Array.isArray(raw.clothes) ? [...new Set(raw.clothes.filter((x) => ITEM_IDS.includes(x)))] : [],
    lookChosen: Boolean(raw.lookChosen),
    settings: {
      masterVolume: clamp(Number(s.masterVolume ?? d.settings.masterVolume), 0, 1),
      lookSensitivity: clamp(Number(s.lookSensitivity ?? d.settings.lookSensitivity), 0.2, 2.5),
      invertY: Boolean(s.invertY),
    },
  };
}

type V1 = Partial<SaveData> & { unlocks?: string[]; finaleDone?: boolean };

function migrate(input: V1): Partial<SaveData> {
  let raw: V1 = input;
  const version = typeof raw.version === 'number' ? raw.version : 1;
  if (version < 2) raw = { ...migrate1to2(raw), version: 2 };
  if (version < 3) {
    // v2 -> v3: the single finale flag becomes chapter 1; outfits start at the classic look.
    const { finaleDone, ...rest } = raw;
    raw = { ...rest, version: 3, chaptersDone: finaleDone ? [1] : [], outfit: { ...DEFAULT_OUTFIT }, clothes: [], lookChosen: false };
  }
  return raw;
}

function migrate1to2(raw: V1): V1 {
  {
    // v1 -> v2: unlocks[] held 'paint-danfo' after winning the sprint. Paint jobs replace it.
    const hadDanfo = Array.isArray(raw.unlocks) && raw.unlocks.includes('paint-danfo');
    const { unlocks: _old, ...rest } = raw;
    void _old;
    return {
      ...rest,
      paints: { owned: hadDanfo ? ['green', 'danfo'] : ['green'], active: hadDanfo ? 'danfo' : 'green' },
      stats: { races: (raw.completedMissions ?? []).includes('harbour-sprint') ? 1 : 0, deliveries: 0, shifts: 0, fares: 0, tows: 0, repairs: 0 },
    };
  }
}

export class SaveStore {
  data: SaveData;
  /** False when the browser blocks storage (private mode etc.); the game still runs in memory. */
  persistent = true;
  /** Set when an older save was upgraded on load. */
  migratedFrom: number | null = null;

  constructor() {
    this.data = this.load();
  }

  private load(): SaveData {
    let text: string | null = null;
    try {
      text = localStorage.getItem(KEY);
    } catch {
      this.persistent = false;
      return defaultSave();
    }
    if (!text) return defaultSave();
    try {
      const raw = JSON.parse(text) as V1;
      if (typeof raw.version === 'number' && raw.version > SAVE_VERSION) {
        console.warn('Save is from a newer version; starting fresh in memory.');
        return defaultSave();
      }
      if ((raw.version ?? 1) < SAVE_VERSION) this.migratedFrom = raw.version ?? 1;
      const data = sanitize(migrate(raw));
      if (this.migratedFrom !== null) {
        try {
          localStorage.setItem(KEY, JSON.stringify(data));
        } catch {
          /* keep running in memory */
        }
      }
      return data;
    } catch {
      console.warn('Save could not be read; starting fresh.');
      return defaultSave();
    }
  }

  save(): boolean {
    this.data = sanitize(this.data);
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
      this.persistent = true;
      return true;
    } catch {
      this.persistent = false;
      return false;
    }
  }

  reset(): void {
    const settings = this.data.settings;
    this.data = defaultSave();
    this.data.settings = settings;
    this.save();
  }
}
