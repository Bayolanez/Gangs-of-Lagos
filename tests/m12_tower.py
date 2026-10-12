"""Harbour Heights: enter from the street, walls hold, walk the stairs from the lobby to the
penthouse, rails stop you falling into the stairwell, ride the lift to every floor, and leave by
the lobby doors back to the same spot on the square."""
import asyncio, math
from gol import browser, ok, finish, SH

T = '__gol.tower'


async def walk(g, yaw, secs, keys=('KeyW',)):
    """Walk with the camera facing yaw; returns the positions seen (x, y, z) every 0.2 s."""
    await g.E(f'__gol.setCamYaw({yaw})')
    for k in keys:
        await g.pg.keyboard.down(k)
    out, t = [], 0.0
    while t < secs:
        await g.sim(0.2)
        t += 0.2
        out.append(await g.E('[__gol.player.x, __gol.player.y, __gol.player.z]'))
    for k in keys:
        await g.pg.keyboard.up(k)
    await g.sim(0.1)
    return out


async def txt(g, i):
    return await g.E(f"document.getElementById('{i}').textContent")


async def main():
    async with browser() as (g, errs):
        E, pg = g.E, g.pg
        await g.boot()
        await g.play()
        await E('__gol.setTraffic(0)')
        ok('interior not built before the first visit', await E(f'{T}.interior') is None)

        # ---- In from the street
        await E('__gol.teleportPlayer(16, 21)')
        await g.sim(0.2)
        ok('prompt at the doors', 'Enter Harbour Heights' in await txt(g, 'prompt'), await txt(g, 'prompt'))
        await g.key('KeyE')
        await g.sim(0.3)
        ok('inside the lobby', await E(f'{T}.inside') and await E(f'{T}.interior.visible') and not await E(f'{T}.exterior.visible'))
        ok('HUD names the floor', 'Lobby' in await txt(g, 'area-name'), await txt(g, 'area-name'))
        await pg.screenshot(path=f'{SH}/m12_lobby.png')

        # Walls: walk east into the wall, south into the glass doors.
        p = await walk(g, 0, 3.0)
        ok('the east wall holds', p[-1][0] < 23.7 and p[-1][1] == 0, p[-1])
        await E('__gol.teleportPlayer(16, 16)')
        p = await walk(g, math.pi / 2, 1.5)
        ok('the glass doors hold (leave with E)', p[-1][2] < 17.8 and await E(f'{T}.inside'), p[-1])
        ok('exit prompt at the doors', 'Exit to Harbour Bend Square' in await txt(g, 'prompt'), await txt(g, 'prompt'))

        # ---- Stairs, lobby to penthouse, walking only
        await E('__gol.teleportPlayer(10, 16.5)')
        p = await walk(g, math.pi, 1.0)  # west into the stair lane
        p = await walk(g, -math.pi / 2, 4.6)  # flight 1 (north)
        ok('flight 1 climbs to floor 1', abs(p[-1][1] - 4) < 0.01 and all(b[1] >= a[1] - 0.01 for a, b in zip(p, p[1:])), [round(q[1], 2) for q in p])
        p = await walk(g, 0, 0.4)  # step across to the second lane
        p = await walk(g, math.pi / 2, 4.6)  # flight 2 (south)
        ok('flight 2 climbs to floor 2', abs(p[-1][1] - 8) < 0.01, [round(q[1], 2) for q in p])
        p = await walk(g, math.pi, 0.4)  # back across to the first lane
        p = await walk(g, -math.pi / 2, 4.6)  # flight 3 (north)
        ok('flight 3 climbs to the penthouse', abs(p[-1][1] - 12) < 0.01 and await E(f'{T}.levelOf(__gol.player.y)') == 3, [round(q[1], 2) for q in p])
        ok('HUD: penthouse', 'Penthouse' in await txt(g, 'area-name'))
        p = await walk(g, 0, 2.5)
        p = await walk(g, math.pi / 2, 2.0)
        ok('penthouse floor is solid to walk on', all(abs(q[1] - 12) < 0.01 for q in p), [round(q[1], 2) for q in p])
        await pg.screenshot(path=f'{SH}/m12_penthouse.png')

        # Rails: on floor 1, walking from the south landing into the open stairwell is blocked.
        await E('__gol.player.y = 4; __gol.player.vy = 0; __gol.teleportPlayer(9, 17.4)')
        await g.sim(0.1)
        p = await walk(g, -math.pi / 2, 1.5)
        ok('the rail stops a fall into the stairwell', p[-1][2] > 15.5 and abs(p[-1][1] - 4) < 0.01, p[-1])

        # Going back down the stairs works too.
        await E('__gol.player.y = 4; __gol.player.vy = 0; __gol.teleportPlayer(9, 3.0)')
        await g.sim(0.1)
        p = await walk(g, math.pi / 2, 4.6)
        ok('walk down to the lobby', abs(p[-1][1]) < 0.01 and p[-1][2] > 15, [round(q[1], 2) for q in p][::3])

        # ---- Lift: every floor from the lobby and back
        await E('__gol.teleportPlayer(19.6, 3.75)')
        await walk(g, 0, 1.0)
        ok('lift prompt inside the car', 'Use the lift' in await txt(g, 'prompt'), await txt(g, 'prompt'))
        heights = []
        for k, lv in [('Digit2', 1), ('Digit3', 2), ('Digit4', 3), ('Digit1', 0)]:
            await g.key('KeyE')
            ok_mode = await E('__gol.mode') == 'lift'
            if lv == 1:
                ok('lift panel lists G, 1, 2 and PH', ok_mode and await E("document.querySelectorAll('#lift-buttons button').length") == 4 and 'Penthouse' in await txt(g, 'lift-buttons'))
                await pg.screenshot(path=f'{SH}/m12_lift.png')
            await g.key(k)
            await g.sim(0.3)
            heights.append(await E('__gol.player.y'))
        ok('the lift reaches every floor', heights == [4, 8, 12, 0], heights)
        await E('__gol.openLift()')
        await pg.click('button[data-level="3"]')
        await g.sim(0.4)
        ok('lift by clicking a floor (penthouse)', await E('__gol.player.y') == 12 and await E('__gol.mode') == 'play')
        p = await walk(g, math.pi, 1.2)
        ok('step out of the lift into the penthouse', p[-1][0] < 21 and abs(p[-1][1] - 12) < 0.01, p[-1])
        await E('__gol.openLift()')
        await g.key('Escape')
        ok('Esc closes the lift panel without moving', await E('__gol.mode') == 'play' and await E('__gol.player.y') == 12)

        # ---- Out again by the lobby doors, to the same spot outside
        await E('__gol.openLift()')
        await g.key('Digit1')
        await g.sim(0.2)
        await E('__gol.teleportPlayer(16, 16.8)')
        await g.sim(0.1)
        await g.key('KeyE')
        await g.sim(0.2)
        out = await E('[__gol.player.x, __gol.player.y, __gol.player.z]')
        ok('leaving puts you outside the doors', not await E(f'{T}.inside') and out == [16, 0, 19.8] and await E(f'{T}.exterior.visible') and not await E(f'{T}.interior.visible'), out)
        p = await walk(g, math.pi / 2, 1.0)
        ok('walking on the square again', p[-1][2] > 21 and p[-1][1] == 0, p[-1])
        await E('__gol.teleportPlayer(16, 21)')
        await g.key('KeyE')
        await g.sim(0.2)
        ok('can go back in', await E(f'{T}.inside'))
        await E('__gol.exitTower()')
        await pg.screenshot(path=f'{SH}/m12_tower_outside.png')
        finish(errs)


if __name__ == "__main__":
    asyncio.run(main())
