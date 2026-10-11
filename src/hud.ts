import { AIRFIELD, HALF, MARINA, SHORE } from './district';
import type { RoadGraph } from './traffic';
import type { WeaponClass } from './weapons';

/**
 * HUD helpers for the "Lagos dusk" layout: the route line on the minimap, the area name over it,
 * the clock, sprint stamina, and the weapon wheel's icons. Original Gangs of Lagos UI.
 */

/** Shortest road route (Dijkstra on the road graph) from one point to another, as map points. */
export function routeTo(g: RoadGraph, from: { x: number; z: number }, to: { x: number; z: number }): [number, number][] {
  const n = g.nodes.length;
  if (!n) return [[from.x, from.z], [to.x, to.z]];
  const near = (p: { x: number; z: number }) => {
    let best = 0, bd = Infinity;
    g.nodes.forEach((q, i) => {
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d < bd) (bd = d), (best = i);
    });
    return { i: best, d: bd };
  };
  const a = near(from), b = near(to);
  // Close by, or nowhere near a road: just draw a straight line.
  if (Math.hypot(to.x - from.x, to.z - from.z) < a.d + b.d + 10 || a.d > 90 || b.d > 90) return [[from.x, from.z], [to.x, to.z]];
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const [p, q] of g.edges) {
    adj[p].push(q);
    adj[q].push(p);
  }
  const dist = new Array<number>(n).fill(Infinity), prev = new Array<number>(n).fill(-1), done = new Array<boolean>(n).fill(false);
  dist[a.i] = 0;
  for (let k = 0; k < n; k++) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0 || dist[u] === Infinity) break;
    done[u] = true;
    if (u === b.i) break;
    for (const v of adj[u]) {
      const w = dist[u] + Math.hypot(g.nodes[u].x - g.nodes[v].x, g.nodes[u].z - g.nodes[v].z);
      if (w < dist[v]) (dist[v] = w), (prev[v] = u);
    }
  }
  if (dist[b.i] === Infinity) return [[from.x, from.z], [to.x, to.z]];
  const path: [number, number][] = [];
  for (let u = b.i; u >= 0; u = prev[u]) path.unshift([g.nodes[u].x, g.nodes[u].z]);
  return [[from.x, from.z], ...path, [to.x, to.z]];
}

/** Name of the neighbourhood you're in (shown over the minimap). */
export function areaName(x: number, z: number, mapArea: string | null): string {
  if (mapArea) return mapArea;
  if (x >= AIRFIELD.minX && x <= AIRFIELD.maxX && z >= AIRFIELD.minZ && z <= AIRFIELD.maxZ) return 'Lagoon Point Airfield';
  if (x >= MARINA.minX && x <= MARINA.maxX && z >= MARINA.minZ && z <= MARINA.maxZ) return 'Marina Point';
  if (x > MARINA.maxX && x < AIRFIELD.minX && Math.abs(z - 40) < 12) return 'Lagoon Point Causeway';
  if (x > SHORE) return 'The Lagoon';
  if (x >= -HALF && x <= SHORE && Math.abs(z) <= HALF) return x > 120 ? 'Harbour Road' : 'Harbour Bend';
  return 'Harbour Bend';
}

/**
 * Game clock for the HUD. The world is always at dusk (there is no day/night cycle yet), so the clock
 * runs through the golden hour, one game minute every 5 seconds, from 18:00 to 19:59 and round again.
 */
export class GameClock {
  minutes = 18 * 60 + 30;
  update(dt: number): void {
    this.minutes += dt / 5;
    if (this.minutes >= 20 * 60) this.minutes = 18 * 60;
  }
  get text(): string {
    const m = Math.floor(this.minutes);
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }
}

/** Sprint stamina: drains while you sprint, comes back after a short rest. Run dry and you walk until it recovers a little. */
export class Stamina {
  value = 100;
  private rest = 0;
  private tired = false;
  /** Returns whether you may sprint this frame. */
  update(dt: number, wantSprint: boolean, moving: boolean): boolean {
    const sprinting = wantSprint && moving && !this.tired && this.value > 0;
    if (sprinting) {
      this.value = Math.max(0, this.value - 12 * dt);
      this.rest = 0;
      if (this.value === 0) this.tired = true;
    } else {
      this.rest += dt;
      if (this.rest > 0.8) this.value = Math.min(100, this.value + 20 * dt);
      if (this.tired && this.value >= 30) this.tired = false;
    }
    return sprinting;
  }
  get exhausted(): boolean {
    return this.tired;
  }
}

/** Simple original silhouettes for the weapon wheel (inline SVG paths, 64 x 32 box). */
export const WEAPON_ICONS: Record<WeaponClass, string> = {
  melee: 'M4 26 L50 6 L54 10 L8 30 Z',
  pistol: 'M14 8 H52 V15 H30 L26 28 H16 L20 15 H14 Z',
  smg: 'M6 9 H54 V15 H40 L38 28 H32 L34 15 H24 L20 24 H12 L16 15 H6 Z',
  shotgun: 'M2 10 H60 V15 H24 L14 25 H4 L10 15 H2 Z',
  rifle: 'M2 10 H62 V14 H44 L42 26 H36 L38 14 H22 L12 24 H4 L12 14 H2 Z',
  marksman: 'M2 11 H62 V14 H40 L38 24 H33 L35 14 H20 L10 22 H3 L10 14 H2 Z M26 5 H44 V9 H26 Z',
};
