"""Phase 4: save format v4 (weapons, rounds, armour, Range Day medals) and migration from v3."""
import asyncio
from gol import browser, ok, finish

V3 = ("{version:3,cash:12345,completedMissions:['harbour-sprint'],bestTimes:{'harbour-sprint':50},bestPay:{},paints:{owned:['green','danfo'],active:'danfo'},"
      "carHealth:80,stats:{races:1,deliveries:0,shifts:0,fares:0,tows:2,repairs:1},chaptersDone:[],outfit:{skin:'skin-3',top:'top-tee',colour:'col-green',hat:'hat-none',trousers:'tr-khaki'},"
      "clothes:[],lookChosen:true,settings:{masterVolume:0.4,lookSensitivity:1.2,invertY:true}}")
BAD = ("{version:4,cash:100,completedMissions:[],bestTimes:{},bestPay:{},paints:{owned:['green'],active:'green'},carHealth:100,stats:{},chaptersDone:[],"
       "outfit:{},clothes:[],lookChosen:true,weapons:{owned:['egret','bazooka','egret'],ammo:{egret:-5,bazooka:99},equipped:'bazooka'},armour:250,range:{best:'7',medal:9},settings:{}}")


async def main():
    async with browser() as (g, errs):
        E = g.E
        await g.boot(V3)
        s = await E('__gol.save')
        ok('v3 save migrates to v5', s['version'] == 5 and s['cash'] == 12345 and s['completedMissions'] == ['harbour-sprint'], s['version'])
        ok('v3 progress kept', s['paints']['active'] == 'danfo' and s['outfit']['top'] == 'top-tee' and s['stats']['tows'] == 2 and s['settings']['invertY'] is True)
        ok('new fields start empty', s['weapons'] == {'owned': [], 'ammo': {}, 'equipped': None} and s['armour'] == 0 and s['range'] == {'best': 0, 'medal': 0}, [s['weapons'], s['armour'], s['range']])
        ok('new stats start at zero', s['stats']['shots'] == 0 and s['stats']['hospital'] == 0 and s['stats']['escapes'] == 0)
        ok('upgrade noted on the title screen', 'upgraded' in await g.txt('save-note'))
        stored = await E("JSON.parse(localStorage.getItem('gangs-of-lagos/save')).version")
        ok('upgraded save written back', stored == 5)

        await g.boot(BAD)
        s = await E('__gol.save')
        ok('unknown weapons dropped, duplicates removed', s['weapons']['owned'] == ['egret'] and s['weapons']['equipped'] is None, s['weapons'])
        ok('ammo, armour and medal clamped', s['weapons']['ammo'] == {'egret': 0} and s['armour'] == 100 and s['range'] == {'best': 7, 'medal': 3}, [s['weapons']['ammo'], s['armour'], s['range']])
        await g.play()
        ok('game runs on the cleaned save', await E('__gol.mode') == 'play')
        finish(errs)


asyncio.run(main())
