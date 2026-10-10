"""Phase 5: a map area streamed in tiles, with traffic on its road graph, BRT buses and lane fines, crowded
market roads, potholes, building colliders and OpenStreetMap attribution. Uses the SYNTHETIC fixture,
imported into dist/test-areas/ (never shipped) because no real Lagos extract is in the repo yet."""
import asyncio, json, math, os, subprocess
from gol import browser, ok, finish, save, SH

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = 'test-areas/fixture-town/manifest.json'
OX = 6000

# Helpers evaluated in the page (area coordinates are offset by AREA_OFFSET.x = 6000).
ROAD = "(name => [...__gol.area.roads()].find(r => r.name === name))"


async def drive_to_speed(g, seconds):
    await g.pg.keyboard.down('KeyW')
    peak = 0
    for _ in range(int(seconds / 0.25)):
        await g.sim(0.25)
        peak = max(peak, abs(await g.E('__gol.hatch.speed')))
    await g.pg.keyboard.up('KeyW')
    return peak


async def main():
    r = subprocess.run(['node', 'tools/osm-import/import.mjs', '--in', 'tools/osm-import/fixtures/fixture-town.osm', '--id', 'fixture-town',
                        '--name', 'Fixture Town', '--fixture', '--out', 'dist/test-areas/fixture-town'], cwd=ROOT, capture_output=True, text=True)
    ok('fixture imported into the build for testing', r.returncode == 0, r.stderr[-200:])
    async with browser() as (g, errs):
        E, sim, txt, pg = g.E, g.sim, g.txt, g.pg
        await g.boot(save(cash=10000))
        # ---- The real area shipped in public/areas (Lagos Island) is offered and loads
        index = await E("fetch('areas/index.json').then(r => r.json())")
        names = [a['name'] for a in index['areas']]
        ok('title screen offers the imported area', names and not await E("document.getElementById('btn-area').hidden") and names[0] in await txt('btn-area'), names)
        await pg.click('#btn-area')
        await pg.wait_for_function("__gol.mode === 'play' || __gol.mode === 'wardrobe'", timeout=120000)
        if await E('__gol.mode') == 'wardrobe':
            await pg.click('#btn-wdone')
        await sim(0.2)
        real = await E('__gol.area.manifest')
        ok('real area loads from the title screen', not real['fixture'] and await E('__gol.area.tiles.size') >= 4 and 'OpenStreetMap' in await txt('attrib') and 'synthetic' not in await txt('attrib'), [real['name'], await E('__gol.area.tiles.size')])
        ok('spawn point is clear of buildings', not (await E('__gol.overlapping()'))['player'])
        await sim(4)
        ok('traffic drives the real streets', await E('__gol.areaTraffic.activeCount') >= 5)
        tile0 = await E("[...__gol.area.tiles.values()][0].json")
        ok('real tiles carry street names, not business names', any(r['name'] for r in tile0['roads']))
        await pg.screenshot(path=f'{SH}/m5_real_area.png')
        await g.key('KeyP'); await pg.click('#btn-leavearea'); await sim(0.2)
        ok('leave the real area', await E('__gol.area') is None)
        await E('__gol.setTraffic(0)')

        # ---- Enter the area: tiles stream in round the spawn point
        ok('enter the map area', await E(f"__gol.enterArea('{MANIFEST}')"))
        p = await E('[__gol.player.x, __gol.player.z]')
        ok('player starts in the area', p[0] > OX - 500 and p[0] < OX + 500, p)
        keys = await E('[...__gol.area.tiles.keys()].sort()')
        ok('tiles within 600 m load', len(keys) == 6, keys)
        ok('OpenStreetMap attribution on screen', 'OpenStreetMap contributors' in await txt('attrib') and 'synthetic' in await txt('attrib') and await E("!document.getElementById('attrib').hidden"))
        await pg.screenshot(path=f'{SH}/m5_area.png')

        # ---- Streaming: far tiles unload, and load again when you come back
        await E(f'__gol.teleportPlayer({OX}+440, 30)'); await sim(0.3)
        await E(f'__gol.area.settle({OX}+440, 30)')
        keys = await E('[...__gol.area.tiles.keys()]')
        ok('tiles more than 700 m behind unload', '-2_0' not in keys and await E('__gol.area.unloadsDone') >= 1, keys)
        ok('unloaded buildings stop colliding', await E("__gol.area.tiles.has('-2_0')") is False)
        await E(f'__gol.teleportPlayer({OX}-440, 30)'); await sim(0.3)
        await E(f'__gol.area.settle({OX}-440, 30)')
        keys = await E('[...__gol.area.tiles.keys()]')
        ok('and load again when you return', '-2_0' in keys and '1_0' not in keys, keys)

        # ---- Buildings from the map are solid
        b = await E("(()=>{const t=[...__gol.area.tiles.values()].find(t=>t.json.buildings.length); const pts=t.json.buildings[0].pts; const cx=pts.reduce((a,p)=>a+p[0],0)/pts.length, cz=pts.reduce((a,p)=>a+p[1],0)/pts.length; return [cx,cz]})()")
        await E(f'__gol.teleportPlayer({OX + b[0]}, {b[1]})'); await sim(0.2)
        ok('you cannot stand inside a building', not (await E('__gol.overlapping()'))['player'])
        await E(f'__gol.teleportPlayer({OX}, 54)'); await E(f'__gol.area.settle({OX}, 54)'); await sim(0.2)

        # ---- Traffic follows the imported road graph; BRT buses keep to BRT lanes
        await sim(4)
        cars = await E('__gol.areaTraffic.edgeTypes()')
        buses = await E('__gol.brtTraffic.edgeTypes()')
        ok('cars drive the imported roads, not the BRT lanes', len(cars) >= 5 and 'brt' not in cars, cars)
        ok('BRT buses run only in BRT lanes', len(buses) >= 1 and set(buses) == {'brt'}, buses)
        pos0 = await E('__gol.brtTraffic.vehicles().map(v=>[v.x,v.z])')
        await sim(3)
        pos1 = await E('__gol.brtTraffic.vehicles().map(v=>[v.x,v.z])')
        ok('BRT buses move', any(abs(a[0] - c[0]) > 3 for a, c in zip(pos0, pos1)), [pos0[:1], pos1[:1]])

        # ---- Driving in the BRT lane near a warden post costs a fine
        await E('__gol.areaTraffic.target = 0; __gol.brtTraffic.target = 0'); await sim(0.2)
        post = await E('__gol.area.posts()[1]')
        brt = await E(f"{ROAD}('Fixture BRT Corridor')")
        z = brt['pts'][0][1]
        await E(f'__gol.teleportVehicle(__gol.hatch, ({post["x"]}) - 30, ({z}), 0)')
        await E(f'__gol.teleportPlayer(({post["x"]}) - 30, ({z}) + 2.2)'); await sim(0.1)
        await g.key('KeyE')
        cash = await E('__gol.save.cash')
        await drive_to_speed(g, 3)
        ok('lane wardens fine you for the BRT lane', await E('__gol.fines') == 1 and await E('__gol.save.cash') == cash - 2000 and 'BRT lane' in await txt('notice'), [await E('__gol.fines'), await txt('notice')])
        await E('__gol.hatch.speed = 0'); await E('__gol.leaveVehicle(true)'); await sim(0.1)

        # ---- Market roads crawl
        lane = await E(f"{ROAD}('Fixture Market Lane')")
        (ax, az), (bx, bz) = lane['pts'][0], lane['pts'][-1]
        await E(f'__gol.hatch.repair(); __gol.teleportVehicle(__gol.hatch, {OX + ax + 3}, {az}, {math.atan2(bz - az, bx - ax)})')
        await E(f'__gol.teleportPlayer({OX + ax + 3}, {az + 2.2})'); await sim(0.1)
        await g.key('KeyE')
        peak = await drive_to_speed(g, 3)
        ok('market roads are barely passable', 0 < peak <= 4.6, peak)
        await E('__gol.hatch.speed = 0'); await E('__gol.leaveVehicle(true)'); await sim(0.1)

        # ---- Potholes jolt the camera and damage the car
        hole = await E("(()=>{for (const t of __gol.area.tiles.values()) for (const p of t.json.potholes) if (!p.rough) return p; return null})()")
        road = await E("""(h => { let best = null, bd = 1e9;
            for (const r of __gol.area.roads()) for (let i = 1; i < r.pts.length; i++) {
              const [ax, az] = r.pts[i - 1], [bx, bz] = r.pts[i], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
              const t = Math.max(0, Math.min(1, ((h.x - ax) * dx + (h.z - az) * dz) / l2));
              const d = Math.hypot(h.x - ax - dx * t, h.z - az - dz * t);
              if (d < bd) { bd = d; best = [dx / Math.sqrt(l2), dz / Math.sqrt(l2)]; }
            } return best; })(%s)""" % json.dumps(hole))
        dx, dz = road
        sx, sz = OX + hole['x'] - dx * 18, hole['z'] - dz * 18
        await E(f'__gol.hatch.repair(); __gol.teleportVehicle(__gol.hatch, {sx}, {sz}, {math.atan2(dz, dx)})')
        await E(f'__gol.teleportPlayer({sx - dz * 2.2}, {sz + dx * 2.2})'); await sim(0.1)
        await g.key('KeyE')
        h0 = await E('__gol.hatch.health')
        shook = False
        await pg.keyboard.down('KeyW')
        for _ in range(16):
            await sim(0.2)
            shook = shook or await E('__gol.camShake') > 0
        await pg.keyboard.up('KeyW')
        ok('a pothole jolts the camera and damages the car', shook and await E('__gol.hatch.health') < h0, [shook, h0, await E('__gol.hatch.health')])
        await E('__gol.hatch.speed = 0'); await E('__gol.leaveVehicle(true)'); await sim(0.1)

        # ---- A burst tyre slows you until it is fixed
        exp = await E(f"{ROAD}('Fixture Expressway')")
        ez = exp['pts'][0][1]
        await E(f'__gol.hatch.repair(); __gol.hatch.tyreBurst = true; __gol.teleportVehicle(__gol.hatch, {OX - 380}, {ez + 2}, 0)')
        await E(f'__gol.teleportPlayer({OX - 380}, {ez + 4.2})'); await sim(0.1)
        await g.key('KeyE')
        peak = await drive_to_speed(g, 6)
        ok('burst tyre limits top speed', 0 < peak <= 16.6, peak)
        await E('__gol.hatch.repair()')
        ok('repair fixes the tyre', await E('__gol.hatch.tyreBurst') is False)
        await E('__gol.hatch.speed = 0'); await E('__gol.leaveVehicle(true)'); await sim(0.1)

        # ---- The full map shows the area
        await g.key('KeyM')
        ok('full map shows the area with attribution', 'Fixture Town' in await txt('map-title') and 'OpenStreetMap' in await txt('map-title'))
        await pg.screenshot(path=f'{SH}/m5_map.png')
        await g.key('KeyM')

        # ---- Back to Harbour Bend from the pause menu
        await g.key('KeyP')
        ok('pause menu offers the way back', await E("!document.getElementById('btn-leavearea').hidden"))
        await pg.click('#btn-leavearea'); await sim(0.2)
        p = await E('[__gol.player.x, __gol.player.z]')
        ok('back in Harbour Bend', abs(p[0] + 30) < 2 and abs(p[1] + 20) < 2 and await E('__gol.area') is None and await E("document.getElementById('attrib').hidden"), p)
        await E('__gol.setTraffic(6)'); await sim(3)
        ok('Harbour Bend traffic returns', await E('__gol.traffic.activeCount') > 0)
        await g.talk('Kunle')
        ok('Harbour Bend jobs still work', await E('__gol.mode') == 'offer')
        await pg.click('#btn-decline'); await sim(0.1)
        ok('the area can be entered again', await E(f"__gol.enterArea('{MANIFEST}')") and len(await E('[...__gol.area.tiles.keys()]')) == 6)
        finish(errs)


asyncio.run(main())
