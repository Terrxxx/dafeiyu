import subprocess,socket,struct,secrets,json,time,pathlib,concurrent.futures
containers=['dfy-qq-yutori','dfy-agent-yutori','dfy-qq-whyn1o','dfy-agent-whyn1o'];address=socket.gethostbyname('myip.ipip.net');pids={c:subprocess.check_output(['docker','inspect',c,'--format','{{.State.Pid}}'],text=True).strip() for c in containers}
def tcp(c,timeout=6,retries=2):
 for attempt in range(retries):
  r=subprocess.run(['nsenter','-t',pids[c],'-n','curl','--noproxy','*','--max-time',str(timeout),'--silent','--resolve','myip.ipip.net:80:'+address,'http://myip.ipip.net'],capture_output=True,text=True)
  if r.returncode==0 and '106.52.17.21' in r.stdout:break
 return {'succeeded':r.returncode==0,'serverExit':'106.52.17.21' in r.stdout}
def dns(c,server='198.18.78.1',name='qq.com'):
 code="import socket,struct,secrets,json; q=struct.pack('!HHHHHH',secrets.randbelow(65536),256,1,0,0,0)+b''.join(bytes([len(p)])+p.encode() for p in "+repr(name)+".split('.'))+bytes(1)+struct.pack('!HH',1,1);s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);s.settimeout(8);s.connect(("+repr(server)+",53));s.send(q);r=s.recv(4096);v=struct.unpack('!HHHHHH',r[:12]);print(json.dumps({'rcode':v[1]&15,'answers':v[3]}))"
 r=subprocess.run(['nsenter','-t',pids[c],'-n','python3','-c',code],capture_output=True,text=True);return json.loads(r.stdout) if r.returncode==0 else {'timeout':True}
report={'containers':{c:tcp(c) for c in containers},'hardcodedDNSIntercept':{c:dns(c,'192.168.1.1') for c in containers}}
print(json.dumps(report),flush=True)
assert all(v['serverExit'] for v in report['containers'].values());assert all(v.get('answers',0)>0 for v in report['hardcodedDNSIntercept'].values())
try:
 subprocess.run(['systemctl','stop','dafeiyu-qq-socks.service'],check=True)
 with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
  jobs={c:pool.submit(tcp,c,4,1) for c in containers};query=pool.submit(dns,containers[1],'198.18.78.1',secrets.token_hex(6)+'.example.net');report['proxyDown']={c:j.result() for c,j in jobs.items()};report['dnsProxyDown']=query.result()
 assert not any(v['succeeded'] for v in report['proxyDown'].values());assert report['dnsProxyDown'].get('rcode')==2 or report['dnsProxyDown'].get('timeout')
finally:subprocess.run(['systemctl','start','dafeiyu-qq-socks.service'],check=True)
for attempt in range(8):
 if tcp(containers[1])['serverExit']:break
 time.sleep(1)
else:raise RuntimeError('Proxy did not recover')
report['recovered']=tcp(containers[1]);print(json.dumps(report))
p=pathlib.Path('/opt/dafeiyu/backups/full-egress-20261028/network-verification.json');p.write_text(json.dumps(report,indent=2))
