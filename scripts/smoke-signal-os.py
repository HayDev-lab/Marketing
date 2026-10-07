import os, subprocess, urllib.request, urllib.error, json, time
from pathlib import Path
root=str(Path(__file__).resolve().parents[1])
db_path=Path('/tmp') / ('marketing-qa-'+str(os.getpid())+'.db')
env=dict(os.environ,DATABASE_URL='file:'+str(db_path))
subprocess.run(['./node_modules/.bin/prisma','db','push','--skip-generate'],cwd=root,env=env,check=True,stdout=subprocess.DEVNULL)
log=open('/tmp/marketing-smoke-server.log','w')
server=subprocess.Popen(['./node_modules/.bin/next','start','-H','127.0.0.1','-p','3010'],cwd=root,env=env,stdout=log,stderr=log)
client=urllib.request.build_opener(urllib.request.ProxyHandler({}))
try:
 for i in range(40):
  try:
   r=client.open('http://127.0.0.1:3010/',timeout=2)
   print('HOME',r.status); break
  except Exception as e:
   if server.poll() is not None: raise RuntimeError(open('/tmp/marketing-smoke-server.log').read())
   time.sleep(.25)
 else: raise RuntimeError('Local HTTP connection unavailable')
 def call(path,body=None,token=None,method=None):
  headers={'content-type':'application/json'}
  if token: headers['x-session-token']=token
  req=urllib.request.Request('http://127.0.0.1:3010'+path,data=json.dumps(body).encode() if body else None,headers=headers,method=method)
  try:
   res=client.open(req); return res.status,json.load(res)
  except urllib.error.HTTPError as e:return e.code,json.load(e)
 print('ASSETS_UNAUTH',call('/api/assets')[0])
 assert call('/api/settings/cloud')[0]==401
 email='qa-signal-'+str(int(time.time()))+'@example.test'
 status,auth=call('/api/auth',{'action':'register','email':email,'password':'SignalQA-2026-Safe!','name':'Signal QA','locale':'en'})
 print('REGISTER',status,auth.get('ok')); assert status==200 and auth.get('ok')
 token=auth.get('data',{}).get('sessionToken'); assert token
 status,login=call('/api/auth',{'action':'login','email':email,'password':'SignalQA-2026-Safe!'})
 print('LOGIN',status); assert status==200
 status,data=call('/api/brands',{'name':'Signal QA Furniture','website':'https://example.com'},token)
 print('BUSINESS_CREATE',status); assert status==201
 brand=data['data']['id']
 status,data=call('/api/content',{'brandId':brand,'title':'Signal QA manual post','caption':'Test draft','contentType':'POST','platform':'instagram','language':'en','aiWrite':False},token)
 print('DRAFT_CREATE',status); assert status==201
 draft=data['data']['id']
 status,data=call('/api/content/'+draft,token=token); print('DRAFT_RELOAD',status); assert status==200
 status,data=call('/api/content/'+draft+'/transition',{'to':'READY_FOR_REVIEW'},token); assert status==200
 status,data=call('/api/content/'+draft+'/transition',{'to':'APPROVED'},token); print('NO_MEDIA_APPROVAL_GUARD',status); assert status==400
 status,data=call('/api/schedule',{'contentItemId':draft,'scheduledAt':'2027-01-01T00:00:00Z'},token);print('UNAPPROVED_SCHEDULE_GUARD',status); assert status==400
 status,data=call('/api/autopilot',{'enabled':True},token,method='PATCH');print('FREE_AUTOPILOT_GUARD',status); assert status==402
 for path in ['/api/settings/cloud','/api/auth/me','/api/assets','/api/brands','/api/subscription','/api/autopilot','/api/jobs']:
  status,data=call(path,token=token);print(path,status,data.get('ok')); assert status==200 and data.get('ok')
 status,data=call('/api/autopilot',{'enabled':False,'paidGeneration':False},token,method='PATCH');print('STOP',status,data.get('data',{}).get('enabled')); assert status==200 and data['data']['enabled'] is False
finally:
 server.terminate();server.wait(timeout=15);log.close(); db_path.unlink(missing_ok=True)
