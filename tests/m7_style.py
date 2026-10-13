"""Visual style: Clean daylight by default, Lagos dusk selectable; graphics quality setting, post effects, original signage, new basics, no franchise marks."""
import asyncio, json, os, re
from gol import browser, ok, finish, save, SH

ROOT = os.path.join(os.path.dirname(__file__), '..')
# Franchise names and marks that must never appear in the game's own text or code.
BANNED = re.compile(r'grand theft|san andreas|\bgta\b|rockstar|vice city|los santos|pricedown', re.I)


def scan_sources():
    hits = []
    for base in ['index.html', 'src', 'public/data']:
        p = os.path.join(ROOT, base)
        files = [p] if os.path.isfile(p) else [os.path.join(d, f) for d, _, fs in os.walk(p) for f in fs]
        for f in files:
            if f.endswith(('.ts', '.html', '.css', '.json')):
                if BANNED.search(open(f, encoding='utf-8').read()):
                    hits.append(os.path.relpath(f, ROOT))
    return hits


hits = scan_sources()
ok('no franchise names or marks in the game sources', not hits, hits)


async def main():
    async with browser() as (g, errs):
        E = g.E
        await g.boot(save(cash=500))
        # Art style: Clean daylight by default (no ink lines), Lagos dusk selectable; the rest of this test runs in dusk.
        ok('Clean daylight is the default art style', await E('__gol.graphics.style') == 'clean')
        await E("__gol.graphics.set('high')")
        ok('Clean style: no ink outlines, even on High', await E('__gol.graphics.post') == {'outline': False, 'bloom': True})
        await E("__gol.graphics.set('auto')")
        await g.pg.screenshot(path=f'{SH}/m7_clean.png')
        await g.pg.click('#btn-settings')
        styles = await E("[...document.querySelectorAll('#set-style option')].map(o => o.value)")
        ok('settings offer Clean and Lagos dusk', styles == ['clean', 'dusk'] and await E("document.getElementById('set-style').value") == 'clean', styles)
        async with g.pg.expect_navigation():
            await g.pg.select_option('#set-style', 'dusk')
        await g.pg.wait_for_function("window.__gol && !document.getElementById('btn-play').disabled", timeout=90000)
        ok('choosing Lagos dusk reloads in that style, progress kept', await E('__gol.graphics.style') == 'dusk' and await E('__gol.save.cash') == 500)
        ok('auto quality picks Low on this software-rendered browser', await E('__gol.graphics.choice') == 'auto' and await E('__gol.graphics.quality') == 'low')
        ok('Low draws straight to the screen (no post effects, no sky reflections)', await E('__gol.graphics.post') == {'outline': False, 'bloom': False} and not await E('__gol.graphics.environment'))
        ok('title keeps the original Gangs of Lagos branding', 'GANGS OF' in (await g.txt('title')).upper() and not BANNED.search(await g.txt('title')))

        # Settings: the graphics menu works and is remembered on this device.
        await g.pg.click('#btn-settings')
        opts = await E("[...document.querySelectorAll('#set-quality option')].map(o => o.value)")
        ok('settings offer Auto, High, Medium and Low graphics', opts == ['auto', 'high', 'medium', 'low'], opts)
        ok('settings explain what Auto chose', 'Auto picked low' in await g.txt('quality-note'))
        await g.pg.select_option('#set-quality', 'high')
        ok('High turns on ink outlines, neon glow and sky reflections', await E('__gol.graphics.post') == {'outline': True, 'bloom': True} and await E('__gol.graphics.environment'))
        ok('graphics choice stored per device', await E("localStorage.getItem('gangs-of-lagos/graphics')") == 'high')
        await g.pg.select_option('#set-quality', 'medium')
        ok('Medium keeps outlines without the glow', await E('__gol.graphics.post') == {'outline': True, 'bloom': False})
        await g.pg.click('#btn-back')
        await g.pg.reload()
        await g.pg.wait_for_function("!document.getElementById('btn-play').disabled", timeout=90000)
        ok('graphics choice survives a reload', await E('__gol.graphics.choice') == 'medium' and await E('__gol.graphics.quality') == 'medium')
        save_raw = await E("localStorage.getItem('gangs-of-lagos/save')")
        ok('graphics setting is not written into the save', 'graphics' not in (save_raw or '') and 'quality' not in (save_raw or ''))

        # The world: neon shop signs, street plates, rooftop billboards — all original names.
        signs = await E('__gol.signs')
        streets = ('ROAD', 'AVENUE', 'STREET', 'CRESCENT')
        shop = [s for s in signs if s['y'] < 5 and not s['text'].endswith(streets)]
        texts = sorted({s['text'] for s in signs})
        ok('neon shop signs line the streets', len(shop) >= 40, len(shop))
        ok('junction street-name plates on every Harbour Bend junction', sum(1 for s in signs if s['text'].endswith(streets)) >= 64)
        ok('rooftop billboards on Marina Point towers', any(s['y'] > 15 for s in signs))
        ok('sign names are original (no franchise names)', not any(BANNED.search(t) for t in texts), texts)

        # Play under High: walking, a car and the HUD still work with the post effects on.
        await E("__gol.graphics.set('high')")
        await g.play()
        await E('__gol.setTraffic(0)')
        x0 = await E('__gol.player.x')
        await g.pg.keyboard.down('KeyW'); await g.sim(1.5); await g.pg.keyboard.up('KeyW')
        ok('walking works with post effects on', abs(await E('__gol.player.x') - x0) > 1 or abs(await E('__gol.player.z') + 20) > 1)
        await E('__gol.enterVehicle(__gol.hatch)')
        await g.pg.keyboard.down('KeyW'); await g.sim(2); await g.pg.keyboard.up('KeyW')
        ok('driving works with post effects on', await E('__gol.inVehicle') == 'hatchback' and await E('Math.abs(__gol.hatch.speed)') > 2)
        await g.pg.screenshot(path=f'{SH}/m7_high_drive.png')
        px = await g.pg.screenshot()
        ok('High frame is not blank', len(px) > 40000, len(px))
        await E('__gol.leaveVehicle(true)')

        # New free basics inspired by the mood board (no logos): plain red cap, track pants.
        await E("__gol.equip('hat','hat-cap-red'); __gol.equip('trousers','tr-track')")
        o = await E('__gol.save.outfit')
        ok('plain red cap and track pants are free basics', o['hat'] == 'hat-cap-red' and o['trousers'] == 'tr-track', o)

        for q in ['medium', 'low']:
            await E(f"__gol.graphics.set('{q}')")
            await g.sim(0.2)
            await g.pg.screenshot(path=f'{SH}/m7_{q}.png')
        ok('switching quality in play keeps the game running', await E('__gol.mode') == 'play')
        finish(errs)


asyncio.run(main())
