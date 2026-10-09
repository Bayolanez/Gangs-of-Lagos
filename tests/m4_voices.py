"""Phase 4: street voices in English, Pidgin, Yoruba, Igbo and Hausa, triggered by bumping, blocking and honking."""
import asyncio
from gol import browser, ok, finish, save

RESIDENT = "(n => __gol.residents.find(k => k.name === n))"


async def main():
    async with browser() as (g, errs):
        E, sim, txt, pg = g.E, g.sim, g.txt, g.pg
        await g.boot(save(cash=1000))
        await g.play()
        await E('__gol.setTraffic(0)'); await sim(0.2)

        # ---- The data file
        data = await E("fetch('data/street_voices.json').then(r => r.json())")
        lines = data['lines']
        langs = {'en', 'pcm', 'yo', 'ig', 'ha'}
        ok('five languages', {l['lang'] for l in lines} == langs)
        ok('every language has greeting, complaint and excuse me', all({l['kind'] for l in lines if l['lang'] == lang} == {'greeting', 'complaint', 'excuse'} for lang in langs))
        ok('every non-English line is reviewed:false', all(l['reviewed'] is False for l in lines if l['lang'] != 'en'))
        ok('non-English lines carry an English gloss', all(l.get('gloss') for l in lines if l['lang'] != 'en'))
        ok('brief drafts present', {'Abeg, shift.', 'Ẹ jọ̀ọ́.', 'Biko.', 'Don Allah.'} <= {l['text'] for l in lines})
        ok('loaded in game', await E('__gol.voices.lines.length') == len(lines))

        # ---- Bump into someone: they say excuse me in their language (Emeka speaks Igbo in the draft casting)
        heard = None
        for _ in range(8):
            r = await E(f"(()=>{{const r={RESIDENT}('Emeka'); r.barkCooldown=0; r.talkTimer=0; return {{x:r.x,z:r.z}}}})()")
            await E(f"__gol.teleportPlayer({r['x']}-1.6,{r['z']})"); await E('__gol.setCamYaw(0)'); await sim(0.05)
            await pg.keyboard.down('KeyW'); await sim(0.8); await pg.keyboard.up('KeyW')
            v = await E('__gol.lastVoice')
            if v and v['name'] == 'Emeka':
                heard = v
                break
        ok('bumping triggers an excuse-me line', heard is not None and heard['kind'] == 'excuse' and heard['lang'] == 'ig', heard)
        ok('subtitle shows the line with its gloss', 'Emeka: Biko. (Please.)' in await txt('subtitle'), await txt('subtitle'))

        # ---- Stand in someone's way: they ask to pass
        blocked = None
        for name in ['Tobi', 'Ada', 'Kunle', 'Mama Titi', 'Aunty Bisi', 'Emeka']:
            for _ in range(12):
                a = await E(f"(()=>{{const r={RESIDENT}('{name}'); r.barkCooldown=0; r.talkTimer=0; return [r.x,r.z]}})()")
                await E('__gol.teleportPlayer(-150,-150)'); await sim(0.2)
                b = await E(f"(()=>{{const r={RESIDENT}('{name}'); return [r.x,r.z]}})()")
                dx, dz = b[0] - a[0], b[1] - a[1]
                d = (dx * dx + dz * dz) ** 0.5
                if d < 0.15:
                    await sim(1)
                    continue
                await E(f"__gol.teleportPlayer({b[0] + dx / d * 0.8},{b[1] + dz / d * 0.8})"); await sim(1.4)
                v = await E('__gol.lastVoice')
                if v and v['name'] == name and v['kind'] == 'excuse':
                    blocked = v
                    break
            if blocked:
                break
        ok('blocking someone triggers an excuse-me line', blocked is not None, blocked)

        # ---- Honk at people: they complain
        await E('__gol.teleportVehicle(__gol.hatch,-40,63,Math.PI/2)'); await E('__gol.teleportPlayer(-41.5,63)'); await sim(0.1)
        await g.key('KeyE')
        complaint = None
        for _ in range(10):
            await E("__gol.residents.forEach(r => { r.barkCooldown = 0; r.talkTimer = 0 })")
            mt = await E(f"(()=>{{const r={RESIDENT}('Iya Ronke'); return [r.x,r.z]}})()")
            await E(f"__gol.teleportVehicle(__gol.hatch,{mt[0]}+8,{mt[1]},Math.PI/2)"); await sim(0.1)
            await g.key('KeyH')
            v = await E('__gol.lastVoice')
            if v and v['kind'] == 'complaint':
                complaint = v
                break
        ok('honking triggers a complaint', complaint is not None, complaint)
        ok('Iya Ronke complains in Yoruba (draft casting)', complaint is not None and (complaint['name'] != 'Iya Ronke' or complaint['text'] == 'Rọra!'), complaint)
        await E('__gol.leaveVehicle()'); await sim(0.1)

        # ---- Walk past slowly: sometimes a greeting
        greeting = None
        for _ in range(40):
            r = await E(f"(()=>{{const r={RESIDENT}('Baba Sule'); r.barkCooldown=0; r.talkTimer=0; return [r.x,r.z]}})()")
            await E(f"__gol.teleportPlayer({r[0]}+2,{r[1]}+0.5)"); await sim(1)
            v = await E('__gol.lastVoice')
            if v and v['kind'] == 'greeting':
                greeting = v
                break
        ok('passers-by greet you', greeting is not None, greeting)
        finish(errs)


asyncio.run(main())
