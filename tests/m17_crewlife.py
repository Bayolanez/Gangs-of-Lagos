"""Crew Life: crews in combat (scatter from gunfire, fight back with pistols, go down and get up),
two of your crew walking with you (following, riding along, fighting), turf wars (a rival crew put
down hands its turf to yours, saved as v9), Afterglow's own music, the indoor camera staying on your
side of the walls, and the new furniture."""
import asyncio
from gol import browser, ok, finish, SH

SAVE = "{version:8,cash:1000,lookChosen:true,weapons:{owned:['harmattan'],ammo:{harmattan:600},equipped:null}}"


async def main():
    async with browser() as (g, errs):
        E, pg, sim = g.E, g.pg, g.sim
        await g.boot(SAVE)
        await g.play()
        await E("__gol.setTraffic(0); __gol.env.setTimeMode('day'); __gol.env.setWeatherMode('clear')")
        ok('v8 save moves to v9: every crew holds its own turf', await E('__gol.save.version') == 9 and await E('__gol.save.turfs') == {'blue': 'blue', 'red': 'red', 'yellow': 'yellow'})

        async def near(i, dx=7, dz=3):
            await E(f'__gol.teleportPlayer(__gol.crews[{i}].leader.x + {dx}, __gol.crews[{i}].leader.z + {dz})')
            await sim(0.2)

        async def shoot_at(js_point, times=1):
            for _ in range(times):
                await E(f"(() => {{ const p = {js_point}; __gol.setAim({{ x: p.x, y: 1.2, z: p.z }}); __gol.fire(); }})()")
                await sim(0.15)

        async def draw():
            await E("__gol.weapons.draw('harmattan')")
            await sim(0.5)

        # ---- Gunfire scatters a crew
        await near(0)
        await draw()
        start = await E('__gol.crews[0].members.map(m => Math.hypot(m.x - __gol.player.x, m.z - __gol.player.z))')
        await E('__gol.setAim({ x: __gol.player.x, y: 30, z: __gol.player.z - 40 }); __gol.fire()')
        await sim(1.5)
        ok('gunfire nearby scatters the crew', await E('__gol.crews[0].mode') == 'scatter')
        after = await E('__gol.crews[0].members.map(m => Math.hypot(m.x - __gol.player.x, m.z - __gol.player.z))')
        ok('...they run away from you', sum(after) > sum(start) + 8, [round(sum(start)), round(sum(after))])
        await E('__gol.setAim(null); __gol.teleportPlayer(0, 20)')
        for _ in range(30):
            await sim(1)
            if await E('__gol.crews[0].mode') == 'walk':
                break
        ok('...then regroup and walk on', await E('__gol.crews[0].mode') == 'walk')

        # ---- Shoot one: they fight back
        await near(1, 8, 2)
        await E('__gol.combat.health = 100')
        shots0 = await E('__gol.crewShots.crew')
        await shoot_at('__gol.crews[1].members[2]')
        await sim(0.2)
        ok('shoot a crew member: that crew fights back', await E('__gol.crews[1].hostile') and await E("__gol.crews[1].members.filter(m => !m.down).every(m => m.isArmed)"))
        ok('...a member hit takes damage', await E('__gol.crews[1].members[2].health') < 100)
        for _ in range(8):
            await E('__gol.combat.health = 100')
            await sim(1)
        ok('...and they shoot at you', await E('__gol.crewShots.crew') > shots0, await E('__gol.crewShots.crew') - shots0)
        # Put them all down.
        for i in range(5):
            for _ in range(12):
                if await E(f'__gol.crews[1].members[{i}].down'):
                    break
                await E('__gol.combat.health = 100')
                await shoot_at(f'__gol.crews[1].members[{i}]')
        await sim(0.6)
        ok('members go down when shot enough', await E('__gol.crews[1].members.every(m => m.down)'), await E('__gol.crews[1].members.map(m => m.health)'))
        ok('...and lie on the ground', await E('__gol.crews[1].members.every(m => Math.abs(m.rig.root.rotation.z) > 1.2)'))
        await pg.screenshot(path=f'{SH}/m17_down.png')
        ok('not in a crew: no turf war', await E('__gol.turfWar') is None)
        await E('__gol.teleportPlayer(0, 20); __gol.weapons.draw(null)')
        await sim(2)
        ok('walk away: the fight ends', not await E('__gol.crews[1].hostile'))
        await sim(36)
        ok('the fallen get back up later', await E('__gol.crews[1].members.every(m => !m.down && m.health === 100)'))

        # ---- Join Blue Tide and take two of the crew with you
        await near(0, 1.6, 0.4)
        await g.key('KeyE')
        await pg.click('#btn-accept')
        await sim(0.3)
        ok('joined Blue Tide', await E('__gol.save.crew') == 'blue')
        await near(0, 1.6, 0.4)
        await g.key('KeyE')
        ok('your leader offers people to walk with you', await g.txt('btn-accept') == 'Walk with me')
        await pg.click('#btn-accept')
        await sim(1)
        ok('two of the crew walk with you, in blue', await E("__gol.followers && __gol.followers.members.length === 2 && __gol.followers.members.every(f => f.rig.root.getObjectByName('bandana'))"))
        await E('__gol.teleportPlayer(0, 20)')
        await sim(0.2)
        await pg.keyboard.down('KeyW')
        await sim(3)
        await pg.keyboard.up('KeyW')
        await sim(1.5)
        gap = await E('__gol.followers.members.map(f => Math.hypot(f.x - __gol.player.x, f.z - __gol.player.z))')
        ok('they follow you on foot', all(d < 5 for d in gap), [round(d, 1) for d in gap])
        await E('__gol.enterVehicle(__gol.saloon)')
        await pg.keyboard.down('KeyW')
        await sim(1.5)
        await pg.keyboard.up('KeyW')
        await sim(0.3)
        ride = await E('__gol.followers.members.map(f => [f.rig.seated, Math.hypot(f.x - __gol.saloon.x, f.z - __gol.saloon.z)])')
        ok('they ride along in your car', all(s and d < 2.5 for s, d in ride), ride)
        await pg.screenshot(path=f'{SH}/m17_ride.png')
        await E('__gol.leaveVehicle(true)')
        await sim(1)
        ok('...and get out with you', await E('__gol.followers.members.every(f => !f.rig.seated)'))

        # ---- Turf war on Red Palm's turf
        await near(1, 1.6, 0.4)
        await g.key('KeyE')
        ok('a rival leader: walk on, or start a turf war', await g.txt('btn-decline') == 'Start a turf war')
        await pg.click('#btn-decline')
        await sim(0.3)
        ok('turf war with Red Palm', await E('__gol.turfWar') == {'crew': 'red', 'turf': 'red'} and await E('__gol.crews[1].hostile'))
        await E('__gol.teleportPlayer(__gol.crews[1].leader.x + 10, __gol.crews[1].leader.z + 3)')
        await draw()
        f0 = await E('__gol.crewShots.followers')
        for _ in range(6):
            await E('__gol.combat.health = 100')
            await sim(1)
        ok('your crew fights on your side', await E('__gol.crewShots.followers') > f0, await E('__gol.crewShots.followers') - f0)
        await pg.screenshot(path=f'{SH}/m17_turfwar.png')
        cash0 = await E('__gol.save.cash')
        for i in range(5):
            for _ in range(14):
                if await E('!__gol.turfWar') or await E(f'__gol.crews[1].members[{i}].down'):
                    break
                await E('__gol.combat.health = 100')
                await shoot_at(f'__gol.crews[1].members[{i}]')
        await sim(0.5)
        ok('turf war won: the west blocks are Blue Tide\'s (saved)', await E('__gol.turfWar') is None and await E('__gol.save.turfs.red') == 'blue' and await E("JSON.parse(localStorage.getItem('gangs-of-lagos/save')).turfs.red") == 'blue')
        ok('...₦5,000 from the crew', await E('__gol.save.cash') - cash0 >= 5000, await E('__gol.save.cash') - cash0)
        ok('...and a Blue Tide group walks it now', await E('__gol.crews[1].def.id') == 'blue' and await E('__gol.crews[1].leaderName') == 'Kunmi')
        await E('__gol.weapons.draw(null); __gol.dismissFollowers()')

        # ---- Saves keep the turf
        await g.boot("{version:9,cash:10,crew:'blue',lookChosen:true,turfs:{blue:'blue',red:'blue',yellow:'yellow'}}")
        await g.play()
        ok('a saved turf war loads: Blue Tide on the west blocks', await E('__gol.crews[1].def.id') == 'blue' and await E("__gol.crews.map(c => c.def.id)") == ['blue', 'blue', 'yellow'])

        # ---- Afterglow's music
        await E('__gol.teleportPlayer(0, 0)')
        await sim(0.5)
        ok('far from the club: no music', await E('__gol.clubMusic.level') == 0)
        await E('__gol.teleportPlayer(76, -45)')
        await sim(0.5)
        lv = await E('__gol.clubMusic.level')
        ok('near the door: muffled music outside', 0 < lv < 0.45 and await E('__gol.clubMusic.playing'), lv)
        await E('__gol.enterClub()')
        await sim(1)
        ok('inside: the club\'s own music, full', await E('__gol.clubMusic.level') == 1 and await E('__gol.clubMusic.time') > 0.5)
        await E('__gol.exitClub(); __gol.teleportPlayer(0, 0)')
        await sim(3)
        ok('walk away: it stops', await E('__gol.clubMusic.level') == 0 and not await E('__gol.clubMusic.playing'))

        # ---- Indoor camera and furniture
        await E('__gol.teleportPlayer(-15, -48.6)')
        await sim(0.2)
        await g.key('KeyE')
        await sim(0.3)
        await E('__gol.teleportPlayer(-15, -59.6); __gol.setCamYaw(Math.PI / 2)')  # looking south: the camera swings north, towards the back rooms' wall
        await sim(1.2)
        cam = await E('__gol.camPos')
        ok('indoor camera stays on your side of the wall', cam[2] > -61.1, [round(c, 2) for c in cam])
        n = await E("(() => { let k = 0; __gol.house.interior.traverse(o => { if (o.isMesh || o.isInstancedMesh) k++; }); return k; })()")
        ok('the house is furnished (beds, bathroom fittings, gym gear, sofas)', n > 250, n)
        finish(errs)


asyncio.run(main())
