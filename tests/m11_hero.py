"""The code-built lead character (src/hero.ts): loads as the default look, has a jointed hierarchy,
idles, walks, runs and jumps with the feet on the ground, holds a weapon, sits in a car and gets out,
and falls back to the older rig for other outfits, with ?classic, or if the hero fails to build."""
import asyncio, math
from gol import browser, ok, finish, SH

HERO = "__gol.player.rig.hero"
J = HERO + ".joints"


async def hold(g, keys, secs):
    for k in keys:
        await g.pg.keyboard.down(k)
    await g.sim(secs)
    for k in keys:
        await g.pg.keyboard.up(k)


async def sample(g, n, js, dt=0.033):
    out = []
    for _ in range(n):
        await g.sim(dt)
        out.append(await g.E(js))
    return out


async def view(g, name, side, d=2.4):
    p = await g.E('(() => { const r = __gol.player.rig.root; return { x: r.position.x, y: r.position.y, z: r.position.z, h: -r.rotation.y }; })()')
    a = p['h'] + side
    await g.E(f"__gol.lookAt({p['x'] + math.cos(a) * d}, {p['y'] + 1.15}, {p['z'] + math.sin(a) * d}, {p['x']}, {p['y'] + 0.95}, {p['z']})")
    await g.pg.screenshot(path=f'{SH}/m11_{name}.png')
    await g.E('__gol.freeCam()')


async def main():
    async with browser() as (g, errs):
        E = g.E
        await g.boot()
        await g.pg.click('#btn-play')
        await g.pg.wait_for_timeout(200)
        ok('new game: the creator starts on the Signature look', (await E('__gol.save.outfit'))['top'] == 'top-signature')
        await g.pg.click('#btn-wdone')
        await g.sim(0.1)
        await E('__gol.setTraffic(0)')
        ok('the player is the code-built hero', await E('__gol.player.rig.mode') == 'hero' and await E(HERO + '.root.visible') and not await E('__gol.player.rig.basic.root.visible'))
        joints = await E(f"Object.keys({J})")
        ok('jointed hierarchy (pelvis, spine, chest, neck, head, arms, elbows, hands, legs, knees, ankles)', len(joints) == 17, joints)
        nest = await E(f"{J}.handR.parent === {J}.elbowR && {J}.elbowR.parent === {J}.armR && {J}.armR.parent === {J}.spine && {J}.ankleL.parent === {J}.kneeL && {J}.kneeL.parent === {J}.legL && {J}.head.parent === {J}.neck")
        ok('limbs hang from their joints', nest)
        meshes = await E(f"(() => {{ let n = 0; {HERO}.root.traverse(o => {{ if (o.isMesh) n++; }}); return n; }})()")
        ok('built from many small meshes (hair, face, hoodie, jacket, chain, cargo pockets, trainers)', meshes > 120, meshes)
        tall = await E(f"(() => {{ const b = new __gol.THREE.Box3().setFromObject({HERO}.root); return b.max.y - b.min.y; }})()")
        ok('about 1.8 m tall', 1.74 < tall < 1.88, round(tall, 3))
        textures = await E(f"(() => {{ let t = 0; {HERO}.root.traverse(o => {{ if (o.isMesh && o.material.map) t++; }}); return t; }})()")
        ok('no image textures (colours only)', textures == 0, textures)

        # Idle: breathing and a weight shift, feet on the ground.
        await g.sim(1)
        idle = await sample(g, 20, f"[{J}.chest.scale.y, {J}.pelvis.position.z, ...{HERO}.soleHeights()]", 0.1)
        ok('idle breathing', max(s[0] for s in idle) - min(s[0] for s in idle) > 0.008)
        ok('idle weight shift', max(s[1] for s in idle) - min(s[1] for s in idle) > 0.01)
        ok('idle feet on the ground', all(abs(s[2]) < 0.02 and abs(s[3]) < 0.02 for s in idle), idle[-1][2:])
        await view(g, 'front', 0)
        await view(g, 'side', math.pi / 2)
        await view(g, 'back', math.pi)

        # Walk and run: alternating swings, the standing foot stays down, a forward lean when running.
        res = {}
        for mode, keys in [('walk', ['KeyW']), ('run', ['KeyW', 'ShiftLeft'])]:
            for k in keys:
                await g.pg.keyboard.down(k)
            await g.sim(1)
            s = await sample(g, 40, f"[__gol.player.speed, {J}.legR.rotation.z, {J}.armR.rotation.z, {J}.spine.rotation.z, Math.min(...{HERO}.soleHeights())]")
            await view(g, mode, math.pi / 2, 3)
            for k in keys:
                await g.pg.keyboard.up(k)
            res[mode] = {
                'speed': s[-1][0],
                'legs': max(x[1] for x in s) - min(x[1] for x in s),
                'arms': max(x[2] for x in s) - min(x[2] for x in s),
                'alternate': max(x[1] for x in s) > 0.2 and min(x[1] for x in s) < -0.2,
                'lean': sum(x[3] for x in s) / len(s),
                'ground': (min(x[4] for x in s), max(x[4] for x in s)),
            }
            await g.sim(1)
        w, r = res['walk'], res['run']
        ok('walk: legs alternate and arms swing', w['alternate'] and w['arms'] > 0.4, w)
        ok('walk: the standing foot stays on the ground', -0.02 < w['ground'][0] and w['ground'][1] < 0.03, w['ground'])
        ok('run: faster and wider swings than walking', r['speed'] > w['speed'] + 2 and r['legs'] > w['legs'] and r['arms'] > w['arms'], r)
        ok('run: forward lean', r['lean'] < -0.14 and w['lean'] > -0.1, [w['lean'], r['lean']])
        ok('run: the lower foot stays near the ground (small bounce)', -0.02 < r['ground'][0] and r['ground'][1] < 0.07, r['ground'])

        # Stopping blends back to idle (no snap: one frame later the legs are still partway).
        await hold(g, ['KeyW', 'ShiftLeft'], 1)
        await g.sim(0.033)
        mid = await E(f"Math.abs({J}.legR.rotation.z) + Math.abs({J}.legL.rotation.z)")
        await g.sim(1.5)
        rest = await E(f"Math.abs({J}.legR.rotation.z) + Math.abs({J}.legL.rotation.z)")
        ok('stopping settles back to idle', rest < 0.05, [mid, rest])

        # Jump / fall pose.
        await E('__gol.player.vy = 4.6')
        await g.sim(0.1)
        air = await E(f"[__gol.player.y, {J}.legR.rotation.z, {J}.kneeR.rotation.z, {J}.armR.rotation.x]")
        ok('jump: knee tucked, arms out', air[0] > 0.2 and air[1] > 0.25 and air[2] < -0.5 and air[3] < -0.25, air)
        await g.sim(1.2)
        ok('lands on its feet', await E('__gol.player.y') == 0 and abs(await E(f"Math.min(...{HERO}.soleHeights())")) < 0.02)

        # Talking to someone still works.
        await g.talk('Kunle')
        m = await E('__gol.mode')
        ok('interactions still work (talk to Kunle)', m != 'play', m)
        await g.pg.keyboard.press('Escape')
        await g.sim(0.2)
        ok('back to play after talking', await E('__gol.mode') == 'play', await E('__gol.mode'))

        # A pistol goes in the right hand and he raises it to aim.
        await E("__gol.save.weapons.owned.push('egret'); __gol.save.weapons.ammo.egret = 24")
        await g.pg.focus('#game')
        await g.key('Digit2')
        await g.sim(0.6)
        held = await E(f"{J}.handR.children.length > 0")
        await E('__gol.fire()')  # firing raises the gun for a moment, as aiming does
        await g.sim(0.3)
        aimz = await E(f"{J}.armR.rotation.z")
        ok('weapon sits in the hero\'s right hand', held)
        ok('aiming raises the gun arm', aimz > 1.3, aimz)

        # Vehicle: sit at the wheel, then get out on foot.
        await E('__gol.enterVehicle(__gol.hatch)')
        await g.sim(1)
        seat = await E(f"[__gol.inVehicle, __gol.player.visible, __gol.player.rig.seated, {J}.legR.rotation.z, {J}.kneeR.rotation.z]")
        ok('seated pose in the car', seat[0] == 'hatchback' and seat[1] and seat[2] and abs(seat[3] - 1.45) < 0.05 and abs(seat[4] + 1.35) < 0.05, seat)
        await view(g, 'seated', -1.2, 2.6)
        await E('__gol.leaveVehicle()')
        await g.sim(1)
        out = await E(f"[__gol.inVehicle, __gol.player.rig.seated, Math.min(...{HERO}.soleHeights()), {J}.legR.rotation.z]")
        ok('gets out and stands on the ground', out[0] is None and not out[1] and abs(out[2]) < 0.02 and abs(out[3]) < 0.1, out)

        # Other outfits use the older rig; the Signature look brings the hero back.
        await E("__gol.equip('top', 'top-tee')")
        ok('other outfits use the older rig', await E('__gol.player.rig.mode') == 'basic' and await E('__gol.player.rig.basic.root.visible') and not await E(HERO + '.root.visible'))
        await E("__gol.equip('top', 'top-signature'); __gol.equip('hat', 'hat-cap-red')")
        ok('Signature look brings the hero back, with headwear', await E('__gol.player.rig.mode') == 'hero' and await E(HERO + '.root.visible'))
        ok('the drawn weapon follows to the showing body', await E(f"{J}.handR.children.length > 0"))
        await E("__gol.equip('hat', 'hat-none')")

        # Fallback if the hero cannot be built.
        await E("(() => { const r = __gol.player.rig; r.hero.root.removeFromParent(); r.hero = null; r.heroError = 'test'; __gol.equip('top', 'top-signature'); })()")
        ok('falls back to the placeholder rig if the hero fails', await E('__gol.player.rig.mode') == 'basic' and await E('__gol.player.rig.basic.root.visible'))
        await g.pg.keyboard.down('KeyW')
        await g.sim(0.5)
        sp = await E('__gol.player.speed')
        await g.pg.keyboard.up('KeyW')
        ok('the fallback still walks', sp > 2, sp)

        # ?classic forces the older rig.
        await g.pg.goto(g.pg.url.split('?')[0] + '?debug&classic')
        await g.pg.wait_for_function("!document.getElementById('btn-play').disabled", timeout=90000)
        await g.play()
        ok('?classic shows the older placeholder rig', await E('__gol.player.rig.mode') == 'basic' and await E('__gol.player.rig.hero') is None)
        finish(errs)


asyncio.run(main())
