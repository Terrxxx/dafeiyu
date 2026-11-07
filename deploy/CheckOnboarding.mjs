import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {Accounts} from '../manager/accounts.js';
import {Tenants} from '../manager/tenants.js';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'dfy-onboarding-')),accounts=new Accounts(root);
accounts.db.prepare('INSERT INTO users(username,created,email) VALUES(?,?,lower(hex(randomblob(8)))||char(64,101,120,97,109,112,108,101,46,116,101,115,116))').run('onboardcheck',Date.now());
const tenants=new Tenants(accounts,{request:(url,options)=>url==='https://api.deepseek.com/user/balance'?Promise.resolve(Response.json({is_available:true,balance_infos:[]})):fetch(url,options)});
try{
 await tenants.create('onboardcheck',{qq:'123456789',adminQQ:'987654321',apiKey:'local-onboarding-test-only'});
 await tenants.provision('onboardcheck');
 let qr,last;
 for(let n=0;n<20;n++){try{qr=await tenants.qr('onboardcheck');break;}catch(e){last=e;await new Promise(r=>setTimeout(r,1500));}}
 if(!qr)throw last;assert.match(qr.image,/^data:image\/png;base64,/);
 console.log(JSON.stringify({newUserDirectory:true,isolatedQQ:true,webQRCode:true,qqLoggedIn:false}));
 await tenants.runtime('stop-all','onboardcheck');
}finally{accounts.close();fs.rmSync(root,{recursive:true,force:true});}
