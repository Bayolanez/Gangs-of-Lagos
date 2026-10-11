/** Keyboard + mouse input with pointer lock for camera look. */
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
  /** Called on the first user gesture (used to start audio). */
  onGesture: (() => void) | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      this.onGesture?.();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => {
      this.keys.clear();
      this.buttons.clear();
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

  requestLock(): void {
    if (this.locked || !this.canvas.requestPointerLock) return;
    try {
      const r = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (r && typeof r.catch === 'function') r.catch(() => undefined);
    } catch {
      /* pointer lock refused: right-drag look still works */
    }
  }

  releaseLock(): void {
    if (document.pointerLockElement) {
      this.selfRelease = true;
      document.exitPointerLock();
    }
  }

  down(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  /** True once per physical press. */
  hit(...codes: string[]): boolean {
    return codes.some((c) => this.pressed.has(c));
  }

  /** Mouse button held (0 left, 2 right). */
  mouse(button: number): boolean {
    return this.buttons.has(button);
  }

  /** True once per mouse click. */
  mouseHit(button: number): boolean {
    return this.clicked.has(button);
  }

  axis(neg: string[], pos: string[]): number {
    return (this.down(...pos) ? 1 : 0) - (this.down(...neg) ? 1 : 0);
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
