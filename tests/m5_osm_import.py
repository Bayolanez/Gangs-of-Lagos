"""Phase 5: tools/osm-import turns an OpenStreetMap extract into streamed tiles (run on the synthetic fixture).
Needs Node.js (the importer) but no browser."""
import hashlib, json, math, os, struct, subprocess, sys, tempfile
sys.path.insert(0, os.path.dirname(__file__))
from gol import ok, fails

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMPORTER = os.path.join(ROOT, 'tools', 'osm-import', 'import.mjs')
FIXTURE = os.path.join(ROOT, 'tools', 'osm-import', 'fixtures', 'fixture-town.osm')


def run(out, *extra):
    r = subprocess.run(['node', IMPORTER, '--in', FIXTURE, '--id', 'fixture-town', '--name', 'Fixture Town', '--out', out, *extra], capture_output=True, text=True, cwd=ROOT)
    if r.returncode:
        print(r.stdout, r.stderr)
    return r


def load(out, name):
    with open(os.path.join(out, name)) as f:
        return json.load(f)


def digest(out):
    h = hashlib.sha256()
    for root, _, files in sorted(os.walk(out)):
        for f in sorted(files):
            with open(os.path.join(root, f), 'rb') as fh:
                h.update(f.encode() + fh.read())
    return h.hexdigest()


tmp = tempfile.mkdtemp()
out = os.path.join(tmp, 'areas', 'fixture-town')
r = run(out, '--fixture')
ok('importer runs on the fixture', r.returncode == 0, r.stdout.splitlines()[:2])
m = load(out, 'manifest.json')
graph = load(out, 'graph.json')
tiles = [load(out, t['json']) for t in m['tiles']]

ok('manifest marks the fixture as synthetic', m['fixture'] is True and m['id'] == 'fixture-town')
ok('tiles are 400 m squares', m['tileSize'] == 400 and all(t['bounds'][2] - t['bounds'][0] == 400 and t['bounds'][3] - t['bounds'][1] == 400 for t in m['tiles']) and len(tiles) >= 4, len(tiles))
ok('attribution and licence note', m['attribution'] == '© OpenStreetMap contributors' and 'ODbL' in m['licence'] and 'confirm' in m['licence'])

roads = [rd for t in tiles for rd in t['roads']]
types = {rd['type'] for rd in roads}
ok('all five road types', types == {'expressway', 'brt', 'service', 'inner', 'market'}, types)
by_name = {}
for rd in roads:
    by_name.setdefault(rd['name'], rd)
ok('trunk road becomes expressway', by_name['Fixture Expressway']['type'] == 'expressway' and by_name['Fixture Expressway']['lanes'] == 4)
ok('busway becomes BRT corridor', by_name['Fixture BRT Corridor']['type'] == 'brt')
ok('service road becomes service lane', by_name['Fixture Service Lane']['type'] == 'service')
ok('roads inside the marketplace become market roads', by_name['Fixture Market Lane']['type'] == 'market')
ok('one-way street flagged', by_name['Fixture One Way']['oneway'] is True and by_name['Fixture Street 60']['oneway'] is False)
ok('footways and parking aisles skipped', m['stats']['roads'] == 16, m['stats']['roads'])
ok('unpaved and bad surfaces are rough', by_name['Fixture Avenue -300']['rough'] and by_name['Fixture Avenue 300']['rough'] and not by_name['Fixture Avenue 0']['rough'])

everything = ''.join(open(os.path.join(dp, f), encoding='utf-8', errors='ignore').read() for dp, _, fs in os.walk(out) for f in fs if f.endswith('.json'))
ok('business, market and church names dropped', 'Real ' not in everything)
ok('public road names kept', 'Fixture Expressway' in everything)

holes = [p for t in tiles for p in t['potholes']]
ok('potholes on rough surfaces', m['stats']['roughPotholes'] >= 10 and sum(1 for p in holes if p['rough']) == m['stats']['roughPotholes'], m['stats'])
ok('seeded random potholes on smooth inner streets too', any(not p['rough'] for p in holes))
ok('no potholes on the expressway or BRT', all(abs(p['z'] - by_name['Fixture Expressway']['pts'][0][1]) > 6 or abs(p['z'] - by_name['Fixture BRT Corridor']['pts'][0][1]) > 6 for p in holes))
posts = [p for t in tiles for p in t['posts']]
ok('lane warden posts beside the BRT corridor', len(posts) == m['stats']['wardenPosts'] >= 2 and all(abs(p['z'] - by_name['Fixture BRT Corridor']['pts'][0][1]) < 8 for p in posts), posts)

blds = [b for t in tiles for b in t['buildings']]
heights = sorted(round(b['h'], 1) for b in blds)
ok('buildings extruded with heights', len(blds) == 18 and min(heights) >= 3, heights)
ok('height and levels tags respected (24 m; 4 levels = 13.2 m)', 24.0 in heights and 13.2 in heights, heights)

# Projection: two grid junctions 150 m apart in the fixture stay ~150 m apart in game metres.
ends = by_name['Fixture Street 60']['pts']
xs = sorted(p[0] for p in ends)
gap = min(b - a for a, b in zip(xs, xs[1:]) if b - a > 50)
ok('UTM 31N projection keeps distances (150 m grid)', abs(gap - 150) < 1.5, gap)

deg = {}
for e in graph['edges']:
    deg[e['a']] = deg.get(e['a'], 0) + 1
    deg[e['b']] = deg.get(e['b'], 0) + 1
ok('road graph has junctions', max(deg.values()) >= 3 and len(graph['edges']) == m['stats']['graphEdges'], max(deg.values()))

# GLB files are valid glTF 2.0 binaries with one coloured mesh.
good = True
for t in m['tiles']:
    with open(os.path.join(out, t['glb']), 'rb') as f:
        data = f.read()
    magic, ver, length = struct.unpack('<III', data[:12])
    jlen, jtype = struct.unpack('<II', data[12:20])
    j = json.loads(data[20:20 + jlen])
    attrs = j['meshes'][0]['primitives'][0]['attributes']
    good &= magic == 0x46546C67 and ver == 2 and length == len(data) and jtype == 0x4E4F534A and set(attrs) == {'POSITION', 'NORMAL', 'COLOR_0'}
ok('tiles are valid GLB files', good)

r2 = run(os.path.join(tmp, 'again', 'fixture-town'), '--fixture')
ok('imports are deterministic', digest(out) == digest(os.path.join(tmp, 'again', 'fixture-town')))
ok('fixtures are not listed for the game', not os.path.exists(os.path.join(tmp, 'areas', 'index.json')))
real = os.path.join(tmp, 'areas', 'demo')
r3 = subprocess.run(['node', IMPORTER, '--in', FIXTURE, '--id', 'demo', '--name', 'Demo', '--out', real], capture_output=True, text=True, cwd=ROOT)
idx = load(os.path.join(tmp, 'areas'), 'index.json')
ok('non-fixture imports are listed in index.json', r3.returncode == 0 and idx['areas'] == [{'id': 'demo', 'name': 'Demo', 'manifest': 'demo/manifest.json'}], idx)
bad = subprocess.run(['node', IMPORTER, '--in', FIXTURE, '--id', 'Bad Id'], capture_output=True, text=True, cwd=ROOT)
ok('rejects bad ids', bad.returncode == 2)

print('FAILED:', fails)
sys.exit(1 if fails else 0)
