import type { Input } from './input';

/**
 * On-screen controls for phones and tablets held in landscape.
 *  - Left side: a floating move stick. Put a thumb down anywhere there; push further to run.
 *  - Right side: drag anywhere that isn't a button to look around.
 *  - Buttons change with what you're doing: on foot, armed, driving, flying or on the boat.
 *  - Top right: pause, map and missions.
 * Every button presses one of the keyboard keys (or a mouse button) through Input, so the game logic
 * is the same for keyboard, mouse and touch.
 */
export type TouchContext = 'foot' | 'armed' | 'car' | 'boat' | 'plane' | 'heli';

interface ButtonDef {
  id: string;
  label: string;
  /** Keyboard code it presses, or 'mouse0' / 'mouse2'. */
  key: string;
  /** hold: down while touched; tap: one press; toggle: tap on, tap off. */
  kind: 'hold' | 'tap' | 'toggle';
  /** Contexts it shows in. */
  show: TouchContext[];
  /** Grid slot class (position in the right-hand cluster). */
  slot: string;
}

const ALL: TouchContext[] = ['foot', 'armed', 'car', 'boat', 'plane', 'heli'];
const BUTTONS: ButtonDef[] = [
  // On foot
  { id: 'jump', label: 'Jump', key: 'Space', kind: 'tap', show: ['foot', 'armed'], slot: 's-a' },
  { id: 'use', label: 'Use', key: 'KeyE', kind: 'tap', show: ['foot', 'armed'], slot: 's-b' },
  { id: 'weapon', label: 'Weapon', key: 'TouchWeapon', kind: 'tap', show: ['foot', 'armed'], slot: 's-c' },
  { id: 'fire', label: 'Fire', key: 'mouse0', kind: 'hold', show: ['armed'], slot: 's-big' },
  { id: 'aim', label: 'Aim', key: 'mouse2', kind: 'toggle', show: ['armed'], slot: 's-d' },
  { id: 'reload', label: 'Reload', key: 'KeyR', kind: 'tap', show: ['armed'], slot: 's-e' },
  // Driving (car, boat) and flying
  { id: 'gas', label: 'Gas', key: 'KeyW', kind: 'hold', show: ['car', 'boat', 'plane'], slot: 's-big' },
  { id: 'brake', label: 'Brake', key: 'KeyS', kind: 'hold', show: ['car', 'boat', 'plane'], slot: 's-a' },
  { id: 'handbrake', label: 'Hand brake', key: 'Space', kind: 'hold', show: ['car'], slot: 's-d' },
  { id: 'horn', label: 'Horn', key: 'KeyH', kind: 'hold', show: ['car'], slot: 's-e' },
  { id: 'up', label: 'Up', key: 'Space', kind: 'hold', show: ['heli'], slot: 's-big' },
  { id: 'down', label: 'Down', key: 'ShiftLeft', kind: 'hold', show: ['heli'], slot: 's-a' },
  { id: 'exit', label: 'Get out', key: 'KeyE', kind: 'tap', show: ['car', 'boat', 'plane', 'heli'], slot: 's-b' },
  { id: 'radio', label: 'Radio', key: 'KeyT', kind: 'tap', show: ['car', 'boat', 'plane', 'heli'], slot: 's-c' },
];
const TOP: { id: string; label: string; key: string }[] = [
  { id: 'pause', label: 'Pause', key: 'Escape' },
  { id: 'map', label: 'Map', key: 'KeyM' },
  { id: 'jobs', label: 'Jobs', key: 'KeyJ' },
];

const STICK_R = 56;

/** True on phones and tablets (a coarse pointer or a touch screen), or with ?touch in the address. */
export function wantsTouch(): boolean {
  if (typeof window === 'undefined') return false;
  const q = new URLSearchParams(location.search);
  if (q.has('touch')) return true;
  if (q.has('notouch')) return false;
  return matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && matchMedia('(hover: none)').matches);
}

export class TouchControls {
  readonly root: HTMLDivElement;
  context: TouchContext = 'foot';
  private stickBase: HTMLDivElement;
  private knob: HTMLDivElement;
  private stickId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private lookIds = new Map<number, { x: number; y: number }>();
  private toggles = new Set<string>();
  private buttons = new Map<string, HTMLButtonElement>();
  private shown = false;
  /** Keys the stick is holding down right now. */
  private stickKeys = new Set<string>();

  constructor(private input: Input, parent: HTMLElement) {
    input.touch = true;
    document.body.classList.add('touch');
    const root = document.createElement('div');
    root.id = 'touch';
    root.hidden = true;
    root.innerHTML = `
      <div class="t-zone t-move"></div>
      <div class="t-zone t-look"></div>
      <div class="t-stick" hidden><div class="t-knob"></div></div>
      <div class="t-top"></div>
      <div class="t-cluster"></div>`;
    parent.appendChild(root);
    this.root = root;
    this.stickBase = root.querySelector('.t-stick')!;
    this.knob = root.querySelector('.t-knob')!;

    const cluster = root.querySelector('.t-cluster')!;
    for (const b of BUTTONS) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `t-btn ${b.slot}`;
      el.id = `t-${b.id}`;
      el.textContent = b.label;
      el.dataset.show = b.show.join(' ');
      cluster.appendChild(el);
      this.buttons.set(b.id, el);
      this.bindButton(el, b.key, b.kind);
    }
    const top = root.querySelector('.t-top')!;
    for (const t of TOP) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 't-small';
      el.id = `t-${t.id}`;
      el.textContent = t.label;
      top.appendChild(el);
      this.bindButton(el, t.key, 'tap');
    }

    // Move stick: wherever the thumb lands on the left side.
    const move = root.querySelector<HTMLDivElement>('.t-move')!;
    move.addEventListener('pointerdown', (e) => {
      if (this.stickId !== null) return;
      e.preventDefault();
      move.setPointerCapture(e.pointerId);
      this.stickId = e.pointerId;
      this.stickOrigin = { x: e.clientX, y: e.clientY };
      this.stickBase.hidden = false;
      this.stickBase.style.transform = `translate(${e.clientX - STICK_R}px, ${e.clientY - STICK_R}px)`;
      this.moveStick(e.clientX, e.clientY);
      input.onGesture?.();
    });
    move.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stickId) this.moveStick(e.clientX, e.clientY);
    });
    const endStick = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.stickBase.hidden = true;
      this.setStick(0, 0);
    };
    move.addEventListener('pointerup', endStick);
    move.addEventListener('pointercancel', endStick);

    // Look: drag on the right side (several fingers can each drag).
    const look = root.querySelector<HTMLDivElement>('.t-look')!;
    look.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      look.setPointerCapture(e.pointerId);
      this.lookIds.set(e.pointerId, { x: e.clientX, y: e.clientY });
      input.onGesture?.();
    });
    look.addEventListener('pointermove', (e) => {
      const last = this.lookIds.get(e.pointerId);
      if (!last) return;
      input.lookX += (e.clientX - last.x) * 1.5;
      input.lookY += (e.clientY - last.y) * 1.5;
      last.x = e.clientX;
      last.y = e.clientY;
    });
    const endLook = (e: PointerEvent) => this.lookIds.delete(e.pointerId);
    look.addEventListener('pointerup', endLook);
    look.addEventListener('pointercancel', endLook);
    root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private bindButton(el: HTMLButtonElement, key: string, kind: 'hold' | 'tap' | 'toggle'): void {
    const set = (down: boolean) => (key.startsWith('mouse') ? this.input.pressButton(Number(key.slice(5)), down) : this.input.press(key, down));
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      if (kind === 'toggle') {
        const on = !this.toggles.has(key);
        if (on) this.toggles.add(key);
        else this.toggles.delete(key);
        el.classList.toggle('on', on);
        set(on);
        return;
      }
      el.classList.add('on');
      set(true);
      // A tap is one press: let go on the next frame so "held" checks don't see it stuck down.
      if (kind === 'tap') requestAnimationFrame(() => requestAnimationFrame(() => set(false)));
    });
    const up = () => {
      if (kind === 'toggle') return;
      el.classList.remove('on');
      if (kind === 'hold') set(false);
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
    el.addEventListener('click', (e) => e.preventDefault());
  }

  private moveStick(x: number, y: number): void {
    let dx = x - this.stickOrigin.x, dy = y - this.stickOrigin.y;
    const d = Math.hypot(dx, dy);
    if (d > STICK_R) {
      dx *= STICK_R / d;
      dy *= STICK_R / d;
    }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    // A small dead zone, then full range.
    const k = (v: number) => (Math.abs(v) < 6 ? 0 : (v - Math.sign(v) * 6) / (STICK_R - 6));
    this.setStick(k(dx), -k(dy));
  }

  /** The stick's value, and the keys it holds for things that read keys (sprint, aircraft). */
  private setStick(x: number, y: number): void {
    const inp = this.input;
    inp.stick.x = x;
    inp.stick.y = y;
    const ctx = this.context;
    const flying = ctx === 'plane' || ctx === 'heli';
    const want: Record<string, boolean> = {
      // On foot, a stick pushed all the way runs.
      ShiftLeft: (ctx === 'foot' || ctx === 'armed') && Math.hypot(x, y) > 0.92,
      // Aircraft read keys: steer with A/D; the helicopter flies forward/back with W/S, the plane pitches with the arrows.
      KeyA: flying && x < -0.35,
      KeyD: flying && x > 0.35,
      KeyW: ctx === 'heli' && y > 0.35,
      KeyS: ctx === 'heli' && y < -0.35,
      ArrowUp: ctx === 'plane' && y < -0.35,
      ArrowDown: ctx === 'plane' && y > 0.35,
    };
    // Only press or release keys the stick itself holds, so it never lets go of a button's key (Gas is W too).
    for (const [code, on] of Object.entries(want)) {
      if (on === this.stickKeys.has(code)) continue;
      if (on) this.stickKeys.add(code);
      else this.stickKeys.delete(code);
      inp.press(code, on);
    }
  }

  /** Show the controls while playing, with the buttons for what you're doing. */
  update(playing: boolean, ctx: TouchContext): void {
    if (playing !== this.shown) {
      this.shown = playing;
      this.root.hidden = !playing;
      if (!playing) this.reset();
    }
    if (ctx !== this.context) {
      this.context = ctx;
      this.root.dataset.ctx = ctx;
      // Leaving the armed buttons drops a held aim.
      if (ctx !== 'armed' && this.toggles.has('mouse2')) {
        this.toggles.delete('mouse2');
        this.buttons.get('aim')?.classList.remove('on');
        this.input.pressButton(2, false);
      }
      this.input.stickSteerOnly = ctx !== 'foot' && ctx !== 'armed';
      this.setStick(this.input.stick.x, this.input.stick.y);
    }
  }

  private reset(): void {
    this.stickId = null;
    this.stickBase.hidden = true;
    this.lookIds.clear();
    this.toggles.clear();
    this.stickKeys.clear();
    for (const b of this.buttons.values()) b.classList.remove('on');
    this.input.releaseTouch();
  }

  /** Every button's id and whether it is showing (tests). */
  get visibleButtons(): string[] {
    return [...this.buttons.entries()].filter(([, el]) => (el.dataset.show ?? '').split(' ').includes(this.context)).map(([id]) => id);
  }
}

export const TOUCH_CONTEXTS = ALL;
