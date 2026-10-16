"""Bayo's model kit: the GLBs load; Green Suit as a playable look (bottle hidden, walks) and as Remi in
the Night Exit briefing; the Royale GT (locked until the Coastal Run, wheels spin and steer, brake
lights, drives) with its built fallback body; the EKO K7 as the rifle in hand with a magazine-drop
reload; and saves that already won the Coastal Run get the Royale (v6 -> v7)."""
import asyncio
from gol import browser, ok, finish, save, SH

G = '__gol.player.rig.green'
RV = '__gol.royale.royale'


async def hold(g, keys, secs):
    for k in keys:
        await g.pg.keyboard.down(k)
    await g.sim(secs)
    for k in keys:
        await g.pg.keyboard.up(k)


async def main():
    async with browser() as (g, errs):
        E, pg = g.E, g.pg
        await g.boot(save(cash=50000, medal=3, owned=['harmattan'], ammo={'harmattan': 120}))
        await g.play()
        await E('__gol.setTraffic(0)')
        ok('all four kit models load', sorted(await E('__gol.models.loaded')) == ['blk-king', 'eko-k7', 'green-suit', 'royale-gt'], await E('__gol.models.loaded'))

        # ---- Green Suit
        await E("__gol.equip('top', 'top-greensuit')")
        ok('Green Suit outfit shows his model', await E('__gol.player.rig.mode') == 'greensuit' and await E(f'{G}.root.visible') and not await E('__gol.player.rig.blk.root.visible') and await E('__gol.player.rig.greenError') is None)
        ok('his bottle prop is hidden', await E(f"{G}.model.getObjectByName('prop_bottle').visible") is False)
        tall = await E(f"(() => {{ const b = new __gol.THREE.Box3().setFromObject({G}.model); return b.max.y - b.min.y; }})()")
        ok('about 1.9 m tall', 1.82 < tall < 1.98, round(tall, 3))
        await g.sim(1)
        ok('standing on the ground (his own leg lengths)', all(abs(h) < 0.02 for h in await E(f'{G}.soleHeights()')), await E(f'{G}.soleHeights()'))
        await pg.keyboard.down('KeyW')
        await g.sim(1)
        hips, soles = [], []
        for _ in range(20):
            await g.sim(0.033)
            hips.append(await E(f'{G}.joints.hip_L.rotation.x'))
            soles.append(min(await E(f'{G}.soleHeights()')))
        await pg.keyboard.up('KeyW')
        ok('walk moves the hip joints', max(hips) - min(hips) > 0.5, [round(min(hips), 2), round(max(hips), 2)])
        ok('walking: a foot stays on the ground', min(soles) > -0.03 and max(soles) < 0.04, [round(min(soles), 3), round(max(soles), 3)])
        await g.sim(0.5)
        await E("__gol.lookAt(__gol.player.x + 3.2, 1.3, __gol.player.z + 1.2, __gol.player.x, 1.0, __gol.player.z)")
        await pg.screenshot(path=f'{SH}/m14_greensuit.png')
        await E('__gol.freeCam()')

        # ---- EKO K7 as the rifle
        await g.key('Digit5')
        await g.sim(0.6)
        await E("__gol.lookAt(__gol.player.x + 1.2, 1.5, __gol.player.z + 1.6, __gol.player.x, 1.1, __gol.player.z)")
        await pg.screenshot(path=f'{SH}/m14_eko.png')
        await E('__gol.freeCam()')
        ok('Harmattan rifle drawn as the EKO K7', await E('__gol.weapons.drawn') == 'harmattan' and await E('__gol.models.held && __gol.models.held.name') == 'eko-k7')
        ok('held in his right hand', await E(f"{G}.joints.hand_R.children.some(c => c.children.some(k => k.name === 'eko-k7'))"))
        mag = "__gol.models.held.getObjectByName('magazine').position.y"
        y0 = await E(mag)
        await E('__gol.fire()')
        await g.sim(0.2)
        await g.key('KeyR')
        ok('R reloads', await E('__gol.weapons.reloading') > 0)
        await g.sim(0.5)
        y1 = await E(mag)
        ok('reload drops the magazine', y1 < y0 - 0.1, [round(y0, 3), round(y1, 3)])
        await g.sim(2)
        ok('...and puts it back', abs(await E(mag) - y0) < 0.005 and await E('__gol.weapons.reloading') == 0, await E(mag))
        await E("__gol.weapons.draw(null)")
        await g.sim(0.2)
        await E("__gol.equip('top', 'top-blkkng')")
        ok('BLK KNG outfit back', await E('__gol.player.rig.mode') == 'blkking')

        # ---- Royale GT
        ok('Royale GT parked on the square with its model', await E('__gol.royale.kind') == 'royale' and await E(f'{RV} !== null') and await E("__gol.royale.group.getObjectByName('royale-gt') !== undefined"))
        nodes = await E(f"['wheel_FL','wheel_FR','wheel_RL','wheel_RR','wheel_FL_steer','wheel_FR_steer','steering_wheel'].map(n => !!{RV}.model.getObjectByName(n))")
        ok('wheel, steer and steering-wheel nodes exist', all(nodes), nodes)
        size = await E(f"(() => {{ const b = new __gol.THREE.Box3().setFromObject({RV}.root); return [b.max.x - b.min.x, b.max.z - b.min.z]; }})()")
        ok('faces along +X like the other cars (5.3 m long, mirrors out)', 5.0 < size[0] < 5.5 and 1.8 < size[1] < 2.35, size)
        await E("__gol.teleportPlayer(__gol.royale.x, __gol.royale.z - 2.0)")
        await g.sim(0.2)
        ok('prompt says locked', 'Royale GT (locked)' in await g.txt('prompt'), await g.txt('prompt'))
        await g.key('KeyE')
        ok('locked until you win the Coastal Run', not await E('__gol.inVehicle') and 'Coastal Run' in await g.txt('notice'), await g.txt('notice'))
        await E("__gol.save.licences.push('royale')")
        await g.key('KeyE')
        ok('unlocked: you can drive it', await E('__gol.inVehicle') and await E('__gol.player.rig.seated'))
        fl0 = await E(f'{RV}.wheelFL.rotation.x')
        await pg.keyboard.down('KeyW'); await pg.keyboard.down('KeyD')
        await g.sim(1.2)
        steer = await E(f"{RV}.model.getObjectByName('wheel_FL_steer').rotation.y")
        await pg.keyboard.up('KeyD')
        await g.sim(0.6)
        fl1 = await E(f'{RV}.wheelFL.rotation.x')
        ok('wheels spin as it drives (wheel_FL.rotation.x)', fl1 - fl0 > 3, [round(fl0, 2), round(fl1, 2)])
        ok('front wheels steer right (negative y in the model)', steer < -0.2, steer)
        ok('it is quick', await E('__gol.royale.kmh') > 40, await E('__gol.royale.kmh'))
        tail = f"{RV}.model.getObjectByName('taillight_led').material.emissiveIntensity"
        off = await E(tail)
        await pg.keyboard.up('KeyW'); await pg.keyboard.down('KeyS')
        await g.sim(0.2)
        on = await E(tail)
        await pg.screenshot(path=f'{SH}/m14_royale.png')
        await pg.keyboard.up('KeyS')
        ok('brake lights come on when braking', on > off + 1, [off, on])
        await hold(g, ['Space'], 3)
        await E('__gol.leaveVehicle(true)')
        await g.sim(0.3)
        await E("__gol.lookAt(__gol.royale.x + 4, 1.6, __gol.royale.z + 5, __gol.royale.x, 0.6, __gol.royale.z)")
        await pg.screenshot(path=f'{SH}/m14_royale_side.png')
        await E('__gol.freeCam()')
        # The built body is the fallback while the model is missing.
        hidden = await E("__gol.royale.group.children.filter(c => c.name !== 'royale-gt' && c.type === 'Mesh' && c.visible && c.geometry.type !== 'SphereGeometry').length")
        ok('built body hidden under the model', hidden == 0, hidden)

        # ---- Remi in the Night Exit briefing is Green Suit
        await E("__gol.beginIntro(__gol.runner().byId('night-exit'))")
        await g.sim(0.3)
        ok('Remi is played by Green Suit in the briefing', await E("__gol.cutscene.actor('remi').root.name") == 'cut-remi' and await E("!!__gol.cutscene.actor('remi').joints"))
        ok('...bottle hidden there too', await E("__gol.cutscene.actor('remi').model.getObjectByName('prop_bottle').visible") is False)
        await g.sim(3)
        await pg.screenshot(path=f'{SH}/m14_remi.png')
        await g.key('Space')

        # ---- Saves: won the Coastal Run before the Royale existed -> you get it.
        await g.boot(save(completed=['coastal-run']))
        ok('v4 save that won the Coastal Run migrates to v7 with the Royale', await E('__gol.save.version') == 7 and 'royale' in await E('__gol.save.licences'))
        await g.boot(save())
        ok('...and one that did not stays locked', 'royale' not in await E('__gol.save.licences'))

        # ---- Fallback: no models served -> the built bodies.
        await pg.route('**/models/*', lambda r: r.abort())
        await g.boot()
        await g.play()
        ok('without the kit: box Royale, built rifle, nearest Green Suit look', await E(f'{RV} === null') and await E("__gol.royale.group.children.some(c => c.visible && c.type === 'Mesh')") and await E('__gol.player.rig.greenError') is not None and await E('__gol.player.rig.mode') == 'hero')
        await E("__gol.equip('top', 'top-greensuit')")
        ok('Green Suit outfit falls back to the older figure', await E('__gol.player.rig.mode') == 'basic')
        await pg.unroute('**/models/*')
        errs[:] = [e for e in errs if 'models' not in e and 'model' not in e.lower()]
        finish(errs)


asyncio.run(main())
