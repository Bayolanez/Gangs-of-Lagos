"""Phase 6: Flight School (plane, helicopter), Rooftop Drop, Lagoon Run and the Wings and Water chapter."""
import asyncio
from gol import browser, ok, finish, save, SH

HB = ['harbour-sprint', 'market-run', 'danfo-shift']


async def offer(g, job):
    """The Chairman: the contact calls about the job (the plan in the call), skip to the answer."""
    await g.E(f"__gol.jobCall(__gol.runner().byId('{job}'), true)")
    await g.sim(0.1)
    await g.pg.keyboard.press('Escape')
    await g.sim(0.1)
    return await g.E('__gol.mode') == 'phone' and await g.E("!!document.querySelector('#ph-choices button[data-choice=accept]')")


async def accept(g):
    await g.pg.click('#ph-choices button[data-choice="accept"]')
    await g.sim(0.2)


async def mission(g):
    return await g.E('__gol.mission')


async def fly_to(g, craft, x, y, z, speed=0, grounded=False, secs=0.3):
    await g.E(f'__gol.{craft}.place({x}, {y}, {z}, 0); __gol.{craft}.grounded={str(grounded).lower()}; __gol.{craft}.speed={speed}')
    await g.sim(secs)


async def main():
    async with browser() as (g, errs):
        # --- Locked until Harbour Bend is done ---
        await g.boot(save(cash=500))
        await g.play()
        st = await g.E("['flight-school-plane', 'lagoon-run'].map(id => __gol.runner().status(__gol.runner().byId(id)))")
        ok('Flight School and the Lagoon Run wait until Harbour Bend is done', st == ['locked', 'locked'], st)

        await g.boot(save(cash=500, chapters=[1], completed=HB))
        await g.play()
        await g.E('__gol.setTraffic(0)')

        # --- Flight School: light plane ---
        ok('Flight School offered by Captain Ade', await offer(g, 'flight-school-plane') and 'plane' in (await g.txt('ph-lines')).lower(), await g.txt('ph-lines'))
        await accept(g)
        await g.E('__gol.teleportPlayer(__gol.plane.x - 3, __gol.plane.z + 3)')
        await g.key('KeyE')
        await g.sim(0.3)
        m = await mission(g)
        ok('plane lesson lets you fly without a licence, timer starts on the runway', await g.E('__gol.flying') == 'plane' and m['index'] == 2 and m['timerOn'], m)
        await g.pg.screenshot(path=f'{SH}/m6_flight_school.png')
        await fly_to(g, 'plane', 950, 25, -30, 40)
        for (x, y, z) in [(1150, 60, 250), (850, 70, 380), (560, 50, 250)]:
            await fly_to(g, 'plane', x, y, z, 40)
        ok('three rings flown (altitude checked)', (await mission(g))['index'] == 6, await mission(g))
        await fly_to(g, 'plane', 470, 5, -30, 40)
        ok('ring needs the right height', (await mission(g))['index'] == 6)
        await fly_to(g, 'plane', 470, 30, -30, 40)
        await fly_to(g, 'plane', 820, 0, -30, 0, True, 0.5)
        m = await mission(g)
        ok('lesson passed after landing', m['state'] == 'result' and 'LICENCE' in await g.txt('r-title'), (m, await g.txt('r-title')))
        ok('plane licence saved', 'plane' in await g.E('__gol.save.licences'))
        await g.pg.click('#btn-continue')
        await g.sim(0.2)
        await g.E('__gol.exitCraft(true, {x:690, z:45})')

        # --- Flight School: helicopter ---
        ok('helicopter lesson offered next', await offer(g, 'flight-school-heli') and 'helicopter' in (await g.txt('ph-lines')).lower(), await g.txt('ph-lines'))
        await accept(g)
        await g.E('__gol.teleportPlayer(__gol.heli.x + 3, __gol.heli.z)')
        await g.key('KeyE')
        ok('in the helicopter for the lesson', await g.E('__gol.flying') == 'heli')
        await fly_to(g, 'heli', 730, 20, 45)
        await fly_to(g, 'heli', 850, 35, 160)
        await fly_to(g, 'heli', 650, 30, 220)
        ok('helicopter rings flown', (await mission(g))['index'] == 4, await mission(g))
        await fly_to(g, 'heli', 730, 0, 45, 0, True, 1.6)
        m = await mission(g)
        ok('helicopter licence earned on the H', m['state'] == 'result' and 'heli' in await g.E('__gol.save.licences'), m)
        await g.pg.click('#btn-continue')
        await g.sim(0.2)
        await g.E('__gol.exitCraft(true, {x:735, z:52})')

        # --- Rooftop Drop ---
        ok('Rooftop Drop offered after both licences', await offer(g, 'rooftop-drop') and 'roof' in (await g.txt('ph-lines')).lower(), await g.txt('ph-lines'))
        await accept(g)
        await g.E('__gol.teleportPlayer(__gol.heli.x + 3, __gol.heli.z)')
        await g.key('KeyE')
        await fly_to(g, 'heli', 730, 0, 45, 0, True, 1.4)
        ok('parcels loaded at the airfield pad', (await mission(g))['index'] == 2, await mission(g))
        r1 = await g.E('__gol.surfaceAt(247.4, -66)')
        await fly_to(g, 'heli', 247.4, r1 + 6, -66)
        ok('hovering over the pad is not a delivery', (await mission(g))['index'] == 2)
        await fly_to(g, 'heli', 247.4, r1, -66, 0, True, 2)
        ok('first roof pad delivered', (await mission(g))['index'] == 3, [await mission(g), r1, await g.E('({y:__gol.heli.y,g:__gol.heli.grounded,x:__gol.heli.x,z:__gol.heli.z})')])
        r2 = await g.E('__gol.surfaceAt(296.6, -66)')
        await fly_to(g, 'heli', 296.6, r2, -66, 0, True, 2)
        m = await mission(g)
        body = await g.txt('r-body')
        ok('both roof pads delivered with drop pay', m['state'] == 'result' and '1,600' in body, [body, m, r2, await g.E('({y:__gol.heli.y,g:__gol.heli.grounded,x:__gol.heli.x,z:__gol.heli.z,w:__gol.heli.wrecked})')])
        await g.pg.click('#btn-continue')
        await g.sim(0.2)
        await g.E('__gol.exitCraft(true, {x:210, z:-60})')

        # --- Lagoon Run ---
        ok('Lagoon Run offered by Ebi', await offer(g, 'lagoon-run') and 'bridges' in (await g.txt('ph-lines')).lower())
        await accept(g)
        await g.E('__gol.teleportPlayer(204, -58.5)')
        await g.key('KeyE')
        ok('race lets you take the speedboat', await g.E('__gol.flying') == 'boat')
        await g.E('__gol.boat.place(190, -1.75, -50, -Math.PI/2)')
        await g.sim(0.4)
        ok('race countdown at the start buoy', (await mission(g))['step'] == 'countdown', await mission(g))
        await g.sim(3.4)
        for (x, z) in [(180, -120), (190, -185), (300, -180), (420, -100), (430, 60), (420, 195), (290, 195), (180, 120), (185, -40)]:
            ok(f'checkpoint ({x},{z}) is open water', await g.E(f"__gol.surfaceAt({x},{z})") < -1)
            await g.E(f'__gol.boat.place({x}, -1.75, {z}, 0)')
            await g.sim(0.2)
        m = await mission(g)
        fin = await g.txt('r-finale')
        ok('Lagoon Run won, boat unlocked', m['state'] == 'result' and 'boat' in await g.E('__gol.save.licences'), m)
        ok('Wings and Water chapter complete', 3 in await g.E('__gol.save.chaptersDone') and 'WINGS AND WATER' in fin.upper(), fin)
        await g.pg.screenshot(path=f'{SH}/m6_chapter3.png')
        await g.pg.click('#btn-continue')
        await g.sim(0.2)
        ok('free use of the boat after the race', await g.E('__gol.exitCraft()') or True)
        finish(errs)


asyncio.run(main())
