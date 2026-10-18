"""Browser playthrough for Gangs of Lagos. Needs: pip install playwright; a running build (npm run build && npm run preview).
Set GOL_URL to point elsewhere (default http://localhost:4173/?debug)."""
import asyncio, os
from playwright.async_api import async_playwright
import os
URL=os.environ.get('GOL_URL','http://localhost:4173/?debug')
SAVE="""{version:3,cash:20000,completedMissions:['chairmans-summons','harbour-sprint','market-run','danfo-shift','diesel-run'],bestTimes:{},bestPay:{},paints:{owned:['green'],active:'green'},carHealth:100,stats:{},chaptersDone:[1],outfit:{},clothes:[],lookChosen:true,settings:{masterVolume:0.7,lookSensitivity:1,invertY:false}}"""
BOT="""(async () => {
  const g = window.__gol, car = g.hatch;
  const P = [[312,40],[312,-100],[232,-100],[232,120],[312,120],[312,40]];
  let k = 0, ticks = 0;
  const keys = {};
  const set = (code, on) => { if (!!keys[code] === on) return; keys[code] = on; window.dispatchEvent(new KeyboardEvent(on ? 'keydown' : 'keyup', { code })); };
  const log = [];
  while (g.mission.state === 'active' && ticks < 30 * 120) {
    ticks++;
    const [tx, tz] = P[Math.min(k, P.length - 1)];
    const dx = tx - car.x, dz = tz - car.z, d = Math.hypot(dx, dz);
    if (d < 9 && k < P.length - 1) k++;
    let diff = Math.atan2(dz, dx) - car.heading; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    set('KeyD', diff > 0.05); set('KeyA', diff < -0.05);
    const corner = k < P.length - 1;
    const v = car.speed, brakeDist = corner ? (v * v - 81) / (2 * 22) + 6 : -1;
    const slow = corner && v > 9 && d < brakeDist;
    set('KeyS', slow); set('KeyW', !slow && Math.abs(diff) < 1.2 || (!slow && v < 6));
    g.simulate(1 / 30);
    if (ticks % 90 === 0) log.push([Math.round(car.x), Math.round(car.z), Math.round(car.kmh), k]);
  }
  for (const c of Object.keys(keys)) set(c, false);
  return { state: g.mission.state, title: document.getElementById('r-title').textContent, body: document.getElementById('r-body').textContent, health: car.healthPct, log };
})()"""
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
        pg=await b.new_page(viewport={'width':640,'height':360})
        await pg.route(lambda u: 'fonts.g' in u, lambda r: r.abort())
        E=pg.evaluate
        await pg.goto(URL); await E(f"localStorage.setItem('gangs-of-lagos/save', JSON.stringify({SAVE}))"); await pg.reload()
        await pg.wait_for_function("!document.getElementById('btn-play').disabled",timeout=90000)
        await pg.click('#btn-play'); await pg.wait_for_timeout(300)
        await E("__gol.jobCall(__gol.runner().byId('marina-showdown'), true)"); await E('__gol.simulate(0.1)')
        await pg.keyboard.press('Escape'); await E('__gol.simulate(0.1)')
        await pg.click('#ph-choices button[data-choice="accept"]')
        await E("__gol.teleportVehicle(__gol.hatch,244,43,0)"); await E("__gol.enterVehicle(__gol.hatch)"); await E('__gol.simulate(4)')
        print(await E('__gol.mission'))
        r=await E(BOT)
        print(r['title'], '|', r['body'], '| car', round(r['health'],2)); print(r['log'])
        await b.close()
asyncio.run(main())
