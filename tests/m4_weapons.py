"""Phase 4: drawing, aiming and firing original placeholder weapons; ammo, reloads, melee, holstering."""
import asyncio
from gol import browser, ok, finish, save, SH


async def main():
    async with browser() as (g, errs):
        E, sim, txt, pg = g.E, g.sim, g.txt, g.pg
        await g.boot(save(cash=5000, medal=3, owned=['pipe', 'egret', 'breakwater'], ammo={'egret': 30, 'breakwater': 12}))
        await g.play()
        await E('__gol.setTraffic(0)'); await sim(0.2)

        # A quiet road far from anyone: no witnesses, no heat.
        await E('__gol.teleportPlayer(-120,-170)'); await E('__gol.setCamYaw(-Math.PI/2)'); await sim(0.2)
        await g.key('Digit2')
        ok('draw the pistol with 2', await E('__gol.weapons.drawn') == 'egret' and await txt('wp-ammo') == '12 / 18', await txt('wp-ammo'))
        ok('crosshair and weapon panel', await E("!document.getElementById('crosshair').hidden && !document.getElementById('weapon').hidden"))
        await E("__gol.setAim({x:-120,y:1.4,z:-197})")
        await g.key('KeyF')
        ok('fire spends a round', await txt('wp-ammo') == '11 / 18' and (await E('__gol.save'))['stats']['shots'] == 1, await txt('wp-ammo'))
        ok('shot hits the boundary wall', (await E('__gol.lastShot'))['kind'] == 'world')
        ok('player turns to aim', abs(await E('__gol.player.heading') - (-1.5708)) < 0.05, await E('__gol.player.heading'))
        await pg.screenshot(path=f'{SH}/m4_fire.png')
        ok('no witnesses, no heat', await E('__gol.combat.heat') == 0)
        # Hold F: the pistol is semi-automatic, so one round per press
        await pg.keyboard.down('KeyF'); await sim(1.0); await pg.keyboard.up('KeyF')
        ok('semi-auto fires once per press', await txt('wp-ammo') == '10 / 18', await txt('wp-ammo'))
        # Empty the magazine: it reloads by itself
        for _ in range(10):
            await g.key('KeyF'); await sim(0.25)
        ok('empty magazine starts a reload', await E('__gol.weapons.reloading') > 0 or await txt('wp-ammo') == 'Reloading…')
        await sim(1.5)
        ok('reload refills from reserve', await txt('wp-ammo') == '12 / 6', await txt('wp-ammo'))
        await g.key('KeyF'); await sim(0.4); await g.key('KeyF'); await sim(0.4)
        await g.key('KeyR'); await sim(1.5)
        ok('R reloads a part-used magazine', await txt('wp-ammo') == '12 / 4', await txt('wp-ammo'))
        for _ in range(17):
            await g.key('KeyF'); await sim(0.35)
            if await E('__gol.weapons.reloading') > 0: await sim(1.4)
        await g.key('KeyF')
        ok('out of rounds says where to buy', (await E('__gol.save'))['weapons']['ammo']['egret'] == 0 and 'Sade' in await txt('notice'), await txt('notice'))

        # Shotgun pellets damage a parked car
        await E('__gol.teleportVehicle(__gol.hatch,-120,-180,0)'); await sim(0.1)
        await g.key('Digit4')
        h0 = await E('__gol.hatch.health')
        await E("__gol.setAim({x:-120,y:0.9,z:-180})")
        await g.key('KeyF'); await sim(0.2)
        ok('shotgun pellets hit the car', await E('__gol.hatch.health') < h0 and (await E('__gol.lastShot'))['kind'] == 'vehicle', [h0, await E('__gol.hatch.health')])
        ok('shotgun uses one shell per shot', await E('__gol.save.weapons.ammo.breakwater') == 11)

        # Holster and switch
        await g.key('KeyQ')
        ok('Q holsters', await E('__gol.weapons.drawn') is None and await E("document.getElementById('weapon').hidden"))
        await g.key('KeyQ')
        ok('Q draws the last weapon again', await E('__gol.weapons.drawn') == 'breakwater')
        await E("__gol.teleportPlayer(-120,-178.2)"); await sim(0.1)
        await g.key('KeyE')
        ok('getting in a car holsters', await E('__gol.inVehicle') == 'hatchback' and await E('__gol.weapons.drawn') is None)
        await g.key('Digit2')
        ok('no weapons while driving', await E('__gol.weapons.drawn') is None)
        await E('__gol.leaveVehicle()'); await sim(0.1)

        # Melee: the pipe makes a resident run and counts as assault
        await E('__gol.setAim(null)')
        await g.key('Digit1')
        ok('pipe drawn, no crosshair', await E('__gol.weapons.drawn') == 'pipe' and await E("document.getElementById('crosshair').hidden"))
        await E("__gol.approach('Baba Sule')"); await E('__gol.setCamYaw(0)'); await sim(0.05)
        await E("(()=>{const r=__gol.residents.find(k=>k.name==='Baba Sule'); __gol.player.x=r.x-1.2; __gol.player.z=r.z; __gol.player.heading=0; __gol.player.sync();})()")
        await g.key('KeyF')
        r = await E("(()=>{const r=__gol.residents.find(k=>k.name==='Baba Sule'); return {flee:r.fleeTimer, line:r.line}})()")
        ok('pipe hits a resident: they run', (await E('__gol.lastShot'))['name'] == 'Baba Sule' and r['flee'] > 0, r)
        ok('assault raises heat to 2', await E('__gol.combat.heat') >= 2, await E('__gol.combat.heat'))

        # Officers arrive; shoot one down with the shotgun
        await E('__gol.save.weapons.ammo.breakwater = 30')
        await g.key('Digit4')
        await sim(6)
        n = await E('__gol.combat.officers.length')
        ok('officers arrive for heat 2', n >= 2, n)
        downed = False
        for _ in range(40):
            o = await E("(()=>{const o=__gol.combat.officers.find(k=>!k.down); return o?{x:o.x,z:o.z}:null})()")
            if not o:
                await sim(1); continue
            await E(f"__gol.teleportPlayer({o['x']}+5,{o['z']})"); await sim(0.05)
            await E(f"__gol.setAim({{x:{o['x']},y:1.2,z:{o['z']}}})")
            await g.key('KeyF'); await sim(1.0)
            if await E('__gol.combat.officers.some(k=>k.down)'):
                downed = True
                break
        ok('an officer can be knocked down', downed)
        ok('hitting officers raises heat to 3+', await E('__gol.combat.heat') >= 3, await E('__gol.combat.heat'))
        await pg.screenshot(path=f'{SH}/m4_officers.png')
        finish(errs)


asyncio.run(main())
