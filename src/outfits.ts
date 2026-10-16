import * as THREE from 'three';
import type { HumanLook } from './human';

/**
 * Character customization (Milestone 3). Every item is an original, generic garment shape in the
 * PLACEHOLDER art style. "Harbour print" is an original procedural pattern inspired by bright
 * wax-print fabric, not a copy of any real design.
 */
export type Slot = 'skin' | 'top' | 'colour' | 'hat' | 'trousers';
export type Shop = 'free' | 'ngozi' | 'funmi' | 'earned';

export interface Outfit {
  skin: string;
  top: string;
  colour: string;
  hat: string;
  trousers: string;
}

export interface ItemDef {
  id: string;
  slot: Slot;
  name: string;
  /** Colour value for skin, colour and trouser items. */
  value?: string;
  price: number;
  shop: Shop;
  /** Earned items: unlocked by finishing a job or a chapter. */
  earn?: { mission?: string; chapter?: number; text: string };
}

export const SHOP_NAMES: Record<'ngozi' | 'funmi', string> = { ngozi: "Ngozi's Tailoring (Harbour Bend market)", funmi: 'Marina Threads (Marina Point)' };
export const SLOT_NAMES: Record<Slot, string> = { skin: 'Skin tone', top: 'Top', colour: 'Colour', hat: 'Headwear', trousers: 'Trousers' };

export const ITEMS: ItemDef[] = [
  { id: 'skin-1', slot: 'skin', name: 'Tone 1', value: '#3b2416', price: 0, shop: 'free' },
  { id: 'skin-2', slot: 'skin', name: 'Tone 2', value: '#5a3a26', price: 0, shop: 'free' },
  { id: 'skin-3', slot: 'skin', name: 'Tone 3', value: '#7a4e30', price: 0, shop: 'free' },
  { id: 'skin-4', slot: 'skin', name: 'Tone 4', value: '#a06a44', price: 0, shop: 'free' },

  { id: 'top-blkkng', slot: 'top', name: 'BLK KNG: navy sweatshirt, black shorts, red trainers (fixed outfit)', price: 0, shop: 'free' },
  { id: 'top-signature', slot: 'top', name: 'Signature look: ochre hoodie, teal jacket, gold chain (fixed colours)', price: 0, shop: 'free' },
  { id: 'top-stripe', slot: 'top', name: 'Danfo stripe tee', price: 0, shop: 'free' },
  { id: 'top-tee', slot: 'top', name: 'Plain tee', price: 0, shop: 'free' },
  { id: 'top-kaftan', slot: 'top', name: 'Kaftan top', price: 3000, shop: 'ngozi' },
  { id: 'top-jacket', slot: 'top', name: 'Bomber jacket', price: 6000, shop: 'funmi' },
  { id: 'top-hoodie', slot: 'top', name: 'Jacket over hoodie (hoodie in your colour)', price: 4500, shop: 'funmi' },
  { id: 'top-champion', slot: 'top', name: 'Champion jacket (gold)', price: 0, shop: 'earned', earn: { chapter: 2, text: 'Finish every Marina Point job' } },

  { id: 'col-yellow', slot: 'colour', name: 'Yellow', value: '#f5c518', price: 0, shop: 'free' },
  { id: 'col-white', slot: 'colour', name: 'White', value: '#f0efe9', price: 0, shop: 'free' },
  { id: 'col-green', slot: 'colour', name: 'Green', value: '#1f9e6e', price: 0, shop: 'free' },
  { id: 'col-blue', slot: 'colour', name: 'Blue', value: '#2d7dd2', price: 0, shop: 'free' },
  { id: 'col-black', slot: 'colour', name: 'Black', value: '#22252a', price: 0, shop: 'free' },
  { id: 'col-print', slot: 'colour', name: 'Harbour print', value: 'print', price: 2500, shop: 'ngozi' },
  { id: 'col-teal', slot: 'colour', name: 'Teal', value: '#16a085', price: 800, shop: 'funmi' },
  { id: 'col-maroon', slot: 'colour', name: 'Maroon', value: '#7b1e2b', price: 800, shop: 'funmi' },

  { id: 'hat-none', slot: 'hat', name: 'None', price: 0, shop: 'free' },
  { id: 'hat-fila', slot: 'hat', name: 'Fila cap', price: 1500, shop: 'ngozi' },
  { id: 'hat-cap', slot: 'hat', name: 'Baseball cap', price: 1200, shop: 'funmi' },
  { id: 'hat-cap-red', slot: 'hat', name: 'Red cap (plain)', price: 0, shop: 'free' },
  { id: 'hat-bucket', slot: 'hat', name: 'Bucket hat', price: 1800, shop: 'funmi' },
  { id: 'hat-danfo', slot: 'hat', name: 'Danfo driver cap', price: 0, shop: 'earned', earn: { mission: 'danfo-shift', text: "Finish Emeka's Danfo Shift" } },

  { id: 'tr-charcoal', slot: 'trousers', name: 'Charcoal', value: '#2b2b2b', price: 0, shop: 'free' },
  { id: 'tr-navy', slot: 'trousers', name: 'Navy', value: '#1f2a44', price: 0, shop: 'free' },
  { id: 'tr-khaki', slot: 'trousers', name: 'Khaki', value: '#8a7a55', price: 0, shop: 'free' },
  { id: 'tr-white', slot: 'trousers', name: 'White', value: '#e9e8e2', price: 1000, shop: 'funmi' },
  { id: 'tr-cargo', slot: 'trousers', name: 'Cargo pants', value: '#34363d', price: 2000, shop: 'funmi' },
  { id: 'tr-track', slot: 'trousers', name: 'Track pants (white stripe)', value: '#17171c', price: 0, shop: 'free' },
];

export const ITEM_IDS = ITEMS.map((i) => i.id);
export const item = (id: string): ItemDef | undefined => ITEMS.find((i) => i.id === id);

/** New games start as BLK KNG, the main player (blkking.ts); the Signature look is the code-built hero. */
export const DEFAULT_OUTFIT: Outfit = { skin: 'skin-2', top: 'top-blkkng', colour: 'col-yellow', hat: 'hat-none', trousers: 'tr-charcoal' };
/** The Milestone 1-2 player: yellow tee with a black stripe (what saves from before Milestone 3 wear). */
export const CLASSIC_OUTFIT: Outfit = { skin: 'skin-2', top: 'top-stripe', colour: 'col-yellow', hat: 'hat-none', trousers: 'tr-charcoal' };

export function validOutfit(o: Partial<Outfit> | undefined): Outfit {
  const out = { ...DEFAULT_OUTFIT };
  if (!o) return out;
  for (const slot of ['skin', 'top', 'colour', 'hat', 'trousers'] as const) {
    const v = o[slot];
    if (typeof v === 'string' && item(v)?.slot === slot) out[slot] = v;
  }
  return out;
}

/** Owned = free, bought (in the save), or earned by progress. */
export function owns(id: string, bought: string[], completed: string[], chapters: number[]): boolean {
  const it = item(id);
  if (!it) return false;
  if (it.shop === 'free') return true;
  if (it.shop === 'earned') return (!!it.earn?.mission && completed.includes(it.earn.mission)) || (!!it.earn?.chapter && chapters.includes(it.earn.chapter));
  return bought.includes(id);
}

let printTex: THREE.CanvasTexture | null = null;
/** Original procedural "Harbour print": circles and zigzags in bright colours. */
export function printTexture(): THREE.CanvasTexture {
  if (printTex) return printTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1f5f8b';
  g.fillRect(0, 0, 128, 128);
  g.lineWidth = 5;
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const x = col * 32 + (row % 2 ? 16 : 0), y = row * 32 + 16;
      g.fillStyle = '#f2c21a';
      g.beginPath();
      g.arc(x, y, 11, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#c0392b';
      g.beginPath();
      g.arc(x, y, 6, 0, Math.PI * 2);
      g.fill();
    }
    g.strokeStyle = '#f0efe9';
    g.beginPath();
    for (let x = 0; x <= 128; x += 8) g.lineTo(x, row * 32 + (x % 16 ? 2 : 6));
    g.stroke();
  }
  printTex = new THREE.CanvasTexture(c);
  printTex.wrapS = printTex.wrapT = THREE.RepeatWrapping;
  printTex.colorSpace = THREE.SRGBColorSpace;
  return printTex;
}

/** Turns saved outfit ids into what the person rig draws. */
export function lookFor(o: Outfit): HumanLook {
  const v = (id: string) => item(id)?.value ?? '#888888';
  const colour = v(o.colour);
  const champion = o.top === 'top-champion';
  return {
    shirt: champion ? '#c9a227' : colour === 'print' ? '#1f5f8b' : colour,
    pattern: !champion && colour === 'print',
    pants: v(o.trousers),
    skin: v(o.skin),
    top: o.top === 'top-blkkng' ? 'blkking' : o.top === 'top-signature' ? 'signature' : champion ? 'jacket' : o.top === 'top-kaftan' ? 'kaftan' : o.top === 'top-jacket' ? 'jacket' : o.top === 'top-hoodie' ? 'hoodie' : 'tee',
    stripe: o.top === 'top-stripe' || champion,
    hatColour: o.hat === 'hat-cap-red' ? '#d23c3c' : undefined,
    pantsStripe: o.trousers === 'tr-track',
    cargo: o.trousers === 'tr-cargo',
    hat: o.hat === 'hat-fila' ? 'fila' : o.hat === 'hat-cap' || o.hat === 'hat-cap-red' ? 'cap' : o.hat === 'hat-bucket' ? 'bucket' : o.hat === 'hat-danfo' ? 'danfo' : undefined,
  };
}
