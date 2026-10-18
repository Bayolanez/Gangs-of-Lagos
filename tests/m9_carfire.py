"""Car fires, hijacking and jobs that survive losing a car."""
import asyncio
from gol import browser, ok, finish, save, SH

# Every thin solid prop (pole, lamp, palm trunk) standing on a road surface; tall map-edge barriers excluded.
POLES_ON_ROADS = """(() => {
  const L=[-120,-40,40,120], W=12, MX=[232,312], MZ=[-100,40,120];
  const onRoad=(x,z)=>{
    if (x>=-200 && x<=140 && z>=-200 && z<=200) { if (L.some(l=>Math.abs(x-l)<W/2) || L.some(l=>Math.abs(z-l)<W/2)) return 'hb'; }
    if (x>=220 && x<=360 && z>=-140 && z<=160) { if (MX.some(l=>Math.abs(x-l)<W/2) || MZ.some(l=>Math.abs(z-l)<W/2 && x>=226)) return 'mp'; }
    if (x>140 && x<220 && Math.abs(z-40)<W/2) return 'bridge';
    if (x>360 && x<560 && Math.abs(z-40)<W/2) return 'causeway';
    return null; };
  const out=[];
  for (const b of __gol.world.boxes) { const w=b.maxX-b.minX, d=b.maxZ-b.minZ; if (b.off) continue; if (Math.min(w,d) > 1.2 || b.height < 1.0 || b.height===40) continue;
    const cx=(b.minX+b.maxX)/2, cz=(b.minZ+b.maxZ)/2, r=onRoad(cx,cz); if (r) out.push([r, +cx.toFixed(1), +cz.toFixed(1), +w.toFixed(2), +d.toFixed(2), +b.height.toFixed(1)]); }
  return out; })()"""


async def hold(g, keys, secs):
    for k in keys:
        await g.pg.keyboard.down(k)
    await g.sim(secs)
    for k in keys:
        await g.pg.keyboard.up(k)


async def main():
    async with browser() as (g, errs):
        E = g.E
        await g.boot(save(cash=5000, completed=['harbour-sprint']))
        await g.play()
        await E('__gol.setTraffic(0)')

        # Cars last much longer: a hard hit leaves the sedan running.
        await E('__gol.enterVehicle(__gol.saloon)')
        await E('__gol.teleportVehicle(__gol.saloon, -160, -40, Math.PI / 2)')
        await hold(g, ['KeyW'], 4)
        hp = await E('__gol.saloon.healthPct')
        ok('a full-speed crash into a wall only dents the car', 0.6 < hp < 1, hp)
        await hold(g, ['Space'], 0.5)
        await g.key('KeyE')

        # Stay inside a burning car: it goes up with you in it.
        await E('__gol.enterVehicle(__gol.saloon)')
        await E('__gol.saloon.damage(9999)')
        await g.sim(0.3)
        ok('a car at zero health catches fire', await E('__gol.fires.has(__gol.saloon)') and await E('__gol.saloon.burning'))
        ok('prompt tells you to get out', 'fire' in (await g.txt('prompt')).lower(), await g.txt('prompt'))
        await g.pg.screenshot(path=f'{SH}/m9_fire.png')
        await g.sim(8)
        ok('still inside when it burns out: you go down (hospital)', await E('__gol.mode') == 'result' and 'still inside' in await g.txt('r-body'), await g.txt('r-body'))
        ok('the burnt car is gone from the street', not await E('__gol.saloon.group.visible'))
        await g.pg.click('#btn-continue'); await g.sim(0.2)

        # Get out in time: you live, the car disappears, and it comes back later.
        await E('__gol.teleportPlayer(__gol.danfo.x - 3, __gol.danfo.z)')
        await E('__gol.enterVehicle(__gol.danfo)')
        await E('__gol.danfo.damage(9999)'); await g.sim(0.3)
        await g.key('KeyE')
        ok('you can always get out of a burning car', await E('__gol.inVehicle') is None)
        hp0 = await E('__gol.combat.health')
        await E('(() => { const v = __gol.danfo; __gol.teleportPlayer(v.x + 12, v.z); })()')
        await g.sim(8)
        ok('out of the car: you survive and it vanishes', await E('__gol.mode') == 'play' and not await E('__gol.danfo.group.visible') and await E('__gol.combat.health') > 0, hp0)
        await g.sim(31)
        ok('the town danfo comes back to the bus park later', await E('__gol.danfo.group.visible') and await E('__gol.danfo.healthPct') == 1)

        # Hijack a car on the road: the driver is pulled out and you drive off.
        await E('__gol.setTraffic(8)'); await E('__gol.teleportPlayer(0, 0)'); await g.sim(3)
        v = await E("(() => { const v = __gol.traffic.vehicles()[0]; return v ? { kind: v.kind, id: v.id } : null; })()")
        ok('traffic is running', v is not None)
        before = await E('__gol.traffic.activeCount')
        await E(f"(() => {{ const v = __gol.traffic.vehicles().find(k => k.id === {v['id']}); const lx = Math.sin(v.heading), lz = -Math.cos(v.heading); __gol.teleportPlayer(v.x + lx * 1.9, v.z + lz * 1.9); }})()")
        await g.sim(0.02)
        ok('prompt offers to hijack the car', 'Hijack' in await g.txt('prompt'), await g.txt('prompt'))
        await g.pg.keyboard.press('KeyE'); await g.sim(0.1)
        ok('E hijacks it: you are driving it', await E('__gol.inVehicle') == v['kind'] and await E(f"__gol.stolen.some(k => k.id === {v['id']})"))
        ok('the driver is pulled out and runs off', await E('__gol.fleeingCount') == 1)
        ok('traffic no longer drives it', not await E(f"__gol.traffic.vehicles().some(k => k.id === {v['id']})"))
        await hold(g, ['KeyW'], 1.5)
        ok('the hijacked car drives', await E('Math.abs(__gol.fleet.find(k => k.id === ' + str(v['id']) + ').speed)') > 3)
        await g.sim(6)
        ok('the fleeing driver is gone after a few seconds', await E('__gol.fleeingCount') == 0)
        await g.key('KeyE')

        # The parked design-board cars are drivable now too.
        await E('__gol.setTraffic(0)')
        await E('__gol.stolen.forEach((k, i) => __gol.teleportVehicle(k, 60 + i * 8, -80, 0))')
        await E('__gol.teleportPlayer(-2, 26.2)'); await g.sim(0.1)
        ok('parked coupe can be driven', 'Drive the sport coupe' in await g.txt('prompt'), [await g.txt('prompt'), await E('__gol.inVehicle'), await E('__gol.fleet.map(k => [k.kind, Math.round(k.x), Math.round(k.z)])')])
        await g.key('KeyE')
        ok('in the coupe', await E('__gol.inVehicle') == 'coupe')
        await g.key('KeyE')

        # A job survives losing the car: Market Run continues in another vehicle.
        await g.take_job('market-run')
        await E('__gol.teleportPlayer(-74, 61)'); await g.sim(0.3)
        await E('__gol.teleportVehicle(__gol.hatch, -40, -60, Math.PI)'); await E('__gol.enterVehicle(__gol.hatch)'); await g.sim(0.2)
        ok('job running with the parcel in the car', (await E('__gol.mission'))['state'] == 'active')
        await E('__gol.hatch.damage(9999)'); await g.sim(0.3)
        await g.key('KeyE'); await g.sim(8)
        m = await E('__gol.mission')
        ok('the job is NOT cancelled when the car burns out', m['state'] == 'active', m)
        await E('__gol.teleportPlayer(-12, 26.0)'); await g.sim(0.1); await g.key('KeyE')
        ok('carry on in another car (the minibus)', await E('__gol.inVehicle') == 'minibus')
        await E('__gol.teleportVehicle(__gol.fleet.find(k => k.kind === "minibus"), 123, -150, Math.PI / 2)'); await g.sim(0.5)
        ok('delivered in the new car: job passes', (await E('__gol.mission'))['state'] == 'result' and 'PAID' in (await g.txt('r-title')).upper() or 'DELIVER' in (await g.txt('r-title')).upper(), await g.txt('r-title'))
        poles = [p for p in await E(POLES_ON_ROADS) if p[5] > 1.5]
        ok('no poles, lamps or trunks standing in any road', not poles, poles)
        finish(errs)


asyncio.run(main())
