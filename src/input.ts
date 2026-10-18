/** Keyboard + mouse input with pointer lock for camera look, plus the on-screen touch controls (touch.ts). */
export class Input {
  private keys = new Set<string>();
  private pressed = new Set<string>();
  private buttons = new Set<number>();
  private clicked = new Set<number>();
  lookX = 0;
  lookY = 0;
  locked = false;
  /** Chrome reports one bogus jump right after pointer lock starts; skip it so the camera doesn't lurch. */
  private skipMoves = 0;
  /** Set when the game itself released the mouse (menus), so the release isn't mistaken for Esc. */
  selfRelease = false;
  /** Touch controls are on: there is no pointer lock, the screen stick and buttons feed this instead. */
  touch = false;
  /** Touch stick, -1..1 each way (y up = forward); feeds the WASD axes. */
  stick = { x: 0, y: 0 };
  /** In a car the stick only steers (the pedals drive). */
  stickSteerOnly = false;
  private vkeys = new Set<string>();
  private vbuttons = new Set<number>();
  /** Called on the first user gesture (used to start audio). */
  onGesture: (() => void) | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    addEventListener('keydown', (e) => {
      // Typing in a text box (your name) is not game input.
      if (e.target instanceof HTMLInputElement && e.target.type === 'text') return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      this.onGesture?.();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => {
      this.keys.clear();
      this.buttons.clear();
      this.releaseTouch();
    });
    addEventListener('mouseup', (e) => this.buttons.delete(e.button));
    canvas.addEventListener('mousemove', (e) => {
      if (this.locked) {
        if (this.skipMoves > 0) {
          this.skipMoves--;
          return;
        }
        this.lookX += e.movementX;
        this.lookY += e.movementY;
      } else if (e.buttons & 2) {
        // Fallback when pointer lock is unavailable: right-drag to look.
        this.lookX += e.movementX * 1.6;
        this.lookY += e.movementY * 1.6;
      }
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('mousedown', (e) => {
      this.buttons.add(e.button);
      this.clicked.add(e.button);
      this.onGesture?.();
    });
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === this.canvas;
      if (this.locked && !was) this.skipMoves = 1;
    });
  }

  /** A touch button or the stick holding a key down (or letting it go). */
  press(code: string, down: boolean): void {
    if (down) {
      if (!this.keys.has(code) && !this.vkeys.has(code)) this.pressed.add(code);
      this.vkeys.add(code);
      this.onGesture?.();
    } else this.vkeys.delete(code);
  }

  /** A touch button acting as a mouse button (0 fire, 2 aim). */
  pressButton(button: number, down: boolean): void {
    if (down) {
      if (!this.vbuttons.has(button)) this.clicked.add(button);
      this.vbuttons.add(button);
      this.onGesture?.();
    } else this.vbuttons.delete(button);
  }

  /** Let go of every touch key and button (leaving play, opening a menu). */
  releaseTouch(): void {
    this.vkeys.clear();
    this.vbuttons.clear();
    this.stick.x = this.stick.y = 0;
  }

  requestLock(): void {
    if (this.touch) {
      this.locked = true;
      return;
    }
    if (this.locked || !this.canvas.requestPointerLock) return;
    try {
      const r = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (r && typeof r.catch === 'function') r.catch(() => undefined);
    } catch {
      /* pointer lock refused: right-drag look still works */
    }
  }

  releaseLock(): void {
    if (this.touch) {
      this.locked = false;
      this.releaseTouch();
      return;
    }
    if (document.pointerLockElement) {
      this.selfRelease = true;
      document.exitPointerLock();
    }
  }

  down(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c) || this.vkeys.has(c));
  }

  /** True once per physical press. */
  hit(...codes: string[]): boolean {
    return codes.some((c) => this.pressed.has(c));
  }

  /** Mouse button held (0 left, 2 right). */
  mouse(button: number): boolean {
    return this.buttons.has(button) || this.vbuttons.has(button);
  }

  /** True once per mouse click. */
  mouseHit(button: number): boolean {
    return this.clicked.has(button);
  }

  axis(neg: string[], pos: string[]): number {
    const digital = (this.down(...pos) ? 1 : 0) - (this.down(...neg) ? 1 : 0);
    // The touch stick is analog: walking speed follows how far it is pushed.
    if (this.touch && pos.includes('KeyD')) return Math.max(-1, Math.min(1, digital + this.stick.x));
    if (this.touch && pos.includes('KeyW') && !this.stickSteerOnly) return Math.max(-1, Math.min(1, digital + this.stick.y));
    return digital;
  }

  consumeLook(): { x: number; y: number } {
    const l = { x: this.lookX, y: this.lookY };
    this.lookX = 0;
    this.lookY = 0;
    return l;
  }

  endFrame(): void {
    this.pressed.clear();
    this.clicked.clear();
  }
}
