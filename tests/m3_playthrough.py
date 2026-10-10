"""Browser playthrough for Gangs of Lagos. Needs: pip install playwright; a running build (npm run build && npm run preview).
Set GOL_URL to point elsewhere (default http://localhost:4173/?debug)."""
import os
import asyncio, json, os, sys
from playwright.async_api import async_playwright
URL=os.environ.get('GOL_URL','http://localhost:4173/?debug')
SH=os.environ.get('GOL_SHOTS','test-shots')
fails=[]
def ok(name,cond,extra=''):
    if not cond: fails.append(name)
    print(("PASS " if cond else "FAIL ")+name+(" "+str(extra) if extra else ""), flush=True)
V2SAVE="""{version:2,cash:20000,completedMissions:['harbour-sprint','market-run','danfo-shift'],bestTimes:{'harbour-sprint':55},bestPay:{},paints:{owned:['green','danfo','gold'],active:'gold'},carHealth:80,stats:{races:1,deliveries:1,shifts:1,fares:1500,tows:0,repairs:0},finaleDone:true,settings:{masterVolume:0.7,lookSensitivity:1,invertY:false}}"""
async def main():
    os.makedirs(SH, exist_ok=True)
    async with async_playwright() as p:
        b=await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
        pg=await b.new_page(viewport={'width':960,'height':540})
        errs=[]
        pg.on('pageerror',lambda e:errs.append('PAGEERROR '+str(e)))
        pg.on('console',lambda m:errs.append(m.text) if m.type=='error' and 'fonts.g' not in m.text and 'ERR_FAILED' not in m.text else None)
        await pg.route(lambda u: 'fonts.g' in u, lambda r: r.abort())
        pg.on('crash',lambda: print('PAGE CRASHED',flush=True))
        async def E(js):
            return await asyncio.wait_for(pg.evaluate(js), 180)
        async def sim(s): await E(f'__gol.simulate({s})')
        async def txt(i): return await E(f"document.getElementById('{i}').textContent")
        async def key(k): await pg.keyboard.press(k); await sim(0.1)
        async def boot():
            await pg.wait_for_function("!document.getElementById('btn-play').disabled",timeout=90000)
        await pg.goto(URL); await E('localStorage.clear()'); await pg.reload(); await boot()
        # ---- New game: choose your look
        await pg.click('#btn-play'); await pg.wait_for_timeout(300)
        ok('new game opens Choose your look', await E('__gol.mode')=='wardrobe' and 'CHOOSE' in await txt('w-title'))
        n_items=await E("document.querySelectorAll('#w-slots .witem').length")
        ok('creator lists only free items', n_items==15, n_items)
        await pg.click('button[data-item="skin-4"]'); await pg.click('button[data-item="top-tee"]'); await pg.click('button[data-item="col-green"]'); await pg.click('button[data-item="tr-khaki"]')
        await pg.screenshot(path=f'{SH}/creator.png')
        o=(await E('__gol.save'))['outfit']
        ok('creator equips choices', o=={'skin':'skin-4','top':'top-tee','colour':'col-green','hat':'hat-none','trousers':'tr-khaki'}, o)
        await pg.click('#btn-wdone'); await sim(0.1)
        ok('start playing', await E('__gol.mode')=='play' and (await E('__gol.save'))['lookChosen'])
        ok('bridge closed on a new game', not await E('__gol.bridgeOpen'))
        await E("__gol.teleportVehicle(__gol.hatch,130,43,0)"); await E("__gol.teleportPlayer(130,45.1)"); await sim(0.1); await key('KeyE')
        await pg.keyboard.down('KeyW'); await sim(4); await pg.keyboard.up('KeyW')
        hx=await E('__gol.hatch.x'); ok('closed bridge blocks the way', hx<218, hx)
        await E("__gol.leaveVehicle()")
        # ---- v2 save with Harbour Bend finished: migrates, bridge opens
        await E(f"localStorage.setItem('gangs-of-lagos/save', JSON.stringify({V2SAVE}))"); await pg.reload(); await boot()
        s=await E('__gol.save')
        ok('v2 save migrates to v3 (now v5)', s['version']==5 and s['chaptersDone']==[1] and 'finaleDone' not in s and s['lookChosen']==False and s['cash']==20000, {k:s[k] for k in ('version','chaptersDone','lookChosen','cash')})
        ok('bridge open for finished Harbour Bend', await E('__gol.bridgeOpen'))
        await pg.click('#btn-play'); await pg.wait_for_timeout(300)
        ok('upgraded save gets Choose your look once', await E('__gol.mode')=='wardrobe')
        ok('earned danfo cap available', await E("!document.querySelector('button[data-item=\"hat-danfo\"]').disabled"))
        await pg.click('button[data-item="hat-danfo"]'); await pg.click('#btn-wdone'); await sim(0.1)
        # ---- Drive across the bridge (traffic off so a random crash can't decide the result)
        await E("__gol.setTraffic(0)"); await sim(0.2)
        await E("__gol.teleportVehicle(__gol.hatch,130,43,0)"); await E("__gol.teleportPlayer(130,45.1)"); await sim(0.1); await key('KeyE')
        await pg.keyboard.down('KeyW'); await sim(5); await pg.keyboard.up('KeyW'); await pg.keyboard.down('Space'); await sim(1.5); await pg.keyboard.up('Space')
        hx=await E('[__gol.hatch.x,__gol.hatch.z]'); ov=await E('__gol.overlapping()')
        ok('drive across the bridge to Marina Point', hx[0]>225 and not ov['hatch'], hx)
        await pg.screenshot(path=f'{SH}/marina_arrive.png')
        await E("__gol.leaveVehicle()"); await E("__gol.setTraffic(10)")
        # ---- Ngozi's Tailoring (Harbour Bend market)
        await E("__gol.approach('Ngozi')"); await sim(0.1); await key('KeyE')
        ok('Ngozi opens her wardrobe', await E('__gol.mode')=='wardrobe' and "Ngozi" in await txt('w-eyebrow'))
        fun=await E("document.querySelector('button[data-item=\"hat-cap\"]').textContent+'|'+document.querySelector('button[data-item=\"hat-cap\"]').disabled")
        ok('other shop items shown as sold elsewhere', 'Marina Threads' in fun and fun.endswith('true'), fun)
        await pg.click('button[data-item="col-print"]'); await pg.click('button[data-item="top-kaftan"]'); await pg.click('button[data-item="hat-fila"]')
        s=await E('__gol.save')
        ok('buy and wear tailor items', set(['col-print','top-kaftan','hat-fila'])<=set(s['clothes']) and s['outfit']['top']=='top-kaftan' and s['cash']==20000-2500-3000-1500, {'cash':s['cash'],'outfit':s['outfit']})
        await pg.screenshot(path=f'{SH}/tailor.png')
        await pg.click('#btn-wdone'); await sim(0.1)
        # ---- Marina Threads
        await E("__gol.approach('Funmi')"); await sim(0.1); await key('KeyE')
        ok('Funmi opens boutique', await E('__gol.mode')=='wardrobe' and 'Marina Threads' in await txt('w-eyebrow'))
        await pg.click('button[data-item="top-jacket"]'); await pg.click('button[data-item="col-teal"]'); await pg.click('button[data-item="hat-cap"]')
        s=await E('__gol.save'); ok('boutique purchases', s['outfit']=={'skin':'skin-2','top':'top-jacket','colour':'col-teal','hat':'hat-cap','trousers':'tr-charcoal'} and s['cash']==13000-6000-800-1200, s['cash'])
        await pg.screenshot(path=f'{SH}/boutique.png')
        champ=await E("document.querySelector('button[data-item=\"top-champion\"]').textContent")
        ok('champion jacket is earned, not sold', 'earn it' in champ, champ)
        await pg.click('#btn-wdone'); await sim(0.1)
        # ---- Showdown locked first
        await E("__gol.approach('Dapo')"); await sim(0.1); await key('KeyE')
        ok('Dapo locked until diesel run', 'Femi' in await txt('subtitle') and await E('__gol.mode')=='play', await txt('subtitle'))
        # ---- Diesel Run
        await E("__gol.approach('Mr Femi')"); await sim(0.1); await key('KeyE')
        ok('Diesel Run offered', await E('__gol.mode')=='offer', await txt('o-terms'))
        await pg.click('#btn-accept'); await sim(0.1)
        await E("__gol.teleportVehicle(__gol.hatch,338,30,-Math.PI/2)"); await E("__gol.teleportPlayer(340.2,30)"); await sim(0.1); await key('KeyE')
        ok('in car for diesel', await E('__gol.inVehicle')=='hatchback', await E('__gol.mission'))
        await E("__gol.teleportVehicle(__gol.hatch,338,17,-Math.PI/2)"); await sim(2.4)
        m=await E('__gol.mission'); ok('loaded at the pumps, timer on', m['index']==2 and m['timerOn'], m)
        for (x,z,h) in [(258,43,0),(235,-60,-1.5708),(100,37,3.1416)]:
            await E(f"__gol.teleportVehicle(__gol.hatch,{x},{z},{h})"); await sim(2.0)
        m=await E('__gol.mission'); body=await txt('r-body')
        ok('diesel run complete with drop pay', m['state']=='result' and 'Drop pay ₦1,800' in body, body)
        await pg.click('#btn-continue'); await sim(0.1)
        await E("__gol.leaveVehicle()")
        # ---- Marina Showdown: lose first (rival finishes), checking he stays on roads
        await E("__gol.approach('Dapo')"); await sim(0.1); await key('KeyE')
        ok('Showdown offered', await E('__gol.mode')=='offer')
        await pg.click('#btn-accept'); await sim(0.2)
        rp=await E('[__gol.rivalCar.x,__gol.rivalCar.z]'); ok('Dapo lines up on the boulevard', abs(rp[0]-244)<0.5 and abs(rp[1]-37)<0.5, rp)
        await E("__gol.teleportVehicle(__gol.hatch,244,43,0)"); await E("__gol.teleportPlayer(244,45.3)"); await sim(0.1); await key('KeyE'); await sim(0.6)
        m=await E('__gol.mission'); ok('showdown countdown', m['step']=='countdown', m)
        await sim(3.3)
        await pg.screenshot(path=f'{SH}/showdown_start.png')
        offroad=0; samples=0; lead=None
        for i in range(30):
            await sim(2)
            st=await E("[__gol.mission.state, __gol.rivalCar.x, __gol.rivalCar.z, __gol.traffic.activeCount, document.getElementById('m-extra').textContent]")
            if st[0]!='active': break
            samples+=1; lead=st[4]
            if await E(f"__gol.overlapping && (()=>{{const w=__gol; return false}})()"): pass
            hit=await E(f"(()=>{{return document && 0}})()")
            if await E(f"(function(){{ const x={st[1]},z={st[2]}; const onRoad=[232,312].some(r=>Math.abs(x-r)<6)||[-100,40,120].some(r=>Math.abs(z-r)<6); return !onRoad }})()"): offroad+=1
        m=await E('__gol.mission')
        ok('Dapo drives the lap on the roads', offroad==0 and samples>5, {'samples':samples,'offroad':offroad,'lastLead':lead})
        ok('roads closed: no traffic during showdown', st[3]==0, st[3])
        body=await txt('r-body'); el=await E('__gol.runner().elapsed')
        ok('lose if Dapo finishes first', 'Dapo crossed the line first' in body, f'{body} after {el:.1f}s')
        # ---- Win (try again)
        await pg.click('#btn-retry'); await sim(0.3)
        await sim(3.4)
        await pg.keyboard.down('KeyW'); await sim(1.5); await pg.keyboard.up('KeyW')
        lt=await txt('m-extra'); ok('lead indicator', 'lead' in lt or 'ahead' in lt, lt)
        for (x,z) in [(312,40),(312,-100),(232,-100),(232,120),(312,120),(312,40)]:
            await E(f"__gol.teleportVehicle(__gol.hatch,{x},{z})"); await sim(0.15)
        s=await E('__gol.save'); body=await txt('r-body'); fin=await txt('r-finale')
        ok('beat Dapo', 'BEAT DAPO' in await txt('r-title'), body)
        ok('Marina Point chapter complete', 2 in s['chaptersDone'] and 'MARINA POINT COMPLETE' in fin, fin)
        await pg.screenshot(path=f'{SH}/chapter2.png')
        await pg.click('#btn-continue'); await sim(0.1)
        await E("__gol.leaveVehicle()")
        await E("__gol.approach('Funmi')"); await sim(0.1); await key('KeyE')
        ok('champion jacket unlocked', await E("!document.querySelector('button[data-item=\"top-champion\"]').disabled"))
        await pg.click('button[data-item="top-champion"]'); await pg.click('#btn-wdone'); await sim(0.1)
        # ---- Traffic in Marina
        await E("__gol.teleportPlayer(272,40.5)"); await sim(25)
        tr=await E("__gol.traffic.vehicles().map(v=>[Math.round(v.x),Math.round(v.z)])")
        ok('traffic reaches Marina Point', any(x>220 for x,z in tr), tr)
        ok('no traffic inside buildings', not await E("__gol.traffic.vehicles().some(v=>{const R=[-120,-40,40,120,232,312]; const Z=[-120,-40,40,120,-100]; return !(R.some(r=>Math.abs(v.x-r)<7)||Z.some(r=>Math.abs(v.z-r)<7))})"))
        await pg.screenshot(path=f'{SH}/marina_street.png')
        await key('KeyM'); await pg.screenshot(path=f'{SH}/map.png'); await key('KeyM')
        # ---- persistence
        await key('KeyP'); await pg.click('#btn-title'); await pg.reload(); await boot()
        s=await E('__gol.save')
        ok('persisted', s['outfit']['top']=='top-champion' and s['chaptersDone']==[1,2] and len(s['completedMissions'])==5 and await E('__gol.bridgeOpen'), s['outfit'])
        # ---- v1 straight to v3
        await E("""localStorage.setItem('gangs-of-lagos/save', JSON.stringify({version:1,cash:5500,completedMissions:['harbour-sprint'],unlocks:['paint-danfo'],bestTimes:{},settings:{masterVolume:0.5,lookSensitivity:1.3,invertY:false}}))""")
        await pg.reload(); await boot(); s=await E('__gol.save')
        ok('v1 save migrates to v3 (now v5)', s['version']==5 and s['paints']['active']=='danfo' and s['chaptersDone']==[] and s['outfit']['top']=='top-stripe', {k:s[k] for k in ('version','paints','chaptersDone')})
        print('ERRORS', errs[:8]); print('FAILED:', fails)
        await b.close()
asyncio.run(main())
