#!/usr/bin/env python3
"""Isolated runtime/transaction regressions. No real account state or cloud writes."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from runtime import Runtime, read_json
from build_stage import build_stage
from evidence_io import write_json


def fixture():
    now=datetime.now(timezone.utc)
    resource={'type':'OSS','id':'oss://cn-hangzhou/fixture-bucket/example.com','bucket':'fixture-bucket','region':'cn-hangzhou'}
    return {'domain':'example.com','account_id':'fixture-account','threshold_days':15,'resource':resource,
      'observed_at':now.isoformat(),'observed_target':{'account_id':'fixture-account','domain':'example.com','resource':dict(resource)},
      'current':{'id':'fixture-old','source':'console_deployed','sans':['example.com'],'not_after':(now+timedelta(days=5)).isoformat()},
      'online_matches_current':True}


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.runtime=Runtime(self.root/'state');self.snapshot=fixture()
        self.account=self.snapshot['account_id'];self.domain=self.snapshot['domain']
        self.lease=self.runtime.begin(self.snapshot);self.owner=self.lease['owner']

    def order(self):
        raw={**self.snapshot,'kind':'quote','product':'aliyun-personal-free','validity_days':90,'quantity':1,'currency':'CNY','payable':'0.00','paid_addons':False}
        work={**self.snapshot,'quota_available':True,'existing_work':'none'}
        return build_stage('order',self.snapshot,raw,work)

    def ready(self):
        now=datetime.now(timezone.utc)
        return {**deepcopy(self.snapshot),'new_certificate':{'id':'123-cn-hangzhou','instance_id':'cas_dv-cn-fixture','account_id':self.account,
          'product':'aliyun-personal-free','status':'issued','sans':[self.domain],'not_before':(now-timedelta(hours=1)).isoformat(),
          'not_after':(now+timedelta(days=90)-timedelta(hours=1)).isoformat(),'fingerprint_sha256':'a'*64}}

    def record(self,action,status='success',ids=None):
        return self.runtime.record(self.account,self.domain,self.owner,action,
          {'observed_at':datetime.now(timezone.utc).isoformat(),'account_id':self.account,'domain':self.domain,'status':status,'ids':ids or {}})

    def deployment(self):
        ready=self.ready();self.runtime.adopt(self.account,self.domain,self.owner,ready)
        self.runtime.intent(self.account,self.domain,self.owner,'preview',ready)
        ids={'task_id':'cas-job-user-fixture','task_name':'deploy-task-123','certificate_id':ready['new_certificate']['id'],
             'instance_id':ready['new_certificate']['instance_id'],'cas_resource_id':'123'}
        self.record('preview',ids=ids)
        data=deepcopy(ready)
        data['preview']={'account_id':self.account,'domain':self.domain,'resource':data['resource'],
          'old_certificate_id':'fixture-old','new_certificate_id':ids['certificate_id'],'resource_count':1,'domain_count':1,
          'currency':'CNY','payable':'0.00','paid_deployment_units':0,'schedule':'immediate','cas_resource_id':'123',
          'task_name':ids['task_name'],'task_instance':ids['task_id']}
        data['stage_evidence']={'kind':'deploy'}
        self.runtime.intent(self.account,self.domain,self.owner,'deployment',data)
        return data,{'observed_at':datetime.now(timezone.utc).isoformat(),'account_id':self.account,'domain':self.domain,
          'resource':data['resource'],'status':'pending','ids':{**ids,'detail_id':'456'}}

    def test_once_intent_survives_lost_response_and_resume(self):
        order=self.order();self.runtime.intent(self.account,self.domain,self.owner,'order',order)
        self.runtime.release(self.account,self.domain,self.owner)
        second=self.runtime.begin(self.snapshot)
        self.assertEqual(second['run_id'],self.lease['run_id'])
        with self.assertRaisesRegex(ValueError,'已有提交记录'):
            self.runtime.intent(self.account,self.domain,second['owner'],'order',order)
        self.assertEqual(second['operations']['order']['status'],'submitting')

    def test_wrong_owner_and_identity_never_mutate(self):
        before=self.runtime.status(self.account,self.domain)
        with self.assertRaises(ValueError):self.runtime.release(self.account,self.domain,'wrong-owner')
        bad=self.order();bad['account_id']='other'
        with self.assertRaises(ValueError):self.runtime.intent(self.account,self.domain,self.owner,'order',bad)
        self.assertEqual(before,self.runtime.status(self.account,self.domain))

    def test_payment_and_application_pinned_to_existing_ids(self):
        order=self.order();self.runtime.intent(self.account,self.domain,self.owner,'order',order)
        self.record('order',ids={'order_id':'order-1'})
        with self.assertRaises(ValueError):self.runtime.intent(self.account,self.domain,self.owner,'payment',order,{'order_id':'other'})
        cashier={'observed_at':datetime.now(timezone.utc).isoformat(),'account_id':self.account,'domain':self.domain,'order_id':'order-1','currency':'CNY','payable':'1.00'}
        with self.assertRaises(ValueError):self.runtime.intent(self.account,self.domain,self.owner,'payment',order,{'order_id':'order-1'},cashier)
        cashier['payable']='0.00'
        self.runtime.intent(self.account,self.domain,self.owner,'payment',order,{'order_id':'order-1'},cashier)
        self.record('payment',ids={'order_id':'order-1','instance_id':'cas_dv-cn-fixture'})
        with self.assertRaises(ValueError):self.runtime.intent(self.account,self.domain,self.owner,'application',self.snapshot,{'instance_id':'other'})
        self.runtime.intent(self.account,self.domain,self.owner,'application',self.snapshot,{'instance_id':'cas_dv-cn-fixture'})
        with self.assertRaises(ValueError):self.record('application',ids={'instance_id':'other','certificate_id':'cert'})

    def test_success_pending_unknown_and_failed_never_allow_resubmit(self):
        data,task=self.deployment()
        self.assertFalse(self.runtime.reconcile(self.account,self.domain,self.owner,task)['can_submit'])
        task['status']='unknown'
        self.assertEqual(self.runtime.reconcile(self.account,self.domain,self.owner,task)['decision'],'query_existing')
        task['status']='success'
        self.assertEqual(self.runtime.reconcile(self.account,self.domain,self.owner,task)['decision'],'verify')
        with self.assertRaises(ValueError):self.runtime.intent(self.account,self.domain,self.owner,'deployment',data)
        task['status']='pending'
        with self.assertRaisesRegex(ValueError,'终态'):self.runtime.reconcile(self.account,self.domain,self.owner,task)
        task['status']='success';task['ids']['task_id']='other'
        with self.assertRaises(ValueError):self.runtime.reconcile(self.account,self.domain,self.owner,task)

    def test_resume_after_binding_already_changed_does_not_rebuy(self):
        data,task=self.deployment();self.runtime.release(self.account,self.domain,self.owner)
        current=deepcopy(self.snapshot);current['current']['id']=task['ids']['certificate_id']
        current['current']['not_after']=(datetime.now(timezone.utc)+timedelta(days=89)).isoformat()
        resumed=self.runtime.begin(current)
        self.assertEqual(resumed['run_id'],self.lease['run_id'])
        with self.assertRaises(ValueError):self.runtime.intent(self.account,self.domain,resumed['owner'],'order',self.order())

    def test_failed_task_stops_and_keeps_history(self):
        data,task=self.deployment();task['status']='failed'
        self.assertEqual(self.runtime.reconcile(self.account,self.domain,self.owner,task)['decision'],'stopped')
        with self.assertRaises(ValueError):self.runtime.intent(self.account,self.domain,self.owner,'deployment',data)
        self.runtime.release(self.account,self.domain,self.owner)
        resumed=self.runtime.begin(self.snapshot)
        self.assertEqual(resumed['operations']['deployment']['status'],'failed')

    def test_begin_write_failure_cleans_only_new_lock(self):
        self.runtime.release(self.account,self.domain,self.owner)
        previous=self.runtime.status(self.account,self.domain)
        with patch('runtime.write_json',side_effect=OSError('disk full')):
            with self.assertRaises(OSError):self.runtime.begin(self.snapshot)
        self.assertFalse((self.runtime.directory(self.account,self.domain)/'run.lock').exists())
        self.assertEqual(self.runtime.status(self.account,self.domain),previous)

    def test_corrupt_state_and_exclusive_lock_are_preserved(self):
        with self.assertRaises(ValueError):self.runtime.begin(self.snapshot)
        self.runtime.release(self.account,self.domain,self.owner)
        file=self.runtime.directory(self.account,self.domain)/'state.json';file.write_text('{corrupt')
        with self.assertRaises(ValueError):self.runtime.begin(self.snapshot)
        self.assertEqual(file.read_text(),'{corrupt')

    def test_failed_persistence_prevents_submission_permission(self):
        with patch('runtime.write_json',side_effect=OSError('disk full')):
            with self.assertRaises(OSError):self.runtime.intent(self.account,self.domain,self.owner,'order',self.order())
        self.assertNotIn('order',self.runtime.status(self.account,self.domain)['operations'])

    def test_no_credentials_accepted_in_receipt(self):
        self.runtime.intent(self.account,self.domain,self.owner,'order',self.order())
        with self.assertRaises(ValueError):self.record('order',ids={'order_id':'1','token':'secret'})

    def test_concurrent_processes_only_one_acquires(self):
        self.runtime.release(self.account,self.domain,self.owner)
        snap=self.root/'snapshot.json';write_json(snap,self.snapshot)
        args=[sys.executable,'-B',str(Path(__file__).with_name('runtime.py')),'--account',self.account,'--domain',self.domain,
              '--state-root',str(self.root/'state'),'begin','--snapshot',str(snap)]
        with ThreadPoolExecutor(2) as pool:
            results=list(pool.map(lambda _:subprocess.run(args,capture_output=True,text=True,timeout=10),range(2)))
        self.assertEqual(sorted(x.returncode for x in results),[0,2])


if __name__=='__main__':unittest.main(verbosity=2)
