"""Browser playthrough for Gangs of Lagos. Needs: pip install playwright; a running build (npm run build && npm run preview).
Set GOL_URL to point elsewhere (default http://localhost:4173/?debug)."""
import asyncio
import os
from playwright.async_api import async_playwright
SH=os.environ.get('GOL_SHOTS','test-shots')
URL=os.environ.get('GOL_URL','http://localhost:4173/?debug')
def ok(name,cond,extra=''): print(("PASS " if cond else "FAIL ")+name+(" "+str(extra) if extra else ""), flush=True)
async def main():
    os.makedirs(SH, exist_ok=True)
    async with async_playwright() as p:
        b=await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
        pg=await b.new_page(viewport={'width':960,'height':540})
        errs=[]
        pg.on('pageerror',lambda e:errs.append('PAGEERROR '+str(e)))
        await pg.route(lambda u: 'fonts.g' in u, lambda r: r.abort())
        E=pg.evaluate
        await pg.goto(URL); await E('localStorage.clear()'); await pg.reload()
        await pg.wait_for_function("!document.getElementById('btn-play').disabled",timeout=90000)
        await pg.click('#btn-play'); await pg.wait_for_timeout(300)
        if await E('__gol.mode')=='wardrobe': await pg.click('#btn-wdone'); await pg.wait_for_timeout(200); await pg.focus('#game')
        # danfo drives out of the bus park under real physics
        await E("__gol.teleportPlayer(__gol.danfo.x+2.2,__gol.danfo.z)"); await E('__gol.simulate(0.1)')
        await pg.keyboard.press('KeyE'); await E('__gol.simulate(0.1)')
        d0=await E("[__gol.danfo.x,__gol.danfo.z]")
        await pg.keyboard.down('KeyW'); await E('__gol.simulate(1.6)'); await pg.keyboard.down('KeyD'); await E('__gol.simulate(1.2)'); await pg.keyboard.up('KeyD'); await E('__gol.simulate(1.0)'); await pg.keyboard.up('KeyW')
        d1=await E("[__gol.danfo.x,__gol.danfo.z,__gol.danfo.kmh,__gol.danfo.heading]")
        ok('danfo drives and turns', ((d1[0]-d0[0])**2+(d1[1]-d0[1])**2)**.5>15 and not (await E('__gol.overlapping()'))['danfo'], d1)
        await pg.screenshot(path=f"{SH}/drive.png")
        await pg.keyboard.down('Space'); await E('__gol.simulate(2)'); await pg.keyboard.up('Space')
        await E("__gol.leaveVehicle()")
        # traffic health over a minute of simulated time
        stuck_samples=[]
        for i in range(6):
            p0=await E("__gol.traffic.vehicles().map(v=>[v.x,v.z])")
            await E('__gol.simulate(10)')
            p1=await E("__gol.traffic.vehicles().map(v=>[v.x,v.z])")
            n=len(p1); mv=sum(1 for a,c in zip(p0,p1) if ((a[0]-c[0])**2+(a[1]-c[1])**2)**.5>3)
            overlap=await E("""(()=>{const vs=__gol.traffic.vehicles();let n=0;for(let i=0;i<vs.length;i++)for(let j=i+1;j<vs.length;j++)if(Math.hypot(vs[i].x-vs[j].x,vs[i].z-vs[j].z)<2.5)n++;return n})()""")
            stuck_samples.append((n,mv,overlap))
        ok('traffic keeps flowing for 60 s', all(mv>=max(1,n-2) for n,mv,_ in stuck_samples), stuck_samples)
        await E("__gol.teleportPlayer(-30,-20)"); await E('__gol.simulate(0.2)')
        await pg.keyboard.press('KeyM'); await E('__gol.simulate(0.1)')
        await pg.screenshot(path=f"{SH}/map.png")
        print('ERRORS',errs)
        await b.close()
asyncio.run(main())
