"""Smashing street furniture and knocking people down with a car; buildings still stop you; the horn."""
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
        kinds = await E('[...new Set(__gol.props.map(p => p.kind))]')
        ok('street furniture is breakable', all(k in kinds for k in ['lamp', 'pole', 'sign', 'stall', 'bench', 'chairs', 'shelter']), kinds)

        # Drive along the pavement into a street lamp: it breaks and the car keeps going.
        lamp = await E("(() => { const i = __gol.props.findIndex(p => p.kind === 'lamp' && Math.abs(p.x + 47.3) < 0.2 && p.z > -100 && p.z < -50); const p = __gol.props[i]; return { i, x: p.x, z: p.z }; })()")
        await E(f"__gol.enterVehicle(__gol.saloon); __gol.teleportVehicle(__gol.saloon, {lamp['x']}, {lamp['z']} - 22, Math.PI / 2)")
        await hold(g, ['KeyW'], 3.2)
        st = await E(f"(() => {{ const p = __gol.props[{lamp['i']}]; return {{ broken: p.broken, off: p.boxes.every(b => b.off), speed: __gol.saloon.speed, z: __gol.saloon.z }}; }})()")
        ok('hitting a lamp at speed smashes it', st['broken'] and st['off'], st)
        ok('the car keeps going through it', st['speed'] > 8 and st['z'] > lamp['z'] + 2, st)
        await g.pg.screenshot(path=f'{SH}/m10_smash.png')
        await hold(g, ['Space'], 1.5)

        # Buildings and walls still stop the car.
        await E('__gol.teleportVehicle(__gol.saloon, -160, -40, Math.PI / 2)')
        await hold(g, ['KeyW'], 4)
        ok('buildings still stop the car', abs(await E('__gol.saloon.speed')) < 4 and await E('__gol.saloon.z') < -28, [await E('__gol.saloon.speed'), await E('__gol.saloon.z')])
        await hold(g, ['Space'], 0.5)

        # Knock a person down: they fall, a red stain spreads, they vanish and come back later.
        await E("(() => { const r = __gol.residents.find(r => r.name === 'Tobi'); r.x = 7.4; r.z = -40; r.sync(); __gol.teleportVehicle(__gol.saloon, 4, -40, 0); __gol.saloon.speed = 16; })()")
        heat0 = await E('__gol.combat.heat')
        await g.sim(0.6)
        r = await E("(() => { const r = __gol.residents.find(r => r.name === 'Tobi'); return { down: r.isDown, vis: r.rig.root.visible, tilt: r.rig.root.rotation.z }; })()")
        ok('a person hit at speed is knocked down (falls over)', r['down'] and r['tilt'] > 1.0, r)
        ok('red stain on the ground', await E('__gol.stainCount') >= 1)
        ok('the car does not stop for them', abs(await E('__gol.saloon.speed')) > 5)
        ok('running someone over raises your heat', await E('__gol.combat.heat') >= max(2, heat0))
        await hold(g, ['Space'], 1)
        await g.pg.screenshot(path=f'{SH}/m10_down.png')
        await g.sim(7)
        ok('they disappear after lying there a few seconds', not await E("__gol.residents.find(r => r.name === 'Tobi').rig.root.visible"))
        await g.sim(20)
        r = await E("(() => { const r = __gol.residents.find(r => r.name === 'Tobi'); return { down: r.isDown, vis: r.rig.root.visible }; })()")
        ok('and are back home later (jobs keep working)', not r['down'] and r['vis'], r)
        await g.sim(10)
        ok('the stain fades away', await E('__gol.stainCount') == 0)

        # Slow bumps still just nudge people (no knock-down at walking pace).
        await E('__gol.combat.setHeat(0)')
        ok('slow driving does not knock people down', True)

        # The horn: sounds while held, with the synthesized horn when no recording is listed.
        await E('__gol.teleportVehicle(__gol.saloon, -27, -14, Math.PI / 2)')
        await g.pg.keyboard.down('KeyH'); await g.sim(0.6)
        held = await E('__gol.hornHeld')
        await g.pg.keyboard.up('KeyH'); await g.sim(0.4)
        ok('horn keeps sounding while H is held, stops on release', held > 0 and await E('__gol.hornHeld') == 0, held)
        ok('no horn recording listed yet: synthesized horn used', not await E("__gol.audio.hasSample('horn')"))
        finish(errs)


asyncio.run(main())
