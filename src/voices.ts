/**
 * Street voices (Phase 4): greetings, complaints and "excuse me" lines in English, Pidgin, Yoruba,
 * Igbo and Hausa, loaded from public/data/street_voices.json. Writers edit that file; non-English
 * lines stay "reviewed": false until a native speaker has checked them. Text only for now (no recordings).
 */
export type VoiceKind = 'greeting' | 'complaint' | 'excuse';

export interface VoiceLine {
  kind: VoiceKind;
  lang: string;
  text: string;
  gloss?: string;
  reviewed: boolean;
}

interface VoiceFile {
  speakers?: Record<string, string>;
  lines?: Partial<VoiceLine>[];
}

export class StreetVoices {
  lines: VoiceLine[] = [];
  speakers: Record<string, string> = {};

  async load(url: string): Promise<void> {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as VoiceFile;
      this.speakers = data.speakers ?? {};
      this.lines = (data.lines ?? [])
        .filter((l): l is VoiceLine => typeof l.text === 'string' && !!l.text && (l.kind === 'greeting' || l.kind === 'complaint' || l.kind === 'excuse'))
        .map((l) => ({ kind: l.kind, lang: l.lang ?? 'en', text: l.text, gloss: l.gloss, reviewed: l.reviewed === true }));
    } catch (err) {
      console.warn('Street voices could not be loaded; residents stay quiet when bumped.', err);
    }
  }

  langOf(name: string): string {
    return this.speakers[name] ?? 'en';
  }

  /** A line of this kind in the speaker's language, falling back to English. */
  pick(name: string, kind: VoiceKind, rand: () => number = Math.random): VoiceLine | null {
    const lang = this.langOf(name);
    let pool = this.lines.filter((l) => l.kind === kind && l.lang === lang);
    if (!pool.length) pool = this.lines.filter((l) => l.kind === kind && l.lang === 'en');
    if (!pool.length) return null;
    return pool[Math.floor(rand() * pool.length)];
  }
}

/** How the line reads on screen: the text, plus the English gloss for other languages. */
export function voiceText(l: VoiceLine): string {
  return l.gloss && l.lang !== 'en' ? `${l.text} (${l.gloss})` : l.text;
}
