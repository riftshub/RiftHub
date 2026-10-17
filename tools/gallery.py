import time, subprocess, os
from playwright.sync_api import sync_playwright
PORT=10889
srv=subprocess.Popen(['node','server/server.js'],env={**os.environ,'PORT':str(PORT)},stdout=subprocess.PIPE); srv.stdout.readline()
errs=[]
types=['smiler','hound','howler','partygoer','skinstealer','faceling','clump','deathmoth','wretch','pale','crawler','shadow','hollow','screamer']
with sync_playwright() as p:
    b=p.chromium.launch(args=['--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
    pg=b.new_page(viewport={'width':480,'height':300})
    pg.on('pageerror', lambda e: errs.append(f'PAGEERROR: {e}'))
    pg.on('console', lambda m: errs.append(m.text) if m.type=='error' else None)
    pg.goto(f'http://127.0.0.1:{PORT}/'); pg.wait_for_function('window.game', timeout=60000)
    pg.evaluate('game.settings.unlocked=30; game.startSolo(4)'); time.sleep(1.5)
    pg.evaluate("document.getElementById('title').classList.remove('show'); document.getElementById('hud').style.display='none'")
    # find a long straight view
    pg.evaluate('''(()=>{const g=game,m=g.map,cs=m.cell;let best=null;
      for(const c of m.floors){const x=c%m.W,y=(c/m.W)|0;for(const [dx,dy,yaw] of [[1,0,-Math.PI/2],[-1,0,Math.PI/2],[0,1,Math.PI],[0,-1,0]]){let k=0;while(m.grid[(y+dy*(k+1))*m.W+x+dx*(k+1)]===0)k++;if(k>=4&&(!best||Math.random()<0.02)){best=[x,y,dx,dy,yaw];}}}
      const [x,y,dx,dy,yaw]=best;g.local.x=(x+.5)*cs;g.local.z=(y+.5)*cs;g.local.yaw=yaw;g.local.pitch=0.05;g.flashDir=[ -Math.sin(yaw),0,-Math.cos(yaw)];
      g._dir=[dx,dy];g.entities.reset();g.mode='paused';})()''')
    for i,t in enumerate(types):
        pg.evaluate(f'''(()=>{{const g=game,cs=g.map.cell;g.entities.list=[];const e=g.entities.spawn('{t}');
          e.x=g.local.x+g._dir[0]*cs*1.6;e.z=g.local.z+g._dir[1]*cs*1.6;e.visible=1;e.state=('{t}'==='skinstealer')?'reveal':'hunt';e.reveal=1;if('{t}'==='crawler')e.y=g.map.wallH;if('{t}'==='deathmoth')e.y=1.0;if('{t}'==='screamer')e.y=0.4;}})()''')
        time.sleep(0.6)
        pg.screenshot(path=f'/tmp/claude-0/shots/e_{i:02d}.png')
    # jumpscare frame
    pg.evaluate("game.mode='play'; game.die('partygoer')"); time.sleep(0.5)
    pg.screenshot(path='/tmp/claude-0/shots/scare.png')
    b.close()
srv.kill()
print(errs or 'no errors')
