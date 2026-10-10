"""Phase 6: in-vehicle radio (fictional stations, placeholder tracks, tuning dial, swappable tracks) and save v5."""
import asyncio, json, os, re
from gol import browser, ok, finish, save, SH

DATA = json.load(open(os.path.join(os.path.dirname(__file__), '..', 'public', 'data', 'radio.json'), encoding='utf-8'))
# Real stations and songs that must never appear (names and call signs only, as a guard).
BANNED = ['lagos boys', 'cool fm', 'wazobia', 'beat fm', 'naija fm', 'nigeria info', 'radio lagos', 'rhythm 93', 'smooth fm', 'city fm', 'inspiration fm', 'classic fm', 'raypower', 'bbc', 'spotify']

st = DATA['stations']
ok('4 to 6 stations', 4 <= len(st) <= 6, len(st))
ok('every track is a labelled placeholder with no audio file', all(t['placeholder'] is True and t['src'] is None for s in st for t in s['tracks']))
blob = json.dumps(DATA).lower()
ok('no real stations or commercial songs named', not any(b in blob for b in BANNED), [b for b in BANNED if b in blob])
ok('every station has DJ links and adverts', all(len(s['links']) >= 3 and len(s['adverts']) >= 2 and s['host'] for s in st))
ok('frequencies are distinct FM numbers', len({s['freq'] for s in st}) == len(st) and all(re.fullmatch(r'\d{2,3}\.\d', s['freq']) for s in st))
ok('data file says how to swap in licensed tracks', 'src' in DATA['note'] and 'licence' in DATA['note'])

V4 = save(cash=777, chapters=[1])


async def main():
    async with browser() as (g, errs):
        await g.boot(V4)
        s = await g.E('__gol.save')
        ok('v4 save migrates to v5 with radio on and no licences', s['version'] == 5 and s['radio'] == 1 and s['licences'] == [] and s['cash'] == 777, (s['version'], s.get('radio'), s.get('licences')))
        await g.play()
        await g.E('__gol.setTraffic(0)')
        ok('radio hidden on foot', await g.E("document.getElementById('radio').hidden"))
        await g.E('__gol.enterVehicle(__gol.hatch)')
        await g.sim(0.2)
        ok('radio dial shows in the car', not await g.E("document.getElementById('radio').hidden"))
        dial = await g.txt('radio-dial')
        ok('dial shows station, frequency and a placeholder label', '88.6 Lagoon FM' in dial and '(placeholder track)' in dial, dial)
        ok('radio plays while driving', await g.E('__gol.radio.active'))
        await g.key('KeyT')
        dial = await g.txt('radio-dial')
        ok('T tunes to the next station', 'Palmwine Radio' in dial and await g.E('__gol.save.radio') == 2, dial)
        ok('tuning announces the station', 'Highlife' in await g.txt('radio-cap'))
        await g.pg.keyboard.down('ShiftLeft')
        await g.key('KeyT')
        await g.pg.keyboard.up('ShiftLeft')
        ok('Shift+T tunes back', 'Lagoon FM' in await g.txt('radio-dial'))
        await g.pg.keyboard.down('ShiftLeft')
        await g.key('KeyT')
        await g.pg.keyboard.up('ShiftLeft')
        ok('the dial passes through off', await g.txt('radio-dial') == 'Radio off' and await g.E('__gol.save.radio') == 0)
        await g.key('KeyT')
        await g.key('KeyT')
        await g.key('KeyT')
        await g.sim(60)
        cap = await g.txt('radio-cap')
        ok('DJ links and adverts come up between tracks', await g.E('__gol.radio.turn') > 0 or 'Aunty Kemi' in cap or 'Advert' in cap, cap)
        await g.pg.screenshot(path=f'{SH}/m6_radio.png')
        await g.E('__gol.leaveVehicle()')
        await g.sim(0.2)
        ok('radio stops when you get out', not await g.E('__gol.radio.active') and await g.E("document.getElementById('radio').hidden"))

        # Saved station comes back after a reload.
        await g.pg.reload()
        await g.pg.wait_for_function("!document.getElementById('btn-play').disabled", timeout=90000)
        ok('saved station restored', await g.E('__gol.radio.index') == 3 and await g.E('__gol.radio.station.name') == 'Bata Beat')

        # A licensed track dropped in through the data file plays instead of the placeholder synth.
        d = json.loads(json.dumps(DATA))
        d['stations'][0]['tracks'][0].update(src='/data/radio-test.ogg', placeholder=False, title='Licensed Test Track')
        await g.pg.route('**/data/radio.json', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps(d)))
        await g.pg.reload()
        await g.pg.wait_for_function("!document.getElementById('btn-play').disabled", timeout=90000)
        await g.E('__gol.radio.index = 1')
        t = await g.E('__gol.radio.nowPlaying')
        lab = await g.E('__gol.radio.label')
        ok('a track with a src replaces the placeholder', t['src'] == '/data/radio-test.ogg' and 'placeholder' not in lab and 'Licensed Test Track' in lab, lab)
        finish(errs)


asyncio.run(main())
