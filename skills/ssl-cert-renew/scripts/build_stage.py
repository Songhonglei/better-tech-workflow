#!/usr/bin/env python3
"""Build order/ready/deploy snapshots from fresh, fixed browser collector output."""
import argparse
from copy import deepcopy
from datetime import datetime, timezone
import json
from pathlib import Path
import ssl
import subprocess
import sys

from build_snapshot import read_json
from evidence_io import write_json
from inspect_tls import decode_certificate
from policy import require, evaluate, moment, domain_name, resource_match, check_new


def build_stage(stage, preflight, evidence=None, work=None, instance=None, public=None, now=None):
    now=now or datetime.now(timezone.utc)
    require(stage in ('order','ready','deploy'),'未知阶段')
    gate=evaluate(preflight,now=now)
    require(gate['decision']=='eligible',gate['reason'])
    data=deepcopy(preflight)
    observations=[preflight]

    def accept(item, kind=None):
        require(isinstance(item,dict),'缺少阶段证据')
        require(0 <= (now-moment(item.get('observed_at'))).total_seconds() <= 600,'阶段证据过期，请重新采集')
        if kind:require(item.get('kind')==kind,'阶段证据类型不符')
        require(item.get('account_id')==data['account_id'] and domain_name(item.get('domain'))==data['domain'],'阶段证据账号或域名不符')
        observations.append(item)

    if stage=='order':
        accept(evidence,'quote');accept(work)
        resource_match(work.get('resource'),data['resource'])
        data['order']={key:evidence[key] for key in ('product','validity_days','quantity','currency','payable','paid_addons')}
        data['order'].update(quota_available=work.get('quota_available'),existing_work=work.get('existing_work'))
    else:
        accept(instance,'instance')
        require(isinstance(public,dict),'缺少新证书公开 X.509')
        require(0 <= (now-moment(public.get('observed_at'))).total_seconds() <= 600,'新证书公开证据过期')
        observations.append(public)
        require(instance['certificate_id']==public['certificate_id'],'实例与公开证书 ID 不一致')
        pem=public['public_certificate']
        require(isinstance(pem,str) and 'PRIVATE KEY' not in pem and pem.startswith('-----BEGIN CERTIFICATE-----'),'只允许公开证书')
        cert=decode_certificate(ssl.PEM_cert_to_DER_cert(pem))
        require(public['serial_number'].upper().lstrip('0')==cert['serial_number'],'新证书序列号不匹配')
        new={**cert,'id':instance['certificate_id'],'instance_id':instance['instance_id'],'account_id':instance['account_id'],
             'product':instance['product'],'status':instance['status']}
        check_new(new,data['current'],data['account_id'],data['domain'],data.get('threshold_days',15),now)
        data['new_certificate']=new
        if stage=='deploy':
            accept(evidence,'preview')
            resource_match(evidence.get('resource'),data['resource'])
            require(evidence['certificate_id']==new['id'] and evidence['instance_id']==new['instance_id'],'预览新证书或实例不匹配')
            ids=evidence['ids']
            require(ids['certificate_id']==new['id'] and ids['instance_id']==new['instance_id'],'预览业务 ID 不一致')
            data['preview']={key:evidence[key] for key in ('account_id','domain','resource','resource_count','domain_count','currency','payable','paid_deployment_units','schedule')}
            data['preview'].update(old_certificate_id=data['current']['id'],new_certificate_id=new['id'],
                                   cas_resource_id=ids['cas_resource_id'],task_instance=ids['task_id'],task_name=ids['task_name'])
    data['observed_at']=min(moment(item['observed_at']) for item in observations).isoformat()
    result=evaluate(data,'order' if stage=='order' else 'deploy' if stage=='deploy' else 'preflight',now)
    require(result['decision']=='eligible',result['reason'])
    data['stage_evidence']={'kind':stage,'observed_at':data['observed_at'],'sources':[item.get('source_url','local-preflight') for item in observations]}
    return data


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('stage',choices=('order','ready','deploy'))
    for name in ('preflight','evidence','work','instance','public','out'):
        parser.add_argument('--'+name,type=Path,required=name in ('preflight','out'))
    args=parser.parse_args()
    try:
        data=build_stage(args.stage,read_json(args.preflight),**{name:read_json(getattr(args,name)) if getattr(args,name) else None for name in ('evidence','work','instance','public')})
        write_json(args.out,data)
        result={'decision':'eligible','stage':args.stage,'writes_performed':False,'out':str(args.out)}
    except (OSError,ValueError,KeyError,TypeError,AttributeError,subprocess.SubprocessError) as exc:
        result={'decision':'blocked','writes_performed':False,'reason':str(exc),'next_step':'重新只读采集缺失或不一致的阶段字段，不手填猜测值'}
    print(json.dumps(result,ensure_ascii=False,indent=2))
    return 2 if result['decision']=='blocked' else 0


if __name__=='__main__':
    sys.exit(main())
