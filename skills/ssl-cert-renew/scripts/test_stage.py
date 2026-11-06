#!/usr/bin/env python3
"""Fresh page evidence -> policy and signed-certificate acceptance regressions."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
import ssl
import subprocess
import tempfile
import unittest

from build_stage import build_stage
from inspect_tls import decode_certificate
from policy import evaluate
from runtime import Runtime
from test_runtime import fixture


class StageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory();cls.addClassCleanup(cls.temp.cleanup)
        root=Path(cls.temp.name)
        subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-noenc','-days','90',
          '-subj','/CN=example.com','-addext','subjectAltName=DNS:example.com,DNS:www.example.com',
          '-keyout',str(root/'ephemeral.key'),'-out',str(root/'public.pem')],check=True,capture_output=True,timeout=30)
        cls.pem=(root/'public.pem').read_text();cls.cert=decode_certificate(ssl.PEM_cert_to_DER_cert(cls.pem))

    def inputs(self):
        pre=fixture();now=pre['observed_at']
        instance={'observed_at':now,'account_id':pre['account_id'],'domain':pre['domain'],'kind':'instance',
          'product':'aliyun-personal-free','status':'issued','certificate_id':'123-cn-hangzhou','instance_id':'cas_dv-cn-fixture'}
        public={'observed_at':now,'certificate_id':instance['certificate_id'],'public_certificate':self.pem,'serial_number':self.cert['serial_number']}
        preview={**instance,'kind':'preview','resource':pre['resource'],'resource_count':1,'domain_count':1,
          'currency':'CNY','payable':'0.00','paid_deployment_units':0,'schedule':'immediate',
          'ids':{'certificate_id':instance['certificate_id'],'instance_id':instance['instance_id'],
                 'task_id':'cas-job-user-fixture','task_name':'deploy-task-1','cas_resource_id':'123'}}
        return pre,instance,public,preview

    def test_signed_candidate_and_preview_generate_eligible_deploy(self):
        p,i,c,v=self.inputs();d=build_stage('deploy',p,v,instance=i,public=c)
        self.assertEqual(evaluate(d,'deploy')['decision'],'eligible')
        self.assertEqual(d['new_certificate']['fingerprint_sha256'],self.cert['fingerprint_sha256'])

    def test_identity_price_counts_and_freshness_mismatch_block(self):
        for which,key,value in [('i','account_id','other'),('i','certificate_id','other'),('i','product','pro'),
          ('v','instance_id','other'),('v','certificate_id','other'),('v','resource_count',2),
          ('v','payable','0.01'),('v','paid_deployment_units',1),('v','schedule','tomorrow'),
          ('c','serial_number','FF'),('c','observed_at',(datetime.now(timezone.utc)-timedelta(minutes=11)).isoformat())]:
            with self.subTest(which=which,key=key):
                p,i,c,v=self.inputs();{'i':i,'c':c,'v':v}[which][key]=value
                with self.assertRaises(ValueError):build_stage('deploy',p,v,instance=i,public=c)

    def test_earliest_evidence_cannot_be_refreshed_by_merging(self):
        p,i,c,v=self.inputs();c['observed_at']=(datetime.now(timezone.utc)-timedelta(minutes=5)).isoformat()
        d=build_stage('ready',p,instance=i,public=c)
        self.assertEqual(d['observed_at'],c['observed_at'])

    def test_complete_local_run_then_new_generation_and_failed_verify(self):
        p,i,c,v=self.inputs();ready=build_stage('ready',p,instance=i,public=c)
        deploy=build_stage('deploy',p,v,instance=i,public=c)
        with tempfile.TemporaryDirectory() as folder:
            r=Runtime(Path(folder)/'state');lease=r.begin(p);owner=lease['owner'];a,d=p['account_id'],p['domain']
            r.adopt(a,d,owner,ready);r.intent(a,d,owner,'preview',ready)
            r.record(a,d,owner,'preview',{'observed_at':p['observed_at'],'account_id':a,'domain':d,'status':'success','ids':v['ids']})
            before={'url':'https://example.com/','status':200,'observed_at':datetime.now(timezone.utc).isoformat()}
            r.intent(a,d,owner,'deployment',deploy)
            task={'observed_at':datetime.now(timezone.utc).isoformat(),'account_id':a,'domain':d,'resource':p['resource'],'ids':v['ids'],'status':'success'}
            r.reconcile(a,d,owner,task)
            after={**before,'observed_at':datetime.now(timezone.utc).isoformat()}
            binding={'observed_at':after['observed_at'],'account_id':a,'domain':d,'bucket':p['resource']['bucket'],
              'region':p['resource']['region'],'bound':True,'cdn_configured':False,'certificate_id':i['certificate_id']}
            tls={**self.cert,'observed_at':after['observed_at'],'domain':d,'verified':False}
            with self.assertRaises(ValueError):r.verify(a,d,owner,binding,c,tls,before,after)
            tls['verified']=True
            wrong={**after,'status':500}
            with self.assertRaises(ValueError):r.verify(a,d,owner,binding,c,tls,before,wrong)
            self.assertEqual(r.verify(a,d,owner,binding,c,tls,before,after)['decision'],'verified')
            self.assertEqual(r.reconcile(a,d,owner,task)['decision'],'verified')
            with self.assertRaises(ValueError):r.record(a,d,owner,'preview',{'observed_at':p['observed_at'],'account_id':a,'domain':d,'status':'success','ids':v['ids']})
            self.assertEqual(r.status(a,d)['phase'],'verified')
            r.release(a,d,owner)
            # A future eligible run uses the deployed ID, retaining the prior journal.
            next_run=deepcopy(p);next_run['current']['id']=i['certificate_id']
            new=r.begin(next_run)
            self.assertNotEqual(new['run_id'],lease['run_id'])
            history=list((r.directory(a,d)/'history').glob('*.json'))
            self.assertEqual(len(history),1)
            self.assertIn('verified',history[0].read_text())


if __name__=='__main__':unittest.main(verbosity=2)
