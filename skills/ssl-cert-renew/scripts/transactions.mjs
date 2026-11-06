// Read-only transaction collectors plus the mandatory local once-only submit gate.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
const execute=promisify(execFile);

const requireValue=(condition,message)=>{if(!condition)throw new Error(message);};
const fresh=data=>requireValue(Number.isFinite(Date.parse(data?.observed_at)) &&
  Date.now()-Date.parse(data.observed_at)>=0 && Date.now()-Date.parse(data.observed_at)<=600000,'证据过旧或时间无效，请只读重查');
const one=(text,expression,label)=>{
  const values=[...text.matchAll(expression)].map(m=>m[1]);
  requireValue(values.length===1,'缺少或重复字段：'+label);return values[0].trim();
};

export function collectTransactionDOM({kind}) {
  // Serialized into the browser; return only non-secret, relevant fields.
  const base={kind,observed_at:new Date().toISOString(),source_url:location.href};
  const text=document.body.innerText;
  if(kind==='quote') {
    const start=text.indexOf('订单详情'),end=text.indexOf('我已阅读',start);
    if(start<0||end<0)return null;
    const summary=text.slice(start,end);
    if(!/应付费用\s*[¥￥]\s*\d/.test(summary))return null;
    return {...base,summary};
  }
  if(kind==='instance') {
    const ids=[...new Set([...text.matchAll(/CertIdentifier:\s*([0-9]+-[a-z0-9-]+)/g)].map(m=>m[1]))];
    if(!ids.length)return null;
    return {...base,certificate_ids:ids,instance_id:text.match(/订阅实例ID\s*(cas_[a-z0-9-]+)/)?.[1],
      status_text:text.match(/实例状态\s*([^\n]+)/)?.[1],source_text:text.match(/证书来源\s*([^\n]+)/)?.[1]};
  }
  let root=document.body;
  if(kind==='preview') {
    const dialogs=[...document.querySelectorAll('[role="dialog"]')].filter(e=>e.getBoundingClientRect().height>0&&e.innerText.includes('任务预览'));
    if(dialogs.length!==1)return null;
    root=dialogs[0];
  }
  const content=root.innerText;
  if(!/deploy-task-\d+/.test(content)||!/cas-job-user-[a-z0-9]+/.test(content))return null;
  const rows=[...root.querySelectorAll('tr')].map(row=>[...row.querySelectorAll(':scope > td')].map(e=>e.innerText.trim()))
    .map(cells=>cells.length>1&&!/^[a-zA-Z0-9.-]+$/.test(cells[0])&&/^[a-zA-Z0-9.-]+$/.test(cells[1])&&cells[1].includes('.')?cells.slice(1):cells)
    .filter(cells=>cells.length>=5&&/^[a-zA-Z0-9.-]+$/.test(cells[0])&&cells[0].includes('.'));
  if(!rows.length)return null;
  if(kind==='preview')return {...base,counts_text:content.match(/共选择\s*\d+\s*个资源，匹配\s*\d+\s*张证书，消耗\s*\d+\s*次部署额度/)?.[0],
    schedule_text:content.match(/部署时间\s*([^\n]+)/)?.[1],type_text:content.match(/证书类型\s*([^\n]+)/)?.[1],
    task_name:content.match(/deploy-task-\d+/)?.[0],task_id:content.match(/cas-job-user-[a-z0-9]+/)?.[0],rows};
  if(kind==='task')return {...base,task_name:content.match(/deploy-task-\d+/)?.[0],
    task_id:content.match(/cas-job-user-[a-z0-9]+/)?.[0],rows};
  throw new Error('未知页面类型');
}

function source(raw,kind) {
  fresh(raw);requireValue(raw.kind===kind,'采集类型不匹配');
  const url=new URL(raw.source_url);
  requireValue(url.protocol==='https:' && url.port==='' && !url.username && !url.password,'不是可信控制台地址');
  if(kind==='quote')requireValue(url.hostname==='yundun.console.aliyun.com'&&url.hash.startsWith('#/testSSL/'),'不是免费证书购买页');
  else requireValue(url.hostname==='yundunnext.console.aliyun.com','不是 CAS 控制台');
  return url;
}

function accountContext(account) {
  fresh(account);
  requireValue(typeof account.account_id==='string'&&account.account_id.trim()&&typeof account.domain==='string','缺少独立账号/域名观测');
  return {account_id:account.account_id,domain:account.domain};
}

export function parseQuote(raw,account) {
  source(raw,'quote');const context=accountContext(account),text=raw.summary;
  requireValue(typeof text==='string'&&text.length<=10000,'购买摘要无效');
  requireValue(one(text,/证书类型\s*([^\n]+)/g,'证书类型')==='DV-个人测试证书（免费版）','只允许个人免费版');
  requireValue(one(text,/证书服务版本\s*([^\n]+)/g,'服务版本')==='基础版','只允许基础版');
  const quantity=Number(one(text,/证书实例数量\s*(\d+)\s*(?:\n|$)/g,'数量'));
  const days=Number(one(text,/证书有效期\s*(\d+)\s*天/g,'有效期'));
  requireValue(quantity===1&&days===90,'不是单张 90 天免费证书');
  requireValue(/专家人工服务\s*不需要/.test(text)&&/稳定性保障\s*无/.test(text),'附加服务未关闭');
  requireValue(/订阅时长\s*90\s*天/.test(text),'订阅时长不符');
  for(const label of ['单域名费用','服务版本费用','增值服务费用','专家人工服务']) {
    const value=one(text,new RegExp(label+'\\s*[¥￥]\\s*([0-9]+(?:\\.[0-9]{1,2})?)(?=\\s|$)','g'),label);
    requireValue(Number(value)===0,'存在非零费用：'+label);
  }
  const payable=one(text,/应付费用\s*[¥￥]\s*([0-9]+(?:\.[0-9]{1,2})?)(?=\s|$)/g,'最终应付');
  requireValue(Number(payable)===0,'应付金额非零，停止');
  // Chinese aliyun.com purchase page + yuan sign is the explicit CNY source.
  return {...context,kind:'quote',observed_at:raw.observed_at,source_url:raw.source_url,
    product:'aliyun-personal-free',validity_days:days,quantity,currency:'CNY',payable,paid_addons:false};
}

function rowTarget(cells) {
  const domain=cells[0].toLowerCase().replace(/\.$/,'');
  requireValue(/^[a-z0-9.-]+$/.test(domain),'目标域名格式不明');
  const parts=cells[1].split('/').map(s=>s.trim());
  requireValue(parts.length===2&&/^[a-z0-9-]+$/.test(parts[1]),'OSS 地域/Bucket 不明确');
  // Add new display mappings only after observing their console representation.
  const region=parts[0]==='华东1（杭州）'?'cn-hangzhou':/^[a-z]+-[a-z0-9-]+$/.test(parts[0])?parts[0]:null;
  requireValue(region,'尚未识别此地域显示，请只读核对并补充映射');
  const certificate_id=one(cells[2],/CertIdentifier:\s*(\d+-[a-z0-9-]+)/g,'CertIdentifier');
  const instance_id=one(cells[2],/(cas_[a-z0-9-]+)/g,'证书实例');
  return {domain,resource:{type:'OSS',id:`oss://${region}/${parts[1]}/${domain}`,bucket:parts[1],region},certificate_id,instance_id};
}

export function parsePreview(raw,account) {
  const url=source(raw,'preview'),context=accountContext(account);
  const route=url.hash.match(/^#\/deployCreateTask\/user\?(.*)$/);
  requireValue(route,'不是部署创建向导');
  const params=new URLSearchParams(route[1]),rid=params.getAll('resourceIds');
  requireValue(params.getAll('resourceType').length===1&&params.get('resourceType')==='OSS'&&rid.length===1&&/^\d+$/.test(rid[0]),'必须只有一个 OSS 资源 ID');
  const counts=raw.counts_text?.match(/^共选择\s*(\d+)\s*个资源，匹配\s*(\d+)\s*张证书，消耗\s*(\d+)\s*次部署额度$/);
  requireValue(counts&&counts.slice(1).join(',')==='1,1,0','预览必须一个资源、一个证书、零次额度');
  requireValue(raw.rows?.length===1,'预览行数不为一');
  requireValue(raw.type_text==='个人测试证书（原免费证书）'&&raw.schedule_text==='立即部署','预览类型或时间不符');
  requireValue(/^deploy-task-\d+$/.test(raw.task_name)&&/^cas-job-user-[a-z0-9]+$/.test(raw.task_id),'预览未完成加载任务标识');
  const row=rowTarget(raw.rows[0]);requireValue(row.domain===context.domain,'预览域名不匹配');
  requireValue(raw.rows[0][4]==='已开启'&&raw.rows[0][5]==='未部署','不是已有 HTTPS 资源的待部署预览');
  return {...context,kind:'preview',observed_at:raw.observed_at,source_url:raw.source_url,...row,
    ids:{task_id:raw.task_id,task_name:raw.task_name,certificate_id:row.certificate_id,instance_id:row.instance_id,cas_resource_id:rid[0]},
    resource_count:1,domain_count:1,currency:'CNY',payable:'0.00',paid_deployment_units:0,schedule:'immediate',
    price_basis:'aliyun-personal-free-and-zero-deployment-units'};
}

export function parseInstance(raw,account) {
  const url=source(raw,'instance'),context=accountContext(account);
  const route=url.hash.match(/^#\/instanceDetail\/(cas_[a-z0-9-]+)\/[a-z0-9-]+$/);
  requireValue(route&&route[1]===raw.instance_id,'实例地址与页面不一致');
  requireValue(raw.source_text==='个人测试'&&raw.status_text==='已签发','不是已签发个人证书');
  requireValue(raw.certificate_ids?.length===1,'实例下证书不唯一，不能猜测');
  return {...context,kind:'instance',observed_at:raw.observed_at,source_url:raw.source_url,
    product:'aliyun-personal-free',status:'issued',instance_id:raw.instance_id,certificate_id:raw.certificate_ids[0]};
}

export function parseTask(raw,account,expected) {
  const url=source(raw,'task'),context=accountContext(account);
  const detail=url.hash.match(/^#\/deployDetail\/user\/(\d+)$/);
  requireValue(detail&&raw.task_name===expected.task_name&&raw.task_id===expected.task_id,'不是已记录的原部署任务');
  requireValue(!expected.detail_id||expected.detail_id===detail[1],'部署详情 ID 不符');
  requireValue(raw.rows?.length===1,'任务资源数量不为一');
  const row=rowTarget(raw.rows[0]);
  requireValue(row.domain===context.domain&&row.certificate_id===expected.certificate_id,'任务域名或新证书不符');
  requireValue(/^\d+$/.test(expected.cas_resource_id),'缺少原预览的资源映射');
  const status={'待部署':'pending','部署中':'pending','部署成功':'success','部署失败':'failed'}[raw.rows[0][4]]||'unknown';
  return {...context,kind:'task',observed_at:raw.observed_at,source_url:raw.source_url,resource:row.resource,status,can_submit:false,
    ids:{task_id:raw.task_id,task_name:raw.task_name,certificate_id:row.certificate_id,instance_id:row.instance_id,
      cas_resource_id:expected.cas_resource_id,detail_id:detail[1]}};
}

export async function readTransaction(page,kind,account) {
  requireValue(['quote','preview','instance'].includes(kind),'请使用 readDeploymentStatus 查询部署任务');
  await page.waitForFunction(collectTransactionDOM,{kind},{timeout:15000});
  const raw=await page.evaluate(collectTransactionDOM,{kind});
  return {quote:parseQuote,preview:parsePreview,instance:parseInstance}[kind](raw,account);
}

export async function readDeploymentStatus(page,account,expected) {
  // Always refresh the SAME task; a stale enabled button is never a reason to submit.
  const url=new URL(await page.url());
  requireValue(url.hostname==='yundunnext.console.aliyun.com'&&/^#\/deployDetail\/user\/\d+$/.test(url.hash),'先进入已观察到的原任务详情');
  await page.reload();
  await page.waitForFunction(collectTransactionDOM,{kind:'task'},{timeout:15000});
  return parseTask(await page.evaluate(collectTransactionDOM,{kind:'task'}),account,expected);
}

export function toReceipt(evidence) {
  fresh(evidence);
  requireValue(['preview','instance'].includes(evidence.kind),'只转换已验证预览或已签发实例');
  return {account_id:evidence.account_id,domain:evidence.domain,observed_at:evidence.observed_at,status:'success',
    ids:evidence.kind==='preview'?{...evidence.ids}:{certificate_id:evidence.certificate_id,instance_id:evidence.instance_id}};
}

export async function guardedSubmit(page,selector,run) {
  const snapshot=JSON.parse(await readFile(run.snapshot,'utf8'));
  if(run.action==='order') {
    const current=await readTransaction(page,'quote',snapshot);
    for(const field of ['product','validity_days','quantity','currency','payable','paid_addons'])
      requireValue(current[field]===snapshot.order[field],'购买页与已检查摘要变化：'+field);
  }
  if(run.action==='deployment') {
    const current=await readTransaction(page,'preview',snapshot),expected=snapshot.preview;
    requireValue(current.account_id===expected.account_id&&current.domain===expected.domain,'当前部署预览目标变化');
    for(const field of ['type','id','bucket','region'])requireValue(current.resource[field]===expected.resource[field],'当前部署资源变化');
    requireValue(current.ids.certificate_id===expected.new_certificate_id&&current.ids.instance_id===snapshot.new_certificate.instance_id&&current.ids.task_id===expected.task_instance&&
      current.ids.task_name===expected.task_name&&current.ids.cas_resource_id===expected.cas_resource_id,'当前预览证书或任务变化');
  }
  const script=fileURLToPath(new URL('./runtime.py',import.meta.url));
  const args=['-B',script,'--account',run.account_id,'--domain',run.domain];
  if(run.state_root)args.push('--state-root',run.state_root);
  args.push('intent','--owner',run.owner,'--action',run.action,'--snapshot',run.snapshot);
  if(run.ids_file)args.push('--ids-file',run.ids_file);
  if(run.payment_evidence)args.push('--payment-evidence',run.payment_evidence);
  let result;
  try {
    const response=await execute('python3',args,{timeout:10000,maxBuffer:262144});
    result=JSON.parse(response.stdout);
  } catch(error) {
    let reason='运行检查失败，保留原状态并查询，不提交';
    try{reason=JSON.parse(error.stdout).reason||reason;}catch{}
    throw new Error(reason);
  }
  requireValue(result.decision==='allowed_once','没有获得本次唯一提交许可');
  // Intent stays submitting on timeout, crash or lost response; never retry here.
  return page.click(selector);
}
