import type { CollisionWorld } from './collision';
import { BRIDGE_Z, BUS_STOPS, HALF, ROAD_LINES, ROAD_W, SHORE } from './district';

/**
 * Top-left minimap. The district is drawn once into an offscreen image, then each frame that image is
 * rotated so the camera's forward direction points up (like most open-world games).
 */
const PX_PER_M = 2;
const MIN_X = -HALF - 10;
const MAX_X = SHORE + 90;
const MIN_Z = -HALF - 10;
const MAX_Z = HALF + 10;

export interface MapMarker {
  x: number;
  z: number;
  kind: MarkerKind;
}
export type MarkerKind = 'start' | 'checkpoint' | 'next' | 'pickup' | 'dropoff' | 'car' | 'danfo' | 'person' | 'giver' | 'traffic';

/** Markers that stay pinned to the minimap edge when out of range. */
const STICKY: MarkerKind[] = ['start', 'checkpoint', 'pickup', 'dropoff', 'car', 'giver'];

const PLACES: { name: string; x: number; z: number }[] = [
  { name: 'Market', x: -80, z: 80 },
  { name: 'Bus park', x: 0, z: 80 },
  { name: 'Square', x: 0, z: 0 },
  { name: 'Harbour Rd', x: 131, z: -90 },
  { name: 'Lagoon', x: 175, z: -60 },
  { name: 'Workshop', x: 86, z: -16 },
];

export class Minimap {
  private ctx: CanvasRenderingContext2D;
  private base: HTMLCanvasElement;
  private size = 0;
  private dpr = 1;

  constructor(private canvas: HTMLCanvasElement, world: CollisionWorld) {
    this.ctx = canvas.getContext('2d')!;
    this.base = document.createElement('canvas');
    this.base.width = (MAX_X - MIN_X) * PX_PER_M;
    this.base.height = (MAX_Z - MIN_Z) * PX_PER_M;
    this.paintBase(world);
  }

  private paintBase(world: CollisionWorld): void {
    const g = this.base.getContext('2d')!;
    const X = (x: number) => (x - MIN_X) * PX_PER_M;
    const Z = (z: number) => (z - MIN_Z) * PX_PER_M;
    const rect = (x0: number, z0: number, x1: number, z1: number, color: string) => {
      g.fillStyle = color;
      g.fillRect(X(x0), Z(z0), (x1 - x0) * PX_PER_M, (z1 - z0) * PX_PER_M);
    };
    g.fillStyle = '#1d4f5c';
    g.fillRect(0, 0, this.base.width, this.base.height);
    rect(-HALF, -HALF, SHORE, HALF, '#6e4a36');
    // Special blocks
    rect(-114, 46, -46, 114, '#7a4a3c'); // market
    rect(-34, 46, 34, 114, '#5e5246');   // bus park
    rect(-34, -34, 34, 34, '#8c867c');   // square paving
    rect(-22, -22, 22, 22, '#3f6b2e');   // square lawn
    rect(126, -HALF, SHORE, HALF, '#8c867c'); // promenade
    rect(46, -34, 114, 34, '#6f6c66'); // workshop yard
    // Roads and bridge
    for (const x of ROAD_LINES) rect(x - ROAD_W / 2, -HALF, x + ROAD_W / 2, HALF, '#d8d1bf');
    for (const z of ROAD_LINES) rect(-HALF, z - ROAD_W / 2, SHORE, z + ROAD_W / 2, '#d8d1bf');
    rect(SHORE, BRIDGE_Z - ROAD_W / 2, SHORE + 80, BRIDGE_Z + ROAD_W / 2, '#c9c1ad');
    rect(SHORE + 76, BRIDGE_Z - ROAD_W / 2, SHORE + 80, BRIDGE_Z + ROAD_W / 2, '#c0392b');
    // Buildings and solid props (skip the tall invisible boundary walls)
    for (const b of world.boxes) {
      if (b.height < 1.6 || b.height > 39) continue;
      g.fillStyle = b.height > 8 ? '#3b3733' : '#4d4741';
      g.fillRect(X(b.minX), Z(b.minZ), (b.maxX - b.minX) * PX_PER_M, (b.maxZ - b.minZ) * PX_PER_M);
    }
    // Bus stops: small blue squares by the shelters
    for (const st of BUS_STOPS) {
      g.fillStyle = '#2e86c1';
      g.fillRect(X(st.shelter.x) - 5, Z(st.shelter.z) - 5, 10, 10);
      g.fillStyle = '#ffffff';
      g.fillRect(X(st.shelter.x) - 2, Z(st.shelter.z) - 2, 4, 4);
    }
    // District edge
    g.strokeStyle = '#c0392b';
    g.lineWidth = 3;
    g.strokeRect(X(-HALF), Z(-HALF), (SHORE + HALF) * PX_PER_M, 2 * HALF * PX_PER_M);
  }

  private fit(): void {
    const size = this.canvas.clientWidth || 190;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (size !== this.size || dpr !== this.dpr) {
      this.size = size;
      this.dpr = dpr;
      this.canvas.width = Math.round(size * dpr);
      this.canvas.height = Math.round(size * dpr);
    }
  }

  /**
   * px/pz: where you are; heading: which way you (or the car) face; camYaw: camera direction.
   * spanM: how many metres the map shows edge to edge.
   */
  draw(px: number, pz: number, heading: number, camYaw: number, spanM: number, markers: MapMarker[]): void {
    this.fit();
    const g = this.ctx;
    const s = this.size;
    const scale = s / spanM; // screen px per metre
    const rot = -Math.PI / 2 - camYaw;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const toScreen = (x: number, z: number) => {
      const dx = (x - px) * scale;
      const dz = (z - pz) * scale;
      return { x: s / 2 + dx * cos - dz * sin, y: s / 2 + dx * sin + dz * cos };
    };

    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, s, s);
    g.save();
    g.beginPath();
    g.rect(0, 0, s, s);
    g.clip();
    g.fillStyle = '#1d4f5c';
    g.fillRect(0, 0, s, s);

    // Rotated district image
    g.save();
    g.translate(s / 2, s / 2);
    g.rotate(rot);
    g.scale(scale / PX_PER_M, scale / PX_PER_M);
    g.translate((MIN_X - px) * PX_PER_M, (MIN_Z - pz) * PX_PER_M);
    g.imageSmoothingEnabled = true;
    g.drawImage(this.base, 0, 0);
    g.restore();

    // Place names (kept upright)
    g.font = '700 11px "Barlow Condensed", "Arial Narrow", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const p of PLACES) {
      const q = toScreen(p.x, p.z);
      if (q.x < -30 || q.x > s + 30 || q.y < -10 || q.y > s + 10) continue;
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(10,10,8,.8)';
      g.strokeText(p.name.toUpperCase(), q.x, q.y);
      g.fillStyle = 'rgba(243,236,216,.9)';
      g.fillText(p.name.toUpperCase(), q.x, q.y);
    }

    // Markers; important ones stick to the edge when off-map.
    const edge = 9;
    for (const m of markers) {
      let q = toScreen(m.x, m.z);
      const sticky = STICKY.includes(m.kind);
      const off = q.x < edge || q.x > s - edge || q.y < edge || q.y > s - edge;
      if (off && !sticky) continue;
      if (off) {
        const cx = s / 2, cy = s / 2, dx = q.x - cx, dy = q.y - cy;
        const k = Math.min((s / 2 - edge) / Math.abs(dx || 1e-6), (s / 2 - edge) / Math.abs(dy || 1e-6));
        q = { x: cx + dx * k, y: cy + dy * k };
      }
      this.marker(g, m.kind, q.x, q.y);
    }

    // You: arrow at the centre, pointing where you face.
    g.save();
    g.translate(s / 2, s / 2);
    g.rotate(heading + rot);
    g.fillStyle = '#ffffff';
    g.strokeStyle = '#0b0b0a';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(9, 0);
    g.lineTo(-6, -6);
    g.lineTo(-3, 0);
    g.lineTo(-6, 6);
    g.closePath();
    g.stroke();
    g.fill();
    g.restore();

    // North indicator on the rim
    const north = toScreen(px, pz - 1000);
    const nx = north.x - s / 2, ny = north.y - s / 2, nl = Math.hypot(nx, ny) || 1;
    const nr = s / 2 - 11;
    g.font = '800 12px "Barlow Condensed", "Arial Narrow", sans-serif';
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(10,10,8,.9)';
    g.strokeText('N', s / 2 + (nx / nl) * nr, s / 2 + (ny / nl) * nr);
    g.fillStyle = '#f5c518';
    g.fillText('N', s / 2 + (nx / nl) * nr, s / 2 + (ny / nl) * nr);
    g.restore();
  }

  private marker(g: CanvasRenderingContext2D, kind: MarkerKind, x: number, y: number, k = 1): void {
    switch (kind) {
      case 'start': return this.dot(x, y, 6 * k, '#f5c518', g);
      case 'checkpoint': return this.dot(x, y, 6 * k, '#63d681', g);
      case 'next': return this.dot(x, y, 4 * k, 'rgba(99,214,129,.55)', g);
      case 'pickup': return this.dot(x, y, 6 * k, '#ff9a3c', g);
      case 'dropoff': return this.dot(x, y, 6 * k, '#4bb3ff', g);
      case 'person': return this.dot(x, y, 2.5 * k, 'rgba(243,236,216,.85)', g);
      case 'traffic': return this.dot(x, y, 2.5 * k, 'rgba(20,20,20,.9)', g);
      case 'car':
      case 'danfo':
        g.fillStyle = kind === 'car' ? '#4b8dff' : '#f5c518';
        g.strokeStyle = '#0b0b0a';
        g.lineWidth = 2;
        g.beginPath();
        g.roundRect(x - 6 * k, y - 4 * k, 12 * k, 8 * k, 2);
        g.fill();
        g.stroke();
        return;
      case 'giver':
        this.dot(x, y, 7 * k, '#ff9a3c', g);
        g.fillStyle = '#0b0b0a';
        g.font = `800 ${Math.round(12 * k)}px "Barlow Condensed", "Arial Narrow", sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('!', x, y + 0.5);
        return;
    }
  }

  /** Full-screen, north-up map (M). Fits the whole district into the canvas. */
  drawFull(canvas: HTMLCanvasElement, px: number, pz: number, heading: number, markers: MapMarker[]): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || 600, h = canvas.clientHeight || 500;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const g = canvas.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#1d4f5c';
    g.fillRect(0, 0, w, h);
    const bw = this.base.width, bh = this.base.height;
    const k = Math.min(w / bw, h / bh);
    const ox = (w - bw * k) / 2, oy = (h - bh * k) / 2;
    g.imageSmoothingEnabled = true;
    g.drawImage(this.base, ox, oy, bw * k, bh * k);
    const S = (x: number, z: number) => ({ x: ox + (x - MIN_X) * PX_PER_M * k, y: oy + (z - MIN_Z) * PX_PER_M * k });
    // Scale place names with the map so neighbouring names don't collide on small screens.
    const fs = Math.max(9, Math.min(15, Math.round(PX_PER_M * k * 13)));
    g.font = `700 ${fs}px "Barlow Condensed", "Arial Narrow", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const p of PLACES) {
      const q = S(p.x, p.z);
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(10,10,8,.85)';
      g.strokeText(p.name.toUpperCase(), q.x, q.y);
      g.fillStyle = 'rgba(243,236,216,.95)';
      g.fillText(p.name.toUpperCase(), q.x, q.y);
    }
    for (const m of markers) {
      const q = S(m.x, m.z);
      this.marker(g, m.kind, q.x, q.y, 1.15);
    }
    const q = S(px, pz);
    g.save();
    g.translate(q.x, q.y);
    g.rotate(heading);
    g.fillStyle = '#ffffff';
    g.strokeStyle = '#0b0b0a';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(11, 0);
    g.lineTo(-7, -7);
    g.lineTo(-3, 0);
    g.lineTo(-7, 7);
    g.closePath();
    g.stroke();
    g.fill();
    g.restore();
    g.font = '800 16px "Barlow Condensed", "Arial Narrow", sans-serif';
    g.fillStyle = '#f5c518';
    g.fillText('N ↑', w - 26, 18);
  }

  private dot(x: number, y: number, r: number, color: string, g = this.ctx): void {
    g.fillStyle = color;
    g.strokeStyle = '#0b0b0a';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
}
