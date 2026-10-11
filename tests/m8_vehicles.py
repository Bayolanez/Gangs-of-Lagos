"""Design-board vehicles: the drivable teal sedan (enter, drive, steer, brake, crash, exit) and the
minibus, coupe and crossover parked on the square and in traffic."""
import asyncio
from gol import browser, ok, finish, save, SH


async def hold(g, keys, secs):
    for k in keys:
        await g.pg.keyboard.down(k)
    await g.sim(secs)
    for k in keys:
        await g.pg.keyboard.up(k)


async def main():
    async with browser() as (g, errs):
        E = g.E
        await g.boot(save(cash=5000))
        await g.play()
        await E('__gol.setTraffic(0)')
        await g.sim(0.2)

        # Walking still works.
        x0 = await E('__gol.player.z')
        await hold(g, ['KeyW'], 1)
        ok('player movement unchanged', abs(await E('__gol.player.z') - x0) > 1 or abs(await E('__gol.player.x') + 30) > 1)

        # The sedan: parked on the square, original design, not inside anything.
        s = await E('({k: __gol.saloon.kind, name: __gol.saloon.spec.name, x: __gol.saloon.x, z: __gol.saloon.z})')
        ok('teal sedan parked on the square', s['k'] == 'saloon' and abs(s['x'] + 27) < 0.1, s)
        ov = await E('__gol.overlapping()')
        ok('sedan and parked vehicles spawn clear of walls and props', not ov['saloon'] and not ov['parked'], ov)
        await E('__gol.teleportPlayer(__gol.saloon.x - 2.0, __gol.saloon.z)')
        await g.sim(0.1)
        prompt = await g.txt('prompt')
        ok('prompt to drive the sedan when close', 'Drive the sedan' in prompt and not await E("document.getElementById('prompt').hidden"), prompt)
        await g.key('KeyE')
        ok('E gets into the sedan', await E('__gol.inVehicle') == 'saloon')
        ok('the player stays visible, seated at the wheel', await E('__gol.player.rig.root.visible') and await E('__gol.player.rig.seated'))
        seat = await E('[__gol.player.rig.root.position.x, __gol.player.rig.root.position.z]')
        ok('driver sits inside the car', abs(seat[0] - s['x']) < 1 and abs(seat[1] - s['z']) < 1, seat)
        ok('driving key hints shown', 'HANDBRAKE' in (await E("document.getElementById('keys').textContent")).upper())

        # Drive: accelerate, wheels spin, steer, brake, reverse.
        spin0 = await E('__gol.saloon.wheelSpin')
        await hold(g, ['KeyW'], 2)
        v = await E('__gol.saloon.speed')
        ok('W accelerates', v > 8, v)
        ok('wheels rotate while moving', abs(await E('__gol.saloon.wheelSpin') - spin0) > 5)
        h0 = await E('__gol.saloon.heading')
        await g.pg.keyboard.down('KeyD'); await g.pg.keyboard.down('KeyW'); await g.sim(0.6)
        st = await E('__gol.saloon.steerAngle')
        await g.pg.keyboard.up('KeyD'); await g.pg.keyboard.up('KeyW')
        ok('front wheels steer with D', st > 0.3, st)
        ok('the car turns', abs(await E('__gol.saloon.heading') - h0) > 0.1)
        await g.sim(0.6)
        ok('front wheels straighten when you let go', abs(await E('__gol.saloon.steerAngle')) < 0.08)
        await hold(g, ['Space'], 1.2)
        ok('Space brakes to a stop', abs(await E('__gol.saloon.speed')) < 0.5, await E('__gol.saloon.speed'))
        await hold(g, ['KeyS'], 1.5)
        ok('S reverses', await E('__gol.saloon.speed') < -2)
        await hold(g, ['Space'], 1)
        ok('car stays on the road surface (no sinking)', abs(await E('__gol.saloon.group.position.y')) < 1e-6)
        await g.pg.screenshot(path=f'{SH}/m8_drive.png')

        # Crash into a building and recover.
        await E('__gol.teleportVehicle(__gol.saloon, -160, -40, Math.PI / 2)')  # facing the buildings south of the road
        await hold(g, ['KeyW'], 4)
        p = await E('[__gol.saloon.x, __gol.saloon.z]')
        await hold(g, ['KeyS'], 1.5)
        p2 = await E('[__gol.saloon.x, __gol.saloon.z]')
        ok('after a crash the car can reverse away (not stuck)', abs(p2[0] - p[0]) + abs(p2[1] - p[1]) > 1, [p, p2])
        ok('crash damages the sedan', await E('__gol.saloon.healthPct') < 1)
        await hold(g, ['Space'], 1)

        # Exit.
        await g.key('KeyE')
        ok('E gets out', await E('__gol.inVehicle') is None and not await E('__gol.player.rig.seated'))
        pp = await E('[__gol.player.x, __gol.player.z]')
        vv = await E('[__gol.saloon.x, __gol.saloon.z]')
        ok('you get out beside the car, not inside a wall', 1 < ((pp[0] - vv[0]) ** 2 + (pp[1] - vv[1]) ** 2) ** 0.5 < 4 and not (await E('__gol.overlapping()'))['player'], [pp, vv])

        # The other three: parked, distinct shapes and colours, and in traffic.
        parked = await E("__gol.parked.map(v => { const cs = new Set(); v.group.traverse(o => { if (o.isMesh && o.material && o.material.color) cs.add(o.material.color.getHexString()); }); return { k: v.kind, len: v.spec.len, colours: [...cs] }; })")
        kinds = [p['k'] for p in parked]
        ok('minibus, coupe and crossover parked on the square', kinds == ['minibus', 'coupe', 'crossover'], kinds)
        want = {'minibus': ['1f6b3d', 'efe3c2'], 'coupe': ['d9503e', '1e1d24'], 'crossover': ['cfb07c', '1f3d47']}
        ok('each has its design colours', all(all(c in p['colours'] for c in want[p['k']]) for p in parked), [(p['k'], p['colours'][:6]) for p in parked])
        sc = await E("(() => { const cs = new Set(); __gol.saloon.group.traverse(o => { if (o.isMesh && o.material && o.material.color) cs.add(o.material.color.getHexString()); }); return [...cs]; })()")
        ok('the sedan is deep teal with an amber stripe', '22707c' in sc and 'f0a836' in sc, sc)
        ok('distinct sizes (the minibus is the longest)', parked[0]['len'] > parked[1]['len'] and parked[0]['len'] > parked[2]['len'])
        await E('__gol.setTraffic(10)'); await g.sim(2)
        tk = await E("__gol.traffic.cars.map(c => c.v.kind)")
        ok('design-board vehicles in traffic too', all(k in tk for k in ['minibus', 'coupe', 'crossover']), tk)
        await E("document.getElementById('hud').style.visibility='hidden'")
        await E('__gol.lookAt(-2, 7, 8, -2, 0.8, 28)'); await g.sim(0.05)
        await g.pg.screenshot(path=f'{SH}/m8_parked.png')
        await E('__gol.freeCam()')
        finish(errs)


asyncio.run(main())
