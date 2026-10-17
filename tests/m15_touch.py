"""Phones in landscape: touch controls (stick, look drag, buttons, pedals, prompt tap), the phone HUD
layout, the rotate-your-phone screen in portrait, and no touch controls on a desktop. Uses real touch
events (Chrome DevTools Input.dispatchTouchEvent) on an emulated 844x390 phone."""
import asyncio, os
from playwright.async_api import async_playwright
from gol import ok, finish, SH, URL

SAVE = "{version:7,lookChosen:true,cash:5000,weapons:{owned:['egret'],ammo:{egret:48},equipped:null}}"


async def main():
    os.makedirs(SH, exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        ctx = await b.new_context(viewport={'width': 844, 'height': 390}, is_mobile=True, has_touch=True)
        pg = await ctx.new_page()
        pg.set_default_timeout(120000)
        errs = []
        pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)))
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'fonts.g' not in m.text and 'ERR_FAILED' not in m.text and "Couldn't load texture" not in m.text else None)
        await pg.route(lambda u: 'fonts.g' in u, lambda r: r.abort())
        cdp = await ctx.new_cdp_session(pg)
        E = lambda js: pg.evaluate(js)
        sim = lambda s: pg.evaluate(f'__gol.simulate({s})')

        async def touch(kind, pts):
            await cdp.send('Input.dispatchTouchEvent', {'type': kind, 'touchPoints': [{'x': x, 'y': y, 'id': i} for i, x, y in pts]})

        async def centre(sel):
            r = await E(f"(() => {{ const r = document.querySelector('{sel}').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }})()")
            return r[0], r[1]

        async def tap(sel):
            x, y = await centre(sel)
            await touch('touchStart', [(9, x, y)])
            await touch('touchEnd', [])

        await pg.goto(URL)
        await E(f"localStorage.clear(); localStorage.setItem('gangs-of-lagos/save', JSON.stringify({SAVE}))")
        await pg.reload()
        await pg.wait_for_function("!document.getElementById('btn-play').disabled && __gol.models.done", timeout=120000)
        ok('phone detected: touch controls on', await E("!!__gol.touch && document.body.classList.contains('touch')"))
        ok('title: touch controls listed, keyboard list hidden, Play on screen', await E("getComputedStyle(document.querySelector('.controls.touch-only')).display !== 'none' && getComputedStyle(document.querySelector('.controls.keys-only')).display === 'none'") and await E("document.getElementById('btn-play').getBoundingClientRect().bottom <= innerHeight"))
        ok('no controls over the title screen', await E("document.getElementById('touch').hidden"))
        await tap('#btn-play')
        await pg.wait_for_timeout(300)
        await E('__gol.setTraffic(0)')
        await sim(0.3)
        ok('playing: controls showing, keyboard hints hidden', not await E("document.getElementById('touch').hidden") and await E("getComputedStyle(document.getElementById('keys')).display === 'none'"))
        ok('on foot: Jump, Use, Weapon', sorted(await E('__gol.touch.visibleButtons')) == ['jump', 'use', 'weapon'], await E('__gol.touch.visibleButtons'))
        await pg.screenshot(path=f'{SH}/m15_phone_foot.png')

        # Move stick: thumb down on the left, pushed up = forward.
        x0, z0 = await E('[__gol.player.x, __gol.player.z]')
        await touch('touchStart', [(1, 150, 280)])
        await touch('touchMove', [(1, 150, 240)])
        await sim(1)
        x1, z1 = await E('[__gol.player.x, __gol.player.z]')
        ok('left thumb walks', ((x1 - x0) ** 2 + (z1 - z0) ** 2) ** 0.5 > 1.5, round(((x1 - x0) ** 2 + (z1 - z0) ** 2) ** 0.5, 2))
        await touch('touchMove', [(1, 150, 200)])
        await sim(0.3)
        ok('pushed all the way: runs', await E('__gol.player.speed') > 5, await E('__gol.player.speed'))
        await touch('touchEnd', [])
        await sim(0.6)
        ok('let go: stops', await E('__gol.player.speed') < 0.5, await E('__gol.player.speed'))

        # Look: drag on the right.
        yaw0 = await E('__gol.camYaw')
        await touch('touchStart', [(2, 560, 200)])
        await touch('touchMove', [(2, 660, 200)])
        await sim(0.1)
        await touch('touchEnd', [])
        ok('right thumb drag turns the camera', abs(await E('__gol.camYaw') - yaw0) > 0.2, await E('__gol.camYaw') - yaw0)

        # Jump
        await tap('#t-jump')
        await sim(0.15)
        ok('Jump button jumps', await E('__gol.player.y') > 0.1, await E('__gol.player.y'))
        await sim(1)

        # Weapon, aim, fire, reload
        await tap('#t-weapon')
        await sim(0.4)
        ok('Weapon button draws the pistol', await E('__gol.weapons.drawn') == 'egret')
        vb = await E('__gol.touch.visibleButtons')
        ok('armed: Fire, Aim, Reload appear', all(k in vb for k in ('fire', 'aim', 'reload')), vb)
        await tap('#t-aim')
        await sim(0.3)
        ok('Aim toggles the over-the-shoulder aim', await E("document.getElementById('t-aim').classList.contains('on')") and await E("!document.getElementById('crosshair').hidden"))
        mag0 = await E("__gol.weapons.mag('egret')")
        await tap('#t-fire')
        await sim(0.3)
        ok('Fire shoots', await E("__gol.weapons.mag('egret')") < mag0, [mag0, await E("__gol.weapons.mag('egret')")])
        await pg.screenshot(path=f'{SH}/m15_phone_armed.png')
        await tap('#t-reload')
        await sim(0.1)
        ok('Reload reloads', await E('__gol.weapons.reloading') > 0)
        await sim(2.5)
        await tap('#t-aim')
        await tap('#t-weapon')
        await sim(0.2)
        ok('Weapon again: holstered (only one weapon owned)', await E('__gol.weapons.drawn') is None)

        # Tap the prompt to get in a car.
        await E('__gol.teleportPlayer(__gol.saloon.x, __gol.saloon.z - 2.0)')
        await sim(0.3)
        ok('prompt shows without the E key hint', 'sedan' in (await E("document.getElementById('prompt').textContent")).lower() and await E("getComputedStyle(document.querySelector('#prompt kbd')).display === 'none'"))
        await tap('#prompt')
        await sim(0.3)
        ok('tapping the prompt gets in', await E('__gol.inVehicle') == 'saloon')
        ok('driving: Gas, Brake, Handbrake, Horn, Get out, Radio', sorted(await E('__gol.touch.visibleButtons')) == ['brake', 'exit', 'gas', 'handbrake', 'horn', 'radio'])
        gx, gy = await centre('#t-gas')
        await touch('touchStart', [(3, gx, gy), (1, 150, 280)])
        await touch('touchMove', [(3, gx, gy), (1, 200, 280)])
        await sim(1.5)
        ok('Gas drives, left thumb steers', await E('__gol.saloon.kmh') > 20 and await E('__gol.saloon.steerAngle') > 0.15, [await E('__gol.saloon.kmh'), await E('__gol.saloon.steerAngle')])
        await pg.screenshot(path=f'{SH}/m15_phone_drive.png')
        await touch('touchEnd', [])
        bx, by = await centre('#t-brake')
        await touch('touchStart', [(4, bx, by)])
        for _ in range(90):
            await sim(1 / 30)
            if await E('__gol.saloon.kmh') < 2:
                break
        await touch('touchEnd', [])
        ok('Brake stops the car (held on, it would reverse)', await E('__gol.saloon.kmh') < 3, await E('__gol.saloon.kmh'))
        await tap('#t-exit')
        await sim(0.3)
        ok('Get out', await E('__gol.inVehicle') is None)

        # Helicopter: stick flies, Up / Down buttons climb and descend.
        await E("__gol.save.licences.push('heli'); __gol.teleportPlayer(__gol.heli.x + 2, __gol.heli.z); __gol.enterCraft(__gol.heli)")
        await sim(0.2)
        ok('helicopter: Up, Down, Get out, Radio', await E('__gol.flying') == 'heli' and sorted(await E('__gol.touch.visibleButtons')) == ['down', 'exit', 'radio', 'up'], await E('__gol.touch.visibleButtons'))
        ux, uy = await centre('#t-up')
        await touch('touchStart', [(5, ux, uy)])
        await sim(2.5)
        await touch('touchEnd', [])
        ok('Up climbs', await E('__gol.heli.y') > 1.5, await E('__gol.heli.y'))
        await E('__gol.exitCraft(true)')
        await sim(0.3)

        # Pause / map / jobs
        await tap('#t-map')
        await sim(0.1)
        ok('Map button opens the map', await E('__gol.mode') == 'map' and await E("document.getElementById('touch').hidden"))
        await pg.keyboard.press('KeyM')
        await sim(0.1)
        ok('back from the map: controls again', await E('__gol.mode') == 'play' and not await E("document.getElementById('touch').hidden"))
        await tap('#t-pause')
        await sim(0.1)
        ok('Pause button pauses', await E('__gol.mode') == 'pause')

        # Short-screen HUD: nothing important off screen.
        boxes = await E("['minimap', 'cash', 'clock', 'vitals'].map(id => { const r = document.getElementById(id).getBoundingClientRect(); return [id, r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight]; })")
        ok('phone HUD fits on screen', all(v for _, v in boxes), boxes)
        await ctx.close()

        # Portrait: ask to turn the phone.
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
        pg = await ctx.new_page()
        await pg.route(lambda u: 'fonts.g' in u, lambda r: r.abort())
        await pg.goto(URL)
        await pg.wait_for_timeout(500)
        ok('portrait: "turn your phone sideways"', await pg.evaluate("getComputedStyle(document.getElementById('rotate')).display === 'flex'"))
        await pg.screenshot(path=f'{SH}/m15_portrait.png')
        await ctx.close()

        # Desktop: no touch controls.
        ctx = await b.new_context(viewport={'width': 960, 'height': 540})
        pg = await ctx.new_page()
        await pg.route(lambda u: 'fonts.g' in u, lambda r: r.abort())
        await pg.goto(URL)
        await pg.wait_for_function("!!window.__gol", timeout=120000)
        ok('desktop: no touch controls, keyboard hints kept', await pg.evaluate("!__gol.touch && !document.getElementById('touch') && !document.body.classList.contains('touch')"))
        await b.close()
        finish(errs)


asyncio.run(main())
