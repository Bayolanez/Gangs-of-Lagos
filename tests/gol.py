"""Shared helpers for the Phase 4 browser tests. Needs: pip install playwright; a running build
(npm run build && npm run preview). Set GOL_URL to point elsewhere (default http://localhost:4173/?debug)."""
import asyncio, os, sys
from contextlib import asynccontextmanager
from playwright.async_api import async_playwright

URL = os.environ.get('GOL_URL', 'http://localhost:4173/?debug')
SH = os.environ.get('GOL_SHOTS', 'test-shots')
fails = []


def ok(name, cond, extra=''):
    if not cond:
        fails.append(name)
    print(("PASS " if cond else "FAIL ") + name + (" " + str(extra) if extra else ""), flush=True)


def finish(errs):
    print('ERRORS', errs)
    print('FAILED:', fails)
    sys.exit(1 if fails or errs else 0)


class Game:
    def __init__(self, pg):
        self.pg = pg

    async def E(self, js):
        return await asyncio.wait_for(self.pg.evaluate(js), 180)

    async def sim(self, s):
        await self.E(f'__gol.simulate({s})')

    async def txt(self, i):
        return await self.E(f"document.getElementById('{i}').textContent")

    async def key(self, k):
        await self.pg.keyboard.press(k)
        await self.sim(0.1)

    async def boot(self, save_js=None):
        """Load the page with a fresh save (or the given save object literal) and press Play."""
        await self.pg.goto(URL)
        await self.E('localStorage.clear()')
        if save_js:
            await self.E(f"localStorage.setItem('gangs-of-lagos/save', JSON.stringify({save_js}))")
        await self.pg.reload()
        await self.pg.wait_for_function("!document.getElementById('btn-play').disabled", timeout=90000)

    async def play(self):
        await self.pg.click('#btn-play')
        await self.pg.wait_for_timeout(200)
        if await self.E('__gol.mode') == 'wardrobe':
            await self.pg.click('#btn-wdone')
        await self.sim(0.1)
        await self.pg.focus('#game')

    async def talk(self, name):
        await self.E(f"__gol.approach('{name}')")
        await self.sim(0.1)
        await self.key('KeyE')


@asynccontextmanager
async def browser():
    os.makedirs(SH, exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        pg = await b.new_page(viewport={'width': 960, 'height': 540})
        errs = []
        pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)))
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'fonts.g' not in m.text and 'ERR_FAILED' not in m.text else None)
        await pg.route(lambda u: 'fonts.g' in u, lambda r: r.abort())
        try:
            yield Game(pg), errs
        finally:
            await b.close()


def save(cash=0, medal=0, owned=None, ammo=None, chapters=None, completed=None):
    """A v4 save object literal (JS) with the given money, medal and weapons."""
    owned = owned or []
    ammo = ammo or {}
    return ("{version:4,cash:%d,completedMissions:%s,bestTimes:{},bestPay:{},paints:{owned:['green'],active:'green'},carHealth:100,"
            "stats:{},chaptersDone:%s,outfit:{skin:'skin-2',top:'top-stripe',colour:'col-yellow',hat:'hat-none',trousers:'tr-charcoal'},"
            "clothes:[],lookChosen:true,weapons:{owned:%s,ammo:%s,equipped:null},armour:0,range:{best:0,medal:%d},"
            "settings:{masterVolume:0,lookSensitivity:1,invertY:false}}") % (cash, completed or [], chapters or [], owned, ammo, medal)
