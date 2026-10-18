"""Bayo's model kit 2: the Modern Lagos House as the crew house (the GLB loads with its four layers,
you walk up the front stairs, onto the terrace and in through the front door, up the U-stair; the
floors above you hide; members only; the crew spots on each floor) and the EKO Twin sawn-off as the
Breakwater, whose barrels break open on reload."""
import asyncio
from gol import browser, ok, finish, SH

LX, LZ = -15, -59  # plot centre; house space (+X east, +Z towards the road)
HOUSE = '__gol.lagosHouse'


def w(x, z):
    return LX + x, LZ + z


async def main():
    async with browser() as (g, errs):
        E, pg, sim = g.E, g.pg, g.sim
        await g.boot("{version:9,cash:10,lookChosen:true,weapons:{owned:['breakwater'],ammo:{breakwater:40},equipped:null}}")
        await g.play()
        await E("__gol.setTraffic(0); __gol.env.setTimeMode('day'); __gol.env.setWeatherMode('clear')")
        loaded = await E('__gol.models.loaded')
        ok('the Lagos House and EKO Twin models load', 'lagos-house' in loaded and 'eko-twin' in loaded, loaded)
        ok('the house takes over from the code-built stand-in', await E(f'{HOUSE}.active') and await E('__gol.house.retired'))
        layers = await E(f"['base', 'ground_floor', 'upper_floor', 'roof_level'].map(n => !!{HOUSE}.model.getObjectByName(n))")
        ok('all four layers exist (base, ground_floor, upper_floor, roof_level)', all(layers), layers)
        size = await E(f"(() => {{ const b = new __gol.THREE.Box3().setFromObject({HOUSE}.model); return [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z]; }})()")
        ok('on its 22 x 18 m plot', 20 < size[0] < 24 and 16 < size[2] < 20 and 8 < size[1] < 14, [round(s, 1) for s in size])

        async def walk(secs, heading):
            await E(f'__gol.setCamYaw({heading}); __gol.player.heading = {heading}')
            await pg.keyboard.down('KeyW')
            await sim(secs)
            await pg.keyboard.up('KeyW')
            await sim(0.3)

        async def at(x, z, y):
            await E(f'__gol.player.y = {y}; __gol.player.vy = 0; __gol.teleportPlayer({LX + x}, {LZ + z})')
            await sim(0.25)

        # ---- Not a member: front stairs up to the terrace, the door stays shut
        await E(f'__gol.teleportPlayer({LX + 2}, {LZ + 8.7})')
        await sim(0.3)
        await walk(2.2, '-Math.PI / 2')
        y = await E('__gol.player.y')
        ok('walk up the front stairs onto the terrace', 1.1 < y < 1.4, round(y, 2))
        await at(2.8, 3.0, 1.23)
        ok('front door prompt: members only', 'members only' in (await g.txt('prompt')).lower(), await g.txt('prompt'))
        await g.key('KeyE')
        ok('...E says join a crew first', 'join a crew' in (await g.txt('notice')).lower())
        await walk(1.2, '-Math.PI / 2')
        ok('...and the locked door keeps you out', await E('__gol.player.z') > LZ + 2.1, round(await E('__gol.player.z') - LZ, 2))
        await at(-3, 6.5, 0)
        await walk(1.5, '-Math.PI / 2')
        ok('the house walls are solid', await E('__gol.player.z') > LZ + 1.9, round(await E('__gol.player.z') - LZ, 2))
        await E("__gol.lookAt(-2, 9, -36, -15, 3, -59)")
        await pg.screenshot(path=f'{SH}/m18_front.png')
        await E('__gol.freeCam()')

        # ---- A member: through the door and up the house
        await g.boot("{version:9,cash:10,crew:'blue',lookChosen:true,weapons:{owned:['breakwater'],ammo:{breakwater:40},equipped:null}}")
        await g.play()
        await E("__gol.setTraffic(0); __gol.env.setTimeMode('day'); __gol.env.setWeatherMode('clear')")
        ok('a Blue Tide house: flag and crew inside', await E(f"{HOUSE}.owner.name") == 'Blue Tide' and await E(f"{HOUSE}.members.length === 3 && {HOUSE}.members.every(m => m.root.visible && m.root.getObjectByName('bandana'))"))
        await at(2.8, 3.2, 1.23)
        await walk(1.2, '-Math.PI / 2')
        inside = await E(f'[__gol.player.y, {HOUSE}.shown]')
        ok('through the front door onto the ground floor', abs(inside[0] - 1.25) < 0.05 and await E('__gol.player.z') < LZ + 1.6, inside)
        ok("setFloor('ground'): the upper floor and roof hide", inside[1] == 'ground' and not await E(f'{HOUSE}.layers.upper_floor.visible') and not await E(f'{HOUSE}.layers.roof_level.visible'))
        ok('...the ground floor stays', await E(f'{HOUSE}.layers.ground_floor.visible') and await E(f'{HOUSE}.layers.base.visible'))
        await pg.screenshot(path=f'{SH}/m18_ground.png')
        ok('Blue Tide house on the area name', 'Blue Tide house' in await g.txt('area-name'), await g.txt('area-name'))

        async def spot(x, z, y, text):
            await at(x, z, y)
            got = await g.txt('prompt')
            ok(f'prompt: {text}', text in got, got)

        await spot(-0.4, 1.45, 1.25, 'Plan with the crew')
        await spot(-1.0, -4.3, 1.25, 'Use the bathroom')
        # The U-stair: up the first flight to the landing, then the second to the upper floor.
        await at(0.9, -2.0, 1.25)
        await walk(1.8, '-Math.PI / 2')
        land = await E('__gol.player.y')
        ok('up the U-stair to the landing', 2.4 < land < 3.3, round(land, 2))
        await E(f'__gol.teleportPlayer({LX + 2.1}, {LZ - 4.9})')
        await walk(2.2, 'Math.PI / 2')
        up = await E(f'[__gol.player.y, {HOUSE}.shown]')
        ok('...and on to the upper floor (the roof hides, the upper floor shows)', abs(up[0] - 4.44) < 0.05 and up[1] == 'upper' and await E(f'{HOUSE}.layers.upper_floor.visible') and not await E(f'{HOUSE}.layers.roof_level.visible'), up)
        await spot(-0.75, 2.4, 4.44, 'Sleep in your room')
        await pg.screenshot(path=f'{SH}/m18_master.png')
        await spot(-1.6, -3.6, 4.44, 'Use the bathroom')
        await spot(2.1, -1.7, 4.44, 'spiral stair to the roof')
        await g.key('KeyE')
        await sim(0.4)
        roof = await E(f'[__gol.player.y, {HOUSE}.shown]')
        ok('the spiral stair takes you to the roof (every floor shows)', abs(roof[0] - 7.83) < 0.05 and roof[1] == 'all', roof)
        await spot(4.3, 1.0, 7.83, 'Work out')
        await g.key('KeyE')
        ok('the roof gym works: fitness up', await E('__gol.save.fitness') == 1)
        await pg.screenshot(path=f'{SH}/m18_roof.png')
        await spot(1.3, -3.4, 7.83, 'Down the spiral stair')
        await g.key('KeyE')
        await sim(0.3)
        ok('...and back down to the upper floor', abs(await E('__gol.player.y') - 4.44) < 0.05)
        await at(7.6, 6.2, 0)
        await spot(7.6, 6.2, 0, 'Drive to the club with the crew')

        # ---- Camera stays inside on the ground floor
        await at(-3.5, -1.0, 1.25)
        await E('__gol.setCamYaw(0)')
        await sim(1.2)
        cam = await E('__gol.camPos')
        ok('indoors the camera stops at the house walls', cam[0] > LX - 7.1, [round(c, 2) for c in cam])

        # ---- EKO Twin
        await at(4.3, 1.0, 0)
        await E(f'__gol.teleportPlayer({LX + 12}, {LZ + 12})')
        await sim(0.3)
        await E("__gol.weapons.draw('breakwater')")
        await sim(0.6)
        ok('Breakwater shotgun drawn as the EKO Twin', await E('__gol.models.held && __gol.models.held.name') == 'eko-twin')
        bar = "__gol.models.held.getObjectByName('barrels').rotation.x"
        b0 = await E(bar)
        await E('__gol.fire()')
        await sim(0.3)
        await g.key('KeyR')
        await sim(0.6)
        b1 = await E(bar)
        ok('reload breaks the barrels open', b1 - b0 > 0.4, [round(b0, 3), round(b1, 3)])
        await E("__gol.lookAt(__gol.player.x + 1.2, 1.5, __gol.player.z + 1.6, __gol.player.x, 1.1, __gol.player.z)")
        await pg.screenshot(path=f'{SH}/m18_twin.png')
        await E('__gol.freeCam()')
        await sim(2.5)
        ok('...and snaps them shut', abs(await E(bar) - b0) < 0.01 and await E('__gol.weapons.reloading') == 0, await E(bar))
        finish(errs)


asyncio.run(main())
