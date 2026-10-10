/**
 * Turns OSM tags into game terms: the five road types from the build script, widths, rough surfaces
 * and building heights. Edit these tables to tune how an area looks and drives.
 */

/** Game road types and what they look and drive like. */
export const ROAD_TYPES = {
  expressway: { width: 14, lanes: 4, speed: 20, colour: [0.22, 0.22, 0.24], y: 0.06 },
  brt: { width: 7, lanes: 2, speed: 16, colour: [0.55, 0.22, 0.16], y: 0.07 },
  service: { width: 4.5, lanes: 1, speed: 9, colour: [0.27, 0.27, 0.28], y: 0.05 },
  inner: { width: 7, lanes: 2, speed: 9, colour: [0.25, 0.25, 0.26], y: 0.04 },
  market: { width: 6, lanes: 2, speed: 4, colour: [0.42, 0.36, 0.30], y: 0.045 },
};

const INNER_WIDTH = { primary: 10, primary_link: 7, secondary: 9, secondary_link: 7, tertiary: 8, tertiary_link: 6, residential: 6, unclassified: 6, living_street: 5, road: 6, track: 4 };
const SKIP = new Set(['footway', 'path', 'cycleway', 'steps', 'pedestrian', 'bridleway', 'corridor', 'construction', 'proposed', 'platform', 'elevator', 'raceway', 'abandoned', 'razed']);
const SKIP_SERVICE = new Set(['parking_aisle', 'driveway', 'drive-through', 'emergency_access']);

/** Road type for a way, or null if it isn't a drivable road for the game. */
export function roadType(tags) {
  const h = tags.highway;
  if (!h || SKIP.has(h) || tags.area === 'yes') return null;
  if (h === 'busway' || tags.busway === 'yes' || (tags.psv === 'designated' && tags.motor_vehicle === 'no')) return 'brt';
  if (['motorway', 'motorway_link', 'trunk', 'trunk_link'].includes(h)) return 'expressway';
  if (h === 'service') return SKIP_SERVICE.has(tags.service) ? null : 'service';
  if (h in INNER_WIDTH) return 'inner';
  return null;
}

export function roadWidth(type, tags) {
  const lanes = Number.parseInt(tags.lanes, 10);
  const w = Number.parseFloat(tags.width);
  if (Number.isFinite(w) && w > 2 && w < 40) return w;
  if (type === 'inner') return INNER_WIDTH[tags.highway] ?? 6;
  if (Number.isFinite(lanes) && lanes > 0 && lanes < 12) return Math.max(ROAD_TYPES[type].width * 0.6, lanes * 3.4);
  return ROAD_TYPES[type].width;
}

export function roadLanes(type, tags) {
  const lanes = Number.parseInt(tags.lanes, 10);
  return Number.isFinite(lanes) && lanes > 0 && lanes < 12 ? lanes : ROAD_TYPES[type].lanes;
}

const ROUGH_SURFACE = new Set(['unpaved', 'gravel', 'fine_gravel', 'dirt', 'earth', 'ground', 'compacted', 'sand', 'mud', 'laterite', 'pebblestone', 'grass', 'rock']);
const ROUGH_SMOOTH = new Set(['bad', 'very_bad', 'horrible', 'very_horrible', 'impassable']);

/** True where the data marks a rough or unpaved surface (potholes go here). */
export function isRough(tags) {
  return ROUGH_SURFACE.has(tags.surface) || ROUGH_SMOOTH.has(tags.smoothness) || tags.highway === 'track';
}

const FLOOR = 3.2;
/** Building height in metres: the data's height or levels when present, otherwise a guess from the type. */
export function buildingHeight(tags, r) {
  const h = Number.parseFloat(tags.height);
  if (Number.isFinite(h) && h > 2) return Math.min(h, 200);
  const lv = Number.parseFloat(tags['building:levels']);
  if (Number.isFinite(lv) && lv > 0) return Math.min(lv, 60) * FLOOR + 0.4;
  const b = tags.building;
  const pick = (lo, hi) => (lo + Math.floor(r * (hi - lo + 1))) * FLOOR + 0.4;
  if (['house', 'detached', 'semidetached_house', 'hut', 'bungalow', 'shed', 'kiosk', 'garage', 'roof'].includes(b)) return pick(1, 1);
  if (['residential', 'terrace'].includes(b)) return pick(1, 3);
  if (['apartments', 'dormitory', 'hotel'].includes(b)) return pick(3, 7);
  if (['commercial', 'retail', 'office', 'bank'].includes(b)) return pick(2, 6);
  if (['industrial', 'warehouse', 'factory'].includes(b)) return pick(2, 2);
  if (['church', 'mosque', 'cathedral', 'school', 'hospital', 'university', 'public', 'civic'].includes(b)) return pick(2, 3);
  return pick(1, 3);
}

/** Wall colour by building type (placeholder palette). */
export function buildingColour(tags, r) {
  const walls = [[0.90, 0.86, 0.78], [0.85, 0.78, 0.66], [0.81, 0.84, 0.82], [0.91, 0.81, 0.75], [0.84, 0.82, 0.73], [0.94, 0.92, 0.89], [0.79, 0.83, 0.84]];
  if (['church', 'mosque', 'cathedral'].includes(tags.building) || tags.amenity === 'place_of_worship') return [0.95, 0.94, 0.90];
  return walls[Math.floor(r * walls.length) % walls.length];
}

/** Area fills drawn on the ground (water, beach, green, paved market). */
export function areaKind(tags) {
  if (tags.natural === 'water' || tags.waterway === 'riverbank' || tags.landuse === 'reservoir' || tags.landuse === 'basin') return 'water';
  if (tags.natural === 'beach' || tags.natural === 'sand') return 'beach';
  if (tags.amenity === 'marketplace') return 'market';
  if (['park', 'garden', 'pitch', 'playground'].includes(tags.leisure) || ['grass', 'recreation_ground', 'cemetery', 'forest', 'meadow'].includes(tags.landuse) || tags.natural === 'wood' || tags.natural === 'scrub' || tags.natural === 'wetland') return 'green';
  return null;
}

export const AREA_COLOUR = { water: [0.12, 0.35, 0.40], beach: [0.86, 0.78, 0.58], market: [0.60, 0.57, 0.52], green: [0.29, 0.45, 0.20] };

/** Stable pseudo-random number in [0, 1) from a string or number (so every import is the same). */
export function hash01(key) {
  let h = 2166136261;
  const s = String(key);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
