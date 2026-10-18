"""Crews: three crews of five walking their turf in matching bandanas; talking to a leader (say no,
join, rival crews turn you away, leave); the crew house (locked until you join, your room's bed, the
bathroom, the gym, the planning table with crew jobs, the club run in the crew minibus to Afterglow
where the crew dances); EKO Arms selling every weapon; save v8."""
import asyncio
from gol import browser, ok, finish, save, SH


async def main():
    async with browser() as (g, errs):
        E, pg, sim = g.E, g.pg, g.sim
        await g.boot(save(cash=60000))
        await g.play()
        await E("__gol.setTraffic(0); __gol.env.setTimeMode('day'); __gol.env.setWeatherMode('clear')")

        # ---- Crews on the street
        info = await E("__gol.crews.map(c => [c.def.id, c.members.length, c.members.every(m => { const b = m.rig.root.getObjectByName('bandana'); return b && b.children[0].material.color.getHexString() === c.def.colour.slice(1); })])")
        ok('three crews of five, every member in the crew\'s bandana', len(info) == 3 and all(n == 5 and band for _, n, band in info), info)
        p0 = await E('[__gol.crews[1].leader.x, __gol.crews[1].leader.z]')
        await sim(3)
        p1 = await E('[__gol.crews[1].leader.x, __gol.crews[1].leader.z]')
        ok('they walk their turf', abs(p1[0] - p0[0]) + abs(p1[1] - p0[1]) > 2.5, [p0, p1])
        inside = await E("__gol.crews.every(c => { const [x0, z0, x1, z1] = c.def.turf; return c.members.every(m => m.x > x0 - 1 && m.x < x1 + 1 && m.z > z0 - 1 && m.z < z1 + 1); })")
        ok('...staying on their own block', inside)
        spread = await E("(() => { const m = __gol.crews[0].members; let far = 0; for (const a of m) for (const b of m) far = Math.max(far, Math.hypot(a.x - b.x, a.z - b.z)); return far; })()")
        ok('...together as a group', spread < 6, round(spread, 2))

        # ---- The crew house is locked until you join
        await E('__gol.teleportPlayer(-15, -48.6)')
        await sim(0.2)
        ok('crew house door: members only', 'members only' in (await g.txt('prompt')).lower(), await g.txt('prompt'))
        await g.key('KeyE')
        ok('locked before you join', await E('__gol.room') is None and 'join a crew' in (await g.txt('notice')).lower())

        # ---- Talk to Blue Tide: say no, then join
        async def to_leader(i):
            await E(f'__gol.teleportPlayer(__gol.crews[{i}].leader.x + 1.6, __gol.crews[{i}].leader.z + 0.4)')
            await sim(0.4)
        await to_leader(0)
        ok('the crew stops when you walk up', await E('__gol.crews[0].paused'))
        ok('prompt: talk to the leader', 'Talk to Seyi (Blue Tide)' in await g.txt('prompt'), await g.txt('prompt'))
        await g.key('KeyE')
        ok('the leader makes the pitch', await E('__gol.mode') == 'offer' and 'Blue Tide' in await g.txt('o-intro') and await g.txt('btn-accept') == 'Join Blue Tide', await g.txt('o-intro'))
        await pg.screenshot(path=f'{SH}/m16_pitch.png')
        await pg.click('#btn-decline')
        await sim(0.2)
        ok('"Not now" leaves you out', await E('__gol.save.crew') == '' and await E('__gol.mode') == 'play')
        await to_leader(0)
        await g.key('KeyE')
        await pg.click('#btn-accept')
        await sim(0.2)
        ok('joined Blue Tide (saved)', await E('__gol.save.crew') == 'blue' and await E("JSON.parse(localStorage.getItem('gangs-of-lagos/save')).crew") == 'blue')
        ok('you wear the blue bandana', await E("(() => { const b = __gol.player.rig.root.getObjectByName('bandana'); return !!b && b.children[0].material.color.getHexString() === '1f6fd1'; })()"))
        ok('the house is Blue Tide\'s now', await E('__gol.house.owner && __gol.house.owner.name') == 'Blue Tide')
        await to_leader(1)
        await g.key('KeyE')
        ok('a rival crew turns you away', 'RED PALM' in await g.txt('o-name') and await g.txt('btn-accept') == 'Walk on' and 'Blue Tide' in await g.txt('o-terms'))
        await pg.click('#btn-accept')
        await sim(0.2)
        ok('...and you stay Blue Tide', await E('__gol.save.crew') == 'blue')

        # ---- Inside the crew house
        await E('__gol.teleportPlayer(-15, -48.6)')
        await sim(0.2)
        await g.key('KeyE')
        await sim(0.3)
        ok('enter the house', await E('__gol.room') == 'house' and 'Blue Tide house' in await g.txt('area-name'))
        ok('crew members inside, in blue', await E("__gol.house.members.length === 3 && __gol.house.members.every(m => m.root.visible && m.root.getObjectByName('bandana'))"))
        await pg.screenshot(path=f'{SH}/m16_house.png')

        async def spot(x, z, text):
            await E(f'__gol.teleportPlayer({x}, {z})')
            await sim(0.15)
            got = await g.txt('prompt')
            ok(f'prompt in the house: {text}', text in got, got)

        await E('__gol.combat.health = 40; __gol.env.setTimeMode("fast")')
        await spot(-23.6, -67.6, 'Sleep in your bed')
        await g.key('KeyE')
        await sim(0.2)
        ok('sleeping: full health, saved, morning on the fast clock', await E('__gol.combat.health') == 100 and 6.9 < await E('__gol.env.hours') < 7.2, await E('__gol.env.hours'))
        await E('__gol.env.setTimeMode("day")')
        await E('__gol.stamina.value = 20')
        await spot(-15, -67.5, 'Use the bathroom')
        await g.key('KeyE')
        ok('bathroom: freshened up (stamina full)', await E('__gol.stamina.value') == 100)
        await spot(-7.6, -67.2, 'Work out')
        await g.key('KeyE')
        ok('gym: fitness up and saved', await E('__gol.save.fitness') == 1 and await E('__gol.stamina.fitness') == 1)
        await g.key('KeyE')
        ok('...rest between sets', await E('__gol.save.fitness') == 1 and 'breath' in (await g.txt('notice')).lower())
        await sim(8.5)
        await g.key('KeyE')
        ok('...and again after a rest', await E('__gol.save.fitness') == 2)
        await spot(-15, -53.8, 'Plan with the crew')
        await g.key('KeyE')
        await sim(0.1)
        ids = await E("[...document.querySelectorAll('#hub-list button')].map(b => b.dataset.mission)")
        ok('planning table: the crew jobs', await E('__gol.mode') == 'missions' and sorted(ids) == ['crew-package', 'crew-rounds'], ids)
        ok('...available to a member', 'Available' in await E("document.getElementById('hub-list').textContent"))
        await pg.keyboard.press('Escape')
        await sim(0.2)

        # ---- Club run
        await spot(-5.6, -55, 'Drive to the club with the crew')
        await g.key('KeyE')
        await sim(0.3)
        cr = await E('__gol.clubRun')
        ok('the crew piles into the minibus with you at the wheel', cr and cr['riders'] == 4 and await E('__gol.inVehicle') == 'minibus' and await E('__gol.room') is None, cr)
        ok('club run on the job card', 'Club run' in await g.txt('m-name') and 'Afterglow' in await g.txt('m-obj'), await g.txt('m-obj'))
        await pg.screenshot(path=f'{SH}/m16_clubrun.png')
        await E('__gol.clubBus.place(76, -43, 0)')
        await sim(0.5)
        ok('pull up outside: everyone goes in', await E('__gol.room') == 'club' and await E('__gol.club.crewCount') == 4)
        await sim(1)
        ok('the crew and the regulars dance', await E("__gol.club.dancers.length >= 9 && __gol.club.dancers.every(d => d.rig.pose === 'dance')"))
        await pg.screenshot(path=f'{SH}/m16_club.png')
        await spot(76, -51.1, 'Leave the club')
        await g.key('KeyE')
        await sim(0.2)
        ok('leave the club: back on the street, club run over', await E('__gol.room') is None and await E('__gol.clubRun') is None and await E('__gol.player.z') > -50)

        # ---- EKO Arms
        await E('__gol.teleportPlayer(14, -47.0)')
        await sim(0.2)
        ok('gun shop counter prompt', 'EKO Arms' in await g.txt('prompt'), await g.txt('prompt'))
        await g.key('KeyE')
        await sim(0.1)
        ok('EKO Arms opens', await E('__gol.mode') == 'armoury' and await g.txt('ar-title') == 'EKO ARMS')
        rows = await E("document.getElementById('ar-list').textContent")
        ok('every weapon for sale, no medal needed', 'locked' not in rows.lower() and 'Heron' in rows, rows[:200])
        await E("[...document.querySelectorAll('#ar-list button')].find(b => b.dataset.weapon === 'heron' || b.dataset.buy === 'heron').click()")
        await sim(0.1)
        ok('buy the marksman rifle without a medal', 'heron' in await E('__gol.save.weapons.owned'), await E('__gol.save.weapons.owned'))
        await pg.screenshot(path=f'{SH}/m16_ekoarms.png')
        await pg.keyboard.press('Escape')
        await sim(0.1)
        await E("__gol.openArmoury('', 'range')")
        ok("Sade's range counter still asks for medals", 'locked' in (await E("document.getElementById('ar-list').textContent")).lower() and await g.txt('ar-title') == 'ARMS COUNTER')
        await pg.keyboard.press('Escape')
        await sim(0.1)

        # ---- Leaving the crew
        await to_leader(0)
        await g.key('KeyE')
        ok('your own crew: carry on or leave', await g.txt('btn-decline') == 'Leave the crew')
        await pg.click('#btn-decline')
        await sim(0.2)
        ok('left the crew: no bandana, house locked again', await E('__gol.save.crew') == '' and not await E("!!__gol.player.rig.root.getObjectByName('bandana')") and await E('__gol.house.owner') is None)

        # ---- Saves
        await g.boot("{version:7,cash:10,completedMissions:[],licences:[]}")
        ok('v7 save moves to v9: no crew, no gym work', await E('__gol.save.version') == 9 and await E('__gol.save.crew') == '' and await E('__gol.save.fitness') == 0)
        await g.boot("{version:8,cash:10,crew:'red',fitness:4,lookChosen:true}")
        await g.play()
        ok('a Red Palm save: red bandana, Red Palm house, fitness kept', await E("(() => { const b = __gol.player.rig.root.getObjectByName('bandana'); return !!b && b.children[0].material.color.getHexString() === 'c62828'; })()") and await E('__gol.house.owner.name') == 'Red Palm' and await E('__gol.stamina.fitness') == 4)
        finish(errs)


asyncio.run(main())
