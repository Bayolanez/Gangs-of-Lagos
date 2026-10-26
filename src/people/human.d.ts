import type * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
export interface Outfit {
  label: string;
  body?: 'male' | 'female';
  skin?: string;
  top?: { kind: 'tee' | 'shirt' | 'kaftan' | 'sweatshirt' | 'dress' | 'blouse'; color?: string; print?: string | string[]; printColor?: string; tie?: string; trim?: string; length?: number; lace?: boolean };
  bottom?: { kind: 'jeans' | 'trousers' | 'shorts' | 'wrapper'; color?: string; wide?: boolean; print?: string[] };
  agbada?: { color: string; embroidery: string };
  socks?: { color: string; stripes?: string[] };
  chain?: string;
  earrings?: boolean;
  shoes?: { kind: 'sneaker' | 'skate' | 'loafer' | 'sandal' | 'slipper' | 'heel'; color: string; sole: string; stripe?: string };
  hat?: { kind: 'cap' | 'fila' | 'beanie' | 'gele' | 'scarf'; color?: string; print?: boolean } | null;
  hair?: 'lowcut' | 'afro' | 'waves' | 'bald' | 'braids' | 'bun';
  beard?: 'none' | 'goatee' | 'full';
  belt?: string;
}
export interface Build { chest: number; belly: number; hips: number; arms: number; legs: number; shoulders: number }
export const FITS: Record<'street' | 'senator' | 'agbada' | 'office' | 'okada' | 'blk_kng' | 'ankara' | 'buba' | 'street_f', Outfit>;
export const BUILDS: Record<'slim' | 'average' | 'athletic' | 'heavy', Build>;
export const SKIN_TONES: Record<'deep' | 'dark' | 'brown' | 'warm' | 'caramel' | 'light', string>;
export function buildHuman(ual: GLTF, o?: { fit?: keyof typeof FITS | Outfit; body?: 'male' | 'female'; earrings?: boolean; skin?: keyof typeof SKIN_TONES | string; build?: keyof typeof BUILDS | Build; hair?: Outfit['hair']; beard?: Outfit['beard']; name?: string }): THREE.Group;
