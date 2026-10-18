import * as THREE from 'three';
import { HumanLook, HumanRig } from './human';

/**
 * Crews: three fictional street crews of Harbour Bend. Each walks its own turf as a group of five
 * (the leader in front), every member with a bandana in the crew's colour. Talk to a crew's leader to
 * hear them out and decide whether to join. You can run with one crew at a time; joining opens the
 * crew house north of the square. Names, colours and lines are invented for this game.
 *
 * Crew Life: crews are part of the fighting. Gunfire nearby scatters them; shoot one and that crew
 * fights back (pistols drawn, keeping their distance, shooting at you and your crew). Members go down
 * when hurt and get back up later. Two of your own crew can walk with you and fight on your side, and
 * a crew you beat on its own turf loses it to yours (turf wars, in main.ts).
 */
export type CrewId = 'blue' | 'red' | 'yellow';

export interface CrewDef {
  id: CrewId;
  name: string;
  colour: string;
  leader: string;
  /** Who leads a second group of this crew on turf it has taken. */
  lieutenant: string;
  /** The block whose pavement they walk round: [x0, z0, x1, z1]. */
  turf: [number, number, number, number];
  turfName: string;
  pitch: string;
  welcome: string;
  member: string;
  rival: string;
  /** Shirts for the five members (leader first). */
  shirts: string[];
}

export const CREWS: CrewDef[] = [
  {
    id: 'blue', name: 'Blue Tide', colour: '#1f6fd1', leader: 'Seyi', lieutenant: 'Kunmi', turf: [-34, -200, 34, -126], turfName: 'the north blocks',
    pitch: "You keep walking our side of town. Blue Tide looks after its own: a roof, a crew at your back, and work that pays. You want in?",
    welcome: "Welcome to Blue Tide. The house is north of the square, by the gun shop. Your room is ready.",
    member: "The house is open. Come to the planning table when you want work.",
    rival: "You run with another crew. Keep walking.",
    shirts: ['#1b2a44', '#22252a', '#2d3e5c', '#14161a', '#384a66'],
  },
  {
    id: 'red', name: 'Red Palm', colour: '#c62828', leader: 'Obi', lieutenant: 'Ebuka', turf: [-200, -34, -126, 34], turfName: 'the west blocks',
    pitch: "Red Palm don't ask twice. We have a house, we have cars and we have each other. Walk with us?",
    welcome: "You're Red Palm now. The crew house is north of the square. Get some sleep, then come and plan.",
    member: "Everything good? The planning table is where the work is.",
    rival: "Wrong colours for this street, friend. Move along.",
    shirts: ['#3a1416', '#22252a', '#4a2a22', '#14161a', '#5c2a2a'],
  },
  {
    id: 'yellow', name: 'Yellow Kite', colour: '#f2b705', leader: 'Amaka', lieutenant: 'Zainab', turf: [46, 46, 114, 114], turfName: 'the south-east blocks',
    pitch: "Yellow Kite flies high. We look out for the market and the bus park, and we look out for our own. Fly with us?",
    welcome: "Yellow Kite! Head to the crew house north of the square. There's a room with your name on it.",
    member: "Good to see you. The others are at the house.",
    rival: "Not your turf. Not your crew.",
    shirts: ['#2a2410', '#22252a', '#3a3320', '#14161a', '#4a4026'],
  },
];

export const crewById = (id: string | null | undefined): CrewDef | null => CREWS.find((c) => c.id === id) ?? null;

/** The look of a crew member: dark clothes and the crew's bandana. */
export function memberLook(crew: CrewDef, i: number): HumanLook {
  const skins = ['#3b2416', '#5a3a26', '#7a4e30', '#4a2e1c', '#6a4228'];
  const tops: HumanLook['top'][] = ['jacket', 'hoodie', 'tee', 'hoodie', 'jacket'];
  return { shirt: crew.shirts[i % crew.shirts.length], pants: i % 2 ? '#1c1d22' : '#2b2b2b', skin: skins[i % skins.length], top: tops[i % tops.length], cargo: i % 3 === 0, bandana: crew.colour };
}

interface Blocker {
  resolveCircle(c: { x: number; z: number }, r: number, smash?: boolean): unknown;
}

/** Someone a fighting crew can shoot at: you, or one of your crew walking with you. */
export interface Target {
  x: number;
  z: number;
  /** 'player' or a follower. */
  who: 'player' | Fighter;
}

/** What a crew needs from the game each frame. */
export interface CrewWorld {
  world: Blocker;
  px: number;
  pz: number;
  /** You're down (in hospital) or gone: fights end. */
  playerOut: boolean;
  targets: Target[];
  canSee(ax: number, az: number, bx: number, bz: number): boolean;
  /** A shot: who fired, at whom, and whether it hit. The game plays the sound and applies damage. */
  shoot(from: Fighter, at: Target, hit: boolean): void;
  /** A pistol to put in someone's hand. */
  gun(): THREE.Object3D;
  rand(): number;
}

/** One person who can walk, fight and go down (crew members and your followers). */
export class Fighter {
  readonly rig: HumanRig;
  x = 0;
  z = 0;
  heading = 0;
  health = 100;
  /** Seconds left lying down (0 = up). */
  downTimer = 0;
  private fall = 0;
  shootTimer = 1 + Math.random();
  private armed = false;

  constructor(look: HumanLook, name: string) {
    this.rig = new HumanRig(look);
    this.rig.root.name = name;
  }

  get down(): boolean {
    return this.downTimer > 0;
  }

  /** Take a hit; returns true if that put them down. */
  hurt(amount: number, downFor: number): boolean {
    if (this.down) return false;
    this.health -= amount;
    if (this.health > 0) return false;
    this.health = 0;
    this.downTimer = downFor;
    this.fall = 0;
    this.arm(null);
    return true;
  }

  /** Draw a pistol (or put it away with null). */
  arm(gun: THREE.Object3D | null): void {
    if (!!gun === this.armed) return;
    this.armed = !!gun;
    this.rig.hold(gun);
    this.rig.aim = gun ? 1 : 0;
  }

  get isArmed(): boolean {
    return this.armed;
  }

  /** Lying down, or getting up when the time is up. Returns true while down. */
  tickDown(dt: number, canGetUp: boolean): boolean {
    if (!this.down) return false;
    this.fall = Math.min(1, this.fall + dt * 3);
    if (canGetUp) this.downTimer = Math.max(0, this.downTimer - dt);
    if (this.downTimer === 0) {
      this.health = 100;
      this.fall = 0;
      this.rig.root.rotation.z = 0;
      this.rig.root.position.y = 0;
      return false;
    }
    this.rig.root.position.set(this.x, 0.15 * this.fall, this.z);
    this.rig.root.rotation.set(0, -this.heading, (Math.PI / 2) * this.fall);
    return true;
  }

  /** Step towards a point at a speed, pushed out of walls; returns the distance moved. */
  moveTo(tx: number, tz: number, speed: number, dt: number, world: Blocker): number {
    const dx = tx - this.x, dz = tz - this.z, d = Math.hypot(dx, dz);
    if (d < 0.05) return 0;
    const step = Math.min(d, speed * dt);
    const c = { x: this.x + (dx / d) * step, z: this.z + (dz / d) * step };
    world.resolveCircle(c, 0.3, false);
    const moved = Math.hypot(c.x - this.x, c.z - this.z);
    this.x = c.x;
    this.z = c.z;
    return moved;
  }

  face(heading: number, dt: number): void {
    const diff = Math.atan2(Math.sin(heading - this.heading), Math.cos(heading - this.heading));
    this.heading += diff * Math.min(1, dt * 8 || 1);
  }

  pose(speed: number, dt: number): void {
    this.rig.root.position.set(this.x, 0, this.z);
    this.rig.root.rotation.set(0, -this.heading, 0);
    this.rig.animate(dt, speed);
  }

  /** Shoot at a target if it's time, in range and in sight. */
  tryShoot(dt: number, at: Target, cw: CrewWorld, accuracy: number): void {
    this.shootTimer -= dt;
    const d = Math.hypot(at.x - this.x, at.z - this.z);
    if (this.shootTimer > 0 || d > 30) return;
    this.shootTimer = 1.3 + cw.rand() * 1.2;
    if (!cw.canSee(this.x, this.z, at.x, at.z)) return;
    cw.shoot(this, at, cw.rand() < Math.max(0.08, accuracy - d * 0.007));
  }
}

type Mode = 'walk' | 'scatter' | 'regroup' | 'fight';

/** One crew group walking a turf: five people following a loop round a block's pavement. */
export class CrewGroup {
  readonly members: Fighter[] = [];
  mode: Mode = 'walk';
  /** Distance along the loop of the leader. */
  private s = 0;
  private readonly loop: [number, number][];
  private readonly length: number;
  private modeTimer = 0;
  private from = { x: 0, z: 0 };
  /** Stopped to talk (someone is close to the leader). */
  paused = false;
  readonly turf: [number, number, number, number];
  readonly leaderName: string;

  constructor(scene: THREE.Scene, readonly def: CrewDef, start = 0, opts: { turf?: [number, number, number, number]; leaderName?: string } = {}) {
    this.turf = opts.turf ?? def.turf;
    this.leaderName = opts.leaderName ?? def.leader;
    const [x0, z0, x1, z1] = this.turf;
    const m = 2.4; // between the lamp posts and the shop fronts
    this.loop = [[x0 + m, z0 + m], [x1 - m, z0 + m], [x1 - m, z1 - m], [x0 + m, z1 - m]];
    this.length = 2 * (x1 - x0 - 2 * m) + 2 * (z1 - z0 - 2 * m);
    this.s = start * this.length;
    for (let i = 0; i < 5; i++) {
      const f = new Fighter(memberLook(def, i), `crew-${def.id}-${i}`);
      scene.add(f.rig.root);
      this.members.push(f);
    }
    this.members.forEach((f, i) => {
      const p = this.slot(i);
      f.x = p.x;
      f.z = p.z;
      f.heading = p.heading;
      f.pose(0, 0);
    });
  }

  get leader(): Fighter {
    return this.members[0];
  }

  get hostile(): boolean {
    return this.mode === 'fight';
  }

  /** Everyone is down: the fight is won. */
  get beaten(): boolean {
    return this.members.every((m) => m.down);
  }

  /** Can you talk to them right now (walking, leader standing)? */
  get canTalk(): boolean {
    return this.mode === 'walk' && !this.leader.down;
  }

  /** Point on the loop at distance d (wraps), and the direction of travel there. */
  private at(d: number): { x: number; z: number; dx: number; dz: number } {
    let r = ((d % this.length) + this.length) % this.length;
    for (let i = 0; i < 4; i++) {
      const [ax, az] = this.loop[i], [bx, bz] = this.loop[(i + 1) % 4];
      const seg = Math.hypot(bx - ax, bz - az);
      if (r <= seg) {
        const dx = (bx - ax) / seg, dz = (bz - az) / seg;
        return { x: ax + dx * r, z: az + dz * r, dx, dz };
      }
      r -= seg;
    }
    return { x: this.loop[0][0], z: this.loop[0][1], dx: 1, dz: 0 };
  }

  /** Member i's place in the walking group: the leader in front, then pairs behind. */
  private slot(i: number): { x: number; z: number; heading: number } {
    const slots: [number, number][] = [[0, 0], [-1.6, -0.75], [-1.6, 0.75], [-3.2, -0.75], [-3.2, 0.75]];
    const [back, side] = slots[i];
    const p = this.at(this.s + back);
    return { x: p.x - p.dz * side, z: p.z + p.dx * side, heading: Math.atan2(p.dz, p.dx) };
  }

  /** Shots nearby: scatter (unless already fighting). */
  hear(x: number, z: number): void {
    if (this.mode === 'fight') return;
    this.mode = 'scatter';
    this.modeTimer = 5;
    this.from = { x, z };
    this.paused = false;
  }

  /** They've been attacked: fight back. */
  provoke(cw: Pick<CrewWorld, 'gun'>): void {
    this.mode = 'fight';
    this.modeTimer = 0;
    this.paused = false;
    for (const m of this.members) if (!m.down) m.arm(cw.gun());
  }

  /** Stop fighting and walk back to their places. */
  calm(): void {
    if (this.mode === 'walk') return;
    this.mode = 'regroup';
    for (const m of this.members) m.arm(null);
  }

  /** A shot hit one of them. Returns true if it put them down. */
  hit(m: Fighter, damage: number): boolean {
    return m.hurt(damage, 35);
  }

  update(dt: number, cw: CrewWorld): void {
    const fighting = this.mode === 'fight';
    if (fighting && (cw.playerOut || Math.hypot(cw.px - this.leader.x, cw.pz - this.leader.z) > 75)) this.calm();
    if (this.mode === 'scatter' && (this.modeTimer -= dt) <= 0) this.mode = 'regroup';
    const d = Math.hypot(cw.px - this.leader.x, cw.pz - this.leader.z);
    this.paused = this.mode === 'walk' && !this.leader.down && d < 4.5;
    if (this.mode === 'walk' && !this.paused) this.s += 1.3 * dt;
    let allHome = true;
    this.members.forEach((m, i) => {
      // The fallen stay down while their crew is fighting; otherwise they get up after a while.
      if (m.tickDown(dt, this.mode !== 'fight')) return;
      const home = this.slot(i);
      let speed = 0;
      if (this.mode === 'fight') {
        // Nearest target; keep about 9 m away, edge sideways, shoot when in sight.
        let best: Target | null = null, bd = Infinity;
        for (const t of cw.targets) {
          const td = Math.hypot(t.x - m.x, t.z - m.z);
          if (td < bd) {
            bd = td;
            best = t;
          }
        }
        if (!m.isArmed) m.arm(cw.gun());
        if (best) {
          const ang = Math.atan2(best.z - m.z, best.x - m.x);
          const side = (i % 2 ? 1 : -1) * 0.6;
          const want = bd > 12 ? 1 : bd < 6 ? -1 : 0;
          const tx = m.x + Math.cos(ang) * want * 2 + Math.cos(ang + Math.PI / 2) * side;
          const tz = m.z + Math.sin(ang) * want * 2 + Math.sin(ang + Math.PI / 2) * side;
          speed = m.moveTo(tx, tz, want ? 3.6 : 1.2, dt, cw.world) / Math.max(dt, 1e-4);
          m.face(ang, dt);
          m.tryShoot(dt, best, cw, 0.34);
        }
        allHome = false;
      } else if (this.mode === 'scatter') {
        const ax = m.x - this.from.x, az = m.z - this.from.z, al = Math.hypot(ax, az) || 1;
        speed = m.moveTo(m.x + (ax / al) * 3, m.z + (az / al) * 3, 4.2, dt, cw.world) / Math.max(dt, 1e-4);
        m.face(Math.atan2(az, ax), dt);
        allHome = false;
      } else {
        const gap = Math.hypot(home.x - m.x, home.z - m.z);
        if (this.mode === 'regroup' && gap > 0.5) {
          speed = m.moveTo(home.x, home.z, 3, dt, cw.world) / Math.max(dt, 1e-4);
          m.face(Math.atan2(home.z - m.z, home.x - m.x), dt);
          allHome = false;
        } else {
          const c = { x: home.x, z: home.z };
          cw.world.resolveCircle(c, 0.3, false);
          speed = Math.hypot(c.x - m.x, c.z - m.z) / Math.max(dt, 1e-4);
          m.x = c.x;
          m.z = c.z;
          m.face(this.paused ? Math.atan2(cw.pz - m.z, cw.px - m.x) : home.heading, dt);
        }
      }
      m.pose(Math.min(4.5, speed), dt);
    });
    if (this.mode === 'regroup' && allHome) this.mode = 'walk';
  }

  /** The leader talks (a gesture while you decide), or everyone goes back to walking. */
  talk(on: boolean): void {
    if (this.mode !== 'walk') return;
    this.leader.rig.pose = on ? 'talk' : 'none';
    for (let i = 1; i < this.members.length; i++) this.members[i].rig.pose = on && i % 2 ? 'crossed' : 'none';
  }

  /** Where they are, for pushing people and cars out of each other (the fallen don't block). */
  obstacles(): { x: number; z: number; r: number; ref: unknown }[] {
    return this.members.filter((m) => !m.down).map((m) => ({ x: m.x, z: m.z, r: 0.38, ref: this }));
  }

  /** Leave the street for good (their turf was taken). */
  remove(): void {
    for (const m of this.members) m.rig.root.removeFromParent();
  }
}

/**
 * Two of your crew walking with you: they follow a couple of metres behind, ride along when you
 * drive, and fight whoever is fighting you.
 */
export class Followers {
  readonly members: Fighter[] = [];

  constructor(scene: THREE.Scene, readonly crew: CrewDef, x: number, z: number) {
    for (let i = 0; i < 2; i++) {
      const f = new Fighter(memberLook(crew, 3 + i), `follower-${i}`);
      f.x = x - 1.5 + i * 3;
      f.z = z + 1.5;
      scene.add(f.rig.root);
      this.members.push(f);
    }
  }

  remove(): void {
    for (const m of this.members) m.rig.root.removeFromParent();
  }

  /**
   * vehicle: the car you're driving (they sit in the passenger seats) or null; flying: in an aircraft
   * or boat (they wait out of sight). enemies: crew members fighting you.
   */
  update(dt: number, cw: CrewWorld, heading: number, vehicle: { x: number; z: number; heading: number; seat: [number, number, number] } | null, flying: boolean, enemies: Fighter[]): void {
    this.members.forEach((f, i) => {
      if (f.tickDown(dt, true)) return;
      f.rig.root.visible = !flying;
      if (vehicle) {
        // Passenger seats: beside you and behind you.
        const [sx, sy, sz] = vehicle.seat;
        const lx = i === 0 ? sx : sx - 1.0, lz = i === 0 ? -sz : 0;
        const c = Math.cos(vehicle.heading), s = Math.sin(vehicle.heading);
        f.x = vehicle.x + lx * c - lz * s;
        f.z = vehicle.z + lx * s + lz * c;
        f.heading = vehicle.heading;
        f.rig.seated = true;
        f.arm(null);
        f.rig.root.position.set(f.x, sy + 0.1 - 0.92, f.z);
        f.rig.root.rotation.set(0, -vehicle.heading, 0);
        f.rig.animate(dt, 0);
        return;
      }
      f.rig.seated = false;
      if (flying) {
        f.x = cw.px;
        f.z = cw.pz;
        return;
      }
      // Fight: the nearest enemy standing, if any is close.
      let foe: Fighter | null = null, fd = Infinity;
      for (const e of enemies) {
        if (e.down) continue;
        const d = Math.hypot(e.x - f.x, e.z - f.z);
        if (d < fd && d < 35) {
          fd = d;
          foe = e;
        }
      }
      const back = 2.2, side = i === 0 ? -1.2 : 1.2;
      const tx = cw.px - Math.cos(heading) * back + Math.cos(heading + Math.PI / 2) * side;
      const tz = cw.pz - Math.sin(heading) * back + Math.sin(heading + Math.PI / 2) * side;
      const gap = Math.hypot(tx - f.x, tz - f.z);
      let speed = 0;
      if (gap > 30) {
        f.x = tx;
        f.z = tz;
      } else if (gap > 0.7) speed = f.moveTo(tx, tz, Math.min(6.5, gap * 2.2), dt, cw.world) / Math.max(dt, 1e-4);
      if (foe) {
        if (!f.isArmed) f.arm(cw.gun());
        f.face(Math.atan2(foe.z - f.z, foe.x - f.x), dt);
        f.tryShoot(dt, { x: foe.x, z: foe.z, who: foe as unknown as Fighter }, cw, 0.45);
      } else {
        f.arm(null);
        if (speed > 0.2) f.face(Math.atan2(tz - f.z, tx - f.x), dt);
      }
      f.pose(Math.min(6, speed), dt);
    });
  }
}
