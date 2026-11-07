#!/usr/bin/python3
import sys,subprocess,json,ipaddress,pathlib,fcntl,time,os
BASE=pathlib.Path('/var/lib/dafeiyu-qq-egress');TABLE='10078';PRIO='18078';TUN='dfyqq0';DNS='198.18.78.1'
def run(*args,check=True):return subprocess.run(list(args),capture_output=True,text=True,check=check).stdout.strip()
def ip(*args,check=True):return run('/usr/sbin/ip',*args,check=check)
def rule(address):
 rows=json.loads(ip('-j','-4','rule','show'))
 if not any(str(r.get('table'))==TABLE and r.get('src') in (address,address+'/32') for r in rows):ip('-4','rule','add','priority',PRIO,'from',address+'/32','table',TABLE)
def routes():
 ip('-4','route','replace','prohibit','default','metric','32760','table',TABLE)
 for cidr in ['10.0.0.0/8','172.16.0.0/12','192.168.0.0/16','127.0.0.0/8','169.254.0.0/16','224.0.0.0/4']:ip('-4','route','replace','throw',cidr,'table',TABLE)
def append(table,chain,*args):
 cmd=['/usr/sbin/iptables','-w','10','-t',table]
 if subprocess.run(cmd+['-C',chain,*args],capture_output=True).returncode:run(*cmd,'-A',chain,*args)
def filter_for(address):
 # Docker's raw-table bridge isolation otherwise drops replies injected by the TUN.
 if subprocess.run(['/usr/sbin/iptables','-w','10','-t','raw','-C','PREROUTING','-i',TUN,'-d',address,'-p','tcp','-j','ACCEPT'],capture_output=True).returncode:run('/usr/sbin/iptables','-w','10','-t','raw','-I','PREROUTING','1','-i',TUN,'-d',address,'-p','tcp','-j','ACCEPT')
 run('/usr/sbin/iptables','-w','10','-t','filter','-N','DFY_QQ_OUT',check=False)
 if subprocess.run(['/usr/sbin/iptables','-w','10','-C','DOCKER-USER','-j','DFY_QQ_OUT'],capture_output=True).returncode:run('/usr/sbin/iptables','-w','10','-I','DOCKER-USER','1','-j','DFY_QQ_OUT')
 append('filter','DFY_QQ_OUT','-s',address,'-o',TUN,'-p','tcp','-j','ACCEPT')
 append('filter','DFY_QQ_OUT','-s',address,'-o',TUN,'-j','REJECT','--reject-with','icmp-port-unreachable')
 append('filter','DFY_QQ_OUT','-d',address,'-i',TUN,'-j','ACCEPT')
 # Preserve original per-container addresses at the TUN endpoint.
 if subprocess.run(['/usr/sbin/iptables','-w','10','-t','nat','-C','POSTROUTING','-s',address,'-o',TUN,'-j','ACCEPT'],capture_output=True).returncode:run('/usr/sbin/iptables','-w','10','-t','nat','-I','POSTROUTING','1','-s',address,'-o',TUN,'-j','ACCEPT')
def dns_base():
 # Resolver is private and the dedicated unprivileged UID can only reach the SSH proxy upstream.
 run('/usr/sbin/iptables','-w','10','-N','DFY_DNS_IN',check=False)
 run('/usr/sbin/iptables','-w','10','-N','DFY_DNS_OUT',check=False)
 import pwd
 uid=str(pwd.getpwnam('_dnscrypt-proxy').pw_uid)
 for proto in ['udp','tcp']:
  cmd=['/usr/sbin/iptables','-w','10']
  args=['-d',DNS,'-p',proto,'--dport','53','-j','DFY_DNS_IN']
  if subprocess.run(cmd+['-C','INPUT',*args],capture_output=True).returncode:run(*cmd,'-I','INPUT','1',*args)
 args=['-m','owner','--uid-owner',uid,'-j','DFY_DNS_OUT']
 if subprocess.run(['/usr/sbin/iptables','-w','10','-C','OUTPUT',*args],capture_output=True).returncode:run('/usr/sbin/iptables','-w','10','-I','OUTPUT','1',*args)
 append('filter','DFY_DNS_OUT','-d','127.0.0.1','-p','tcp','--dport','11080','-j','ACCEPT')
 append('filter','DFY_DNS_OUT','-s',DNS,'-d',DNS,'-j','ACCEPT')
 append('filter','DFY_DNS_IN','-i','lo','-j','ACCEPT')
 append('filter','DFY_DNS_IN','-j','DROP')
 append('filter','DFY_DNS_OUT','-j','REJECT')
def dns_for(address):
 for proto in ['udp','tcp']:
  args=['-s',address,'-p',proto,'--dport','53','-j','DNAT','--to-destination',DNS+':53']
  cmd=['/usr/sbin/iptables','-w','10','-t','nat']
  if subprocess.run(cmd+['-C','PREROUTING',*args],capture_output=True).returncode:run(*cmd,'-I','PREROUTING','1',*args)
  args=['-s',DNS,'-d',address,'-p',proto,'--sport','53','-j','ACCEPT']
  if subprocess.run(['/usr/sbin/iptables','-w','10','-C','DFY_DNS_OUT',*args],capture_output=True).returncode:run('/usr/sbin/iptables','-w','10','-I','DFY_DNS_OUT','1',*args)
 args=['-s',address,'-j','ACCEPT']
 if subprocess.run(['/usr/sbin/iptables','-w','10','-C','DFY_DNS_IN',*args],capture_output=True).returncode:run('/usr/sbin/iptables','-w','10','-I','DFY_DNS_IN','1',*args)
def local_isolation(address,subnet,gateway):
 for chain,hook in [('DFY_TENANT_LAN','DOCKER-USER'),('DFY_TENANT_HOST','INPUT')]:
  run('/usr/sbin/iptables','-w','10','-N',chain,check=False)
  if subprocess.run(['/usr/sbin/iptables','-w','10','-C',hook,'-j',chain],capture_output=True).returncode:run('/usr/sbin/iptables','-w','10','-I',hook,'1','-j',chain)
 append('filter','DFY_TENANT_LAN','-s',address,'-d',str(subnet),'-j','RETURN')
 for dest in ['10.0.0.0/8','172.16.0.0/12','192.168.0.0/16','169.254.0.0/16','224.0.0.0/4']:
  append('filter','DFY_TENANT_LAN','-s',address,'-d',dest,'-j','REJECT','--reject-with','icmp-port-unreachable')
 for dest in [DNS,str(gateway)]:append('filter','DFY_TENANT_HOST','-s',address,'-d',dest,'-j','RETURN')
 append('filter','DFY_TENANT_HOST','-s',address,'-j','REJECT','--reject-with','icmp-port-unreachable')
def ensure(network):
 if not network.startswith('dfy-net-'):raise ValueError('Invalid tenant network')
 name=network[len('dfy-net-'):]
 import re
 if not re.fullmatch('[a-z][a-z0-9_]{2,23}',name):raise ValueError('Invalid tenant')
 net=json.loads(run('/usr/bin/docker','network','inspect',network))[0]
 if net.get('Labels',{}).get('dafeiyu.owner')!=name or net.get('EnableIPv6'):raise ValueError('Network ownership or IPv6 mismatch')
 settings=next(c for c in net['IPAM']['Config'] if ':' not in c['Subnet']);subnet=ipaddress.ip_network(settings['Subnet']);gateway=ipaddress.ip_address(settings['Gateway']);address=str(gateway+1)
 if not subnet.is_private or gateway+1 not in subnet:raise ValueError('Invalid subnet')
 addresses={address,str(gateway+2)}
 for entry in net.get('Containers',{}).values():
  if entry.get('Name') in ('dfy-qq-'+name,'dfy-agent-'+name):addresses.add(str(ipaddress.ip_interface(entry['IPv4Address']).ip))
 with open(BASE/'lock','a') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX);routes();dns_base()
  if pathlib.Path('/sys/class/net/'+TUN).exists():ip('-4','route','replace','default','dev',TUN,'metric','10','table',TABLE)
  for value in addresses:rule(value);filter_for(value);dns_for(value);local_isolation(value,subnet,gateway)
  file=BASE/'addresses.json';known=set(json.loads(file.read_text())) if file.exists() else set();known.update(addresses);temp=BASE/'addresses.tmp';temp.write_text(json.dumps(sorted(known)));temp.chmod(0o600);os.replace(temp,file)
 return str(gateway+2) if len(sys.argv)>3 and sys.argv[3]=='agent' else address
mode=sys.argv[1]
if mode=='guard':
 routes();dns_base();file=BASE/'addresses.json'
 for address in json.loads(file.read_text()) if file.exists() else []:
  if not ipaddress.ip_address(address).is_private:raise ValueError('Invalid saved address')
  rule(address);dns_for(address)
elif mode=='tun':
 if not pathlib.Path('/sys/class/net/'+TUN).exists():ip('tuntap','add','dev',TUN,'mode','tun')
 ip('addr','replace','198.18.78.1/30','dev',TUN);ip('link','set','dev',TUN,'mtu','1400','up');run('/usr/sbin/sysctl','-w','net.ipv4.conf.'+TUN+'.rp_filter=2');routes();ip('-4','route','replace','default','dev',TUN,'metric','10','table',TABLE)
elif mode=='ensure':print(ensure(sys.argv[2]))
elif mode=='watch':
 while True:
  try:
   networks=run('/usr/bin/docker','network','ls','--filter','label=dafeiyu.owner','--format','{{.Name}}').splitlines()
   for network in networks:
    if network.startswith('dfy-net-'):ensure(network)
  except Exception:print('QQ egress reconciliation failed; dedicated routes remain fail-closed',file=sys.stderr,flush=True)
  time.sleep(5)
