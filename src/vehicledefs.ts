/**
 * Vehicle designs (visual style pass). Original vehicles drawn from the Gangs of Lagos design board:
 * no real manufacturer shapes, badges or brand marks. Everything here is data — paint, trim, profiles,
 * wheel positions and handling — so colours and feel can change without touching the vehicle logic
 * in vehicles.ts. Units are metres; x runs forward along the vehicle, y up, z to the right.
 */

export type DesignKind = 'saloon' | 'minibus' | 'coupe' | 'crossover';

export interface Handling {
  name: string;
  len: number;
  wid: number;
  maxSpeed: number;
  maxReverse: number;
  accel: number;
  brake: number;
  rolling: number;
  steerDeg: number;
  circles: number[];
  circleR: number;
  health: number;
  camDist: number;
  camHeight: number;
}

export interface VehicleDesign {
  /** Body paint, the lower body on two-tone vehicles. */
  paint: string;
  /** Upper body on two-tone vehicles (minibus), otherwise the same as paint. */
  upper?: string;
  /** Roof and pillars when they differ from the paint (coupe's dark roof). */
  roof?: string;
  /** Accent stripe along the side. */
  accent: string;
  /** Bumpers, grille, cladding. */
  trim: string;
  /** Wheel rims. */
  rim: string;
  /** Glowing accent lines (coupe), or null. */
  glowAccent: string | null;
  width: number;
  sill: number;
  wheelR: number;
  /** Front and rear axle positions (x) and half track (z). */
  axles: [number, number];
  track: number;
  /** Lower body outline from the nose back to the tail (above the sill; arches are cut in). */
  body: [number, number][];
  /** Glasshouse outline (roof and pillars), from the base of the windscreen back. */
  cabin: [number, number][];
  /** Side window outline, slightly inside the cabin outline. */
  windows: [number, number][];
  /** Windscreen and rear window: [x1, y1, x2, y2] along the profile. */
  screen: [number, number, number, number];
  rear: [number, number, number, number];
  /** Window pillars between side windows (x positions). */
  pillars: number[];
  /** Door seams (x positions) and the height of the door bottoms and tops. */
  doors: number[];
  doorY: [number, number];
  /** Stripe: from (x0, y0) to (x1, y1) along the side. */
  stripe: [number, number, number, number];
  /** Lamps: front x, rear x, height. */
  lamps: [number, number, number];
  /** Seats (x positions of the rows) and seat height. */
  seats: number[];
  seatY: number;
  /** Where the driver sits (local x, y, z): left-hand drive, as in Nigeria. */
  driver: [number, number, number];
  roofRack?: boolean;
  sliding?: boolean;
  slats?: number;
}

export const DESIGNS: Record<DesignKind, VehicleDesign> = {
  // 1. Player sedan: deep teal four-door with an amber stripe.
  saloon: {
    paint: '#22707c', accent: '#f0a836', trim: '#1c1f24', rim: '#3a3330', glowAccent: null,
    width: 1.82, sill: 0.3, wheelR: 0.35, axles: [1.42, -1.42], track: 0.8,
    body: [[2.38, 0.46], [2.36, 0.76], [2.18, 0.86], [0.98, 0.98], [-1.4, 1.0], [-2.24, 0.96], [-2.38, 0.82], [-2.4, 0.46]],
    cabin: [[0.98, 0.98], [0.28, 1.4], [-0.86, 1.42], [-1.52, 1.0]],
    windows: [[0.86, 1.02], [0.3, 1.35], [-0.84, 1.36], [-1.38, 1.02]],
    screen: [0.97, 0.99, 0.29, 1.39], rear: [-0.87, 1.41, -1.5, 1.01],
    pillars: [-0.28],
    doors: [0.95, -0.28, -1.42], doorY: [0.36, 1.0],
    stripe: [-2.0, 0.72, 2.0, 0.82],
    lamps: [2.34, -2.36, 0.74],
    seats: [-0.08, -0.98], seatY: 0.5,
    driver: [-0.1, 0.42, -0.38],
  },
  // 2. Shared minibus: cream over green, a thin yellow line, boxy.
  minibus: {
    paint: '#1f6b3d', upper: '#efe3c2', accent: '#e8b53a', trim: '#22252a', rim: '#b9bcc0', glowAccent: null,
    width: 1.96, sill: 0.36, wheelR: 0.37, axles: [1.62, -1.55], track: 0.86,
    body: [[2.48, 0.52], [2.5, 1.14], [-2.44, 1.14], [-2.46, 0.52]],
    cabin: [[2.5, 1.14], [2.36, 1.48], [2.12, 2.16], [1.86, 2.26], [-2.32, 2.27], [-2.46, 2.1], [-2.46, 1.14]],
    windows: [[1.96, 1.5], [1.86, 2.08], [-2.3, 2.08], [-2.3, 1.5]],
    screen: [2.35, 1.5, 2.11, 2.14], rear: [-2.47, 1.5, -2.47, 2.04],
    pillars: [1.2, 0.2, -0.8, -1.7],
    doors: [1.25, 0.15, -1.05], doorY: [0.42, 2.06],
    stripe: [-2.44, 1.16, 2.5, 1.16],
    lamps: [2.5, -2.47, 0.98],
    seats: [1.4, 0.5, -0.4, -1.3], seatY: 0.62,
    driver: [1.45, 0.55, -0.42],
    sliding: true,
  },
  // 3. Sport coupe: coral-red two-door, dark roof, subtle cyan lines.
  coupe: {
    paint: '#d9503e', roof: '#1e1d24', accent: '#1e1d24', trim: '#18171c', rim: '#26262c', glowAccent: '#38e6f0',
    width: 1.86, sill: 0.28, wheelR: 0.35, axles: [1.38, -1.36], track: 0.82,
    body: [[2.3, 0.42], [2.32, 0.62], [2.1, 0.76], [0.9, 0.88], [-1.3, 0.92], [-2.14, 0.95], [-2.28, 0.76], [-2.3, 0.42]],
    cabin: [[0.88, 0.88], [0.0, 1.26], [-0.78, 1.28], [-1.78, 0.95]],
    windows: [[0.74, 0.92], [0.02, 1.21], [-0.72, 1.22], [-1.5, 0.95]],
    screen: [0.87, 0.89, 0.01, 1.25], rear: [-0.79, 1.27, -1.76, 0.96],
    pillars: [],
    doors: [0.9, -0.62], doorY: [0.34, 0.9],
    stripe: [-1.9, 0.36, 1.95, 0.36],
    lamps: [2.26, -2.27, 0.68],
    seats: [-0.15], seatY: 0.42,
    driver: [-0.2, 0.34, -0.38],
  },
  // 4. Crossover: sand body, dark teal cladding, roof rack.
  crossover: {
    paint: '#cfb07c', accent: '#1f3d47', trim: '#1f3d47', rim: '#2f2a26', glowAccent: null,
    width: 1.9, sill: 0.46, wheelR: 0.39, axles: [1.36, -1.36], track: 0.84,
    body: [[2.22, 0.6], [2.24, 0.96], [2.06, 1.08], [0.95, 1.18], [-2.1, 1.2], [-2.22, 1.02], [-2.24, 0.6]],
    cabin: [[0.95, 1.18], [0.32, 1.62], [-1.92, 1.66], [-2.14, 1.22]],
    windows: [[0.82, 1.22], [0.34, 1.57], [-1.86, 1.6], [-2.0, 1.24]],
    screen: [0.94, 1.19, 0.33, 1.61], rear: [-1.93, 1.64, -2.13, 1.23],
    pillars: [-0.38, -1.38],
    doors: [0.92, -0.38, -1.38], doorY: [0.5, 1.2],
    stripe: [-2.2, 0.62, 2.22, 0.62],
    lamps: [2.2, -2.22, 0.96],
    seats: [-0.15, -1.05], seatY: 0.66,
    driver: [-0.18, 0.58, -0.4],
    roofRack: true,
    slats: 6,
  },
};

/** Handling for the new vehicles (same arcade model as the others; see vehicles.ts). */
export const DESIGN_SPECS: Record<DesignKind, Handling> = {
  saloon: { name: 'Harbour saloon', len: 4.8, wid: 1.85, maxSpeed: 31, maxReverse: 9, accel: 9.8, brake: 27, rolling: 4.5, steerDeg: 78, circles: [-1.5, 0, 1.5], circleR: 0.95, health: 110, camDist: 7.8, camHeight: 1.7 },
  minibus: { name: 'Shared minibus', len: 5.0, wid: 2.0, maxSpeed: 22, maxReverse: 7, accel: 6.5, brake: 20, rolling: 4, steerDeg: 60, circles: [-1.7, 0, 1.7], circleR: 1.05, health: 140, camDist: 9.5, camHeight: 2.6 },
  coupe: { name: 'Sport coupe', len: 4.6, wid: 1.88, maxSpeed: 36, maxReverse: 9, accel: 12, brake: 30, rolling: 4.5, steerDeg: 84, circles: [-1.45, 0, 1.45], circleR: 0.95, health: 90, camDist: 7.4, camHeight: 1.55 },
  crossover: { name: 'Crossover', len: 4.5, wid: 1.92, maxSpeed: 28, maxReverse: 8, accel: 8.6, brake: 25, rolling: 4.5, steerDeg: 72, circles: [-1.45, 0, 1.45], circleR: 1.0, health: 130, camDist: 8.2, camHeight: 2.0 },
};
