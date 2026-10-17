import sys, time, subprocess, os, json
from playwright.sync_api import sync_playwright
PORT=10888
srv=subprocess.Popen(['node','server/server.js'],env={**os.environ,'PORT':str(PORT)},stdout=subprocess.PIPE)
srv.stdout.readline()
out=sys.argv[1] if len(sys.argv)>1 else '/tmp/claude-0/shots'
levels=[int(x) for x in sys.argv[2].split(',')] if len(sys.argv)>2 else [0]
errs=[]
with sync_playwright() as p:
    b=p.chromium.launch(args=['--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required'])
    pg=b.new_page(viewport={'width':960,'height':540})
    pg.on('console', lambda m: errs.append(f'{m.type}: {m.text}') if m.type in ('error','warning') or 'built' in m.text else None)
    pg.on('pageerror', lambda e: errs.append(f'PAGEERROR: {e}'))
    pg.goto(f'http://127.0.0.1:{PORT}/')
    pg.wait_for_function('window.game', timeout=60000)
    time.sleep(2)
    pg.screenshot(path=f'{out}/menu.png')
    for lv in levels:
        pg.evaluate(f'game.settings.unlocked=30; game.startSolo({lv})')
        time.sleep(1.5); pg.evaluate("document.getElementById('title').classList.remove('show')"); time.sleep(1)
        pg.screenshot(path=f'{out}/lv{lv}.png')
        info=pg.evaluate('({fps: game.fpsShow, ents: game.entities.list.map(e=>e.type+":"+e.state), pos:[game.local.x,game.local.z]})')
        errs.append(f'L{lv} {json.dumps(info)}')
    b.close()
srv.kill()
print('\n'.join(errs[:60]))
