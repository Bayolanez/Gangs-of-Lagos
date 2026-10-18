"""Phase 6: light plane, helicopter and speedboat (licences, take-off, flight, landing, roofs, water, crashes)."""
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
        await g.boot(save(cash=1000, chapters=[1], completed=[]))
        await g.play()
        await g.E('__gol.setTraffic(0)')
        ok('save upgraded to v7 with no licences', await g.E('__gol.save.version') == 9 and await g.E('__gol.save.licences.length') == 0)

        # --- Licences lock the aircraft ---
        await g.E('__gol.teleportPlayer(__gol.plane.x - 3, __gol.plane.z + 3)')
        await g.key('KeyE')
        ok('plane is locked without a licence', await g.E('__gol.flying') is None)
        ok('locked plane points you to Flight School', 'Flight School' in await g.txt('notice'))
        await g.E('__gol.enterCraft(__gol.boat)')
        ok('boat is locked until the Lagoon Run is won', await g.E('__gol.flying') is None)

        # --- Plane: take off, fly, level out, land ---
        await g.E("__gol.save.licences.push('plane','heli','boat')")
        await g.key('KeyE')
        ok('E gets you into the plane with a licence', await g.E('__gol.flying') == 'plane')
        ok('radio dial shows in the plane', not await g.E("document.getElementById('radio').hidden"))
        await hold(g, ['KeyW'], 9)
        spd = await g.E('__gol.plane.speed')
        ok('plane accelerates down the runway', spd > 25, round(spd, 1))
        await hold(g, ['KeyW', 'ArrowUp'], 4)
        await hold(g, ['KeyW'], 4)
        y = await g.E('__gol.plane.y')
        ok('plane takes off', y > 10 and not await g.E('__gol.plane.grounded'), round(y, 1))
        ok('HUD shows altitude while flying', 'ALT' in await g.txt('speed'))
        await g.sim(6)
        y2 = await g.E('__gol.plane.y')
        ok('plane levels out and keeps flying hands-off', y2 > 8 and await g.E('__gol.flying') == 'plane', round(y2, 1))
        ok('can\'t get out in the air', not await g.E('__gol.exitCraft()'))
        await g.pg.screenshot(path=f'{SH}/m6_plane_air.png')
        # Line up over the runway low and slow, then let it settle.
        await g.E('__gol.plane.place(640, 6, -30, 0); __gol.plane.grounded=false; __gol.plane.speed=26')
        await hold(g, ['KeyS'], 1)
        await g.sim(12)
        p = await g.E('({y:__gol.plane.y, g:__gol.plane.grounded, s:__gol.plane.speed, h:__gol.plane.health, w:__gol.plane.wrecked})')
        ok('gentle landing on the runway does no damage', p['g'] and not p['w'] and p['y'] < 1 and p['h'] == 100, p)
        await hold(g, ['KeyS'], 6)
        ok('get out on the ground once stopped', await g.E('__gol.exitCraft()') and await g.E('__gol.flying') is None)

        # --- Crash: nose-dive into the lagoon ---
        await g.E('__gol.enterCraft(__gol.plane)')
        await g.E('__gol.plane.place(700, 40, 300, 0); __gol.plane.grounded=false; __gol.plane.speed=45')
        await hold(g, ['ArrowDown', 'KeyW'], 8)
        ok('a crash throws you out of the plane', await g.E('__gol.flying') is None)
        pp = await g.E('({x:__gol.player.x, z:__gol.player.z})')
        ok('crew pulls you out at the airfield apron', abs(pp['x'] - 690) < 3 and abs(pp['z'] - 45) < 3, pp)
        await g.sim(5)
        ok('the plane is back on the runway after a crash', not await g.E('__gol.plane.wrecked') and abs(await g.E('__gol.plane.x') - 628) < 1)

        # --- Helicopter: hover, roof landing ---
        await g.E('__gol.teleportPlayer(__gol.heli.x + 3, __gol.heli.z)')
        await g.key('KeyE')
        ok('E gets you into the helicopter', await g.E('__gol.flying') == 'heli')
        await hold(g, ['Space'], 5)
        hy = await g.E('__gol.heli.y')
        ok('helicopter climbs with Space', hy > 8, round(hy, 1))
        await g.sim(4)
        hy2 = await g.E('__gol.heli.y')
        ok('helicopter hovers on its own', abs(hy2 - hy) < 3, (round(hy, 1), round(hy2, 1)))
        await hold(g, ['KeyW'], 3)
        ok('W flies the helicopter forward', await g.E('Math.hypot(__gol.heli.vx, __gol.heli.vz)') > 3)
        roof = await g.E('__gol.surfaceAt(247.4, -66)')
        ok('tower roof helipad is a landing surface', roof > 20, roof)
        await g.E('__gol.heli.place(247.4, roof_ + 12, -66, 0); __gol.heli.grounded=false'.replace('roof_', str(roof)))
        await hold(g, ['ShiftLeft'], 6)
        await g.sim(2)
        h = await g.E('({y:__gol.heli.y, g:__gol.heli.grounded, w:__gol.heli.wrecked})')
        ok('helicopter sets down on the roof', h['g'] and not h['w'] and abs(h['y'] - roof) < 1.5, h)
        ok('no getting out on a rooftop', not await g.E('__gol.exitCraft()'))
        await g.pg.screenshot(path=f'{SH}/m6_heli_roof.png')
        await g.E('__gol.exitCraft(true, {x:690, z:45})')

        # --- Speedboat: water only ---
        await g.E('__gol.teleportPlayer(204, -58.5)')
        await g.key('KeyE')
        ok('E gets you into the speedboat from the jetty', await g.E('__gol.flying') == 'boat')
        await hold(g, ['KeyW'], 4)
        b = await g.E('({x:__gol.boat.x, z:__gol.boat.z, s:__gol.boat.speed})')
        ok('boat speeds across the water', b['s'] > 10 and b['x'] < 200, b)
        await g.E('__gol.boat.place(150, -1.75, 0, Math.PI)')
        await hold(g, ['KeyW'], 5)
        bx = await g.E('__gol.boat.x')
        ok('boat runs aground instead of driving onto land', bx > 140.5, round(bx, 2))
        ok('boat stays on the water line', abs(await g.E('__gol.boat.y') + 1.75) < 0.2)
        await g.E('__gol.boat.place(203, -1.75, -54.5, Math.PI)')
        ok('get out of the boat beside the jetty', await g.E('__gol.exitCraft()') and await g.E('__gol.flying') is None)

        # --- Save keeps licences ---
        await g.E('__gol.goDown()')
        ok('licences are saved', await g.E("JSON.parse(localStorage.getItem('gangs-of-lagos/save')).licences.length") == 3)
        finish(errs)


asyncio.run(main())
