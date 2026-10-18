/**
 * The Chairman's empire and the properties he can give you. Every name and place is invented for the
 * game (fictional Harbour Bend and Marina Point); none is a real person's, business's or home.
 * `where` says where it is (or that it is off the map for now). Gifts are saved in `save.gifts`;
 * a gift can also carry a game unlock (the Royale GT and the speedboat are licences in the save).
 */
export type PropertyKind = 'estate' | 'club' | 'hotel' | 'tower' | 'island' | 'car' | 'plane' | 'heli' | 'yacht' | 'boat' | 'house';

export interface Property {
  id: string;
  name: string;
  kind: PropertyKind;
  where: string;
  /** On the map in this build (with a position for the map marker). */
  x?: number;
  z?: number;
}

/** What the Chairman owns (shown in the phone's Properties tab). */
export const EMPIRE: Property[] = [
  { id: 'crown-ridge', name: 'The Crown Ridge residence', kind: 'estate', where: 'Crown Ridge, north-west Harbour Bend: his home and office', x: -162, z: -162 },
  { id: 'afterglow', name: 'Afterglow', kind: 'club', where: 'North Crescent, Harbour Bend: his club, VIP floor upstairs', x: 76, z: -62 },
  { id: 'palmyra', name: 'The Palmyra Grand Hotel (his stake)', kind: 'hotel', where: 'South-west Harbour Bend', x: -163, z: 160 },
  { id: 'heights', name: 'Harbour Heights', kind: 'tower', where: 'The residential tower on Harbour Bend Square (he owns the top floors)' },
  { id: 'marina-towers', name: 'Two office towers on Marina Point', kind: 'tower', where: 'Marina Point, across the Old Ferry Bridge' },
  { id: 'coral-cay', name: 'Coral Cay', kind: 'island', where: 'A private island out on the lagoon (off the map in this build)' },
  { id: 'royale-fleet', name: 'Four Royale GTs and a black SUV', kind: 'car', where: 'In the Crown Ridge driveway', x: -162, z: -150 },
  { id: 'jet', name: 'A private light jet', kind: 'plane', where: 'Lagoon Point Airfield hangar (off the map in this build)' },
  { id: 'chopper', name: 'A twin-engine helicopter', kind: 'heli', where: 'Lagoon Point Airfield' },
  { id: 'yacht', name: 'The yacht "Lady Morayo"', kind: 'yacht', where: 'Moored off Coral Cay (off the map in this build)' },
];

/** What he can give you. `licence` ties a gift to a game unlock already in the save. */
export interface Gift extends Property {
  licence?: 'royale' | 'boat';
  /** Shown when it arrives. */
  note: string;
}

export const GIFTS: Gift[] = [
  { id: 'royale-gt', name: 'Royale GT', kind: 'car', where: 'Parked on Harbour Bend Square', x: 18, z: 28, licence: 'royale', note: 'The keys to a Royale GT from his own fleet. It waits on Harbour Bend Square.' },
  { id: 'speedboat', name: 'Speedboat', kind: 'boat', where: 'Marina Jetty', x: 203, z: -54.5, licence: 'boat', note: 'A speedboat of your own, moored at Marina Jetty.' },
  { id: 'heights-penthouse', name: 'The Harbour Heights penthouse', kind: 'house', where: 'Top floor of Harbour Heights, Harbour Bend Square', x: 16, z: 10, note: 'The penthouse at Harbour Heights is yours: take the lift to PH. Sleep there to heal and save.' },
];

/** Your penthouse bed (Harbour Heights, top floor) once it is yours. */
export const PENTHOUSE_BED = { x: 21, z: 13.6, y: 12 };

export function giftById(id: string): Gift | undefined {
  return GIFTS.find((g) => g.id === id);
}

export const KIND_LABEL: Record<PropertyKind, string> = {
  estate: 'Estate', club: 'Club', hotel: 'Hotel', tower: 'Real estate', island: 'Island', car: 'Cars', plane: 'Aircraft', heli: 'Helicopter', yacht: 'Yacht', boat: 'Boat', house: 'House',
};
