/**
 * Greeting lines are loaded from public/data/greetings.json (same file as the Unreal reference),
 * grouped by voice. Writers edit that file; no code changes needed.
 */
interface GreetingFile {
  groups?: Record<string, { text?: string }[]>;
}

const FALLBACK = 'Good day.';

export class Dialogue {
  private lines = new Map<string, string[]>();
  loaded = false;

  async load(url: string): Promise<void> {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as GreetingFile;
      for (const [group, entries] of Object.entries(data.groups ?? {})) {
        const texts = (entries ?? []).map((e) => e.text ?? '').filter((t) => t.length > 0);
        if (texts.length) this.lines.set(group, texts);
      }
      this.loaded = this.lines.size > 0;
    } catch (err) {
      console.warn('Greetings could not be loaded; residents will use a fallback line.', err);
    }
  }

  pick(group: string): string {
    const list = this.lines.get(group) ?? this.lines.get('default');
    if (!list || list.length === 0) return FALLBACK;
    return list[Math.floor(Math.random() * list.length)];
  }
}
