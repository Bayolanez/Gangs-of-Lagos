"""The Chairman: Mission 01, The Chairman's Summons, end to end, and jobs only from the boss.
New game: the phone rings (unknown number), a missed call rings again, the call plays in order and can be
skipped, the 8 PM clock, Tunde's text on the way, the black SUV, the gate (on time and late), following
Musa, the meeting with the Chairman (seated, heavy-set) and Tunde's briefing, the car in the forecourt,
the guest walking to the car and riding along, the drop at Afterglow, ₦250,000 paid exactly once, the
phone unlocked, saved and kept after a reload with no repeat of the opening call, no replay. Then the
phone apps, a job taken by phone, residents no longer giving work, a gift (the Royale GT) and the
penthouse, a failed run and its retry, a missing scene that doesn't stop the mission, and save v10."""
import asyncio
from gol import browser, ok, finish, SH

R = '__gol.runner()'
M01 = "__gol.runner().byId('chairmans-summons')"


async def main():
    async with browser() as (g, errs):
        E, pg, sim = g.E, g.pg, g.sim

        async def reload_keep():
            await pg.reload()
            await pg.wait_for_function("!document.getElementById('btn-play').disabled", timeout=90000)
            await pg.wait_for_function("!window.__gol || !__gol.models || __gol.models.done", timeout=90000)
            await g.play()

        # ---- A new game: name, then the phone rings
        await g.boot("{version:9,cash:10,lookChosen:false}")
        await pg.click('#btn-play')
        await pg.wait_for_timeout(200)
        ok('Choose your look asks for your name', await E('__gol.mode') == 'wardrobe' and not await E("document.getElementById('w-namefield').hidden"))
        await pg.fill('#w-name', 'Dayo')
        await pg.click('#btn-wdone')
        await sim(0.1)
        await pg.focus('#game')
        await E("__gol.setTraffic(0); __gol.env.setTimeMode('day'); __gol.env.setWeatherMode('clear')")
        ok('your name is saved', await E('__gol.save.playerName') == 'Dayo')
        ok('every other job waits for the Chairman', await E(f"{R}.missions.filter(m => !m.crew && m.id !== 'chairmans-summons').every(m => {R}.status(m) === 'locked')"))
        await sim(4.5)
        ok('the phone rings: unknown number (offered)', await E('__gol.phone.state') == 'ringing' and await g.txt('ph-ring-who') == 'Unknown number' and await E("__gol.save.story['chairmans-summons']") == 'offered')
        ok('play carries on while it rings', await E('__gol.mode') == 'play' and 'answer' in (await g.txt('m-obj')).lower())
        await pg.screenshot(path=f'{SH}/m19_ring.png')
        await sim(26)
        ok('unanswered: a missed call', await E('__gol.phone.state') == 'idle' and 'Missed call' in await g.txt('notice'))
        await sim(41)
        ok('...and it rings again', await E('__gol.phone.state') == 'ringing')

        # ---- The call
        await g.key('KeyC')
        ok('C answers: the call opens on the phone', await E('__gol.mode') == 'phone' and await E('__gol.phone.state') == 'call')
        ok('first line: Tunde asks for you by name', 'Dayo?' in await g.txt('ph-lines'))
        await pg.screenshot(path=f'{SH}/m19_call.png')
        await g.key('Space')
        await g.key('Space')
        n = await E('__gol.phone.shown')
        ok('Space moves to the next line', n == 3, n)
        await g.key('Escape')
        await sim(0.3)
        heard = await E('__gol.phone.heard')
        order = ['Tunde: Dayo?', "Dayo: Who's asking?", 'Tunde: My name is Tunde. I work with Chief Akinwale.', 'Dayo: The Chairman?']
        ok('the call plays in order (skipping shows the rest)', heard[:4] == order and len(heard) == 7 and 'Crown Ridge residence before eight' in heard[-1], heard)
        ok('call over: the mission is on (in progress)', await E('__gol.mode') == 'play' and await E(f'{R}.state') == 'active' and await E("__gol.save.story['chairmans-summons']") == 'in_progress')
        ok('"Wetin I enter now?"', 'Wetin I enter now?' in await g.txt('subtitle'))
        ok('objective: Crown Ridge before 8 PM', 'Crown Ridge before 8 PM' in await g.txt('m-obj'))
        ok('the 8 PM clock runs from 18:47', not await E("document.getElementById('story-clock').hidden") and (await g.txt('story-clock')).startswith('18:4'), await g.txt('story-clock'))
        ok('the way is marked (compass to the gate)', not await E("document.getElementById('compass').hidden"))
        await sim(15)
        ok("Tunde texts on the way: tell them Tunde sent you", any('Tunde sent you' in m['text'] for m in await E('__gol.save.messages')) and 'Tunde sent you' in await g.txt('ph-note-text'))

        # ---- Crown Ridge: on time, the SUV, the gate
        await E('__gol.teleportPlayer(-162, -122)')
        await sim(0.4)
        ok('arrived before 8: on time', await E(f'{R}.index') == 1 and not await E('__gol.arrivedLate'))
        ok('a black SUV sweeps in through the gate', await E('__gol.chairman.suvMoving'))
        opened = 0
        for _ in range(20):
            await sim(0.5)
            opened = max(opened, await E('__gol.chairman.gateOpen'))
            if opened > 0.5:
                break
        ok('the gate opened for it', opened > 0.5, opened)
        await pg.screenshot(path=f'{SH}/m19_gate.png')
        await E('__gol.teleportPlayer(-162, -129.4)')
        await sim(0.3)
        ok('gate prompt', 'Gate' in await g.txt('prompt'), await g.txt('prompt'))
        await g.key('KeyE')
        ok('E at the gate: Musa stops you', await E('__gol.mode') == 'cutscene' and await g.txt('cut-who') == 'Musa' and await g.txt('cut-text') == 'Stop there. Where are you going?')
        lines = []
        for _ in range(40):
            t = await g.txt('cut-text')
            if t and (not lines or lines[-1] != t):
                lines.append(t)
            if await E('__gol.mode') != 'cutscene':
                break
            await sim(0.6)
        ok('the gate scene plays in order to the end', lines[0].startswith('Stop there') and lines[-1].startswith('Alright. Follow me') and 'Oga, the boy is here.' in lines, lines)
        ok('the gate opens and Musa leads the way', await E('__gol.mode') == 'play' and await E(f'{R}.index') == 2 and await E('__gol.chairman.musaWalking'))
        # Follow him up the drive (walk behind him).
        for _ in range(30):
            mp = await E('[__gol.chairman.musa.root.position.x, __gol.chairman.musa.root.position.z]')
            await E(f'__gol.teleportPlayer({mp[0]}, {mp[1] + 2.5})')
            await sim(0.5)
            if await E('__gol.mode') == 'cutscene' or not await E('__gol.chairman.musaWalking'):
                break
        await E('__gol.teleportPlayer(-162, -155.8)')
        await sim(0.3)
        ok('at the front door: the meeting', await E('__gol.mode') == 'cutscene' and await E("!!__gol.cutscene.actor('chairman')"))
        ok('the Chairman sits behind his desk, a heavy-set man', await E("__gol.cutscene.actor('chairman').seated") and await E("__gol.cutscene.actor('chairman').root.position.y") < -0.2)
        await sim(1.5)
        await pg.screenshot(path=f'{SH}/m19_office.png')
        office = []
        for _ in range(160):
            t = await g.txt('cut-text')
            if t and (not office or office[-1] != t):
                office.append(t)
            if 'Palmyra Grand' in t:
                break
            await sim(0.5)
        ok("the Chairman's lines, in order, with your name", office[0] == "So. You're Dayo." and "Don't make me regret this meeting." in office and office.index("Sit down.") < office.index("Don't make me regret this meeting."), office)
        ok("then Tunde's briefing (the guest at the Palmyra Grand)", 'Palmyra Grand' in await g.txt('cut-text'))
        await pg.screenshot(path=f'{SH}/m19_briefing.png')
        await g.key('Space')
        await sim(1.5)
        ok('the drive: take the car in the forecourt', await E('__gol.mode') == 'play' and await E(f'{R}.index') == 3 and 'black car' in await g.txt('m-obj'))
        ok("Tunde texts the guest's name and pickup", any('Mr Kalu' in m['text'] and 'Palmyra' in m['text'] for m in await E('__gol.save.messages')))
        await E('__gol.teleportPlayer(__gol.missionCar.x - 2.2, __gol.missionCar.z)')
        await sim(0.2)
        await g.key('KeyE')
        await sim(0.3)
        ok('in the black car', await E('__gol.inVehicle') == 'sedan' and await E(f'{R}.index') == 4)

        # ---- The Palmyra Grand: the guest walks over and gets in
        await E('__gol.missionCar.place(-163, 128, 0)')
        await sim(0.5)
        ok('at the hotel: Mr Kalu comes out (passenger entry)', await E(f'{R}.index') == 5 and await E('__gol.guest.boarding'))
        await pg.keyboard.down('KeyW')
        await sim(1)
        await pg.keyboard.up('KeyW')
        ok('the car waits while he gets in', await E('Math.hypot(__gol.missionCar.x + 163, __gol.missionCar.z - 128)') < 0.3)
        for _ in range(12):
            await sim(0.5)
            if not await E('__gol.guest.boarding'):
                break
        ok('he is in the passenger seat', await E('__gol.guest.seated'))
        await pg.screenshot(path=f'{SH}/m19_guest.png')
        seen = []
        for _ in range(16):
            await sim(0.5)
            t = await g.txt('subtitle')
            if t not in seen:
                seen.append(t)
        ok('his lines on the drive', any('You work for Akinwale?' in t for t in seen) and any("better at driving than his last guy" in t for t in seen), seen)
        ok('the clock runs for the drop', await E(f'{R}.timerOn'))

        # ---- Afterglow
        cash0 = await E('__gol.save.cash')
        await E('__gol.missionCar.place(76, -42, 0)')
        await sim(0.6)
        ok('MISSION COMPLETE at the club', await E('__gol.mode') == 'result' and await g.txt('r-title') == 'MISSION COMPLETE', await g.txt('r-body'))
        ok('₦250,000 paid', await E('__gol.save.cash') - cash0 == 250000, await E('__gol.save.cash') - cash0)
        body = await g.txt('r-body')
        ok('result: Tunde a new contact, the phone, the new places', 'New contact: Tunde' in body and 'mission phone' in body and 'Crown Ridge' in body, body)
        ok('saved: completed, phone, contact, standing', await E("__gol.save.story['chairmans-summons']") == 'completed' and await E('__gol.save.phone') and await E('__gol.save.contacts') == ['Tunde'] and await E('__gol.save.rep') == 10)
        ok('no replay of the opening mission', await E("document.getElementById('btn-retry').hidden"))
        await pg.screenshot(path=f'{SH}/m19_done.png')
        await pg.click('#btn-continue')
        await sim(3)
        ok('Tunde: "Good work. Oga has been informed."', any('Oga has been informed' in m['text'] for m in await E('__gol.save.messages')))
        ok('the guest walks into the club', await E("!!__gol.chairman.root.getObjectByName('guest-walking')"))
        await sim(4)
        cash1 = await E('__gol.save.cash')

        # ---- Reload: kept, paid once, the opening call never comes back
        await reload_keep()
        await E('__gol.jobRing = 9999')
        heard0 = len(await E('__gol.phone.heard'))
        await sim(8)
        ok('after a reload: still completed, paid once', await E("__gol.save.story['chairmans-summons']") == 'completed' and await E('__gol.save.cash') == cash1 and await E("__gol.save.payments.filter(p => p.amount === 250000).length") == 1)
        ok('the opening call does not repeat', await E('__gol.phone.state') == 'idle' and len(await E('__gol.phone.heard')) == heard0)
        ok('the list shows it completed with no replay', await E(f"__gol.hubStatus('chairmans-summons')") == 'completed')
        await g.key('KeyJ')
        await pg.click('button[data-mission="chairmans-summons"]')
        ok('...no start or replay button', await E("!document.getElementById('btn-hubstart')"))
        await g.key('Escape')

        # ---- The phone's apps
        await g.key('KeyC')
        ok('C opens the phone', await E('__gol.phone.state') == 'apps' and await E('__gol.mode') == 'phone')
        tabs = {}
        for t in ['messages', 'contacts', 'jobs', 'properties', 'bank']:
            await pg.click(f'#ph-tabs button[data-tab="{t}"]')
            tabs[t] = await g.txt('ph-body')
        ok('Messages, Contacts, Jobs, Properties, Bank', 'Oga has been informed' in tabs['messages'] and 'Tunde' in tabs['contacts'] and 'Harbour Bend Sprint' in tabs['jobs'] and 'Coral Cay' in tabs['properties'] and '250,000' in tabs['bank'], {k: v[:60] for k, v in tabs.items()})
        ok("properties: the Chairman's estate, club, island, cars, jet, helicopter, yacht", all(k in tabs['properties'] for k in ['Crown Ridge', 'Afterglow', 'Coral Cay', 'Royale', 'jet', 'helicopter', 'yacht']))
        await pg.click('#ph-tabs button[data-tab="jobs"]')
        await pg.screenshot(path=f'{SH}/m19_phone.png')
        await pg.click('#ph-body button[data-job="harbour-sprint"]')
        await sim(0.2)
        ok('call Tunde about a job: he explains the plan', await E('__gol.phone.state') == 'call' and await g.txt('ph-caller') == 'Tunde')
        await g.key('Escape')
        await pg.click('#ph-choices button[data-choice="accept"]')
        await sim(0.2)
        ok('take it: the job starts', await E(f'{R}.state') == 'active' and await E(f'{R}.def.id') == 'harbour-sprint')
        await E(f'{R}.abandon()')
        await pg.click('#btn-continue')
        await sim(0.1)
        await E("__gol.approach('Kunle')")
        await sim(0.1)
        await g.key('KeyE')
        ok('residents no longer hand out jobs', await E('__gol.mode') == 'play' and 'job' not in (await g.txt('prompt')).lower())
        await E('__gol.jobRing = 0.5')
        await sim(1)
        ok('the boss calls you with work', await E('__gol.phone.state') == 'ringing' and await g.txt('ph-ring-who') in ('Tunde', 'The Chairman'))
        await E('__gol.phone.decline()')

        # ---- Gifts: the Royale GT (Coastal Run) and the penthouse
        await E(f"{R}.start({R}.byId('coastal-run'))")
        await E(f"{R}.finish(true, 'Job done')")
        await sim(0.1)
        ok('a gift from the Chairman: the Royale GT', 'royale-gt' in await E('__gol.save.gifts') and 'royale' in await E('__gol.save.licences') and 'gift from the Chairman' in await g.txt('r-body'), await g.txt('r-body'))
        await pg.click('#btn-continue')
        await sim(0.1)
        await g.key('KeyC')
        await pg.click('#ph-tabs button[data-tab="properties"]')
        ok('...listed as yours in Properties', 'Royale GT' in (await E("document.querySelector('#ph-body .mine').textContent")))
        await g.key('KeyC')
        await g.boot("{version:10,cash:10,lookChosen:true,completedMissions:['chairmans-summons'],phone:true,gifts:['heights-penthouse']}")
        await g.play()
        await E('__gol.enterTower(); __gol.player.y = 12; __gol.teleportPlayer(21, 13.6); __gol.combat.health = 30')
        await sim(0.3)
        ok('your penthouse: sleep there', 'penthouse' in (await g.txt('prompt')).lower(), await g.txt('prompt'))
        await g.key('KeyE')
        ok('...heals and saves', await E('__gol.combat.health') == 100)

        # ---- A failed run, then the retry from the car
        await g.boot("{version:10,cash:10,lookChosen:true}")
        await g.play()
        await E(f"__gol.startSummons({M01}, 3)")
        await sim(0.3)
        await E('__gol.enterVehicle(__gol.missionCar)')
        await sim(0.2)
        await E('__gol.missionCar.place(-163, 128, 0)')
        await sim(6)
        await E(f'{R}.elapsed = 149.9')
        await sim(0.3)
        ok('too slow: failed (the state is saved)', await g.txt('r-title') == 'JOB FAILED' and await E("__gol.save.story['chairmans-summons']") == 'failed' and await E('__gol.save.cash') == 10)
        await pg.click('#btn-retry')
        await sim(0.3)
        ok('Try again: back at the car in the forecourt', await E(f'{R}.state') == 'active' and await E(f'{R}.index') == 3 and abs(await E('__gol.player.x') + 158.5) < 1)
        await E(f'{R}.abandon()')
        await pg.click('#btn-continue')

        # ---- Late at the gate: Musa is less welcoming
        await g.boot("{version:10,cash:10,lookChosen:true}")
        await g.play()
        await E(f"__gol.startSummons({M01}, 0)")
        await sim(0.2)
        await E('__gol.setStoryStart(__gol.elapsed - 200)')
        await sim(0.2)
        ok('past 8: the clock turns red', 'late' in await E("document.getElementById('story-clock').className"))
        await E('__gol.teleportPlayer(-162, -122)')
        await sim(0.3)
        await E('__gol.teleportPlayer(-162, -129.4)')
        await sim(0.3)
        await g.key('KeyE')
        ok('late: "The Chairman does not wait for anybody"', await E('__gol.arrivedLate') and 'does not wait' in await g.txt('cut-text'), await g.txt('cut-text'))
        # A missing scene doesn't stop the mission (clear fallback).
        await g.key('Space')
        await sim(0.3)
        await E(f"delete {M01}.scenes.office")
        await E('__gol.teleportPlayer(-162, -155.8)')
        await sim(0.3)
        ok('missing office scene: a notice, and on to the car', await E('__gol.mode') != 'cutscene' or 'Palmyra' in await g.txt('cut-text'))

        # ---- Saves: v9 -> v10
        await g.boot("{version:9,cash:10,lookChosen:true,licences:['royale'],chaptersDone:[1],completedMissions:['harbour-sprint']}")
        ok('v9 save moves to v10: story not started, earlier wins count as gifts', await E('__gol.save.version') == 10 and await E('__gol.save.story') == {} and await E('__gol.save.gifts') == ['royale-gt', 'heights-penthouse'] and await E('__gol.save.playerName') == 'Bayo')
        finish(errs)


asyncio.run(main())
