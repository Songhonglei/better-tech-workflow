// Offline replay of the observed Alibaba console layout; no cloud writes.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parseQuote,parsePreview,parseTask,parseInstance,collectTransactionDOM,readDeploymentStatus,guardedSubmit,toReceipt} from './transactions.mjs';

const account={account_id:'fixture-account',domain:'example.com',observed_at:new Date().toISOString()};
const quote={kind:'quote',observed_at:account.observed_at,source_url:'https://yundun.console.aliyun.com/?p=cas_buy#/testSSL/cn-hangzhou',
summary:'订单详情\n证书实例数量\n1\n证书类型\nDV-个人测试证书（免费版）\n证书品牌\nDigiCert\n证书服务版本\n基础版\n证书有效期\n90 天\n专家人工服务\n不需要\n稳定性保障\n无\n订阅时长\n90天\n单域名费用\n¥0.00\n服务版本费用\n¥0.00\n增值服务费用\n¥0.00\n专家人工服务\n¥0.00\n应付费用\n¥0.00\n查看明细\n'};
assert.equal(parseQuote(quote,account).payable,'0.00');
for(const [a,b] of [['免费版','Pro版'],['应付费用\n¥0.00','应付费用\n¥0.01'],['¥0.00','USD0.00'],
  ['90 天','180 天'],['数量\n1','数量\n2'],['不需要','需要'],['基础版','专业版'],['增值服务费用\n¥0.00','增值服务费用\n¥1.00']]) {
  assert.throws(()=>parseQuote({...quote,summary:quote.summary.replace(a,b)},account));
}
assert.throws(()=>parseQuote({...quote,summary:quote.summary+'应付费用\n¥0.00\n'},account));
assert.throws(()=>parseQuote({...quote,source_url:'https://untrusted.example/#/testSSL/cn-hangzhou'},account));
assert.throws(()=>parseQuote(quote,{...account,observed_at:'2020-01-01T00:00:00Z'}));

const cert='123-cn-hangzhou',instance='cas_dv-cn-fixture';
const row=['example.com','华东1（杭州）/fixture-bucket',`cert-fixture\n${instance}\nCertIdentifier:${cert}`,'example.com全部(2)','已开启','未部署','删除'];
const preview={kind:'preview',observed_at:account.observed_at,
  source_url:'https://yundunnext.console.aliyun.com/?p=cas#/deployCreateTask/user?resourceType=OSS&resourceIds=123',
  counts_text:'共选择\n1\n个资源，匹配\n1\n张证书，消耗\n0\n次部署额度',schedule_text:'立即部署',
  type_text:'个人测试证书（原免费证书）',task_name:'deploy-task-1',task_id:'cas-job-user-fixture',rows:[row]};
const parsed=parsePreview(preview,account);
assert.equal(parsed.ids.certificate_id,cert);assert.equal(parsed.resource.bucket,'fixture-bucket');
assert.equal(parsed.ids.cas_resource_id,'123');assert.equal(parsed.paid_deployment_units,0);
assert.throws(()=>parsePreview({...preview,counts_text:preview.counts_text.replace('匹配\n1','匹配\n2')},account));
assert.throws(()=>parsePreview({...preview,counts_text:preview.counts_text.replace('消耗\n0','消耗\n1')},account));
assert.throws(()=>parsePreview({...preview,rows:[row,row]},account));
assert.throws(()=>parsePreview({...preview,source_url:preview.source_url+',456'},account));
assert.throws(()=>parsePreview({...preview,rows:[['wrong.example',...row.slice(1)]]},account));
assert.throws(()=>parsePreview({...preview,rows:[[row[0],'未知地区/fixture-bucket',...row.slice(2)]]},account));
const meta={kind:'instance',observed_at:account.observed_at,source_url:`https://yundunnext.console.aliyun.com/?p=cas#/instanceDetail/${instance}/cn-hangzhou`,
  instance_id:instance,status_text:'已签发',source_text:'个人测试',certificate_ids:[cert]};
assert.equal(parseInstance(meta,account).certificate_id,cert);
assert.throws(()=>parseInstance({...meta,certificate_ids:[cert,'456-cn-hangzhou']},account));

const task={kind:'task',observed_at:account.observed_at,source_url:'https://yundunnext.console.aliyun.com/?p=cas#/deployDetail/user/456',
  task_id:preview.task_id,task_name:preview.task_name,rows:[[...row.slice(0,4),'部署成功','回滚']]};
assert.equal(parseTask(task,account,parsed.ids).status,'success');
assert.equal(parseTask(task,account,parsed.ids).can_submit,false);
assert.equal(parseTask({...task,rows:[[...row.slice(0,4),'未知状态','--']]},account,parsed.ids).status,'unknown');
assert.throws(()=>parseTask({...task,task_id:'other'},account,parsed.ids));
assert.throws(()=>parseTask(task,account,{...parsed.ids,detail_id:'999'}));

// A stale "立即部署" button and header success count must never override row state.
globalThis.location=new URL(task.source_url);
globalThis.document={body:{innerText:`部署成功\n0\n立即部署\n${preview.task_name}\n${preview.task_id}`,
  querySelectorAll:()=>[{querySelectorAll:()=>['',...task.rows[0]].map(innerText=>({innerText}))}]}};
const dom=collectTransactionDOM({kind:'task'});
assert.equal(parseTask(dom,account,parsed.ids).status,'success');
assert.equal(dom.rows[0][0],'example.com','strip checkbox column without losing target domain');
let reloads=0;
const page={url:async()=>task.source_url,reload:async()=>{reloads++;},waitForFunction:async()=>{},evaluate:async()=>task,
  click:async()=>{throw Error('read-only query cannot click');}};
assert.equal((await readDeploymentStatus(page,account,parsed.ids)).status,'success');
assert.equal(reloads,1);

// Exercise the real Python state gate with a fake page. Second click never occurs.
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'ssl-transaction-'));
try {
  const now=Date.now(),resource=parsed.resource;
  const snapshot={domain:account.domain,account_id:account.account_id,threshold_days:15,observed_at:new Date(now).toISOString(),resource,
    observed_target:{...account,resource},current:{source:'console_deployed',id:'old',sans:[account.domain],not_after:new Date(now+5*86400000).toISOString()},
    online_matches_current:true,order:{product:'aliyun-personal-free',validity_days:90,quantity:1,currency:'CNY',payable:'0.00',paid_addons:false,quota_available:true,existing_work:'none'},
    stage_evidence:{kind:'order'}};
  const filename=path.join(directory,'order.json');await fs.writeFile(filename,JSON.stringify(snapshot));
  const script=fileURLToPath(new URL('./runtime.py',import.meta.url)),root=path.join(directory,'state');
  const lease=JSON.parse(execFileSync('python3',['-B',script,'--account',account.account_id,'--domain',account.domain,'--state-root',root,'begin','--snapshot',filename],{encoding:'utf8',timeout:10000}));
  const run={...account,owner:lease.owner,state_root:root,action:'order',snapshot:filename};
  const quotePage={waitForFunction:async()=>{},evaluate:async()=>quote};
  let clicks=0;await guardedSubmit({...quotePage,click:async()=>{clicks++;throw Error('response lost');}},'current-submit',run).catch(()=>{});
  await assert.rejects(()=>guardedSubmit({...quotePage,click:async()=>{clicks++;}},'current-submit',run),/已有提交记录/);
  assert.equal(clicks,1,'lost response must not lead to another click');

  const deployRoot=path.join(directory,'deployment-state');
  const ready={...snapshot,new_certificate:{id:cert,instance_id:instance,account_id:account.account_id,product:'aliyun-personal-free',status:'issued',
    sans:[account.domain],not_before:new Date(now-3600000).toISOString(),not_after:new Date(now-3600000+90*86400000).toISOString(),fingerprint_sha256:'a'.repeat(64)}};
  const readyFile=path.join(directory,'ready.json');await fs.writeFile(readyFile,JSON.stringify(ready));
  const invoke=(...args)=>JSON.parse(execFileSync('python3',['-B',script,'--account',account.account_id,'--domain',account.domain,'--state-root',deployRoot,...args],{encoding:'utf8',timeout:10000}));
  const deployLease=invoke('begin','--snapshot',readyFile);
  invoke('adopt','--owner',deployLease.owner,'--snapshot',readyFile);
  await guardedSubmit({click:async()=>{}},'preview-button',{...account,owner:deployLease.owner,state_root:deployRoot,action:'preview',snapshot:readyFile});
  const receiptFile=path.join(directory,'preview-result.json');await fs.writeFile(receiptFile,JSON.stringify(toReceipt(parsed)));
  invoke('record','--owner',deployLease.owner,'--action','preview','--evidence',receiptFile);
  const deploy={...ready,stage_evidence:{kind:'deploy'},preview:{...parsed,old_certificate_id:'old',new_certificate_id:cert,
    cas_resource_id:parsed.ids.cas_resource_id,task_name:parsed.ids.task_name,task_instance:parsed.ids.task_id}};
  const deployFile=path.join(directory,'deploy.json');await fs.writeFile(deployFile,JSON.stringify(deploy));
  const deployRun={...account,owner:deployLease.owner,state_root:deployRoot,action:'deployment',snapshot:deployFile};
  const changed={...preview,rows:[[...row.slice(0,2),row[2].replace(instance,'cas_dv-cn-other'),...row.slice(3)]]};
  let deployClicks=0;
  await assert.rejects(()=>guardedSubmit({waitForFunction:async()=>{},evaluate:async()=>changed,click:async()=>{deployClicks++;}},'submit',deployRun),/预览证书或任务变化/);
  assert.equal(deployClicks,0);
  const previewPage={waitForFunction:async()=>{},evaluate:async()=>preview,click:async()=>{deployClicks++;throw Error('lost');}};
  await assert.rejects(()=>guardedSubmit(previewPage,'submit',deployRun),/lost/);
  await assert.rejects(()=>guardedSubmit(previewPage,'submit',deployRun),/已有提交记录/);
  assert.equal(deployClicks,1);
} finally {await fs.rm(directory,{recursive:true,force:true});}
console.log('Transaction regressions passed: quote/preview/instance/task identity, zero cost, stale buttons, refresh, once-only browser submission.');
