"""BLK KNG as the main player (model loads with textures, animates, grounded, holds a gun, drives,
wardrobe and fallback, save v5 -> v6), and Lagos time of day and weather (real sun times, live
weather parsing and fetch, the climate estimate fallback, settings, night lights, rain, lightning, haze)."""
import asyncio, datetime, json
from gol import browser, ok, finish, save, SH, URL

B = '__gol.player.rig.blk'


def brightness(path):
    """Mean brightness of the whole frame (sky, buildings and street; lamp pools count, but locally)."""
    from PIL import Image, ImageStat
    return ImageStat.Stat(Image.open(path).convert('L')).mean[0]


async def main():
    async with browser() as (g, errs):
        E, pg = g.E, g.pg
        await g.boot()
        await g.play()
        await E('__gol.setTraffic(0)')

        # ---- BLK KNG
        ok('BLK KNG is the main player on a new game', await E('__gol.save.outfit.top') == 'top-blkkng' and await E('__gol.player.rig.mode') == 'blkking' and await E('__gol.player.rig.blkError') is None)
        ok('his model is showing (the stand-ins are hidden)', await E(f'{B}.root.visible') and not await E('__gol.player.rig.basic.root.visible'))
        tex = await E(f"(() => {{ let n = 0, ok = 0; {B}.model.traverse(o => {{ const m = o.material; if (m && m.map) {{ n++; if (m.map.image && (m.map.image.width || m.map.image.naturalWidth)) ok++; }} }}); return [n, ok]; }})()")
        ok('textures loaded (BLK KNG print, knit, hair)', tex[0] > 0 and tex[0] == tex[1], tex)
        tall = await E(f"(() => {{ const b = new __gol.THREE.Box3().setFromObject({B}.model); return b.max.y - b.min.y; }})()")
        ok('about 1.85 m tall', 1.78 < tall < 1.92, round(tall, 3))
        ok('named joints found', await E(f"Object.keys({B}.joints).length") == 16)
        await g.sim(1)
        idle = await E(f'{B}.soleHeights()')
        ok('standing on the ground', all(abs(h) < 0.02 for h in idle), idle)
        await g.pg.keyboard.down('KeyW')
        await g.sim(1)
        hips, soles = [], []
        for _ in range(20):
            await g.sim(0.033)
            hips.append(await E(f'{B}.joints.hip_L.rotation.x'))
            soles.append(min(await E(f'{B}.soleHeights()')))
        await g.pg.keyboard.up('KeyW')
        ok('walk cycle swings the hip joints', max(hips) - min(hips) > 0.5, [round(min(hips), 2), round(max(hips), 2)])
        ok('walking: a foot stays on the ground', min(soles) > -0.03 and max(soles) < 0.04, [round(min(soles), 3), round(max(soles), 3)])
        # Sample while still running (a passing crew can block one frame).
        await g.pg.keyboard.down('KeyW')
        await g.pg.keyboard.down('ShiftLeft')
        await g.sim(1.2)
        leans = []
        for _ in range(6):
            await g.sim(0.05)
            leans.append(await E(f'{B}.joints.spine.rotation.x'))
        await g.pg.keyboard.up('ShiftLeft')
        await g.pg.keyboard.up('KeyW')
        lean = max(leans)
        ok('runs with a forward lean', lean > 0.12, lean)
        await g.sim(1)
        await pg.screenshot(path=f'{SH}/m13_blkking.png')
        await E('__gol.player.vy = 4.6')
        await g.sim(0.2)
        ok('jump pose (knee tucked)', await E(f'{B}.joints.knee_R.rotation.x') > 0.5, await E(f'{B}.joints.knee_R.rotation.x'))
        await g.sim(1.2)
        await E("__gol.save.weapons.owned.push('egret'); __gol.save.weapons.ammo.egret = 24")
        await g.key('Digit2')
        await g.sim(0.6)
        held = await E(f"{B}.joints.hand_R.children.some(c => c.children.length > 0)")
        await E('__gol.fire()')
        await g.sim(0.2)
        ok('pistol in his right hand, raised to fire', held and await E(f'{B}.joints.shoulder_R.rotation.x') < -1.2, await E(f'{B}.joints.shoulder_R.rotation.x'))
        await g.key('Digit2')
        await E('__gol.enterVehicle(__gol.saloon)')
        await g.sim(1)
        ok('sits at the wheel', await E('__gol.player.rig.seated') and await E(f'{B}.joints.hip_L.rotation.x') < -1.2)
        await E('__gol.leaveVehicle(true)')
        await g.sim(1)
        ok('stands again outside the car', abs(min(await E(f'{B}.soleHeights()'))) < 0.03)
        await E("__gol.equip('top', 'top-tee')")
        ok('other outfits use the older figure', await E('__gol.player.rig.mode') == 'basic')
        await E("__gol.equip('top', 'top-blkkng')")
        ok('BLK KNG outfit brings him back', await E('__gol.player.rig.mode') == 'blkking')
        await E(f"(() => {{ const r = __gol.player.rig; {B}.root.removeFromParent(); r.blk = null; __gol.equip('top', 'top-blkkng'); }})()")
        ok('without the model, the code-built hero stands in', await E('__gol.player.rig.mode') == 'hero')

        # ---- Time of day: Lagos time and the real sun
        now = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=1)
        clock = await E('__gol.env.clockText')
        mins = lambda t: int(t[:2]) * 60 + int(t[3:])
        ok('live clock is Lagos time (UTC+1)', abs(mins(clock) - (now.hour * 60 + now.minute)) <= 1 or abs(mins(clock) - (now.hour * 60 + now.minute)) >= 1439, [clock, now.strftime('%H:%M')])
        sp = lambda h: E(f"__gol.envLib.sunPosition('2026-10-16T12:00:00Z', {h}).elevation")
        noon, dawn0, dawn1, dusk0, dusk1, midnight = await sp(12.8), await sp(6.2), await sp(7.0), await sp(18.4), await sp(19.0), await sp(0)
        ok('mid-October Lagos: high midday sun (peak about 74 degrees)', 70 < noon < 75.5, round(noon, 1))
        ok('sunrise between 06:12 and 07:00', dawn0 < 0 < dawn1, [round(dawn0, 1), round(dawn1, 1)])
        ok('sunset between 18:24 and 19:00', dusk0 > 0 > dusk1, [round(dusk0, 1), round(dusk1, 1)])
        ok('sun well below the horizon at midnight', midnight < -60, round(midnight, 1))
        ok('morning sun in the east, evening sun in the west', await E("__gol.envLib.sunPosition('2026-10-16T12:00:00Z', 8).azimuth") < 180 < await E("__gol.envLib.sunPosition('2026-10-16T12:00:00Z', 17).azimuth"))

        # Settings: time and weather menus, remembered on this device.
        await g.key('Escape')
        await pg.click('#btn-settings2')
        topts = await E("[...document.querySelectorAll('#set-time option')].map(o => o.value)")
        wopts = await E("[...document.querySelectorAll('#set-weather option')].map(o => o.value)")
        ok('settings: time of day and weather choices', topts == ['live', 'fast', 'day', 'dusk', 'night'] and wopts == ['live', 'clear', 'cloudy', 'rain', 'storm', 'haze'], [topts, wopts])
        await pg.select_option('#set-time', 'night')
        await pg.select_option('#set-weather', 'clear')
        ok('choices stored on this device', await E("[localStorage.getItem('gangs-of-lagos/time'), localStorage.getItem('gangs-of-lagos/weather')]") == ['night', 'clear'])
        await pg.click('#btn-back')
        await pg.click('#btn-resume')
        await E("__gol.env.shown.cloud = 0; __gol.env.shown.rain = 0; __gol.env.shown.haze = 0")
        await g.sim(0.3)
        night = await E('__gol.env.debug')
        ok('night: dark sky, moonlight dimmer than the sun, windows lit', night['night'] == 1 and night['sunIntensity'] < 1.6 and night['zenith'] < '#202020', night)
        await pg.screenshot(path=f'{SH}/m13_night.png')
        night_l = brightness(f'{SH}/m13_night.png')
        await E("__gol.env.setTimeMode('day')")
        await g.sim(0.3)
        day = await E('__gol.env.debug')
        ok('day: blue sky, bright sun, no window lights', day['night'] == 0 and day['sunIntensity'] > 2 and day['zenith'] != night['zenith'], day)
        await pg.screenshot(path=f'{SH}/m13_day.png')
        day_l = brightness(f'{SH}/m13_day.png')
        ok('night is dark but you can still see the street (not black)', 0.45 < night_l / day_l < 0.95, [round(night_l, 1), round(day_l, 1)])
        await E("__gol.env.setTimeMode('fast')")
        h0 = await E('__gol.env.hours')
        await g.sim(30)
        ok('fast day: about a game minute per second', 0.3 < (await E('__gol.env.hours') - h0) % 24 < 0.7, await E('__gol.env.hours') - h0)

        # Weather presets.
        await E("__gol.env.setTimeMode('day'); __gol.env.setWeatherMode('rain')")
        await g.sim(8)
        r = await E('__gol.env.debug')
        ok('rain: falling streaks, closer fog, weaker sun', r['rainVisible'] and r['fogFar'] < 600 and r['sunIntensity'] < day['sunIntensity'], r)
        await pg.screenshot(path=f'{SH}/m13_rain.png')
        await E("__gol.env.setWeatherMode('storm')")
        await g.sim(22)
        ok('thunderstorm: lightning strikes', await E('__gol.env.lightning') >= 1, await E('__gol.env.lightning'))
        await E("__gol.env.setWeatherMode('haze')")
        await g.sim(10)
        hz = await E('__gol.env.debug')
        ok('harmattan haze: short, dusty view, no rain', hz['fogFar'] < 400 and not hz['rainVisible'], hz)
        ok('HUD weather label', 'Harmattan haze' in await g.txt('weather') and 'set in Settings' in await g.txt('weather'), await g.txt('weather'))

        # Live Lagos weather: the Open-Meteo answer is understood (codes per WMO).
        codes = await E("[95, 63, 61, 3, 1, 0, 45].map(c => __gol.envLib.fromWeatherCode(c, c === 0 ? 5 : 60, 0, 20000).kind)")
        ok('weather codes: storm, rain, light rain, overcast, partly, clear, fog', codes == ['storm', 'rain', 'rain', 'cloudy', 'partly', 'clear', 'fog'], codes)
        ok('low visibility reads as haze', await E("__gol.envLib.fromWeatherCode(0, 10, 0, 2500).kind") == 'haze')
        await E("__gol.env.setWeatherMode('live')")
        applied = await E("__gol.env.applyLive({ current: { temperature_2m: 27.4, weather_code: 63, cloud_cover: 96, precipitation: 2.1, wind_speed_10m: 4.2, visibility: 9000 } })")
        ok('live data drives the weather and HUD', applied and await E('__gol.env.weather.kind') == 'rain' and await E('__gol.env.weather.tempC') == 27 and 'live' in await E('__gol.env.weatherText'), await E('__gol.env.weatherText'))
        est = await E("__gol.envLib.estimateWeather('2026-01-10T12:00:00Z', 13)")
        ok('climate estimate (offline): January afternoon is dry, hot', est['rain'] == 0 and 30 <= est['tempC'] <= 34 and est['source'] == 'estimate', est)
        june = [await E(f"__gol.envLib.estimateWeather('2026-06-{d:02d}T12:00:00Z', 17).rain") for d in range(1, 29)]
        jan = [await E(f"__gol.envLib.estimateWeather('2026-01-{d:02d}T12:00:00Z', 17).rain") for d in range(1, 29)]
        ok('climate estimate: June evenings rain far more than January', sum(1 for x in june if x > 0) > sum(1 for x in jan if x > 0) + 5, [sum(1 for x in june if x > 0), sum(1 for x in jan if x > 0)])
        await E("localStorage.setItem('gangs-of-lagos/time', 'live'); localStorage.setItem('gangs-of-lagos/weather', 'live')")

        # Save v5 -> v6: a save still in the old default (the Signature look) becomes BLK KNG; others keep theirs.
        v5 = save(cash=10).replace('version:4', 'version:5')
        await g.boot(v5.replace("top:'top-stripe'", "top:'top-signature'"))
        ok('v5 save in the Signature look moves to BLK KNG (v9 now)', await E('__gol.save.version') == 9 and await E('__gol.save.outfit.top') == 'top-blkkng' and await E('__gol.save.cash') == 10)
        await g.boot(v5.replace("top:'top-stripe'", "top:'top-kaftan'"))
        ok('other outfits are kept', await E('__gol.save.version') == 9 and await E('__gol.save.outfit.top') == 'top-kaftan')

        # The real request (with ?liveweather): answered, and refused (falls back to the estimate).
        sample = {'current': {'temperature_2m': 31.0, 'weather_code': 2, 'cloud_cover': 45, 'precipitation': 0, 'wind_speed_10m': 3.0, 'visibility': 20000}}
        await pg.route(lambda u: 'api.open-meteo.com' in u, lambda route: route.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'}, body=json.dumps(sample)))
        await pg.goto(URL + '&liveweather')
        await pg.wait_for_function("!document.getElementById('btn-play').disabled", timeout=90000)
        await g.play()
        await g.sim(0.5)
        await pg.wait_for_function("__gol.env.lastFetch !== null", timeout=30000)
        ok('fetches Lagos weather from Open-Meteo', await E('__gol.env.lastFetch.ok') and await E('__gol.env.weather.source') == 'live' and await E('__gol.env.weather.kind') == 'partly', await E('__gol.env.weatherText'))
        await pg.unroute(lambda u: 'api.open-meteo.com' in u)
        await pg.route(lambda u: 'api.open-meteo.com' in u, lambda route: route.abort())
        ok_fb = await E('__gol.env.fetchLive()')
        ok('no connection: falls back to the climate estimate', not ok_fb and await E('__gol.env.weather.source') == 'estimate' and 'estimated' in await E('__gol.env.weatherText'))
        finish(errs)


asyncio.run(main())
