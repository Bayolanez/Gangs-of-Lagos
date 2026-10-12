import * as THREE from 'three';
import type { CollisionWorld } from './collision';
import { routeTo } from './hud';
import type { RoadGraph } from './traffic';
import { Obstacle, Vehicle } from './vehicles';

/**
 * Patrol pursuit (Night Exit): cars of the fictional Harbour Patrol Unit chase you along the roads.
 * They are ordinary vehicles with the same physics as yours, driven by a simple AI that follows a
 * road route to you (Dijkstra on the road graph) and goes straight for you when close. If one pins
 * you down (close and you are nearly stopped, or on foot) the "caught" meter fills.
 */
interface Patrol {
  car: Vehicle;
  route: [number, number][];
  routeT: number;
  stuck: number;
  reverse: number;
  far: number;
  dead: number;
  bar: THREE.Mesh[];
}

export interface PursuitTarget {
  x: number;
  z: number;
  heading: number;
  speed: number;
  inVehicle: boolean;
}

const PATROL_PAINT = '#1c2a4a';

export class Pursuit {
  active = false;
  /** 0 to 1: full means you are caught. */
  caught = 0;
  nearest = Infinity;
  private patrols: Patrol[] = [];
  private flash = 0;

  constructor(private scene: THREE.Scene, private rand: () => number) {}

  get cars(): Vehicle[] {
    return this.patrols.map((p) => p.car);
  }

  /** Circles for other vehicles to collide with. */
  obstacles(): Obstacle[] {
    return this.patrols.flatMap((p) => p.car.circles());
  }

  start(count: number, at: PursuitTarget, graph: RoadGraph): void {
    this.stop();
    this.active = true;
    this.caught = 0;
    for (let i = 0; i < count; i++) this.spawn(at, graph, i);
  }

  stop(): void {
    for (const p of this.patrols) p.car.group.removeFromParent();
    this.patrols = [];
    this.active = false;
    this.caught = 0;
    this.nearest = Infinity;
  }

  /** Put a patrol car on a road junction 70-140 m from you, facing you. */
  private spawn(at: PursuitTarget, graph: RoadGraph, i: number, old?: Patrol): void {
    const spots = graph.nodes.filter((n) => {
      const d = Math.hypot(n.x - at.x, n.z - at.z);
      return d > 70 && d < 140;
    });
    const pool = spots.length ? spots : graph.nodes;
    const n = pool[Math.floor(this.rand() * pool.length) % pool.length] ?? { x: at.x + 90, z: at.z };
    const heading = Math.atan2(at.z - n.z, at.x - n.x);
    // Spread cars that share a junction.
    const ox = Math.cos(heading + Math.PI / 2) * (i % 2 ? 3 : -3);
    const oz = Math.sin(heading + Math.PI / 2) * (i % 2 ? 3 : -3);
    if (old) {
      old.car.repair();
      old.car.place(n.x + ox, n.z + oz, heading);
      old.route = [];
      old.routeT = 0;
      old.far = old.dead = old.stuck = old.reverse = 0;
      return;
    }
    const car = new Vehicle('sedan', n.x + ox, n.z + oz, heading, PATROL_PAINT);
    car.hasDriver = true;
    car.group.name = 'patrol-car';
    // Roof light bar: blue and red, flashing (fictional unit, no real force's livery).
    const bar: THREE.Mesh[] = [];
    for (const [z, c] of [[-0.32, '#2f6bff'], [0.32, '#ff3040']] as const) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.14, 0.5), new THREE.MeshBasicMaterial({ color: c }));
      m.position.set(-0.2, 1.55, z);
      car.group.add(m);
      bar.push(m);
    }
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.12, 1.9), new THREE.MeshStandardMaterial({ color: '#f0efe9', roughness: 0.5 }));
    stripe.position.set(0, 0.75, 0);
    car.group.add(stripe);
    this.scene.add(car.group);
    this.patrols.push({ car, route: [], routeT: 0, stuck: 0, reverse: 0, far: 0, dead: 0, bar });
  }

  update(dt: number, t: PursuitTarget, graph: RoadGraph, world: CollisionWorld, others: Obstacle[], now: number): void {
    if (!this.active) return;
    this.flash += dt;
    const on = Math.floor(this.flash * 6) % 2 === 0;
    let nearest = Infinity;
    for (const [i, p] of this.patrols.entries()) {
      const car = p.car;
      p.bar[0].visible = on;
      p.bar[1].visible = !on;
      if (car.wrecked) {
        // A wrecked patrol car is replaced after a few seconds by a fresh one further off.
        p.dead += dt;
        car.update(dt, null, world, others, now);
        if (p.dead > 5) this.spawn(t, graph, i, p);
        continue;
      }
      const d = Math.hypot(t.x - car.x, t.z - car.z);
      nearest = Math.min(nearest, d);
      // Fallen far behind: come back on a junction nearer to you.
      p.far = d > 220 ? p.far + dt : 0;
      if (p.far > 4) this.spawn(t, graph, i, p);

      // Where to drive: straight at you when close, otherwise along the road route.
      p.routeT -= dt;
      if (p.routeT <= 0) {
        p.route = routeTo(graph, car, t).slice(1);
        p.routeT = 1.2;
      }
      while (p.route.length > 1 && Math.hypot(p.route[0][0] - car.x, p.route[0][1] - car.z) < 7) p.route.shift();
      const lead = Math.min(1.2, d / 25);
      const aim = d < 32 || !p.route.length ? { x: t.x + Math.cos(t.heading) * t.speed * lead, z: t.z + Math.sin(t.heading) * t.speed * lead } : { x: p.route[0][0], z: p.route[0][1] };
      let diff = Math.atan2(aim.z - car.z, aim.x - car.x) - car.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      let throttle = Math.abs(diff) > 1.1 ? 0.35 : 1;
      if (d < 9 && Math.abs(t.speed) < 3) throttle = car.speed > 2 ? -0.6 : 0.15; // box you in, gently
      let steer = THREE.MathUtils.clamp(diff * 2.2, -1, 1);
      // Stuck against something: back off and turn.
      p.stuck = Math.abs(car.speed) < 1.2 && throttle > 0.3 ? p.stuck + dt : 0;
      if (p.stuck > 1.3) {
        p.reverse = 1.1;
        p.stuck = 0;
      }
      if (p.reverse > 0) {
        p.reverse -= dt;
        throttle = -1;
        steer = -steer;
      }
      const obs = others.concat(this.patrols.filter((q) => q !== p).flatMap((q) => q.car.circles()));
      car.update(dt, { throttle, steer, handbrake: false }, world, obs, now);
    }
    this.nearest = nearest;
    // Caught: a patrol car right on you while you are almost stopped (or on foot).
    const pinned = t.inVehicle ? nearest < 7.5 && Math.abs(t.speed) < 4 : nearest < 10;
    this.caught = THREE.MathUtils.clamp(this.caught + (pinned ? dt / (t.inVehicle ? 3 : 1.6) : -dt / 3), 0, 1);
  }
}
