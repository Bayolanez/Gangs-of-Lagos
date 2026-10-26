"""Lagos People (Bayo's kit): one shared skeleton with 43 animations (Quaternius Universal Animation
Library, CC0) dressed by human.js. The GLB loads; spawn() gives a person with every clip; play('Walk_Loop')
moves the thigh_l bone; the player's Lagos fits in the wardrobe (men's and women's) in your skin tone; sitting
on a chair; a crew bandana on the new head; the residents near you shown as Lagos People in their own fits (the
rest as the light older figure), walking, talking and falling; and the fallback when the skeleton can't load."""
import asyncio
from gol import browser, ok, finish, save, SH

P = '__gol.player.rig.people'
L = '__gol.people.lib'


async def main():
    async with browser() as (g, errs):
        E, pg, sim = g.E, g.pg, g.sim
        await g.boot(save(cash=500))
        await g.play()
        await E("__gol.setTraffic(0); __gol.env.setTimeMode('day'); __gol.env.setWeatherMode('clear'); __gol.storyRing = 9999; __gol.jobRing = 9999")

        # ---- The library
        clips = await E(f'{L}.clips')
        ok('the skeleton GLB loads with 43 animations', await E('__gol.people.error') is None and len(clips) == 43, len(clips))
        ok('...including walk, sprint, jump, driving, sitting, talking, dance, punches, pistol, hit and death', all(c in clips for c in ['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Jump_Loop', 'Driving_Loop', 'Sitting_Idle_Loop', 'Idle_Talking_Loop', 'Dance_Loop', 'Punch_Cross', 'Pistol_Aim_Neutral', 'Hit_Chest', 'Death01']))
        t = await E(f"(() => {{ const p = {L}.spawn({{ fit: 'senator', skin: 'dark', build: 'average' }}); __gol.scene.add(p.root); p.root.position.set(__gol.player.x + 2, 0, __gol.player.z); window.__p = p; return p.mixer._actions.length; }})()")
        ok('spawn() returns a dressed person playing a clip', await E('__p.clip') == 'Idle_Loop' and t >= 1)
        q0 = await E('__p.bones.thigh_l.quaternion.toArray()')
        await E("__p.play('Walk_Loop', 0)")
        qs = []
        for _ in range(12):
            qs.append(await E('(__p.mixer.update(0.08), __p.bones.thigh_l.quaternion.toArray())'))
        swing = max(max(abs(q[i] - q0[i]) for q in qs) for i in range(4))
        ok("play('Walk_Loop') changes the thigh_l bone's pose (the leg swings)", swing > 0.08, round(swing, 3))
        await E('__p.root.removeFromParent()')

        # ---- The player's fits (wardrobe)
        await E("__gol.equip('top', 'top-fit-agbada')")
        await sim(0.3)
        ok('wardrobe: the agbada fit is a Lagos People body', await E('__gol.player.rig.mode') == 'people' and await E(f'{P}.fit') == 'agbada')
        sk0 = await E(f"(() => {{ let c = null; {P}.model.traverse(o => {{ if (!c && o.material && /^skin_/.test(o.material.name || '')) c = o.material.name; }}); return c; }})()")
        await E("__gol.equip('skin', 'skin-4')")
        await sim(0.2)
        sk1 = await E(f"(() => {{ let c = null; {P}.model.traverse(o => {{ if (!c && o.material && /^skin_/.test(o.material.name || '')) c = o.material.name; }}); return c; }})()")
        ok('...in your skin tone', sk0 != sk1, [sk0, sk1])
        await pg.screenshot(path=f'{SH}/m20_agbada.png')
        await E("__gol.equip('top', 'top-fit-ankara')")
        await sim(0.3)
        ok("women's fits too (ankara dress and gele)", await E(f'{P}.fit') == 'ankara')
        await pg.keyboard.down('KeyW')
        await sim(1)
        ok('...and she walks', await E(f'{P}.clip') == 'Walk_Loop')
        await pg.keyboard.up('KeyW')
        await sim(0.5)
        await E("__gol.equip('top', 'top-blkkng')")
        await sim(0.3)
        ok('BLK KNG again: the same built body is reused', await E(f'{P}.fit') == 'blk_kng' and await E('__gol.player.rig.mode') == 'people')

        # ---- Sitting on a chair (cutscenes) and a bandana on the new head
        await E("__gol.player.rig.seated = true; __gol.player.rig.seatKind = 'chair'")
        await sim(0.4)
        ok('sits on a chair (Sitting_Idle_Loop)', await E(f'{P}.clip') == 'Sitting_Idle_Loop')
        await E("__gol.player.rig.seated = false; __gol.player.rig.seatKind = 'car'")
        await sim(0.4)
        await E("__gol.player.rig.setBandana('#1f6fd1')")
        ok('a crew bandana sits on the Lagos People head', await E(f"!!{P}.bones.Head.getObjectByName('bandana')"))
        await E('__gol.player.rig.setBandana(null)')

        # ---- Residents
        await E("__gol.teleportPlayer(-40, 60)")
        await sim(1.5)
        shown = await E('__gol.people.shown')
        ok('residents near you are Lagos People (at most 12)', 1 <= len(shown) <= 12, shown)
        far = await E("__gol.residents.filter(r => !r.showingBody).map(r => r.name)")
        ok('...the rest stay the light older figure', len(far) >= 1, far)
        for _ in range(16):
            await sim(0.5)
        shown = await E('__gol.people.shown')
        ok('...built one at a time, up to the nearest 12', len(shown) >= 3 and await E("__gol.residents.filter(r => r.showingBody).every(r => !!r.body && r.body.root.visible)"), shown)
        looks = await E("__gol.residents.filter(r => r.body).map(r => [r.name, r.body.fit])")
        titi = [f for n, f in looks if n == 'Mama Titi']
        ok('each resident has their own fit (Mama Titi in buba and wrapper)', not titi or titi[0] == 'buba', looks)
        await E("__gol.approach('Mama Titi')")
        await sim(1.5)
        ok('Mama Titi as Lagos People', await E("__gol.residents.find(r => r.name === 'Mama Titi').showingBody"))
        await g.key('KeyE')
        await sim(0.3)
        ok('greeted: she talks (Idle_Talking_Loop)', await E("__gol.residents.find(r => r.name === 'Mama Titi').body.clip") == 'Idle_Talking_Loop')
        await E("(() => { const r = __gol.residents.find(r => r.name === 'Mama Titi'); __gol.lookAt(r.x + 2.6, 1.5, r.z + 1.2, r.x, 1, r.z); })()")
        await pg.screenshot(path=f'{SH}/m20_titi.png')
        await E('__gol.freeCam()')
        walking = await E("__gol.residents.filter(r => r.showingBody && r.body.clip === 'Walk_Loop').length")
        for _ in range(10):
            if walking:
                break
            await sim(1)
            walking = await E("__gol.residents.filter(r => r.showingBody && r.body.clip === 'Walk_Loop').length")
        ok('residents walk with the walk cycle', walking >= 1, walking)
        await E("(() => { const r = __gol.residents.find(r => r.name === 'Mama Titi'); r.knockDown(r.x - 3, r.z); })()")
        await sim(1)
        ok('knocked down: she falls (Death01), upright root', await E("__gol.residents.find(r => r.name === 'Mama Titi').body.clip") == 'Death01' and await E("__gol.residents.find(r => r.name === 'Mama Titi').rig.root.rotation.z") == 0)

        # ---- Fallback: no skeleton
        await pg.route('**/models/UAL1_Standard.glb*', lambda r: r.abort())
        await g.boot(save(cash=10))
        await g.play()
        await E("__gol.equip('top', 'top-blkkng')")
        await sim(2)
        ok('without Lagos People: the BLK KNG model plays the player', await E('__gol.people.error') is not None and await E('__gol.player.rig.mode') == 'blkking')
        ok('...and residents keep the older figure', await E('__gol.people.shown') == [])
        await E("__gol.equip('top', 'top-fit-senator')")
        ok('...a Lagos fit falls back to the nearest older look', await E('__gol.player.rig.mode') == 'basic')
        await pg.unroute('**/models/UAL1_Standard.glb*')
        errs[:] = [e for e in errs if 'UAL1_Standard' not in e and 'model' not in e.lower() and 'ERR_FAILED' not in e]
        finish(errs)


asyncio.run(main())
