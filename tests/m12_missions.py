"""Missions update: the mission list (J), animated introductions (skip and full), and the three new
missions played through: Night Exit (caught, wrecked, and a clean escape), Coastal Run and Market
Delivery (delivered, and out of time). An older job still starts from the list."""
import asyncio
from gol import browser, ok, finish, SH

R = '__gol.runner()'


async def hold(g, keys, secs):
    for k in keys:
        await g.pg.keyboard.down(k)
    await g.sim(secs)
    for k in keys:
        await g.pg.keyboard.up(k)


async def txt(g, i):
    return await g.E(f"document.getElementById('{i}').textContent")


async def to_pursuit(g):
    """From a freshly started Night Exit: power, side door, cell, car. Returns once the pursuit runs."""
    E = g.E
    await E("__gol.teleportPlayer(-154.6, -71)")
    await g.sim(0.1)
    await hold(g, ['KeyE'], 1.8)
    await E("__gol.teleportPlayer(-161.5, -75.3)")
    await g.sim(0.2)
    await E("__gol.teleportPlayer(-178.4, -78)")
    await g.sim(0.1)
    await hold(g, ['KeyE'], 2.8)
    await E("__gol.teleportPlayer(__gol.missionCar.x, __gol.missionCar.z + 1.7)")
    await g.sim(0.1)
    await g.key('KeyE')
    await g.sim(0.3)


async def main():
    async with browser() as (g, errs):
        E, pg = g.E, g.pg
        await g.boot()
        await g.play()
        await E('__gol.setTraffic(0)')
        spawn = await E('[__gol.player.x, __gol.player.z]')

        # ---- Mission list
        await g.key('KeyJ')
        ok('J opens the mission list', await E('__gol.mode') == 'missions')
        n = await E("document.querySelectorAll('#hub-list button').length")
        ok('every mission is listed (12 + the two crew jobs)', n == 14, n)
        rows = await E("[...document.querySelectorAll('#hub-list button')].map(b => [b.dataset.mission, b.querySelector('.st').textContent, b.querySelector('small').textContent])")
        st = {r[0]: r[1] for r in rows}
        ok('statuses: available and locked', st['night-exit'] == 'Available' and st['coastal-run'] == 'Available' and st['market-delivery'] == 'Available' and st['marina-showdown'] == 'Locked', st)
        ok('list rows show location and reward', all('₦' in r[2] for r in rows), rows[-3:])
        await pg.click('button[data-mission="night-exit"]')
        await g.sim(0.1)
        detail = await txt(g, 'hub-detail')
        ok('detail: name, description, location, reward, status', all(k in detail for k in ['NIGHT EXIT', 'Holding Centre', 'Range Avenue', '₦8,000', 'Available', 'Animated briefing']), detail[:200])
        ok('selecting marks the mission on the map', await E('__gol.tracked') == 'night-exit')
        await pg.click('button[data-mission="marina-showdown"]')
        await g.sim(0.1)
        ok('a locked mission cannot be started', await E("!document.getElementById('btn-hubstart')") and 'Locked' in await txt(g, 'hub-detail'))
        await pg.click('button[data-mission="night-exit"]')
        await g.pg.screenshot(path=f'{SH}/m12_hub.png')
        await g.key('Escape')
        ok('closing the list resumes play', await E('__gol.mode') == 'play')
        await g.sim(0.2)
        ok('HUD points to the selected mission', 'Night Exit' in await txt(g, 'm-name') and 'Range Avenue' in await txt(g, 'm-obj'), await txt(g, 'm-obj'))

        # ---- Introduction from the list: controls off, camera cuts, gestures, skip, cancel restores you
        await g.key('KeyJ')
        await pg.click('#btn-hubstart')
        await g.sim(0.05)
        ok('the intro plays', await E('__gol.mode') == 'cutscene' and not await E("document.getElementById('cutscene').hidden") and await E("document.getElementById('hud').hidden"))
        ok('a Skip prompt is shown', 'Skip' in await txt(g, 'btn-skip') and await E("document.getElementById('btn-skip').offsetParent !== null"))
        p0 = await E('[__gol.player.x, __gol.player.z]')
        lines, poses = [], []
        for t in [1.0, 5.0, 9.0, 12.0]:
            cur = await E('__gol.lastIntro.t')
            await hold(g, ['KeyW'], max(0.05, t - cur))
            lines.append(await txt(g, 'cut-who'))
            poses.append(await E("[__gol.cutscene.actor('remi').pose, __gol.cutscene.actor('kachi').pose, __gol.player.rig.pose]"))
        p1 = await E('[__gol.player.x, __gol.player.z]')
        ok('movement and actions are off during the intro', abs(p1[0] - p0[0]) < 0.01 and abs(p1[1] - p0[1]) < 0.01 , [p0, p1])
        ok('several speakers with subtitles', len(set(lines)) >= 3, lines)
        ok('characters gesture (lookout, talk, point...)', len({p for row in poses for p in row} - {'none'}) >= 3, poses)
        shots = await E('__gol.cutscene.shot')
        ok('camera cuts between shots', shots >= 3, shots)
        await g.pg.screenshot(path=f'{SH}/m12_intro.png')
        await g.key('Space')
        li = await E('__gol.lastIntro')
        ok('Space skips to the start card', await E('__gol.mode') == 'offer' and li['skipped'] and li['t'] < li['length'], li)
        ok('camera and controls restored after the skip', await E('__gol.cutscene') is None and await E("document.getElementById('cutscene').hidden") and abs(await E('__gol.camYaw') - await E('__gol.player.heading')) < 0.01)
        ok('start card shows the introduction', 'Remi and Kachi' in await txt(g, 'o-intro') and await txt(g, 'btn-accept') == 'Start mission' and await txt(g, 'btn-decline') == 'Cancel')
        await pg.click('#btn-decline')
        await g.sim(0.1)
        back = await E('[__gol.player.x, __gol.player.z]')
        ok('Cancel puts you back where you were', await E('__gol.mode') == 'play' and abs(back[0] - spawn[0]) < 0.5 and abs(back[1] - spawn[1]) < 0.5 and await E(f'{R}.state') == 'idle', back)

        # ---- At the start point in the world: E plays the full intro to the end
        await E('__gol.teleportPlayer(-131, -78)')
        await g.sim(0.1)
        ok('start point prompt in the world', 'Night Exit' in await txt(g, 'prompt'), await txt(g, 'prompt'))
        await g.key('KeyE')
        ok('E at the start point plays the intro', await E('__gol.mode') == 'cutscene')
        await g.sim(23)
        li = await E('__gol.lastIntro')
        ok('the full intro ends by itself on the start card', await E('__gol.mode') == 'offer' and not li['skipped'] and li['t'] >= li['length'] - 0.1, li)
        await pg.click('#btn-accept')
        await g.sim(0.2)
        ok('Night Exit starts: objective on the HUD', await E(f'{R}.state') == 'active' and 'generator' in await txt(g, 'm-obj'), await txt(g, 'm-obj'))
        ok('getaway car parked in the lane', await E('!!__gol.missionCar && __gol.missionCar.kind') == 'saloon')
        await g.key('KeyJ')
        ok('the list shows it as active', await E("__gol.hubStatus('night-exit')") == 'active' and 'Active' in await txt(g, 'hub-list'))
        await g.key('Escape')

        # Objectives: generator (hold E), side door, cell (hold E), car.
        await E("__gol.teleportPlayer(-154.6, -71)")
        await g.sim(0.1)
        ok('generator prompt', 'Generator' in await txt(g, 'prompt'), await txt(g, 'prompt'))
        await hold(g, ['KeyE'], 0.5)
        ok('a short tap is not enough', await E(f'{R}.index') == 1)
        await hold(g, ['KeyE'], 1.8)
        ok('holding E cuts the floodlights and unlocks the side door', await E(f'{R}.index') == 2 and not await E('__gol.sites.powerOn'))
        await E("__gol.teleportPlayer(-155.5, -75.3); __gol.player.heading = Math.PI; __gol.setCamYaw(Math.PI)")
        await hold(g, ['KeyW'], 2.2)
        ok('walk in through the side door', await E(f'{R}.index') == 3 and await E('__gol.player.x') < -158, await E('__gol.player.x'))
        await E("__gol.teleportPlayer(-178.4, -78)")
        await hold(g, ['KeyE'], 2.8)
        ok('opening the cell frees Sola, who follows you', await E(f'{R}.index') == 4 and await E('!!__gol.companion'))
        await E("__gol.teleportPlayer(__gol.missionCar.x, __gol.missionCar.z + 1.7)")
        await g.sim(0.1)
        await g.key('KeyE')
        await g.sim(0.5)
        ok('in the car, the pursuit starts', await E('__gol.inVehicle') == 'saloon' and await E('__gol.pursuit.active') and await E('__gol.pursuit.cars.length') == 3)
        ok('Sola rides along', await E('__gol.companion.rig.seated'))
        await hold(g, ['KeyW'], 1.5)
        await g.sim(1)
        ok('pursuit indicator on the HUD', not await E("document.getElementById('pursuit').hidden") and 'patrol cars' in await txt(g, 'pu-text'), await txt(g, 'pursuit'))
        await g.pg.screenshot(path=f'{SH}/m12_pursuit.png')

        # Caught: a patrol car pins the stopped getaway car.
        await E("(() => { const v = __gol.missionCar; v.speed = 0; const c = __gol.pursuit.cars[0]; c.place(v.x + Math.cos(v.heading) * 6, v.z + Math.sin(v.heading) * 6, v.heading + Math.PI); c.speed = 0; })()")
        for _ in range(12):
            await E("(() => { const v = __gol.missionCar; const c = __gol.pursuit.cars[0]; if (!v || !c) return; v.speed = 0; c.place(v.x + Math.cos(v.heading) * 6, v.z + Math.sin(v.heading) * 6, v.heading + Math.PI); })()")
            await g.sim(0.4)
            if await E('__gol.mode') == 'result':
                break
        ok('caught by the patrol: mission failed', await E('__gol.mode') == 'result' and await txt(g, 'r-title') == 'JOB FAILED' and 'caught' in await txt(g, 'r-body'), await txt(g, 'r-body'))
        ok('failure cleans up (pursuit, lights, Sola)', not await E('__gol.pursuit.active') and await E('__gol.sites.powerOn') and not await E('!!__gol.companion'))

        # Try again; this time the car is wrecked.
        await pg.click('#btn-retry')
        await g.sim(0.3)
        ok('Try again restarts it on foot at the meeting point', await E(f'{R}.state') == 'active' and await E(f'{R}.def.id') == 'night-exit' and await E('__gol.inVehicle') is None and await E(f'{R}.index') == 1)
        await to_pursuit(g)
        await E('__gol.missionCar.damage(9999)')
        await g.sim(0.3)
        ok('getaway car disabled: mission failed', await E('__gol.mode') == 'result' and 'disabled' in await txt(g, 'r-body'), await txt(g, 'r-body'))
        cash0 = await E('__gol.save.cash')
        await pg.click('#btn-retry')
        await g.sim(0.3)
        await to_pursuit(g)

        # Clean escape: at the safehouse with the patrol far behind.
        await E("(() => { const v = __gol.missionCar; v.place(84, 166, Math.PI / 2); v.speed = 0; __gol.pursuit.cars.forEach((c, i) => c.place(-150 - i * 8, -100, 0)); })()")
        await g.sim(0.2)
        await E("(() => { const v = __gol.missionCar; v.place(84, 171, Math.PI / 2); v.speed = 0; })()")
        await g.sim(0.6)
        ok('reaching the safehouse with the patrol lost: success', await E('__gol.mode') == 'result' and await txt(g, 'r-title') == 'ESCAPE COMPLETE', await txt(g, 'r-body'))
        ok('reward paid', await E('__gol.save.cash') == cash0 + 8000 and 'night-exit' in await E('__gol.save.completedMissions'), await E('__gol.save.cash'))
        await g.pg.screenshot(path=f'{SH}/m12_night_exit_done.png')
        await pg.click('#btn-continue')
        await g.sim(0.2)
        await g.key('KeyJ')
        await pg.click('button[data-mission="night-exit"]')
        ok('completed missions can be replayed', await E("__gol.hubStatus('night-exit')") == 'completed' and 'Replay' in await txt(g, 'btn-hubstart'), await txt(g, 'btn-hubstart'))
        await g.key('Escape')
        if await E('__gol.inVehicle'):
            await E('__gol.leaveVehicle(true)')

        # ---- Coastal Run: drive it for real
        await E("__gol.beginIntro(__gol.runner().byId('coastal-run'))")
        await g.sim(0.1)
        ok('Coastal Run has an intro', await E('__gol.mode') == 'cutscene' and await E("__gol.cutscene.actor('ebun') !== undefined"))
        await g.key('Space')
        await pg.click('#btn-accept')
        await g.sim(0.2)
        await E("__gol.teleportPlayer(__gol.missionCar.x + 1.6, __gol.missionCar.z)")
        await g.sim(0.1)
        await g.key('KeyE')
        await g.sim(0.2)
        # Roll up to the line (12 m ahead), then stop inside it.
        for _ in range(20):
            if await E('Math.hypot(__gol.missionCar.x - 120, __gol.missionCar.z + 160)') < 6:
                break
            await hold(g, ['KeyW'], 0.2)
        await hold(g, ['Space'], 1.5)
        ok('start prompt: countdown at the line', await E(f'{R}.index') >= 2, await E(f'{R}.objectiveText()'))
        await g.sim(3.3)
        await g.pg.keyboard.down('KeyW')
        for _ in range(26):
            await g.sim(1)
            if await E(f'{R}.state') != 'active':
                break
        await g.pg.keyboard.up('KeyW')
        ok('Coastal Run: checkpoints to the finish, paid', await txt(g, 'r-title') == 'RACE COMPLETE' and 'coastal-run' in await E('__gol.save.completedMissions') and await E("__gol.save.bestTimes['coastal-run']") > 0, await txt(g, 'r-body'))
        ok('Coastal Run prize: the Royale GT is yours', 'royale' in await E('__gol.save.licences') and 'Royale GT' in await txt(g, 'r-body'), await txt(g, 'r-body'))
        await pg.click('#btn-continue')
        await g.sim(0.2)
        if await E('__gol.inVehicle'):
            await E('__gol.leaveVehicle(true)')

        # ---- Market Delivery: out of time, then delivered
        await E("__gol.beginIntro(__gol.runner().byId('market-delivery'))")
        await g.sim(0.1)
        await g.key('Space')
        await pg.click('#btn-accept')
        await g.sim(0.2)
        ok('Market Delivery: pick-up prompt', 'cooler' in (await txt(g, 'prompt')).lower(), await txt(g, 'prompt'))
        await g.key('KeyE')
        await g.sim(0.2)
        ok('cooler picked up, timer running', await E(f'{R}.cargo') == 100 and await E(f'{R}.timerOn'))
        await g.sim(51)
        ok('too slow: Time up', await E('__gol.mode') == 'result' and 'Time up' in await txt(g, 'r-body'), await txt(g, 'r-body'))
        await pg.click('#btn-retry')
        await g.sim(0.2)
        await E('__gol.teleportPlayer(-46, 48)')
        await g.sim(0.1)
        await g.key('KeyE')
        await E('__gol.teleportPlayer(48, 16)')
        await g.sim(0.2)
        await E('__gol.teleportPlayer(52, 16)')
        await g.sim(0.3)
        ok('delivered in time: paid', await txt(g, 'r-title') == 'DELIVERED' and 'market-delivery' in await E('__gol.save.completedMissions'), await txt(g, 'r-body'))
        await pg.click('#btn-continue')
        await g.sim(0.2)

        # ---- An older job still starts from the list (and keeps its resident giver).
        await g.key('KeyJ')
        await pg.click('button[data-mission="harbour-sprint"]')
        await pg.click('#btn-hubstart')
        await g.sim(0.1)
        ok('older jobs: briefing card from the list', await E('__gol.mode') == 'offer' and 'Kunle' in await txt(g, 'o-giver'))
        await pg.click('#btn-accept')
        await g.sim(0.1)
        ok('older job starts from the list', await E(f'{R}.state') == 'active' and await E(f'{R}.def.id') == 'harbour-sprint')
        await E(f'{R}.abandon()')
        await pg.click('#btn-continue')
        finish(errs)


asyncio.run(main())
