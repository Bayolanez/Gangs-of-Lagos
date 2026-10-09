/**
 * Local, versioned save in localStorage. Same fields as the Unreal reference (GOLSaveGame),
 * plus best times for missions. Bump SAVE_VERSION and extend migrate() when the format changes.
 */
export const SAVE_VERSION = 1;
const KEY = 'gangs-of-lagos/save';

export interface Settings {
  masterVolume: number;   // 0..1
  lookSensitivity: number; // 0.2..2.5
  invertY: boolean;
}

export interface SaveData {
  version: number;
  cash: number;
  completedMissions: string[];
  unlocks: string[];
  bestTimes: Record<string, number>;
  settings: Settings;
}

export function defaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    cash: 0,
    completedMissions: [],
    unlocks: [],
    bestTimes: {},
    settings: { masterVolume: 0.7, lookSensitivity: 1, invertY: false },
  };
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

function sanitize(raw: Partial<SaveData>): SaveData {
  const d = defaultSave();
  const s: Partial<Settings> = raw.settings ?? {};
  return {
    version: SAVE_VERSION,
    cash: Math.max(0, Math.floor(Number(raw.cash) || 0)),
    completedMissions: Array.isArray(raw.completedMissions) ? raw.completedMissions.filter((x) => typeof x === 'string') : [],
    unlocks: Array.isArray(raw.unlocks) ? raw.unlocks.filter((x) => typeof x === 'string') : [],
    bestTimes: raw.bestTimes && typeof raw.bestTimes === 'object' ? { ...raw.bestTimes } : {},
    settings: {
      masterVolume: clamp(Number(s.masterVolume ?? d.settings.masterVolume), 0, 1),
      lookSensitivity: clamp(Number(s.lookSensitivity ?? d.settings.lookSensitivity), 0.2, 2.5),
      invertY: Boolean(s.invertY),
    },
  };
}

function migrate(raw: Partial<SaveData>): Partial<SaveData> {
  // Version 1 is the first format; nothing to migrate yet.
  return raw;
}

export class SaveStore {
  data: SaveData;
  /** False when the browser blocks storage (private mode etc.); the game still runs in memory. */
  persistent = true;

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
      const raw = JSON.parse(text) as Partial<SaveData>;
      if (typeof raw.version === 'number' && raw.version > SAVE_VERSION) {
        console.warn('Save is from a newer version; starting fresh in memory.');
        return defaultSave();
      }
      return sanitize(migrate(raw));
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
