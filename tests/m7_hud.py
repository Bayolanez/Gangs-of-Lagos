"""HUD: area name, route line, mission card, Lagos clock and weather, stamina, key hints, weapon wheel."""
import asyncio
from gol import browser, ok, finish, save, SH


async def main():
    async with browser() as (g, errs):
        E = g.E
        await g.boot(save(cash=24500, medal=3, owned=['pipe', 'egret', 'kingfisher'], ammo={'egret': 48, 'kingfisher': 90}))
        await g.play()
        await E('__gol.setTraffic(0)')
        await g.sim(0.3)
        ok('area name over the minimap', (await g.txt('area-name')) == 'Harbour Bend', await g.txt('area-name'))
        ok('money in its own panel, in naira', (await g.txt('cash')).startswith('₦'))
        ok('idle card: work comes by phone', 'call' in (await g.txt('m-obj')).lower() and await g.txt('m-name') == 'The Chairman', [await g.txt('m-name'), await g.txt('m-obj')])
        await E("__gol.acceptJob(__gol.runner().byId('night-exit'))")
        await g.sim(0.3)
        ok('a job taken by phone: card with distance to its start', 'Range Avenue' in await g.txt('m-obj') and (await g.txt('m-dist')).endswith(' m'), [await g.txt('m-obj'), await g.txt('m-dist')])
        route = await E('__gol.hud.route')
        ok('route line follows the roads to the job', len(route) >= 3, len(route))
        live = await g.txt('clock')
        ok('clock shows Lagos time (HH:MM)', len(live) == 5 and live[2] == ':' and live == await E('__gol.env.clockText'), live)
        ok('weather shown beside the clock', '°C' in await g.txt('weather'), await g.txt('weather'))
        await E("__gol.env.setTimeMode('fast')")
        c0 = await g.txt('clock')
        await g.sim(12)
        ok('clock runs (fast day)', await g.txt('clock') != c0, [c0, await g.txt('clock')])
        await E("__gol.env.setTimeMode('live')")
        keys = await E("document.getElementById('keys').textContent")
        ok('on-foot key hints', all(w in keys.upper() for w in ['WASD', 'SPRINT', 'INTERACT', 'TAB', 'MAP']), keys)

        # Stamina: sprinting drains it, resting brings it back, and it can run dry.
        await g.pg.keyboard.down('KeyW'); await g.pg.keyboard.down('ShiftLeft')
        await g.sim(3)
        s1 = await E('__gol.hud.stamina.value')
        ok('sprinting drains stamina', s1 < 70, s1)
        await g.sim(6)
        ok('stamina runs out and you slow to a walk', await E('__gol.hud.stamina.exhausted') and await E('__gol.player.speed') < 5, await E('__gol.player.speed'))
        await g.pg.keyboard.up('ShiftLeft'); await g.pg.keyboard.up('KeyW')
        await g.sim(5)
        ok('stamina recovers when you rest', await E('__gol.hud.stamina.value') > 60 and not await E('__gol.hud.stamina.exhausted'))
        ok('stamina bar shows it', float((await E("document.getElementById('st-bar').style.width")).rstrip('%')) > 60)

        # Weapon wheel: hold Tab, steer, release to equip.
        await g.pg.keyboard.down('Tab'); await g.sim(0.1)
        ok('holding Tab opens the weapon wheel', await E('__gol.hud.wheelOpen') and not await E("document.getElementById('wheel').hidden"))
        ok('wheel lists all six weapons, unowned ones locked', await E("document.querySelectorAll('.wseg').length") == 6 and await E("document.querySelectorAll('.wseg.locked').length") == 3)
        await E('__gol.hud.steerWheel(90, 0)')  # right: the pistol slot (2 o'clock)
        await g.sim(0.1)
        pick = await E('__gol.hud.wheelPick')
        await g.pg.screenshot(path=f'{SH}/m7_wheel.png')
        await g.pg.keyboard.up('Tab'); await g.sim(0.1)
        ok('releasing Tab equips the picked weapon', not await E('__gol.hud.wheelOpen') and await E('__gol.weapons.drawn') == pick and pick in ('egret', 'kingfisher'), pick)
        keys = await E("document.getElementById('keys').textContent")
        ok('weapon key hints (aim, fire, reload, holster)', all(w in keys.upper() for w in ['AIM', 'FIRE', 'RELOAD', 'HOLSTER']), keys)
        await g.key('KeyX')
        ok('X holsters too', await E('__gol.weapons.drawn') is None)
        await g.pg.keyboard.down('Tab'); await g.sim(0.1)
        await g.key('Digit3')
        await g.pg.keyboard.up('Tab'); await g.sim(0.1)
        ok('number keys pick on the wheel', await E('__gol.weapons.drawn') == 'kingfisher')

        # Driving hints, then Marina Point name.
        await E('__gol.weapons.draw(null); __gol.enterVehicle(__gol.hatch)'); await g.sim(0.2)
        keys = await E("document.getElementById('keys').textContent")
        ok('driving key hints', 'HANDBRAKE' in keys.upper() and 'RADIO' in keys.upper(), keys)
        await E('__gol.leaveVehicle(true); __gol.teleportPlayer(272, 40)'); await g.sim(0.2)
        ok('area name changes in Marina Point', await g.txt('area-name') == 'Marina Point')
        finish(errs)


asyncio.run(main())
