export async function checkBalance(key, request=fetch) {
  if(typeof key!=='string'||key.length<8||key.length>300||/[\s\x00-\x1f]/.test(key))throw Object.assign(new Error('请输入有效的 DeepSeek API Key'),{status:400});
  const response=await request('https://api.deepseek.com/user/balance',{headers:{Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(15000),redirect:'error'});
  if(response.status===401||response.status===403)throw Object.assign(new Error('API Key 无效或没有访问权限'),{status:400});
  if(response.status===402)return {available:false,balances:[],checkedAt:Date.now()};
  if(!response.ok)throw Object.assign(new Error('暂时无法查询 API 余额，请稍后重试'),{status:502});
  const value=await response.json();
  if(typeof value.is_available!=='boolean')throw new Error('余额接口返回异常');
  return {available:value.is_available,balances:(value.balance_infos||[]).map(row=>({currency:row.currency,total:row.total_balance})),checkedAt:Date.now()};
}
