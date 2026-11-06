#!/usr/bin/env python3
"""Local run leases and once-only submission intents. Never performs cloud writes."""
import argparse
from copy import deepcopy
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import ssl
import subprocess
import sys
import uuid
from contextlib import contextmanager

from evidence_io import external_path, write_json
from policy import domain_name, evaluate, moment, require, resource_match, unique_object, reject_constant, check_new, zero_price
from inspect_tls import decode_certificate

ACTIONS = ('order', 'payment', 'application', 'preview', 'deployment')
ID_KEYS = {'order_id', 'instance_id', 'certificate_id', 'task_id', 'task_name', 'detail_id', 'cas_resource_id'}


def read_json(path):
    return json.loads(Path(path).read_text(), object_pairs_hook=unique_object, parse_constant=reject_constant)


def stamp():
    return datetime.now(timezone.utc).isoformat()


def fresh(evidence):
    require(0 <= (datetime.now(timezone.utc)-moment(evidence.get('observed_at'))).total_seconds() <= 600,
            '证据超过 10 分钟或时间无效，请只读重查')


def identifiers(values):
    require(isinstance(values, dict) and not set(values)-ID_KEYS, '结果只接受已知公开业务 ID，禁止保存凭据或原始响应')
    for value in values.values():
        require(isinstance(value,str) and re.fullmatch(r'[A-Za-z0-9_-]{1,128}', value), '业务 ID 格式无效')
    return dict(values)


class Runtime:
    def __init__(self, root=None):
        self.root=external_path(root or Path.home()/'.local/state/ssl-cert-renew')

    def directory(self, account, domain):
        require(isinstance(account,str) and account.strip()==account and bool(account), '缺少稳定账号 UID')
        key=hashlib.sha256(json.dumps([account,domain_name(domain)],separators=(',',':')).encode()).hexdigest()
        return self.root/key

    @contextmanager
    def transaction(self, account, domain):
        directory=self.directory(account,domain)
        directory.mkdir(parents=True,exist_ok=True,mode=0o700)
        require(not directory.is_symlink(), '运行目录不可为符号链接')
        mutex=directory/'.mutex'
        fd=os.open(mutex,os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
        try:
            fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
            yield directory
        finally:
            os.close(fd)

    def load(self, directory, account, domain):
        state=read_json(directory/'state.json')
        require(state.get('schema')==1, '旧版或损坏记录不能直接执行；保留原记录并只读核对云端')
        require(state['target']['account_id']==account and state['target']['domain']==domain_name(domain), '运行目标不匹配')
        return state

    def owned(self, directory, owner):
        lock=read_json(directory/'run.lock')
        require(lock.get('owner')==owner, '运行锁不属于本次调用，已停止')

    def save(self, directory, state, event):
        state['updated_at']=stamp()
        state.setdefault('journal',[]).append({'at':state['updated_at'],**event})
        write_json(directory/'state.json',state)

    def begin(self, snapshot):
        gate=evaluate(snapshot)
        require(gate['decision']!='blocked', gate['reason'])
        account,domain=snapshot['account_id'],domain_name(snapshot['domain'])
        target={'account_id':account,'domain':domain,'resource':deepcopy(snapshot['resource'])}
        with self.transaction(account,domain) as directory:
            require(not (directory/'run.lock').exists(), '已有运行锁；先查询原任务，不能抢锁或换目录')
            state=read_json(directory/'state.json') if (directory/'state.json').exists() else None
            if state:
                if state.get('schema')==1:
                    state=self.load(directory,account,domain)
                    resource_match(state['target']['resource'],target['resource'])
                else:
                    require(state.get('phase')=='verified' and state.get('account_id')==account and state.get('domain')==domain,
                            '旧版未完成或身份不明记录须先只读恢复，不能覆盖')
                if state.get('phase')=='verified':
                    require(gate['decision']=='eligible',gate['reason'])
                    previous_id=state.get('new_certificate_id') or state.get('operations',{}).get('deployment',{}).get('ids',{}).get('certificate_id')
                    require(previous_id==snapshot['current']['id'], '已完成记录与当前绑定不一致，请先核对')
                    archive=directory/'history'/str(uuid.uuid4())
                    write_json(archive.with_suffix('.json'),state)
                    state=None
                else:
                    deployed=state.get('operations',{}).get('deployment',{}).get('ids',{}).get('certificate_id')
                    require(snapshot['current']['id'] in (state.get('baseline_id'),deployed), '未完成运行的绑定出现其他证书；只读核对后恢复')
            else:
                require(gate['decision']=='eligible',gate['reason'])
            state=state or {'schema':1,'run_id':uuid.uuid4().hex,'target':target,'baseline_id':snapshot['current']['id'],
                            'phase':'ready','operations':{},'journal':[]}
            owner=uuid.uuid4().hex
            lock={'owner':owner,'run_id':state['run_id'],'started_at':stamp()}
            fd=os.open(directory/'run.lock',os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
            try:
                inode=os.fstat(fd).st_ino
                with os.fdopen(fd,'w') as stream:
                    json.dump(lock,stream);stream.flush();os.fsync(stream.fileno())
                self.save(directory,state,{'event':'acquired'})
            except BaseException:
                # Remove only the exact lock just created. Existing state is preserved.
                if (directory/'run.lock').stat().st_ino==inode:
                    (directory/'run.lock').unlink()
                raise
            return {'decision':'acquired','owner':owner,'run_id':state['run_id'],'phase':state['phase'],
                    'operations':state['operations'],'directory':str(directory),'writes_performed':False}

    def adopt(self, account, domain, owner, snapshot):
        gate=evaluate(snapshot);require(gate['decision']=='eligible',gate['reason'])
        check_new(snapshot['new_certificate'],snapshot['current'],account,domain_name(domain),snapshot.get('threshold_days',15),datetime.now(timezone.utc))
        new=snapshot['new_certificate']
        ids=identifiers({'instance_id':new['instance_id'],'certificate_id':new['id']})
        with self.transaction(account,domain) as directory:
            self.owned(directory,owner);state=self.load(directory,account,domain)
            require(snapshot['account_id']==account and domain_name(snapshot['domain'])==domain_name(domain),'复用目标不符')
            resource_match(snapshot['resource'],state['target']['resource'])
            require(snapshot['current']['id']==state['baseline_id'],'复用时原证书已变化')
            require(not state['operations'],'已有操作须恢复原对象，不能另选证书')
            state['operations']['application']={'status':'success','ids':ids,'observed_at':snapshot['observed_at'],'reused':True}
            state['phase']='application_success'
            self.save(directory,state,{'event':'adopted','ids':ids})
            return {'decision':'adopted','writes_performed':False,'ids':ids}

    def status(self, account, domain):
        with self.transaction(account,domain) as directory:
            return self.load(directory,account,domain)

    def intent(self, account, domain, owner, action, snapshot, ids=None, payment_evidence=None):
        require(action in ACTIONS, '未知提交动作')
        stage='deploy' if action=='deployment' else 'order' if action in ('order','payment') else 'preflight'
        gate=evaluate(snapshot,stage)
        require(gate['decision']=='eligible',gate['reason'])
        if action in ('order','payment','deployment'):
            require(snapshot.get('stage_evidence',{}).get('kind')==('deploy' if action=='deployment' else 'order'),
                    '须使用 build_stage 生成阶段检查输入，不手拼购买或部署字段')
        ids=identifiers(ids or {})
        with self.transaction(account,domain) as directory:
            self.owned(directory,owner);state=self.load(directory,account,domain)
            require(state['phase']!='verified','该次换证已验收，禁止再次提交')
            require(snapshot['account_id']==account and domain_name(snapshot['domain'])==domain_name(domain),'检查账号或域名不匹配')
            resource_match(snapshot['resource'],state['target']['resource'])
            require(snapshot['current']['id']==state['baseline_id'],'原证书变化，停止提交')
            ops=state['operations']
            require(action not in ops,'此动作已有提交记录；只读查询并恢复，禁止再次点击')
            require(not any(later in ops for later in ACTIONS[ACTIONS.index(action)+1:]),'后续阶段已经存在，禁止返回前阶段重提')
            predecessor={'payment':'order','application':'payment','deployment':'preview'}.get(action)
            if predecessor:
                require(ops.get(predecessor,{}).get('status')=='success','须先完成并记录 '+predecessor)
            if action=='preview':
                require(ops.get('application',{}).get('status')=='success','先查询已签发证书并记录，不能直接创建预览')
                new=snapshot['new_certificate']
                check_new(new,snapshot['current'],account,domain_name(domain),snapshot.get('threshold_days',15),datetime.now(timezone.utc))
                require(all(ops['application']['ids'].get(k)==v for k,v in {'certificate_id':new['id'],'instance_id':new['instance_id']}.items()),'预览候选与已签发实例不符')
                ids=identifiers({'certificate_id':new['id'],'instance_id':new['instance_id']})
            if action=='deployment':
                preview=snapshot['preview']
                expected={'certificate_id':preview['new_certificate_id'],'task_id':preview['task_instance'],
                          'task_name':preview['task_name'],'cas_resource_id':preview['cas_resource_id'],
                          'instance_id':snapshot['new_certificate']['instance_id']}
                require(all(ops['preview']['ids'].get(k)==v for k,v in expected.items()),'提交对象与已记录预览不一致')
                ids=identifiers(expected)
            elif action=='payment':
                require(ids.get('order_id')==ops['order']['ids'].get('order_id') and bool(ids.get('order_id')),'支付订单不匹配')
                require(isinstance(payment_evidence,dict),'支付前须只读采集当前收银台金额，不能沿用购买报价')
                fresh(payment_evidence);zero_price(payment_evidence)
                require(payment_evidence.get('account_id')==account and domain_name(payment_evidence.get('domain'))==domain_name(domain)
                        and payment_evidence.get('order_id')==ids['order_id'],'收银台订单或目标不匹配')
            elif action=='application':
                require(bool(ids.get('instance_id')) and ids['instance_id']==ops['payment']['ids'].get('instance_id'),'申请前须核对已支付订单对应实例 ID')
            ops[action]={'status':'submitting','ids':ids,'intent_at':stamp()}
            if action=='deployment':
                ops[action]['new_fingerprint_sha256']=snapshot['new_certificate']['fingerprint_sha256']
            state['phase']=action+'_submitting'
            self.save(directory,state,{'event':'intent','action':action,'ids':ids})
            return {'decision':'allowed_once','action':action,'writes_performed':False,
                    'next_step':'本次意图已落盘；仅立即点击一次，失败或中断后查询原对象，不重提'}

    def record(self, account, domain, owner, action, evidence):
        require(action in ACTIONS and action!='deployment','部署结果只能通过 reconcile 读取原任务')
        fresh(evidence)
        require(evidence.get('account_id')==account and domain_name(evidence.get('domain'))==domain_name(domain),'结果目标不匹配')
        status=evidence.get('status');require(status in ('pending','success','failed','unknown'),'结果状态无效')
        ids=identifiers(evidence.get('ids',{}))
        with self.transaction(account,domain) as directory:
            self.owned(directory,owner);state=self.load(directory,account,domain)
            require(state['phase']!='verified','已验收运行不能被迟到结果覆盖')
            op=state['operations'].get(action);require(op is not None,'没有提交意图，不能记为已提交')
            require(op['status'] not in ('success','failed') or op['status']==status,'终态不可被旧响应覆盖')
            require(all(k not in op['ids'] or op['ids'][k]==v for k,v in ids.items()),'响应 ID 与提交意图不符')
            merged={**op['ids'],**ids}
            if status=='success':
                keys={'order':('order_id',),'payment':('order_id',),'application':('instance_id','certificate_id'),
                      'preview':('task_id','task_name','certificate_id','cas_resource_id')}[action]
                require(all(merged.get(k) for k in keys),'成功结果缺少业务 ID')
            op.update(status=status,ids=merged,observed_at=evidence['observed_at'])
            if ACTIONS.index(action)==max(ACTIONS.index(k) for k in state['operations']):
                state['phase']=action+'_'+status
            self.save(directory,state,{'event':'result','action':action,'status':status,'ids':merged})
            return {'decision':'recorded','phase':state['phase'],'writes_performed':False}

    def reconcile(self, account, domain, owner, evidence):
        fresh(evidence)
        with self.transaction(account,domain) as directory:
            self.owned(directory,owner);state=self.load(directory,account,domain)
            op=state['operations'].get('deployment');require(op is not None,'缺少原部署提交记录，不能新建任务代替查询')
            require(evidence.get('account_id')==account and domain_name(evidence.get('domain'))==domain_name(domain),'任务目标不匹配')
            resource_match(evidence.get('resource'),state['target']['resource'])
            ids=identifiers(evidence['ids'])
            require(all(ids.get(k)==op['ids'].get(k) for k in ('task_id','task_name','certificate_id','instance_id','cas_resource_id')),'不是本次原部署任务')
            status=evidence.get('status');require(status in ('pending','success','failed','unknown'),'任务状态无效')
            require(op['status'] not in ('success','failed') or op['status']==status,'已确认终态不可被陈旧页面覆盖')
            if state['phase']=='verified':
                return {'decision':'verified','can_submit':False,'status':status,'writes_performed':False}
            op.update(status=status,ids={**op['ids'],**ids},observed_at=evidence['observed_at'])
            state['phase']='deployment_'+status
            self.save(directory,state,{'event':'reconciled','status':status,'ids':ids})
            return {'decision':'verify' if status=='success' else 'query_existing' if status in ('pending','unknown') else 'stopped',
                    'can_submit':False,'status':status,'writes_performed':False}

    def verify(self, account, domain, owner, binding, public, tls, before, after):
        for item in (binding,public,tls,after):fresh(item)
        with self.transaction(account,domain) as directory:
            self.owned(directory,owner);state=self.load(directory,account,domain)
            op=state['operations'].get('deployment',{})
            require(op.get('status')=='success','先查询原任务确认成功，再做公网验收')
            target=state['target'];resource=target['resource']
            require(binding['account_id']==account and domain_name(binding['domain'])==domain_name(domain),'验收账号/域名不符')
            require(binding['bucket']==resource['bucket'] and binding['region']==resource['region'] and binding.get('bound') is True and binding.get('cdn_configured') is False,'验收绑定资源不符')
            require(binding['certificate_id']==public['certificate_id']==op['ids']['certificate_id'],'实际绑定不是本次新证书')
            require('PRIVATE KEY' not in public['public_certificate'],'不读取私钥')
            cert=decode_certificate(ssl.PEM_cert_to_DER_cert(public['public_certificate']))
            require(cert['serial_number']==public['serial_number'].upper().lstrip('0'),'公开证书序列号不符')
            require(tls.get('verified') is True and domain_name(tls['domain'])==domain_name(domain),'公网信任/域名验收未通过')
            require(cert['fingerprint_sha256']==tls['fingerprint_sha256']==op['new_fingerprint_sha256'],'签发、绑定与公网指纹不符')
            require(cert['not_after']==tls['not_after'],'公网期限不符')
            require(moment(before['observed_at'])<=moment(op['intent_at'])<=moment(after['observed_at']),'HTTPS 基线或验收时间不符')
            require(type(before['status']) is int and before['status']==after['status'] and before['url']==after['url'],'HTTPS 与原基线不符')
            require(after['url'].startswith('https://'+domain_name(domain)+'/'),'HTTPS 验收域名不符')
            state.update(phase='verified',new_certificate_id=op['ids']['certificate_id'],verified_at=stamp())
            self.save(directory,state,{'event':'verified','certificate_id':state['new_certificate_id']})
            return {'decision':'verified','writes_performed':False,'certificate_id':state['new_certificate_id'],'not_after':cert['not_after']}

    def release(self, account, domain, owner):
        with self.transaction(account,domain) as directory:
            self.owned(directory,owner);state=self.load(directory,account,domain)
            self.save(directory,state,{'event':'released'})
            self.owned(directory,owner);(directory/'run.lock').unlink()
            return {'decision':'released','phase':state['phase'],'writes_performed':False,
                    'next_step':'阶段记录已保留；再次 begin 将恢复原操作，不自动重买或重提'}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--account',required=True);parser.add_argument('--domain',required=True)
    parser.add_argument('--state-root',type=Path,help='仅隔离测试/显式部署使用；生产同一目标须固定默认目录')
    commands=parser.add_subparsers(dest='command',required=True)
    commands.add_parser('status')
    begin=commands.add_parser('begin');begin.add_argument('--snapshot',required=True,type=Path)
    for name in ('intent','record','reconcile','release','adopt','verify'):
        cmd=commands.add_parser(name);cmd.add_argument('--owner',required=True)
        if name in ('intent','record'):cmd.add_argument('--action',choices=ACTIONS,required=True)
        if name=='intent':
            cmd.add_argument('--snapshot',required=True,type=Path);cmd.add_argument('--ids-file',type=Path)
            cmd.add_argument('--payment-evidence',type=Path)
        if name in ('record','reconcile'):cmd.add_argument('--evidence',required=True,type=Path)
        if name=='adopt':cmd.add_argument('--snapshot',required=True,type=Path)
        if name=='verify':
            for field in ('binding','public','tls','https-before','https-after'):cmd.add_argument('--'+field,required=True,type=Path)
    args=parser.parse_args()
    try:
        runtime=Runtime(args.state_root)
        if args.command=='begin':
            snapshot=read_json(args.snapshot)
            require(snapshot['account_id']==args.account and domain_name(snapshot['domain'])==domain_name(args.domain),'命令目标与检查目标不符')
            result=runtime.begin(snapshot)
        elif args.command=='status':result=runtime.status(args.account,args.domain)
        elif args.command=='intent':result=runtime.intent(args.account,args.domain,args.owner,args.action,read_json(args.snapshot),read_json(args.ids_file) if args.ids_file else None,read_json(args.payment_evidence) if args.payment_evidence else None)
        elif args.command=='record':result=runtime.record(args.account,args.domain,args.owner,args.action,read_json(args.evidence))
        elif args.command=='reconcile':result=runtime.reconcile(args.account,args.domain,args.owner,read_json(args.evidence))
        elif args.command=='adopt':result=runtime.adopt(args.account,args.domain,args.owner,read_json(args.snapshot))
        elif args.command=='verify':result=runtime.verify(args.account,args.domain,args.owner,read_json(args.binding),read_json(args.public),read_json(args.tls),read_json(args.https_before),read_json(args.https_after))
        else:result=runtime.release(args.account,args.domain,args.owner)
    except (OSError,ValueError,KeyError,TypeError,AttributeError,RecursionError,subprocess.SubprocessError) as exc:
        result={'decision':'blocked','writes_performed':False,'reason':str(exc),
                'next_step':'保留原状态，先只读查询已记录订单/实例/任务；不要再次提交或删除锁'}
    print(json.dumps(result,ensure_ascii=False,indent=2))
    return 2 if result.get('decision')=='blocked' else 0


if __name__=='__main__':
    sys.exit(main())
