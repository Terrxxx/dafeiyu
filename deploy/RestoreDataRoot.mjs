import fs from 'node:fs';
import {Accounts} from '../manager/accounts.js';
import {Tenants} from '../manager/tenants.js';
let input='';for await(const chunk of process.stdin)input+=chunk;const plan=JSON.parse(input);
const root='/opt/dafeiyu/data';if(!fs.existsSync(root+'/.platform/master.key'))throw Error('Migrated encryption key is missing');
const accounts=new Accounts(root+'/.platform'),tenants=new Tenants(accounts,{dataRoot:root}),results=[];
try{
 const counts=Object.fromEntries(['users','bots','sessions','invites','audit','settings'].map(table=>[table,accounts.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n]));
 for(const key of Object.keys(counts))if(counts[key]!==plan.counts[key])throw Error('Database row count changed during migration: '+key);
 if(accounts.db.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw Error('Migrated database integrity failed');
 for(const user of plan.users){const bot=accounts.bot(user.username);if(!bot?.secrets?.apiKey||!bot.secrets.napcatToken||!bot.secrets.webuiToken)throw Error('Cannot decrypt migrated credentials');}
 console.log(JSON.stringify({phase:'database-and-credentials-verified',counts}));
 for(const user of plan.users){const name=user.username,result={username:name,qqRestored:false,agentRestored:false};try{
  if(user.disabled){result.disabled=true;results.push(result);continue;}
  const qqWasRunning=plan.containers.some(c=>c.username===name&&c.kind==='qq'&&c.running),agentWasRunning=plan.containers.some(c=>c.username===name&&c.kind==='agent'&&c.running);
  if(qqWasRunning||(agentWasRunning&&user.desired&&!user.billing)){
   await tenants.provision(name);let loggedIn=false;
   for(let attempt=0;attempt<30;attempt++){try{if((await tenants.qqStatus(name)).loggedIn){loggedIn=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,1000));}
   result.qqRestored=loggedIn;console.log(JSON.stringify({phase:'qq-check',username:name,loggedIn}));
   if(!loggedIn){result.needsQQLogin=true;results.push(result);continue;}
  }
  if(agentWasRunning&&user.desired&&!user.billing){const state=await tenants.control(name,'start');result.agentRestored=state.phase==='running';}
  results.push(result);console.log(JSON.stringify({phase:'restored',...result}));
 }catch(error){result.error=String(error.message).split('\n')[0].slice(0,200);results.push(result);console.log(JSON.stringify({phase:'needs-attention',username:name,error:result.error}));}}
 console.log(JSON.stringify({phase:'restore-complete',results}));
}catch(error){console.error('Restore verification failed: '+String(error.message).split('\n')[0]);process.exitCode=1;}finally{accounts.close();}
