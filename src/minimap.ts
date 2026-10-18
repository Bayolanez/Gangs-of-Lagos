import type { CollisionWorld } from './collision';
import { AIRFIELD, BOUNDARY_H, BRIDGE_Z, BUS_STOPS, CAUSEWAY, HALF, JETTY, MARINA, ROAD_LINES, ROAD_W, SHORE } from './district';

/**
 * Top-left minimap. The district is drawn once into an offscreen image, then each frame that image is
 * rotated so the camera's forward direction points up (like most open-world games).
 */
const PX_PER_M = 2;
const MIN_X = -HALF - 10;
const MAX_X = AIRFIELD.maxX + 12;
const MIN_Z = -HALF - 10;
const MAX_Z = HALF + 10;

export interface MapMarker {
  x: number;
  z: number;
  kind: MarkerKind;
}
export type MarkerKind = 'start' | 'checkpoint' | 'next' | 'pickup' | 'dropoff' | 'car' | 'danfo' | 'person' | 'giver' | 'traffic' | 'rival' | 'shop' | 'officer' | 'range' | 'hospital' | 'craft' | 'mission' | 'tower' | 'patrol' | 'crewhouse' | 'club' | 'gunshop' | 'crew-blue' | 'crew-red' | 'crew-yellow' | 'boss' | 'hotel';

/** Markers that stay pinned to the minimap edge when out of range. */
const STICKY: MarkerKind[] = ['start', 'checkpoint', 'pickup', 'dropoff', 'car', 'giver', 'rival', 'officer', 'mission', 'patrol'];

const PLACES: { name: string; x: number; z: number }[] = [
  { name: 'Market', x: -80, z: 80 },
  { name: 'Bus park', x: 0, z: 80 },
  { name: 'Square', x: 0, z: 0 },
  { name: 'Harbour Rd', x: 131, z: -90 },
  { name: 'Lagoon', x: 175, z: -60 },
  { name: 'Workshop', x: 86, z: -16 },
  { name: 'Marina Point', x: 272, z: -122 },
  { name: 'Towers', x: 272, z: -30 },
  { name: 'Shops', x: 262, z: 80 },
  { name: 'Fuel', x: 337, z: -10 },
  { name: 'Gardens', x: 337, z: 84 },
  { name: 'Jetty', x: 208, z: -72 },
  { name: 'Airfield', x: 760, z: 80 },
  { name: 'Causeway', x: 460, z: 30 },
];

export class Minimap {
  private ctx: CanvasRenderingContext2D;
  private base: HTMLCanvasElement;
  private size = 0;
  private dpr = 1;

  private bridgeOpen = false;
  /** What the map shows: Harbour Bend and Marina Point, or a streamed map area (Phase 5). */
  private view: HTMLCanvasElement;
  private minX = MIN_X;
  private minZ = MIN_Z;
  private ppm = PX_PER_M;
  private places = PLACES;
  private area: { roads: { type: string; w: number; pts: [number, number][] }[]; ox: number; oz: number; x0: number; z0: number; x1: number; z1: number } | null = null;

  constructor(private canvas: HTMLCanvasElement, private world: CollisionWorld) {
    this.ctx = canvas.getContext('2d')!;
    this.base = document.createElement('canvas');
    this.base.width = (MAX_X - MIN_X) * PX_PER_M;
    this.base.height = (MAX_Z - MIN_Z) * PX_PER_M;
    this.paintBase(world);
    this.view = this.base;
  }

  /**
   * Phase 5: switch the map to a streamed area (game coordinates of its corners). Roads come from the
   * area's road graph straight away; buildings and ground areas are painted in as tiles load.
   */
  setArea(x0: number, z0: number, x1: number, z1: number, roads: { type: string; w: number; pts: [number, number][] }[], ox: number, oz: number, name: string): void {
    const ppm = 1;
    const c = document.createElement('canvas');
    c.width = Math.ceil(x1 - x0 + 40) * ppm;
    c.height = Math.ceil(z1 - z0 + 40) * ppm;
    this.view = c;
    this.minX = x0 - 20;
    this.minZ = z0 - 20;
    this.ppm = ppm;
    this.area = { roads, ox, oz, x0, z0, x1, z1 };
    this.places = [{ name, x: (x0 + x1) / 2, z: z0 + 12 }];
    const g = c.getContext('2d')!;
    g.fillStyle = '#5e3c4c';
    g.fillRect(0, 0, c.width, c.height);
    this.paintRoads();
  }

  private paintRoads(): void {
    const a = this.area;
    if (!a) return;
    const { roads, ox, oz, x0, z0, x1, z1 } = a;
    const ppm = this.ppm;
    const g = this.view.getContext('2d')!;
    const colour: Record<string, string> = { expressway: '#efe8d6', brt: '#c0623f', service: '#bdb6a4', inner: '#f0d8c8', market: '#b9977a' };
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const type of ['market', 'service', 'inner', 'brt', 'expressway']) {
      for (const r of roads) {
        if (r.type !== type) continue;
        g.strokeStyle = colour[type];
        g.lineWidth = Math.max(3, r.w) * ppm;
        g.beginPath();
        r.pts.forEach(([x, z], i) => (i ? g.lineTo : g.moveTo).call(g, (x + ox - this.minX) * ppm, (z + oz - this.minZ) * ppm));
        g.stroke();
      }
    }
    g.strokeStyle = '#c0392b';
    g.lineWidth = 3;
    g.strokeRect((x0 - this.minX) * ppm, (z0 - this.minZ) * ppm, (x1 - x0) * ppm, (z1 - z0) * ppm);
  }

  /** Paint a loaded tile's buildings and ground areas into the area map (under the roads' colour order). */
  paintTile(buildings: { pts: [number, number][]; h: number }[], areas: { kind: string; pts: [number, number][] }[], ox: number, oz: number): void {
    if (!this.area) return;
    const g = this.view.getContext('2d')!;
    const poly = (pts: [number, number][], fill: string) => {
      g.fillStyle = fill;
      g.beginPath();
      pts.forEach(([x, z], i) => (i ? g.lineTo : g.moveTo).call(g, (x + ox - this.minX) * this.ppm, (z + oz - this.minZ) * this.ppm));
      g.closePath();
      g.fill();
    };
    const fills: Record<string, string> = { water: '#123f52', beach: '#d9c79a', green: '#2f6a4a', market: '#9c8a93' };
    for (const a of areas) poly(a.pts, fills[a.kind] ?? '#5e3c4c');
    this.paintRoads(); // roads stay on top of ground areas
    for (const b of buildings) poly(b.pts, b.h > 8 ? '#2a2142' : '#3a2e52');
  }

  /** Back to the Harbour Bend and Marina Point map. */
  clearArea(): void {
    this.view = this.base;
    this.minX = MIN_X;
    this.minZ = MIN_Z;
    this.ppm = PX_PER_M;
    this.places = PLACES;
    this.area = null;
  }

  /** Repaint the district image once the Old Ferry Bridge reopens (removes the red barrier). */
  setBridgeOpen(open: boolean): void {
    if (open === this.bridgeOpen) return;
    this.bridgeOpen = open;
    this.paintBase(this.world);
  }

  private paintBase(world: CollisionWorld): void {
    const g = this.base.getContext('2d')!;
    const X = (x: number) => (x - MIN_X) * PX_PER_M;
    const Z = (z: number) => (z - MIN_Z) * PX_PER_M;
    const rect = (x0: number, z0: number, x1: number, z1: number, color: string) => {
      g.fillStyle = color;
      g.fillRect(X(x0), Z(z0), (x1 - x0) * PX_PER_M, (z1 - z0) * PX_PER_M);
    };
    g.fillStyle = '#123f52';
    g.fillRect(0, 0, this.base.width, this.base.height);
    rect(-HALF, -HALF, SHORE, HALF, '#5e3c4c');
    // Special blocks
    rect(-114, 46, -46, 114, '#7a3f52'); // market
    rect(-34, 46, 34, 114, '#56465c');   // bus park
    rect(-34, -34, 34, 34, '#9c8a93');   // square paving
    rect(-22, -22, 22, 22, '#2f6a4a');   // square lawn
    rect(126, -HALF, SHORE, HALF, '#9c8a93'); // promenade
    rect(46, -34, 114, 34, '#6f6c66'); // workshop yard
    // Marina Point
    rect(MARINA.minX, MARINA.minZ, MARINA.maxX, MARINA.maxZ, '#5e3c4c');
    rect(MARINA.minX, MARINA.minZ, MARINA.minX + 6, MARINA.maxZ, '#9c8a93');
    rect(318, 46, 356, 114, '#2f6a4a'); // gardens
    rect(318, 0, 356, 34, '#9c8a93'); // fuel forecourt
    // Roads and bridge
    for (const x of ROAD_LINES) rect(x - ROAD_W / 2, -HALF, x + ROAD_W / 2, HALF, '#f0d8c8');
    for (const z of ROAD_LINES) rect(-HALF, z - ROAD_W / 2, SHORE, z + ROAD_W / 2, '#f0d8c8');
    for (const x of MARINA.X) rect(x - ROAD_W / 2, MARINA.minZ, x + ROAD_W / 2, MARINA.maxZ, '#f0d8c8');
    for (const z of MARINA.Z) rect(z === BRIDGE_Z ? MARINA.minX : MARINA.X[0] - ROAD_W / 2, z - ROAD_W / 2, MARINA.maxX, z + ROAD_W / 2, '#f0d8c8');
    rect(SHORE, BRIDGE_Z - ROAD_W / 2, SHORE + 80, BRIDGE_Z + ROAD_W / 2, '#c9c1ad');
    // Phase 6: causeway, airfield and jetty
    rect(CAUSEWAY.x0, CAUSEWAY.z - 6, CAUSEWAY.x1, CAUSEWAY.z + 6, '#c9c1ad');
    rect(AIRFIELD.minX, AIRFIELD.minZ, AIRFIELD.maxX, AIRFIELD.maxZ, '#5d6b45');
    const rw = AIRFIELD.runway;
    rect(rw.x0, rw.z - rw.w / 2, rw.x1, rw.z + rw.w / 2, '#2f2f2f');
    for (let x = rw.x0 + 20; x < rw.x1 - 20; x += 30) rect(x, rw.z - 0.6, x + 14, rw.z + 0.6, '#efe8d6');
    rect(AIRFIELD.pad.x - 8, AIRFIELD.pad.z - 8, AIRFIELD.pad.x + 8, AIRFIELD.pad.z + 8, '#9c8a93');
    rect(JETTY.x0, JETTY.z0, JETTY.x1, JETTY.z1, '#9a7b55');
    if (!this.bridgeOpen) rect(SHORE + 76, BRIDGE_Z - ROAD_W / 2, SHORE + 80, BRIDGE_Z + ROAD_W / 2, '#c0392b');
    // Buildings and solid props (skip the tall invisible boundary walls)
    for (const b of world.boxes) {
      if (b.height < 1.6 || b.height === BOUNDARY_H) continue;
      g.fillStyle = b.height > 8 ? '#2a2142' : '#3a2e52';
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
    g.strokeRect(X(MARINA.minX), Z(MARINA.minZ), (MARINA.maxX - MARINA.minX) * PX_PER_M, (MARINA.maxZ - MARINA.minZ) * PX_PER_M);
    g.strokeRect(X(AIRFIELD.minX), Z(AIRFIELD.minZ), (AIRFIELD.maxX - AIRFIELD.minX) * PX_PER_M, (AIRFIELD.maxZ - AIRFIELD.minZ) * PX_PER_M);
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
  draw(px: number, pz: number, heading: number, camYaw: number, spanM: number, markers: MapMarker[], route: [number, number][] = []): void {
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
    g.fillStyle = '#123f52';
    g.fillRect(0, 0, s, s);

    // Rotated district image
    g.save();
    g.translate(s / 2, s / 2);
    g.rotate(rot);
    g.scale(scale / this.ppm, scale / this.ppm);
    g.translate((this.minX - px) * this.ppm, (this.minZ - pz) * this.ppm);
    g.imageSmoothingEnabled = true;
    g.drawImage(this.view, 0, 0);
    g.restore();

    // Route to the objective along the roads (gold line with an ink edge).
    if (route.length > 1) {
      g.lineCap = 'round';
      g.lineJoin = 'round';
      for (const [w, c] of [[7, 'rgba(27,18,51,.85)'], [3.5, '#ffb43c']] as const) {
        g.lineWidth = w;
        g.strokeStyle = c;
        g.beginPath();
        route.forEach(([x, z], i) => {
          const q = toScreen(x, z);
          if (i) g.lineTo(q.x, q.y);
          else g.moveTo(q.x, q.y);
        });
        g.stroke();
      }
    }

    // Place names (kept upright)
    g.font = '700 11px "Barlow Condensed", "Arial Narrow", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const p of this.places) {
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
      case 'rival': return this.dot(x, y, 5 * k, '#a259d9', g);
      case 'officer': return this.dot(x, y, 4 * k, '#3d7bff', g);
      case 'patrol': return this.dot(x, y, 5 * k, '#ff3040', g);
      case 'crew-blue': return this.dot(x, y, 5 * k, '#1f6fd1', g);
      case 'crew-red': return this.dot(x, y, 5 * k, '#c62828', g);
      case 'crew-yellow': return this.dot(x, y, 5 * k, '#f2b705', g);
      case 'range':
      case 'hospital':
      case 'tower':
      case 'mission':
      case 'crewhouse':
      case 'club':
      case 'gunshop':
      case 'boss':
      case 'hotel': {
        const col = { range: '#e67e22', hospital: '#2e86c1', tower: '#1f3d47', mission: '#ff4fa3', crewhouse: '#2e7d32', club: '#a0307a', gunshop: '#b71c1c', boss: '#b8902a', hotel: '#2c3e70' }[kind];
        const letter = { range: 'R', hospital: 'H', tower: 'B', mission: '★', crewhouse: 'C', club: '♪', gunshop: 'G', boss: 'A', hotel: 'P' }[kind];
        this.dot(x, y, 7 * k, col, g);
        g.fillStyle = '#ffffff';
        g.font = `800 ${Math.round(11 * k)}px "Barlow Condensed", "Arial Narrow", sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(letter, x, y + 0.5);
        return;
      }
      case 'craft':
        this.dot(x, y, 6 * k, '#dfe9ee', g);
        g.fillStyle = '#123f52';
        g.font = `800 ${Math.round(10 * k)}px "Barlow Condensed", "Arial Narrow", sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('✈', x, y + 0.5);
        return;
      case 'shop':
        this.dot(x, y, 6 * k, '#e6e1d6', g);
        g.fillStyle = '#5b2a86';
        g.fillRect(x - 2.5 * k, y - 2.5 * k, 5 * k, 5 * k);
        return;
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
    g.fillStyle = '#123f52';
    g.fillRect(0, 0, w, h);
    const bw = this.view.width, bh = this.view.height;
    const k = Math.min(w / bw, h / bh);
    const ox = (w - bw * k) / 2, oy = (h - bh * k) / 2;
    g.imageSmoothingEnabled = true;
    g.drawImage(this.view, ox, oy, bw * k, bh * k);
    const S = (x: number, z: number) => ({ x: ox + (x - this.minX) * this.ppm * k, y: oy + (z - this.minZ) * this.ppm * k });
    // Scale place names with the map so neighbouring names don't collide on small screens.
    const fs = Math.max(9, Math.min(15, Math.round(this.ppm * k * 13)));
    g.font = `700 ${fs}px "Barlow Condensed", "Arial Narrow", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const p of this.places) {
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
