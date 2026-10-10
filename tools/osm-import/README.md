# tools/osm-import

Turns an OpenStreetMap extract of one area into streamed game tiles for Gangs of Lagos (Phase 5,
"Real Lagos, area 1"). Plain Node.js (18+), no extra installs: it uses the `three` package the game
already depends on for polygon triangulation.

## 1. Get an extract for one area

The importer reads **OSM XML** (`.osm`) or **Overpass JSON**. Keep each area to a few square kilometres.

- **OpenStreetMap "Export"** (openstreetmap.org → Export → Manual selection) gives a `.osm` file for a
  small box.
- **Overpass** (overpass-turbo.eu), for a box `south,west,north,east`:

  ```
  [out:json][timeout:90];
  (
    way["highway"](S,W,N,E);
    way["building"](S,W,N,E);
    way["amenity"="marketplace"](S,W,N,E);
    way["natural"~"water|beach|sand|wood|scrub|wetland"](S,W,N,E);
    way["leisure"~"park|garden|pitch|playground"](S,W,N,E);
    way["landuse"~"grass|recreation_ground|cemetery|reservoir|basin|forest|meadow"](S,W,N,E);
    relation["type"="multipolygon"]["natural"="water"](S,W,N,E);
  );
  out body; >; out skel qt;
  ```

- **Geofabrik `.osm.pbf`**: cut and convert it first, for example
  `osmium extract -b W,S,E,N nigeria-latest.osm.pbf -o area.osm.pbf && osmium cat area.osm.pbf -o area.osm`.

## 2. Import it

```bash
node tools/osm-import/import.mjs --in area.osm --id lagos-island --name "Lagos Island" \
    [--bbox S,W,N,E] [--origin lat,lon] [--tile 400]
```

This writes `public/areas/<id>/` with:
- `manifest.json`: origin, bounds, spawn point, tile list, attribution and licence note;
- `graph.json`: the road graph for traffic;
- `tiles/<x>_<z>.glb` and `.json`: one mesh per 400 m tile, plus a sidecar holding the roads, building
  footprints, ground areas, potholes and lane-warden posts.

It also lists the area in `public/areas/index.json`. The game then offers the area on the title screen
and in the pause menu. Pass `--fixture` to skip that listing (tests use it).

Run `npm run build` afterwards so the area is copied into `dist/`.

## What it does

- **Projection.** UTM zone 31N (it covers Lagos) in metres around the origin. The origin is the middle of
  the data unless `--origin` is given. Game x is east, game z is south, and 1 unit is 1 metre.
- **Roads** become the build script's five types (the table is in `lib/classify.mjs`):

  | OSM | Game |
  |---|---|
  | `motorway`, `trunk` (and links) | expressway |
  | `highway=busway`, `busway=yes`, `psv=designated` + `motor_vehicle=no` | BRT corridor (kerbed lane, lane wardens beside it) |
  | `highway=service` (not parking aisles or driveways) | service lane |
  | `primary` … `residential`, `unclassified`, `living_street`, `track` | inner street |
  | inner streets and service roads inside an `amenity=marketplace` area | market road |

  Footways, paths, steps and cycleways are skipped. Road names are kept, because public roads can be
  real.
- **Potholes** go on rough or unpaved surfaces (`surface=unpaved|gravel|dirt|…`, `smoothness=bad|…`),
  plus seeded random ones on inner and market streets. They are fixed in place, so players can learn the
  roads, and every import of the same data gives the same result.
- **Buildings** are extruded from their footprints. Heights come from `height` or `building:levels`,
  or are guessed from the building type. **All names, shops and brands are dropped**: businesses and
  homes stay fictional in the game. Churches and mosques stay as unnamed landmarks.
- **Ground areas**: water (including multipolygons), beaches, parks and markets are drawn flat.

## Not done yet

- **Tiles are uncompressed GLB.** Draco or meshopt compression is still to do.
- **Bridges are drawn at ground level**, with no decks or ramps yet.
- **The coastline isn't drawn.** It is a line, not an area. Lagoon and sea areas only show where the data
  has water polygons.
- **No hand-fix pass yet.** Coverage varies by street, so every area needs a manual pass in a map editor
  before it ships. For now, fix the OSM extract itself before importing.
- **Single building colour**, chosen by building type. Facades, roofs and props are all placeholders.

## Licence

OpenStreetMap data is © OpenStreetMap contributors and available under the **Open Database License
(ODbL) 1.0**. The game shows "© OpenStreetMap contributors" whenever you are in a map area, and on its
map. The derived tiles may count as a derivative database with **share-alike** obligations. Confirm
what that means for a commercial release (with a lawyer) before shipping an area.

## Test fixture

`fixtures/fixture-town.osm` is **synthetic test data**, made by `fixtures/make-fixture.mjs`. It is not real
geography and must never ship as a game area. `tests/m5_osm_import.py` and `tests/m5_area.py` use it.
