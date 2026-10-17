import * as THREE from 'three';
import { HumanLook, HumanRig } from './human';

/**
 * Crews: three fictional street crews of Harbour Bend. Each walks its own turf as a group of five
 * (the leader in front), every member with a bandana in the crew's colour. Talk to a crew's leader to
 * hear them out and decide whether to join. You can run with one crew at a time; joining opens the
 * crew house north of the square. Names, colours and lines are invented for this game.
 */
export type CrewId = 'blue' | 'red' | 'yellow';

export interface CrewDef {
  id: CrewId;
  name: string;
  colour: string;
  leader: string;
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
    id: 'blue', name: 'Blue Tide', colour: '#1f6fd1', leader: 'Seyi', turf: [-34, -200, 34, -126], turfName: 'the north blocks',
    pitch: "You keep walking our side of town. Blue Tide looks after its own: a roof, a crew at your back, and work that pays. You want in?",
    welcome: "Welcome to Blue Tide. The house is north of the square, by the gun shop. Your room is ready.",
    member: "The house is open. Come to the planning table when you want work.",
    rival: "You run with another crew. Keep walking.",
    shirts: ['#1b2a44', '#22252a', '#2d3e5c', '#14161a', '#384a66'],
  },
  {
    id: 'red', name: 'Red Palm', colour: '#c62828', leader: 'Obi', turf: [-200, -34, -126, 34], turfName: 'the west blocks',
    pitch: "Red Palm don't ask twice. We have a house, we have cars and we have each other. Walk with us?",
    welcome: "You're Red Palm now. The crew house is north of the square. Get some sleep, then come and plan.",
    member: "Everything good? The planning table is where the work is.",
    rival: "Wrong colours for this street, friend. Move along.",
    shirts: ['#3a1416', '#22252a', '#4a2a22', '#14161a', '#5c2a2a'],
  },
  {
    id: 'yellow', name: 'Yellow Kite', colour: '#f2b705', leader: 'Amaka', turf: [46, 46, 114, 114], turfName: 'the south-east blocks',
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

/** One crew walking its turf: five people following a loop round a block's pavement. */
export class CrewGroup {
  readonly members: { rig: HumanRig; x: number; z: number; heading: number }[] = [];
  /** Distance along the loop of the leader. */
  private s = 0;
  private readonly loop: [number, number][];
  private readonly length: number;
  /** Stopped to talk (someone is close to the leader). */
  paused = false;
  private t = 0;

  constructor(scene: THREE.Scene, readonly def: CrewDef, start = 0) {
    const [x0, z0, x1, z1] = def.turf;
    const m = 2.4; // between the lamp posts and the shop fronts
    this.loop = [[x0 + m, z0 + m], [x1 - m, z0 + m], [x1 - m, z1 - m], [x0 + m, z1 - m]];
    this.length = 2 * (x1 - x0 - 2 * m) + 2 * (z1 - z0 - 2 * m);
    this.s = start * this.length;
    for (let i = 0; i < 5; i++) {
      const rig = new HumanRig(memberLook(def, i));
      rig.root.name = `crew-${def.id}-${i}`;
      scene.add(rig.root);
      this.members.push({ rig, x: 0, z: 0, heading: 0 });
    }
    this.place(0, null);
  }

  get leader() {
    return this.members[0];
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

  /** Lay the group out along the loop: the leader in front, then pairs behind. */
  private place(dt: number, world: Blocker | null, face?: { x: number; z: number }): void {
    const slots: [number, number][] = [[0, 0], [-1.6, -0.75], [-1.6, 0.75], [-3.2, -0.75], [-3.2, 0.75]];
    this.members.forEach((mb, i) => {
      const [back, side] = slots[i];
      const p = this.at(this.s + back);
      const tx = p.x - p.dz * side, tz = p.z + p.dx * side;
      const c = { x: tx, z: tz };
      world?.resolveCircle(c, 0.3, false);
      const moved = Math.hypot(c.x - mb.x, c.z - mb.z);
      mb.x = c.x;
      mb.z = c.z;
      let heading = Math.atan2(p.dz, p.dx);
      if (face) heading = Math.atan2(face.z - mb.z, face.x - mb.x);
      const diff = Math.atan2(Math.sin(heading - mb.heading), Math.cos(heading - mb.heading));
      mb.heading += diff * Math.min(1, dt * 6 || 1);
      mb.rig.root.position.set(mb.x, 0, mb.z);
      mb.rig.root.rotation.y = -mb.heading;
      mb.rig.animate(dt, dt > 0 ? Math.min(2.2, moved / dt) : 0);
    });
  }

  /** Walk on, or stop and face someone standing near the leader. */
  update(dt: number, world: Blocker, px: number, pz: number): void {
    this.t += dt;
    const d = Math.hypot(px - this.leader.x, pz - this.leader.z);
    this.paused = d < 4.5;
    if (!this.paused) this.s += 1.3 * dt;
    this.place(dt, world, this.paused ? { x: px, z: pz } : undefined);
  }

  /** The leader talks (a gesture while you decide), or everyone goes back to walking. */
  talk(on: boolean): void {
    this.leader.rig.pose = on ? 'talk' : 'none';
    for (let i = 1; i < this.members.length; i++) this.members[i].rig.pose = on && i % 2 ? 'crossed' : 'none';
  }

  /** Where they are, for pushing people and cars out of each other. */
  obstacles(): { x: number; z: number; r: number; ref: unknown }[] {
    return this.members.map((m) => ({ x: m.x, z: m.z, r: 0.38, ref: this }));
  }
}
