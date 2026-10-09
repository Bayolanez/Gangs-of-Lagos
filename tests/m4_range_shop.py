"""Phase 4: Range Day medals unlock weapons; Sade's arms counter sells weapons, rounds and armour."""
import asyncio
from gol import browser, ok, finish, save, SH


async def shoot_targets(g, until):
    """Aim at standing targets and press F until `until` hits or the round ends."""
    for _ in range(400):
        st = await g.E('__gol.rangeRun.state')
        if st == 'idle' or await g.E('__gol.rangeRun.hits') >= until:
            break
        t = await g.E('__gol.rangeRun.standing()')
        if t and st == 'live':
            await g.E(f"__gol.setAim({t[0]})")
            await g.pg.keyboard.press('KeyF')
        await g.sim(0.32)
    await g.E('__gol.setAim(null)')


async def main():
    async with browser() as (g, errs):
        E, sim, txt, pg = g.E, g.sim, g.txt, g.pg
        await g.boot(save(cash=40000))
        await g.play()

        # ---- The counter before any medal: only the pipe is on sale
        await g.talk('Sade')
        ok('Sade opens the arms counter', await E('__gol.mode') == 'armoury')
        ok('pipe on sale, guns locked', await E("!!document.querySelector('button[data-buy=\"pipe\"]') && !document.querySelector('button[data-buy=\"egret\"]')"))
        ok('locked guns say which medal', 'bronze medal' in await txt('ar-list') and 'gold medal' in await txt('ar-list'))
        await pg.click('#btn-arleave'); await sim(0.1)
        await g.key('Digit2')
        ok('cannot draw a gun you do not own', await E('__gol.weapons.drawn') is None and "don't have" in await txt('notice'))

        # ---- Range Day: leaving the line ends it
        await g.talk('Coach Kola')
        ok('Coach Kola offers Range Day', await E('__gol.mode') == 'offer' and 'RANGE DAY' in await txt('o-name'), await txt('o-terms'))
        await pg.click('#btn-accept'); await sim(0.1)
        ok('on the line with the loaner pistol', await E('__gol.rangeRun.state') == 'countdown' and await E('__gol.weapons.drawn') == 'egret' and await E('__gol.weapons.loaner'))
        ok('range HUD shows', 'Range Day' in await txt('m-name') and await E("!document.getElementById('crosshair').hidden"))
        await E('__gol.teleportPlayer(-42,0)'); await sim(0.2)
        ok('leaving the firing line ends Range Day', await E('__gol.mode') == 'result' and 'OVER' in await txt('r-title'), await txt('r-body'))
        ok('loaner handed back', await E('__gol.weapons.drawn') is None and not await E('__gol.weapons.loaner'))
        await pg.click('#btn-continue'); await sim(0.1)

        # ---- Range Day for gold
        await g.talk('Coach Kola'); await pg.click('#btn-accept'); await sim(3.3)
        ok('targets pop up', await E('__gol.rangeRun.state') == 'live' and len(await E('__gol.rangeRun.standing()')) >= 0)
        await shoot_targets(g, 26)
        ok('range hits count', await E('__gol.rangeRun.hits') >= 26, await E('__gol.rangeRun.hits'))
        ok('no heat for shooting on the range', await E('__gol.combat.heat') == 0)
        await sim(45)
        ok('round ends with a result', await E('__gol.mode') == 'result' and 'GOLD MEDAL' in await txt('r-title'), await txt('r-body'))
        await pg.screenshot(path=f'{SH}/m4_range_result.png')
        s = await E('__gol.save')
        ok('bronze gives the Egret pistol with rounds', 'egret' in s['weapons']['owned'] and s['weapons']['ammo']['egret'] == 24, s['weapons'])
        ok('medal and best saved', s['range']['medal'] == 3 and s['range']['best'] >= 26, s['range'])
        await pg.click('#btn-continue'); await sim(0.1)

        # ---- A round with no hits: no medal, best kept
        await g.talk('Coach Kola'); await pg.click('#btn-accept'); await sim(45)
        ok('no hits, no medal', await E('__gol.mode') == 'result' and 'NO MEDAL' in await txt('r-title'))
        ok('best result kept', (await E('__gol.save'))['range']['medal'] == 3)
        await pg.click('#btn-continue'); await sim(0.1)

        # ---- The counter after gold: everything on sale
        await g.talk('Sade')
        ok('gold unlocks the rest', await E("['kingfisher','breakwater','harmattan','heron'].every(id => document.querySelector(`button[data-buy=\"${id}\"]`))"))
        cash = await E('__gol.save.cash')
        await pg.click('button[data-buy="breakwater"]')
        s = await E('__gol.save')
        ok('buy the shotgun with a pack of rounds', 'breakwater' in s['weapons']['owned'] and s['weapons']['ammo']['breakwater'] == 12 and s['cash'] == cash - 7000, s['weapons'])
        await pg.click('button[data-ammo="egret"]')
        ok('buy rounds', (await E('__gol.save'))['weapons']['ammo']['egret'] == 48)
        await pg.click('button[data-armour]')
        ok('fit armour', await E('__gol.combat.armour') == 100 and not await E("!!document.querySelector('button[data-armour]')"))
        await pg.screenshot(path=f'{SH}/m4_counter.png')
        await pg.click('#btn-arleave'); await sim(0.1)
        ok('armour shows on the HUD', await E("!document.getElementById('armour-row').hidden"))

        # ---- Saved across a reload
        await E('__gol.weapons.draw("breakwater")'); await sim(0.1)
        await pg.keyboard.press('KeyP'); await sim(0.1); await pg.click('#btn-title')
        await pg.reload(); await pg.wait_for_function("!document.getElementById('btn-play').disabled", timeout=90000)
        s = await E('__gol.save')
        ok('weapons, armour and medal persist', 'breakwater' in s['weapons']['owned'] and s['armour'] == 100 and s['range']['medal'] == 3 and s['weapons']['equipped'] == 'breakwater', s['weapons'])
        ok('equipped weapon drawn on load', await E('__gol.weapons.drawn') == 'breakwater')
        finish(errs)


asyncio.run(main())
