"""Browser playthrough for Gangs of Lagos. Needs: pip install playwright; a running build (npm run build && npm run preview).
Set GOL_URL to point elsewhere (default http://localhost:4173/?debug)."""
import asyncio, json, sys
from playwright.async_api import async_playwright
import os
URL=os.environ.get('GOL_URL','http://localhost:4173/?debug')
SHOTS=sys.argv[1] if len(sys.argv)>1 else ''
fails=[]
def ok(name,cond,extra=''):
    if not cond: fails.append(name)
    print(("PASS " if cond else "FAIL ")+name+(" "+str(extra) if extra else ""), flush=True)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
        pg=await b.new_page(viewport={'width':960,'height':540})
        errs=[]
        pg.on('pageerror',lambda e:errs.append('PAGEERROR '+str(e)))
        pg.on('console',lambda m:errs.append(m.text) if m.type=='error' and 'fonts.g' not in m.text and 'TUNNEL' not in m.text and 'ERR_FAILED' not in m.text else None)
        await pg.route(lambda u: 'fonts.g' in u, lambda r: r.abort())
        E=pg.evaluate
        async def sim(s): await E(f'__gol.simulate({s})')
        async def txt(i): return await E(f"document.getElementById('{i}').textContent")
        async def hidden(i): return await E(f"document.getElementById('{i}').hidden")
        async def shot(n):
            if SHOTS: await pg.screenshot(path=f'{SHOTS}/{n}.png')
        async def key(k): await pg.keyboard.press(k); await sim(0.1)
        await pg.goto(URL)
        await E("""localStorage.setItem('gangs-of-lagos/save', JSON.stringify({version:2,cash:20000,completedMissions:['harbour-sprint','market-run','danfo-shift'],bestTimes:{},bestPay:{},paints:{owned:['green','danfo','gold'],active:'danfo'},carHealth:100,stats:{races:1,deliveries:1,shifts:1,fares:1500,tows:0,repairs:0},finaleDone:true,settings:{masterVolume:0.7,lookSensitivity:1,invertY:false}}))""")
        await pg.reload(); await pg.wait_for_function("!document.getElementById('btn-play').disabled",timeout=90000)
        await pg.click('#btn-play'); await pg.wait_for_timeout(300)
        if await E('__gol.mode')=='wardrobe': await pg.click('#btn-wdone'); await pg.wait_for_timeout(200); await pg.focus('#game')
        cash_before=20000
        # ---- Workshop
        await E("__gol.leaveVehicle()")
        await E("__gol.hatch.health=50"); await E("__gol.teleportVehicle(__gol.hatch,45,0,0)")
        await E("__gol.teleportPlayer(45,2.1)"); await sim(0.1); await key('KeyE')
        await E("__gol.teleportVehicle(__gol.hatch,57,0,0)"); await sim(0.2)
        ok('shop opens in the bay', await E("__gol.mode")=='shop', await txt('shop-vehicle'))
        rep=await txt('btn-repair'); ok('repair priced', '1,000' in rep, rep)
        await shot('t_shop')
        await pg.click('#btn-repair')
        s=await E("__gol.save"); ok('repair works', await E("__gol.hatch.healthPct")==1 and s['cash']==cash_before-1000, s['cash'])
        await pg.click('button[data-paint="blue"]')
        s=await E("__gol.save"); ok('buy paint', 'blue' in s['paints']['owned'] and s['paints']['active']=='blue' and s['cash']==cash_before-3500)
        await pg.click('button[data-paint="gold"]')
        ok('apply earned paint', (await E("__gol.save"))['paints']['active']=='gold')
        await pg.click('#btn-leave'); await sim(0.1)
        ok('leave shop', await E("__gol.mode")=='play')
        # ---- Wreck and tow
        await E("__gol.hatch.health=2"); await E("__gol.teleportVehicle(__gol.hatch,-40,-60,Math.PI)")
        await pg.keyboard.down('KeyW'); await sim(2.0); await pg.keyboard.up('KeyW'); await sim(0.2)
        s=await E("__gol.save"); hx=await E("[__gol.hatch.x,__gol.hatch.z]")
        ok('wreck towed to workshop', abs(hx[0]-66)<0.1 and abs(hx[1]+14)<0.1 and s['stats']['tows']==1 and await E("__gol.inVehicle") is None, {'pos':hx,'notice':await txt('notice')})
        # ---- Map
        await key('KeyM'); ok('full map opens', await E("__gol.mode")=='map')
        await shot('t_map')
        await key('KeyM'); ok('full map closes', await E("__gol.mode")=='play')
        # ---- Horn scatters residents
        await E("__gol.approach('Baba Sule')"); await E("(()=>{const r=__gol.residents.find(r=>r.name==='Baba Sule');__gol.teleportVehicle(__gol.hatch,r.x-6,r.z,0);})()")
        await E("__gol.enterVehicle(__gol.hatch)"); await key('KeyH')
        ok('horn scatters residents', await E("__gol.residents.find(r=>r.name==='Baba Sule').fleeTimer")>0)
        # ---- Traffic drives and never ends up inside buildings
        p0=await E("__gol.traffic.vehicles().map(v=>[v.x,v.z])")
        await sim(8)
        p1=await E("__gol.traffic.vehicles().map(v=>[v.x,v.z])")
        bad=await E("__gol.traffic.vehicles().filter(v=>__gol.overlapping && false).length")
        inside=await E("""(()=>{let n=0; for(const v of __gol.traffic.vehicles()){ const w=Math.abs(((v.x%80)+80)%80-40)<9 || Math.abs(((v.z%80)+80)%80-40)<9; if(!w) n++;} return n})()""")
        moved=sum(1 for a,b2 in zip(p0,p1) if ((a[0]-b2[0])**2+(a[1]-b2[1])**2)**.5>5)
        ok('traffic moves along roads', moved>=3 and inside==0, {'moved':moved,'offroad':inside,'n':len(p1)})
        # ---- Fail path: leaving the car during the race
        await E("__gol.leaveVehicle()")
        await E("__gol.approach('Kunle')"); await sim(0.1); await key('KeyE'); await pg.click('#btn-accept'); await sim(0.1)
        await E("__gol.teleportPlayer(__gol.hatch.x+2.2,__gol.hatch.z)"); await sim(0.1); await key('KeyE')
        await E("__gol.teleportVehicle(__gol.hatch,-40,-4,Math.PI/2)"); await sim(4.0)
        await key('KeyE')
        ok('fail when leaving the vehicle', 'left the vehicle' in await txt('r-body'), await txt('r-body'))
        # retry puts the car on the line
        await E("__gol.teleportPlayer(__gol.hatch.x+2.2,__gol.hatch.z)")
        await pg.click('#btn-continue'); await sim(0.1)
        # ---- Persistence + migration
        await E("__gol.leaveVehicle()")
        await key('KeyP'); await pg.click('#btn-title')
        await pg.reload(); await pg.wait_for_function("!document.getElementById('btn-play').disabled",timeout=90000)
        s=await E("__gol.save")
        ok('save persists', 1 in s['chaptersDone'] and s['paints']['active']=='gold' and len(s['completedMissions'])==3 and s['lookChosen'], {'cash':s['cash']})
        await E("""localStorage.setItem('gangs-of-lagos/save', JSON.stringify({version:1,cash:5500,completedMissions:['harbour-sprint'],unlocks:['paint-danfo'],bestTimes:{'harbour-sprint':61.2},settings:{masterVolume:0.5,lookSensitivity:1.3,invertY:false}}))""")
        await pg.reload(); await pg.wait_for_function("!document.getElementById('btn-play').disabled",timeout=90000)
        s=await E("__gol.save")
        ok('v1 save migrates', s['version']==3 and s['cash']==5500 and s['paints']=={'owned':['green','danfo'],'active':'danfo'} and s['settings']['lookSensitivity']==1.3 and 'unlocks' not in s and s['chaptersDone']==[] and s['lookChosen']==False, s)
        ok('migration noted on title', 'upgraded' in await txt('save-note'), await txt('save-note'))
        print('ERRORS', errs[:8])
        print('FAILED:', fails)
        await b.close()
asyncio.run(main())
