import http from 'node:http';
export function helper(operation, username, options={}) {
  return new Promise((resolve,reject)=>{
    const request=http.request({socketPath:process.env.DAFEIYU_HELPER_SOCKET||'/run/dafeiyu/helper.sock',path:'/',method:'POST',headers:{'Content-Type':'application/json'}},res=>{
      let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>{try{const result=JSON.parse(body);if(res.statusCode!==200)reject(new Error(result.error||'运行服务不可用'));else resolve(result);}catch{reject(new Error('运行服务返回无效数据'));}});
    });request.setTimeout(180000,()=>request.destroy(new Error('操作超时，请刷新状态后重试')));request.on('error',reject);request.end(JSON.stringify({operation,username,...options}));
  });
}
export {checkBalance} from '../src/api-balance.js';
