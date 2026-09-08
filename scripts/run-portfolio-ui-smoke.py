import os, sys, tempfile, json, subprocess
from pathlib import Path
root=Path(__file__).resolve().parents[1]
tmp=Path(tempfile.mkdtemp(prefix='keywords-portfolio-ui-'))
env=os.environ.copy()
env.update(KEYWORDS_DB_PATH=str(tmp/'test.sqlite'),KEYWORDS_API_PORT='18787',VITE_API_BASE_URL='http://127.0.0.1:18787',KEYWORDS_OPERATOR_INTERVAL_MINUTES='0',KEYWORDS_ANALYTICS_FILE=str(tmp/'snapshot.json'))
(tmp/'snapshot.json').write_text(json.dumps({'generatedAt':'2026-09-08T00:00:00Z','period':{'start':'2026-08-09','end':'2026-09-05','previousStart':'2026-07-12','previousEnd':'2026-08-08'},'sites':[{'name':'Fixture','host':'fixture.example','gsc':{'current':{'total':{'clicks':5,'impressions':100}},'previous':{'total':{'clicks':20}}},'ga4':{'current':{'total':{'sessions':0}},'previous':{'total':{'sessions':30}}}}]}))
# The generic helper leaves shell children running on Windows. Own Node processes directly.
import socket, time
for port in [18787,15173]:
    with socket.socket() as sock:
        if sock.connect_ex(('127.0.0.1',port)) == 0:
            raise RuntimeError(f'Test port {port} is already in use')
processes=[]
try:
    for args,port in [(['node','--import','tsx/esm','apps/api/src/index.ts'],18787),(['node','node_modules/vite/bin/vite.js','apps/web','--host','127.0.0.1','--port','15173','--strictPort'],15173)]:
        log=(tmp/f'{port}.log').open('w',encoding='utf-8')
        process=subprocess.Popen(args,cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT,creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
        processes.append((process,log))
        deadline=time.monotonic()+30
        while True:
            if process.poll() is not None: raise RuntimeError(f'Server failed; see {tmp}')
            with socket.socket() as sock:
                if sock.connect_ex(('127.0.0.1',port))==0: break
            if time.monotonic()>deadline: raise RuntimeError(f'Server timeout; see {tmp}')
            time.sleep(.2)
    subprocess.run([sys.executable,'scripts/portfolio-ui-smoke.py'],cwd=root,env=env,check=True)
finally:
    for process,log in reversed(processes):
        if process.poll() is None:
            if os.name=='nt': subprocess.run(['taskkill','/PID',str(process.pid),'/T','/F'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            else: process.terminate()
            process.wait(timeout=10)
        log.close()
