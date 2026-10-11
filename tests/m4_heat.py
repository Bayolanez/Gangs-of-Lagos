"""Phase 4: health and armour, heat 1 to 5, the fictional patrol unit, cooling off, and waking at the hospital."""
import asyncio
from gol import browser, ok, finish, save, SH


async def main():
    async with browser() as (g, errs):
        E, sim, txt, pg = g.E, g.sim, g.txt, g.pg
        await g.boot(save(cash=5000, medal=1, owned=['egret'], ammo={'egret': 96}))
        await g.play()
        await E('__gol.setTraffic(0)'); await sim(0.2)

        # ---- Gunfire near residents: heat 1 and the patrol arrives
        await E("__gol.approach('Kunle')"); await sim(0.1)
        await g.key('Digit2')
        await E("__gol.setAim({x:-60,y:0.5,z:69})")
        await g.key('KeyF')
        ok('shots near people raise heat to 1', await E('__gol.combat.heat') == 1)
        ok('heat shows on the HUD', await E("!document.getElementById('heat').hidden && document.querySelectorAll('#heat-stars i.on').length === 1"))
        await sim(5)
        offs = await E("__gol.combat.officers.map(o => Math.hypot(o.x-__gol.player.x, o.z-__gol.player.z))")
        ok('two officers arrive at heat 1', len(offs) == 2, offs)

        # ---- Officers shoot: armour soaks damage first
        await E('__gol.combat.armour = 60')
        await E('__gol.combat.setHeat(3)')
        hurt = False
        for _ in range(30):
            await sim(1)
            if await E('__gol.combat.armour') < 60:
                hurt = True
                break
        ok('officers shoot and armour soaks it', hurt and await E('__gol.combat.health') == 100, [await E('__gol.combat.armour'), await E('__gol.combat.health')])
        ok('more officers at heat 3', await E('__gol.combat.officers.filter(o=>!o.down).length') >= 3)
        await pg.screenshot(path=f'{SH}/m4_heat.png')

        # ---- Get out of sight: heat cools a level at a time, then the patrol gives up
        await E('__gol.teleportPlayer(-185,185)'); await sim(0.1)
        await E('__gol.combat.clearOfficers()')
        lv = []
        for _ in range(16):
            await sim(4)
            lv.append(await E('__gol.combat.heat'))
            if lv[-1] == 0:
                break
        ok('heat cools while hidden', lv[-1] == 0 and 2 in lv and 1 in lv, lv)
        ok('escape counted and announced', (await E('__gol.save'))['stats']['escapes'] == 1)

        # ---- A change of clothes while nobody is watching clears heat
        await E('__gol.combat.setHeat(2)'); await E('__gol.combat.clearOfficers()')
        await E("__gol.approach('Ngozi')"); await sim(0.05)
        await E('__gol.combat.clearOfficers()'); await sim(0.05)
        ok('hidden from the patrol', await E('__gol.heatHidden'))
        await g.key('KeyE')
        ok('wardrobe open', await E('__gol.mode') == 'wardrobe')
        await pg.click('button[data-item="tr-navy"]')
        await pg.click('#btn-wdone'); await sim(0.1)
        ok('new look shakes off the patrol', await E('__gol.combat.heat') == 0 and 'lost you' in await txt('notice'), await txt('notice'))

        # ---- Going down: wake at the fictional hospital for a fee
        await E('__gol.teleportPlayer(0,-40)'); await sim(0.1)
        cash = await E('__gol.save.cash')
        await E("__gol.combat.crime('officer')"); await E('__gol.combat.setHeat(5)'); await E('__gol.combat.armour = 0'); await E('__gol.combat.health = 15')
        for _ in range(60):
            await sim(1)
            if await E('__gol.mode') == 'result':
                break
        ok('going down shows the hospital card', await E('__gol.mode') == 'result' and 'PATCHED UP' in await txt('r-title'), await txt('r-body'))
        ok('hospital is fictional and charges a fee', 'fictional' in await txt('r-body') and await E('__gol.save.cash') == cash - 1000)
        p = await E('[__gol.player.x, __gol.player.z]')
        ok('wake up at the hospital', abs(p[0] + 54) < 1 and abs(p[1] + 80) < 1, p)
        ok('back to full health, heat gone', await E('__gol.combat.health') == 100 and await E('__gol.combat.heat') == 0 and await E('__gol.combat.officers.length') == 0)
        ok('hospital visit counted', (await E('__gol.save'))['stats']['hospital'] == 1)
        await pg.screenshot(path=f'{SH}/m4_hospital.png')
        await pg.click('#btn-continue'); await sim(0.1)
        ok('continue back to the street', await E('__gol.mode') == 'play')

        # ---- Health comes back slowly when out of trouble
        await E('__gol.combat.health = 40'); await E('__gol.combat.calm = 0')
        await sim(12)
        ok('health regenerates when calm', await E('__gol.combat.health') > 45, await E('__gol.combat.health'))

        # ---- Going down during a job fails it
        await g.talk('Kunle'); await pg.click('#btn-accept'); await sim(0.1)
        ok('job running', (await E('__gol.mission'))['state'] == 'active')
        await E('__gol.goDown()')
        ok('going down fails the job', await E('__gol.mode') == 'result' and 'JOB FAILED' in await txt('r-title') and 'hospital' in await txt('r-body'), await txt('r-body'))
        await pg.click('#btn-continue'); await sim(0.1)
        ok('job can be offered again', (await E('__gol.mission'))['state'] == 'idle')
        finish(errs)


asyncio.run(main())
