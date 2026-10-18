/**
 * Local, versioned save in localStorage (single-player only; nothing leaves the browser).
 * Version 2 (Milestone 2) adds paint jobs, your car's condition and job stats.
 * Version 3 (Milestone 3) adds your outfit, bought clothes and finished chapters (replacing the v2
 * finale flag). Version 4 (Phase 4, Street Kit) adds weapons, ammo, armour and Range Day medals.
 * Version 5 (Phase 6, Wings and Water) adds pilot's licences, the speedboat and the radio station.
 * Version 6 makes BLK KNG the main player: saves still wearing the old default (the Signature look) switch to him.
 * Version 10 (The Chairman) adds your name, the story missions' states, standing with the Chairman,
 * the mission phone (contacts, messages, payments) and the properties he has given you.
 * Version 9 (Crew Life) adds who holds each crew's turf (turf wars).
 * Version 8 (Crews) adds the crew you run with and your gym fitness.
 * Version 7 adds the Royale GT (won in the Coastal Run, kept in licences): saves that already won the race get it.
 * Older saves are migrated step by step.
 * Bump SAVE_VERSION and extend migrate() whenever the format changes.
 */
import { ITEM_IDS, Outfit, validOutfit, DEFAULT_OUTFIT, CLASSIC_OUTFIT } from './outfits';
import { Arsenal, WEAPON_IDS } from './weapons';

export const SAVE_VERSION = 10;
const KEY = 'gangs-of-lagos/save';
const PAINT_IDS = ['green', 'blue', 'red', 'danfo', 'gold'];

/** Story mission states (the Chairman's story). */
export type StoryState = 'inactive' | 'offered' | 'accepted' | 'in_progress' | 'completed' | 'failed';
const STORY_STATES: StoryState[] = ['inactive', 'offered', 'accepted', 'in_progress', 'completed', 'failed'];
export interface PhoneMessage {
  from: string;
  text: string;
}
export interface Payment {
  from: string;
  what: string;
  amount: number;
}

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
  /** Phase 4 */
  shots: number;
  hospital: number;
  escapes: number;
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
  /** Phase 4: weapons owned, rounds carried and the drawn weapon. */
  weapons: Arsenal;
  /** Body armour, 0..100. Health is not saved: you start each session fit. */
  armour: number;
  /** Range Day: best hits and best medal (0 none, 1 bronze, 2 silver, 3 gold). */
  range: { best: number; medal: number };
  /** Phase 6: 'plane' and 'heli' licences from Flight School, 'boat' once you win the Lagoon Run, 'royale' (the Royale GT) for the Coastal Run. */
  licences: string[];
  /** Phase 6: the radio station you last tuned to (0 = off). */
  radio: number;
  /** Crews: the crew you joined ('' for none) and gym fitness (0..10: sprint lasts longer). */
  crew: '' | 'blue' | 'red' | 'yellow';
  fitness: number;
  /** Crew Life: which crew holds each crew's home turf (keyed by the crew that started there). */
  turfs: Record<'blue' | 'red' | 'yellow', 'blue' | 'red' | 'yellow'>;
  /** The Chairman (v10): your name in the story (dialogue uses it). */
  playerName: string;
  /** Story missions by id: inactive, offered (the phone rang), accepted, in progress, completed or failed. */
  story: Record<string, StoryState>;
  /** Standing with the Chairman's organisation, 0..100. */
  rep: number;
  /** The mission phone is unlocked (calls, messages, jobs, properties, bank). */
  phone: boolean;
  contacts: string[];
  /** Newest last; the phone keeps the last 40. */
  messages: PhoneMessage[];
  /** Money paid in (newest last; the last 30 are kept). */
  payments: Payment[];
  /** Properties the Chairman has given you (ids from properties.ts). */
  gifts: string[];
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
    stats: { races: 0, deliveries: 0, shifts: 0, fares: 0, tows: 0, repairs: 0, shots: 0, hospital: 0, escapes: 0 },
    chaptersDone: [],
    outfit: { ...DEFAULT_OUTFIT },
    clothes: [],
    lookChosen: false,
    weapons: { owned: [], ammo: {}, equipped: null },
    armour: 0,
    range: { best: 0, medal: 0 },
    licences: [],
    crew: '',
    fitness: 0,
    turfs: { blue: 'blue', red: 'red', yellow: 'yellow' },
    playerName: 'Bayo',
    story: {},
    rep: 0,
    phone: false,
    contacts: [],
    messages: [],
    payments: [],
    gifts: [],
    radio: 1,
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
  const w: Partial<Arsenal> = raw.weapons ?? {};
  const guns = Array.isArray(w.owned) ? [...new Set(w.owned.filter((x) => (WEAPON_IDS as string[]).includes(x)))] : [];
  const ammo: Record<string, number> = {};
  for (const id of guns) ammo[id] = count(w.ammo?.[id]);
  return {
    version: SAVE_VERSION,
    cash: count(raw.cash),
    completedMissions: Array.isArray(raw.completedMissions) ? [...new Set(raw.completedMissions.filter((x) => typeof x === 'string'))] : [],
    bestTimes: numberMap(raw.bestTimes),
    bestPay: numberMap(raw.bestPay),
    paints: { owned: [...new Set(owned)], active },
    carHealth: clamp(Number(raw.carHealth ?? 100) || 0, 0, 100),
    stats: { races: count(st.races), deliveries: count(st.deliveries), shifts: count(st.shifts), fares: count(st.fares), tows: count(st.tows), repairs: count(st.repairs), shots: count(st.shots), hospital: count(st.hospital), escapes: count(st.escapes) },
    chaptersDone: Array.isArray(raw.chaptersDone) ? [...new Set(raw.chaptersDone.map(Number).filter((n) => Number.isInteger(n) && n > 0))] : [],
    outfit: validOutfit(raw.outfit),
    clothes: Array.isArray(raw.clothes) ? [...new Set(raw.clothes.filter((x) => ITEM_IDS.includes(x)))] : [],
    lookChosen: Boolean(raw.lookChosen),
    weapons: { owned: guns, ammo, equipped: typeof w.equipped === 'string' && guns.includes(w.equipped) ? w.equipped : null },
    armour: clamp(Number(raw.armour ?? 0) || 0, 0, 100),
    range: { best: count(raw.range?.best), medal: clamp(count(raw.range?.medal), 0, 3) },
    licences: Array.isArray(raw.licences) ? [...new Set(raw.licences.filter((x) => x === 'plane' || x === 'heli' || x === 'boat' || x === 'royale'))] : [],
    radio: clamp(count(raw.radio ?? 1), 0, 9),
    crew: raw.crew === 'blue' || raw.crew === 'red' || raw.crew === 'yellow' ? raw.crew : '',
    fitness: clamp(count(raw.fitness), 0, 10),
    turfs: (() => {
      const ok = (v: unknown): v is 'blue' | 'red' | 'yellow' => v === 'blue' || v === 'red' || v === 'yellow';
      const t = (raw.turfs ?? {}) as Partial<Record<string, unknown>>;
      return { blue: ok(t.blue) ? t.blue : 'blue', red: ok(t.red) ? t.red : 'red', yellow: ok(t.yellow) ? t.yellow : 'yellow' };
    })(),
    playerName: cleanName(raw.playerName),
    story: (() => {
      const out: Record<string, StoryState> = {};
      if (raw.story && typeof raw.story === 'object') for (const [k, v] of Object.entries(raw.story)) if (STORY_STATES.includes(v as StoryState)) out[k] = v as StoryState;
      return out;
    })(),
    rep: clamp(count(raw.rep), 0, 100),
    phone: Boolean(raw.phone),
    contacts: Array.isArray(raw.contacts) ? [...new Set(raw.contacts.filter((x) => typeof x === 'string'))].slice(0, 20) : [],
    messages: Array.isArray(raw.messages) ? raw.messages.filter((m) => m && typeof m.from === 'string' && typeof m.text === 'string').map((m) => ({ from: m.from.slice(0, 40), text: m.text.slice(0, 400) })).slice(-40) : [],
    payments: Array.isArray(raw.payments) ? raw.payments.filter((p) => p && typeof p.from === 'string' && typeof p.what === 'string').map((p) => ({ from: p.from.slice(0, 40), what: p.what.slice(0, 80), amount: count(p.amount) })).slice(-30) : [],
    gifts: Array.isArray(raw.gifts) ? [...new Set(raw.gifts.filter((x) => typeof x === 'string'))] : [],
    settings: {
      masterVolume: clamp(Number(s.masterVolume ?? d.settings.masterVolume), 0, 1),
      lookSensitivity: clamp(Number(s.lookSensitivity ?? d.settings.lookSensitivity), 0.2, 2.5),
      invertY: Boolean(s.invertY),
    },
  };
}

/** A name for the story: letters, spaces, hyphens and apostrophes, up to 16 characters ('Bayo' if empty). */
export function cleanName(v: unknown): string {
  const n = typeof v === 'string' ? v.replace(/[^\p{L}\p{M} '\-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 16) : '';
  return n || 'Bayo';
}

type V1 = Partial<SaveData> & { unlocks?: string[]; finaleDone?: boolean };

function migrate(input: V1): Partial<SaveData> {
  let raw: V1 = input;
  const version = typeof raw.version === 'number' ? raw.version : 1;
  if (version < 2) raw = { ...migrate1to2(raw), version: 2 };
  if (version < 3) {
    // v2 -> v3: the single finale flag becomes chapter 1; outfits start at the classic look.
    const { finaleDone, ...rest } = raw;
    raw = { ...rest, version: 3, chaptersDone: finaleDone ? [1] : [], outfit: { ...CLASSIC_OUTFIT }, clothes: [], lookChosen: false };
  }
  if (version < 4) {
    // v3 -> v4: nothing to convert; start unarmed with no armour or medals.
    raw = { ...raw, version: 4, weapons: { owned: [], ammo: {}, equipped: null }, armour: 0, range: { best: 0, medal: 0 } };
  }
  if (version < 5) {
    // v4 -> v5: no licences yet; radio on the first station.
    raw = { ...raw, version: 5, licences: [], radio: 1 };
  }
  if (version < 6) {
    // v5 -> v6: BLK KNG replaces the Signature look as the main player's default outfit.
    const o = raw.outfit as Partial<Outfit> | undefined;
    raw = { ...raw, version: 6, outfit: o && o.top === 'top-signature' ? { ...o, top: 'top-blkkng' } as Outfit : raw.outfit };
  }
  if (version < 7) {
    // v6 -> v7: the Royale GT is the Coastal Run prize; anyone who already won the race gets it.
    const lic = Array.isArray(raw.licences) ? raw.licences : [];
    const won = Array.isArray(raw.completedMissions) && raw.completedMissions.includes('coastal-run');
    raw = { ...raw, version: 7, licences: won && !lic.includes('royale') ? [...lic, 'royale'] : lic };
  }
  if (version < 8) {
    // v7 -> v8 (Crews): not in a crew yet, no gym work.
    raw = { ...raw, version: 8, crew: '', fitness: 0 };
  }
  if (version < 9) {
    // v8 -> v9 (Crew Life): every crew still holds its own turf.
    raw = { ...raw, version: 9, turfs: { blue: 'blue', red: 'red', yellow: 'yellow' } };
  }
  if (version < 10) {
    // v9 -> v10 (The Chairman): the story hasn't started yet; the phone rings when you next play.
    // What you already won counts as his gifts: the Royale GT, the speedboat and (chapter 1) the penthouse.
    const lic = Array.isArray(raw.licences) ? raw.licences : [];
    const gifts = [...(lic.includes('royale') ? ['royale-gt'] : []), ...(lic.includes('boat') ? ['speedboat'] : []), ...(Array.isArray(raw.chaptersDone) && raw.chaptersDone.includes(1) ? ['heights-penthouse'] : [])];
    raw = { ...raw, version: 10, playerName: 'Bayo', story: {}, rep: 0, phone: false, contacts: [], messages: [], payments: [], gifts };
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
      stats: { races: (raw.completedMissions ?? []).includes('harbour-sprint') ? 1 : 0, deliveries: 0, shifts: 0, fares: 0, tows: 0, repairs: 0, shots: 0, hospital: 0, escapes: 0 },
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
