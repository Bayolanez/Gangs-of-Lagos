import * as THREE from 'three';
import type { Box2, CollisionWorld } from './collision';
import { HumanRig } from './human';
import { Batcher, textSprite } from './placeholders';

/**
 * Mission sites (original placeholder geometry, all fictional):
 *  - Harbour Bend Holding Centre: a walled detention compound in the west courtyard off Range
 *    Avenue, with a cell block, a guard booth, floodlights, a generator and a locked side door.
 *  - Bode's Lock-up: the crew's safehouse yard on the south-east side of Harbour Bend.
 * Night Exit switches the floodlights off, unlocks the side door and sounds the alarm light.
 */
export const FACILITY = {
  name: 'Harbour Bend Holding Centre',
  x0: -197, x1: -157, z0: -86.5, z1: -67.5,
  gate: { z0: -82, z1: -76 },
  door: { z0: -76, z1: -74.6 },
  generator: { x: -156.2, z: -71 },
  cell: { x: -178.8, z: -78 },
  car: { x: -146, z: -78, heading: 0 },
  briefing: { x: -131, z: -78 },
};
export const SAFEHOUSE = { name: "Bode's Lock-up", x: 84, z: 172 };

export class Sites {
  private lamps: THREE.Mesh[] = [];
  private alarm: THREE.Mesh;
  private doorBox: Box2;
  private doorMesh: THREE.Mesh;
  private guards: HumanRig[] = [];
  private alarmOn = false;
  private t = 0;

  constructor(scene: THREE.Scene, world: CollisionWorld) {
    const F = FACILITY;
    const b = new Batcher();
    const glow = (color: string) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.2) });
    const wallH = 3.2;
    const wall = (x0: number, x1: number, z0: number, z1: number) => {
      b.add('box', '#b9b2a6', (x0 + x1) / 2, wallH / 2, (z0 + z1) / 2, x1 - x0, wallH, z1 - z0);
      b.add('cyl', '#3a3a3f', (x0 + x1) / 2, wallH + 0.15, (z0 + z1) / 2, 0.12, Math.max(x1 - x0, z1 - z0), 0.12, x1 - x0 > z1 - z0 ? 0 : Math.PI / 2, 0, x1 - x0 > z1 - z0 ? Math.PI / 2 : 0, false); // wire
      world.add(x0, x1, z0, z1, wallH);
    };
    // Perimeter, with a vehicle gate and a small side door on the east wall.
    wall(F.x0, F.x1, F.z0, F.z0 + 0.4);
    wall(F.x0, F.x1, F.z1 - 0.4, F.z1);
    wall(F.x0, F.x0 + 0.4, F.z0, F.z1);
    wall(F.x1 - 0.4, F.x1, F.z0, F.gate.z0);
    wall(F.x1 - 0.4, F.x1, F.door.z1, F.z1);
    b.add('box', '#4d555e', F.x1 - 0.2, 1.4, (F.gate.z0 + F.gate.z1) / 2, 0.2, 2.8, F.gate.z1 - F.gate.z0, 0, 0, 0, false); // gate
    for (let i = 0; i < 7; i++) b.add('box', '#2b3036', F.x1 - 0.08, 1.4, F.gate.z0 + 0.4 + i * 0.86, 0.06, 2.8, 0.08, 0, 0, 0, false);
    world.add(F.x1 - 0.4, F.x1, F.gate.z0, F.gate.z1, 2.8);
    b.add('box', '#9a9488', (F.x0 + F.x1) / 2, 0.02, (F.z0 + F.z1) / 2, F.x1 - F.x0, 0.03, F.z1 - F.z0, 0, 0, 0, false); // yard
    // Locked side door (opens when the power is cut).
    this.doorMesh = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.3, F.door.z1 - F.door.z0), new THREE.MeshStandardMaterial({ color: '#6b3a2e', roughness: 0.7 }));
    this.doorMesh.position.set(F.x1 - 0.2, 1.15, (F.door.z0 + F.door.z1) / 2);
    scene.add(this.doorMesh);
    this.doorBox = world.add(F.x1 - 0.4, F.x1, F.door.z0, F.door.z1, 2.3);
    // Cell block with a barred door on its east side, and a guard booth.
    b.add('box', '#8f9aa3', -187.5, 2.0, -77.5, 15, 4.0, 15);
    b.add('box', '#5d6670', -187.5, 4.1, -77.5, 15.4, 0.25, 15.4, 0, 0, 0, false);
    world.add(-195, -180, -85, -70, 4);
    b.add('box', '#3a3d42', -179.95, 1.2, -78, 0.12, 2.4, 1.4, 0, 0, 0, false);
    for (let i = 0; i < 5; i++) b.add('box', '#8a8f96', -179.85, 1.2, -78.55 + i * 0.27, 0.05, 2.3, 0.05, 0, 0, 0, false);
    for (let i = 0; i < 4; i++) b.add('box', '#1d2026', -179.95, 2.6, -83 + i * 3, 0.1, 0.5, 1.4, 0, 0, 0, false); // high windows
    b.add('box', '#dcd6c8', -161.5, 1.4, -69.8, 3, 2.8, 2.6);
    world.add(-163, -160, -71.1, -68.5, 2.8);
    b.add('box', '#2a3b4c', -160, 1.6, -69.8, 0.06, 1.0, 1.6, 0, 0, 0, false);
    // Generator outside the east wall, by the side door.
    b.add('box', '#2e7d32', F.generator.x, 0.55, F.generator.z, 1.0, 1.1, 0.9);
    b.add('box', '#d8d2c4', F.generator.x + 0.51, 0.75, F.generator.z, 0.02, 0.3, 0.4, 0, 0, 0, false);
    world.add(F.generator.x - 0.5, F.generator.x + 0.5, F.generator.z - 0.45, F.generator.z + 0.45, 1.1);
    // Floodlight poles.
    for (const [x, z] of [[-158.6, -85.3], [-158.6, -68.7], [-195.6, -85.3], [-195.6, -68.7]]) {
      b.add('cyl', '#5d6168', x, 3.5, z, 0.14, 7, 0.14);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.3, 0.7), glow('#fff2c0'));
      head.position.set(x, 7.1, z);
      scene.add(head);
      this.lamps.push(head);
    }
    this.alarm = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), glow('#ff2a2a'));
    this.alarm.position.set(-161.5, 3.0, -69.8);
    this.alarm.visible = false;
    scene.add(this.alarm);
    const sign = textSprite('HARBOUR BEND HOLDING CENTRE', '#f0efe9', 0.75);
    sign.position.set(F.x1 + 0.6, 3.9, -79);
    const sub = textSprite('Fictional · placeholder', '#ffd27a', 0.34);
    sub.position.set(F.x1 + 0.6, 3.35, -79);
    scene.add(sign, sub);
    // Two guards inside the gate (fictional Harbour Patrol Unit).
    for (const [x, z] of [[-163.5, -80.5], [-163.5, -76.5]]) {
      const g = new HumanRig({ shirt: '#4d6b8a', pants: '#20262e', skin: '#4a3020', top: 'jacket', hat: 'cap', stripe: true });
      g.root.position.set(x, 0, z);
      g.root.rotation.y = 0; // facing the gate (east)
      scene.add(g.root);
      this.guards.push(g);
    }
    world.add(-164, -163, -81, -76, 1.8);

    // ---- Bode's Lock-up (safehouse)
    const S = SAFEHOUSE;
    b.add('box', '#8d8a82', S.x - 6, 0.02, S.z - 4, 22, 0.03, 18, 0, 0, 0, false);
    b.add('box', '#c97d4a', 72.5, 1.9, 163, 9, 3.8, 10);
    world.add(68, 77, 158, 168, 3.8);
    b.add('box', '#7e8285', 77.05, 1.5, 163, 0.1, 3.0, 6, 0, 0, 0, false);
    for (let i = 0; i < 10; i++) b.add('box', '#6c7075', 77.12, 0.2 + i * 0.3, 163, 0.04, 0.05, 6, 0, 0, 0, false);
    b.add('box', '#1f3d47', 72.5, 3.95, 163, 9.6, 0.15, 10.6, 0, 0, 0, false);
    const ss = textSprite("BODE'S LOCK-UP", '#ffd27a', 0.8);
    ss.position.set(78, 4.6, 163);
    const s2 = textSprite('Safehouse · fictional', '#f0efe9', 0.34);
    s2.position.set(78, 4.05, 163);
    scene.add(ss, s2);
    b.build(scene);
  }

  /** Floodlights on or off; cutting the power also unlocks the side door. */
  setPower(on: boolean): void {
    for (const l of this.lamps) l.visible = on;
    this.doorBox.off = !on;
    this.doorMesh.position.y = on ? 1.15 : 1.15;
    this.doorMesh.rotation.y = on ? 0 : -1.3; // swung open
    this.doorMesh.position.x = on ? FACILITY.x1 - 0.2 : FACILITY.x1 + 0.35;
    this.doorMesh.position.z = on ? (FACILITY.door.z0 + FACILITY.door.z1) / 2 : FACILITY.door.z0 + 0.1;
  }

  setAlarm(on: boolean): void {
    this.alarmOn = on;
    this.alarm.visible = on;
  }

  /** Put everything back as it was (after the mission ends). */
  reset(): void {
    this.setPower(true);
    this.setAlarm(false);
  }

  get powerOn(): boolean {
    return this.lamps[0].visible;
  }

  update(dt: number): void {
    this.t += dt;
    if (this.alarmOn) this.alarm.visible = Math.floor(this.t * 4) % 2 === 0;
    for (const g of this.guards) g.animate(dt, 0);
  }
}
