/**
 * The mission phone (The Chairman). Calls ring on the HUD while you keep playing: answer with C (or
 * the banner's button), and the call opens on the phone with each line as a subtitle. Lines move on by
 * themselves; Space or a click moves on sooner and Esc skips to the end. A call can end with choices
 * (take the job / not now). Texts arrive as a short note and stay in Messages.
 *
 * Once it is unlocked (after The Chairman's Summons), C opens the phone's apps: Messages, Contacts,
 * Jobs (the Chairman's work, by phone only), Properties (his empire and what he has given you) and Bank.
 * The game fills the apps through PhoneData; the phone only draws them.
 */
export interface Line {
  who: string;
  text: string;
  /** Local-language line (e.g. 'pcm' Nigerian Pidgin): stays reviewed: false until a native speaker checks it. */
  lang?: string;
  reviewed?: boolean;
}

export interface Choice {
  id: string;
  label: string;
}

export interface CallDef {
  caller: string;
  /** Shown under the name while it rings ("Unknown number"). */
  number?: string;
  lines: Line[];
  /** Buttons once the lines are done (none: the call just ends). */
  choices?: Choice[];
  /** 'done' (no choices), a choice id, 'declined' or 'missed'. */
  onEnd(result: string): void;
  /** Seconds it rings before it's missed (default 25). */
  ringFor?: number;
}

export type PhoneTab = 'messages' | 'contacts' | 'jobs' | 'properties' | 'bank';

export interface JobRow {
  id: string;
  name: string;
  contact: string;
  pay: string;
  status: 'available' | 'locked' | 'done' | 'active';
  note: string;
  /** You can call about it now (not locked, not running, replayable if done). */
  canCall: boolean;
}

export interface PropRow {
  name: string;
  kind: string;
  where: string;
  mine: boolean;
}

export interface PhoneData {
  name(): string;
  standing(): string;
  cash(): string;
  messages(): { from: string; text: string }[];
  contacts(): { name: string; role: string }[];
  jobs(): JobRow[];
  properties(): PropRow[];
  payments(): { from: string; what: string; amount: string }[];
  /** Call a contact about a job (Jobs tab) or for work (Contacts tab). */
  callAbout(jobId: string | null, contact: string): void;
  sfx(name: 'ring' | 'message' | 'tap'): void;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

export class Phone {
  state: 'idle' | 'ringing' | 'call' | 'apps' = 'idle';
  tab: PhoneTab = 'messages';
  /** The call ringing or in progress. */
  call: CallDef | null = null;
  /** Lines shown so far in the current call. */
  shown = 0;
  /** Every line played in this session, in order (tests check calls play in order and once). */
  readonly heard: string[] = [];
  private lineT = 0;
  private ringT = 0;
  private noteT = 0;
  private ringSfx = 0;

  constructor(private data: PhoneData) {
    $('ph-answer').addEventListener('click', () => this.answer());
    $('ph-decline').addEventListener('click', () => this.decline());
    $('ph-skip').addEventListener('click', () => this.skip());
    $('ph-lines').addEventListener('click', () => this.advance());
    $('ph-close').addEventListener('click', () => this.close());
    $('ph-ring').addEventListener('click', (e) => {
      if ((e.target as HTMLElement).id !== 'ph-ring-decline') this.answer();
    });
    $('ph-ring-decline').addEventListener('click', () => this.decline());
    for (const b of document.querySelectorAll<HTMLButtonElement>('#ph-tabs button')) b.addEventListener('click', () => this.openApps(b.dataset.tab as PhoneTab));
  }

  get line(): Line | null {
    return this.call && this.shown > 0 ? this.call.lines[this.shown - 1] : null;
  }

  get busy(): boolean {
    return this.state !== 'idle';
  }

  /** Ring: the banner shows on the HUD; play carries on until you answer. */
  ring(call: CallDef): void {
    if (this.state === 'ringing' || this.state === 'call') return;
    if (this.state === 'apps') this.close();
    this.call = call;
    this.shown = 0;
    this.state = 'ringing';
    this.ringT = call.ringFor ?? 25;
    this.ringSfx = 0;
    $('ph-ring-who').textContent = call.caller;
    $('ph-ring-num').textContent = call.number ?? 'Mobile';
    $('ph-ring').hidden = false;
  }

  answer(): void {
    if (this.state !== 'ringing' || !this.call) return;
    this.state = 'call';
    $('ph-ring').hidden = true;
    this.show('call');
    $('ph-caller').textContent = this.call.caller;
    $('ph-number').textContent = this.call.number ?? 'Mobile';
    $('ph-avatar').textContent = initials(this.call.caller);
    $('ph-lines').innerHTML = '';
    $('ph-choices').innerHTML = '';
    $('ph-status').textContent = 'On call';
    $('ph-skip').hidden = false;
    this.data.sfx('tap');
    this.advance();
  }

  decline(): void {
    if (this.state !== 'ringing' || !this.call) return;
    this.end('declined');
  }

  /** Next line (or the choices / the end once every line is shown). */
  advance(): void {
    if (this.state !== 'call' || !this.call) return;
    if ($('ph-choices').childElementCount) return;
    if (this.shown >= this.call.lines.length) return this.finishLines();
    const l = this.call.lines[this.shown++];
    this.heard.push(`${l.who}: ${l.text}`);
    const row = el('p', l.who === this.data.name() ? 'me' : 'them');
    row.append(el('b', '', l.who), el('span', '', l.text));
    $('ph-lines').append(row);
    $('ph-lines').scrollTop = 1e6;
    this.lineT = 1.6 + l.text.length * 0.045;
  }

  /** Skip the rest of the call's lines (they still count as heard, in order). */
  skip(): void {
    if (this.state !== 'call' || !this.call) return;
    while (this.shown < this.call.lines.length) this.advance();
    this.finishLines();
  }

  private finishLines(): void {
    const c = this.call!;
    $('ph-skip').hidden = true;
    if (!c.choices?.length) return this.end('done');
    if ($('ph-choices').childElementCount) return;
    $('ph-status').textContent = 'Your answer';
    for (const ch of c.choices) {
      const b = el('button', ch === c.choices[0] ? 'go' : 'chip', ch.label);
      b.type = 'button';
      b.dataset.choice = ch.id;
      b.addEventListener('click', () => this.choose(ch.id));
      $('ph-choices').append(b);
    }
  }

  choose(id: string): void {
    if (this.state !== 'call' || !this.call?.choices?.some((c) => c.id === id)) return;
    this.end(id);
  }

  private end(result: string): void {
    const c = this.call!;
    this.call = null;
    this.shown = 0;
    this.state = 'idle';
    $('ph-ring').hidden = true;
    this.show(null);
    c.onEnd(result);
  }

  /** A text message: a note on the HUD for a few seconds (it is also kept in the save by the game). */
  notify(from: string, text: string): void {
    $('ph-note-from').textContent = from;
    $('ph-note-text').textContent = text;
    $('ph-note').hidden = false;
    this.noteT = 7;
    this.data.sfx('message');
    if (this.state === 'apps' && this.tab === 'messages') this.render();
  }

  openApps(tab: PhoneTab = this.tab): void {
    if (this.state === 'ringing' || this.state === 'call') return;
    this.state = 'apps';
    this.tab = tab;
    this.show('apps');
    this.render();
  }

  close(): void {
    if (this.state !== 'apps') return;
    this.state = 'idle';
    this.show(null);
  }

  update(dt: number): void {
    if (this.noteT > 0 && (this.noteT -= dt) <= 0) $('ph-note').hidden = true;
    if (this.state === 'ringing') {
      if ((this.ringSfx -= dt) <= 0) {
        this.ringSfx = 2.2;
        this.data.sfx('ring');
      }
      if ((this.ringT -= dt) <= 0) this.end('missed');
    }
    if (this.state === 'call' && this.lineT > 0 && (this.lineT -= dt) <= 0) this.advance();
  }

  private show(view: 'call' | 'apps' | null): void {
    $('phone').hidden = !view;
    $('ph-call').hidden = view !== 'call';
    $('ph-apps').hidden = view !== 'apps';
    $('ph-clock').textContent = new Date().toTimeString().slice(0, 5);
  }

  /** Draw the open tab. */
  render(): void {
    const d = this.data;
    for (const b of document.querySelectorAll<HTMLButtonElement>('#ph-tabs button')) b.classList.toggle('sel', b.dataset.tab === this.tab);
    $('ph-me').textContent = `${d.name()} · ${d.cash()}`;
    $('ph-standing').textContent = d.standing();
    const body = $('ph-body');
    body.innerHTML = '';
    const empty = (t: string) => body.append(el('p', 'ph-empty', t));
    if (this.tab === 'messages') {
      const ms = d.messages();
      if (!ms.length) empty('No messages yet.');
      for (const m of [...ms].reverse()) {
        const r = el('div', 'ph-msg');
        r.append(el('b', '', m.from), el('span', '', m.text));
        body.append(r);
      }
    } else if (this.tab === 'contacts') {
      const cs = d.contacts();
      if (!cs.length) empty('No contacts yet.');
      for (const c of cs) {
        const r = el('div', 'ph-row');
        r.append(el('b', '', c.name), el('small', '', c.role));
        const b = el('button', 'chip', `Call ${c.name.split(' ')[0]}`);
        b.type = 'button';
        b.dataset.call = c.name;
        b.addEventListener('click', () => d.callAbout(null, c.name));
        r.append(b);
        body.append(r);
      }
    } else if (this.tab === 'jobs') {
      const js = d.jobs();
      if (!js.length) empty('No work yet. The Chairman calls when he needs you.');
      for (const j of js) {
        const r = el('div', `ph-row job ${j.status}`);
        r.append(el('b', '', j.name), el('small', '', `${j.contact} · ${j.pay} · ${j.note}`));
        if (j.canCall) {
          const b = el('button', j.status === 'done' ? 'chip' : 'go', j.status === 'done' ? 'Ask to do it again' : `Call ${j.contact.replace(/^The /, '')}`);
          b.type = 'button';
          b.dataset.job = j.id;
          b.addEventListener('click', () => d.callAbout(j.id, j.contact));
          r.append(b);
        }
        body.append(r);
      }
    } else if (this.tab === 'properties') {
      const ps = d.properties();
      const mine = ps.filter((p) => p.mine), his = ps.filter((p) => !p.mine);
      body.append(el('h4', '', 'Yours'));
      if (!mine.length) empty('Nothing yet. Work for the Chairman and he rewards loyalty.');
      for (const p of mine) {
        const r = el('div', 'ph-row mine');
        r.append(el('b', '', p.name), el('small', '', `${p.kind} · ${p.where}`));
        body.append(r);
      }
      body.append(el('h4', '', "The Chairman's empire"));
      for (const p of his) {
        const r = el('div', 'ph-row');
        r.append(el('b', '', p.name), el('small', '', `${p.kind} · ${p.where}`));
        body.append(r);
      }
    } else {
      body.append(el('p', 'ph-balance', `Balance ${d.cash()}`));
      const ps = d.payments();
      if (!ps.length) empty('No payments yet.');
      for (const p of [...ps].reverse()) {
        const r = el('div', 'ph-row');
        r.append(el('b', '', `+${p.amount}`), el('small', '', `${p.from} · ${p.what}`));
        body.append(r);
      }
    }
  }
}

function initials(name: string): string {
  const w = name.replace(/^(The|Chief)\s+/i, '').split(/\s+/).filter(Boolean);
  return (w[0]?.[0] ?? '?') + (w[1]?.[0] ?? '');
}
