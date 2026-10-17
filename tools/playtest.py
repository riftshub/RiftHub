import time, subprocess, os, json
from playwright.sync_api import sync_playwright
PORT=10890
srv=subprocess.Popen(['node','server/server.js'],env={**os.environ,'PORT':str(PORT)},stdout=subprocess.PIPE); srv.stdout.readline()
errs=[]; URL=f'http://127.0.0.1:{PORT}/'
ARGS=['--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required']
with sync_playwright() as p:
    b=p.chromium.launch(args=ARGS)
    pg=b.new_page(viewport={'width':320,'height':200})
    pg.on('pageerror', lambda e: errs.append(f'PAGEERROR: {e}'))
    pg.on('console', lambda m: errs.append('ERR '+m.text) if m.type=='error' else None)
    pg.goto(URL); pg.wait_for_function('window.game', timeout=60000)
    pg.evaluate('game.audio.init()')
    states=set()
    for lv in range(26):
        pg.evaluate(f'game.settings.unlocked=30; game.startSolo({lv}); game.local.sanity=100')
        # walk forward & sprint so entities hear us; make the player immortal for the test
        pg.evaluate('game._die=game.die; game.die=()=>{game.deaths=(game.deaths||0)+1}; game.input.keys.add("KeyW"); game.input.keys.add("ShiftLeft"); 0')
        for k in range(4):
            time.sleep(0.6)
            pg.evaluate('game.local.yaw += 1.3')
            s=pg.evaluate('game.entities.list.map(e=>e.type+":"+e.state)')
            states.update(s)
        pg.evaluate('game.input.keys.clear(); game.die=game._die; 0')
    print('entity states seen:', len(states)); print(sorted(states))
    # exit flow + death flow
    pg.evaluate('game.startSolo(0)'); time.sleep(1)
    pg.evaluate('game.nextLevel()'); time.sleep(2)
    print('after exit level =', pg.evaluate('game.levelIdx'))
    pg.evaluate("game.die('hound')"); time.sleep(2)
    print('death overlay visible =', pg.evaluate("!document.getElementById('death').classList.contains('hidden')"))
    # ---- co-op with two browsers ----
    ctxA=b.new_context(viewport={'width':320,'height':200}); ctxB=b.new_context(viewport={'width':320,'height':200})
    A=ctxA.new_page(); B=ctxB.new_page()
    for P in (A,B):
        P.on('pageerror', lambda e: errs.append(f'COOP PAGEERROR: {e}'))
        P.goto(URL); P.wait_for_function('window.game', timeout=60000)
        P.evaluate(f"game.settings.server='{URL}'")
    A.evaluate("game.local.name='Alice'; game.hostCoop(2)")
    A.wait_for_function('game.net && game.net.code && game.map', timeout=30000)
    code=A.evaluate('game.net.code'); print('room', code)
    B.evaluate(f"game.local.name='Bob'; game.joinCoop('{code}')")
    B.wait_for_function('game.net && game.net.code && game.levelIdx===2', timeout=30000)
    time.sleep(2.5)
    print('maps identical:', A.evaluate('Array.from(game.map.grid).join("")')==B.evaluate('Array.from(game.map.grid).join("")'))
    print('B sees entities:', B.evaluate('game.entities.list.length'), 'A has', A.evaluate('game.entities.list.length'))
    print('A sees Bob:', A.evaluate('[...game.remotes.values()].map(r=>r.name+":"+r.seen)'))
    A.evaluate('game.nextLevel()'); time.sleep(3)
    print('levels after host exit:', A.evaluate('game.levelIdx'), B.evaluate('game.levelIdx'), 'same map:', A.evaluate('Array.from(game.map.grid).join("")')==B.evaluate('Array.from(game.map.grid).join("")'))
    # host kills Bob via an entity
    A.evaluate("(()=>{const e=game.entities.list[0]; const r=[...game.remotes.values()][0]; game.killPlayer(r,e)})()"); time.sleep(1.5)
    print('Bob dead on his client:', not B.evaluate('game.local.alive'))
    A.close(); time.sleep(1.5)
    print('Bob became host:', B.evaluate('game.net.isHost'), 'entities kept:', B.evaluate('game.entities.list.length'))
    time.sleep(1)
    b.close()
srv.kill()
print('\n'.join(errs) if errs else 'NO ERRORS')
