#!/usr/bin/env python3
"""Offline live-evidence adapter regressions, with a temporary public X.509 fixture."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
import contextlib
import io
import json
import ssl
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from build_snapshot import build, main
from inspect_tls import decode_certificate
from policy import evaluate, moment


class LiveEvidenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.temp.cleanup)
        root=Path(cls.temp.name)
        cert=root/'public.pem'
        subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-noenc','-days','10',
                        '-subj','/CN=example.com','-addext','subjectAltName=DNS:example.com,DNS:www.example.com',
                        '-keyout',str(root/'ephemeral.key'),'-out',str(cert)],
                       capture_output=True,check=True,timeout=30)
        cls.pem=cert.read_text()
        cls.decoded=decode_certificate(ssl.PEM_cert_to_DER_cert(cls.pem))

    def inputs(self):
        now=datetime.now(timezone.utc)
        observed=now.isoformat()
        expected={'account_id':'fixture-account','domain':'example.com','bucket':'fixture-bucket','region':'cn-hangzhou'}
        binding={**expected,'observed_at':observed,'bound':True,'cdn_configured':False,'certificate_id':'fixture-old'}
        public={**self.decoded,'observed_at':observed,'certificate_id':'fixture-old','public_certificate':self.pem}
        tls={**self.decoded,'domain':'example.com','observed_at':observed,'verified':True}
        return binding,public,tls,expected,now

    def test_real_public_certificate_to_preflight(self):
        b,c,t,e,now=self.inputs()
        snapshot=build(b,c,t,e,now=now)
        self.assertEqual(evaluate(snapshot,now=now)['decision'],'eligible')
        self.assertEqual(snapshot['current']['not_after'],self.decoded['not_after'])
        self.assertTrue(snapshot['online_matches_current'])

    def test_display_epoch_eight_hours_wrong_does_not_replace_x509_time(self):
        b,c,t,e,now=self.inputs()
        for field in ('not_before','not_after'):
            c['provider_'+field]=(moment(c.pop(field))-timedelta(hours=8)).isoformat()
        snapshot=build(b,c,t,e,now=now)
        self.assertTrue(snapshot['time_evidence']['provider_time_discrepancy'])
        self.assertEqual(snapshot['current']['not_after'],t['not_after'])

    def test_domain_account_resource_and_identity_mismatch_stop(self):
        for which,field,value in ((0,'account_id','other'),(0,'bucket','other'),(0,'domain','www.example.com'),
                                  (0,'certificate_id','other'),(2,'fingerprint_sha256','f'*64),
                                  (2,'serial_number','1234'),(2,'not_after','2026-01-01T00:00:00Z'),
                                  (0,'cdn_configured',True),(2,'verified',False)):
            with self.subTest(which=which,field=field):
                b,c,t,e,now=self.inputs()
                (b,c,t)[which][field]=value
                with self.assertRaises(ValueError):
                    build(b,c,t,e,now=now)

    def test_missing_public_certificate_never_accepts_a_boolean_claim(self):
        b,c,t,e,now=self.inputs()
        del c['public_certificate']
        b['online_matches_current']=True
        with self.assertRaises(ValueError):
            build(b,c,t,e,now=now)

    def test_stale_evidence_does_not_get_a_new_timestamp(self):
        b,c,t,e,now=self.inputs()
        c['observed_at']=(now-timedelta(seconds=601)).isoformat()
        with self.assertRaises(ValueError):
            build(b,c,t,e,now=now)

    def test_adapter_preserves_earliest_observation(self):
        b,c,t,e,now=self.inputs()
        c['observed_at']=(now-timedelta(seconds=100)).isoformat()
        snapshot=build(b,c,t,e,now=now)
        self.assertEqual(moment(snapshot['observed_at']),moment(c['observed_at']))

    def test_above_threshold_skips_without_tls(self):
        b,c,t,e,now=self.inputs()
        snapshot=build(b,c,None,e,threshold=5,now=now)
        self.assertEqual(evaluate(snapshot,now=now)['decision'],'skip')
        self.assertFalse(snapshot['online_matches_current'])
        b['account_id']='wrong-account'
        with self.assertRaises(ValueError):
            build(b,c,None,e,threshold=5,now=now)

    def test_due_certificate_requires_tls(self):
        b,c,t,e,now=self.inputs()
        with self.assertRaisesRegex(ValueError,'公网 TLS'):
            build(b,c,None,e,now=now)

    def test_cli_decode_failure_is_blocked_without_traceback(self):
        b,c,t,e,now=self.inputs()
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            for name,data in [('binding',b),('controlplane',c),('expected',e)]:
                (root/(name+'.json')).write_text(json.dumps(data))
            argv=['build_snapshot.py']
            for name in ['binding','controlplane','expected']:
                argv+=['--'+name,str(root/(name+'.json'))]
            argv+=['--out',str(root/'snapshot.json')]
            output=io.StringIO()
            with patch.object(sys,'argv',argv),patch('build_snapshot.decode_certificate',side_effect=subprocess.CalledProcessError(1,['openssl'])),contextlib.redirect_stdout(output):
                self.assertEqual(main(),2)
            self.assertEqual(json.loads(output.getvalue())['decision'],'blocked')
            self.assertFalse((root/'snapshot.json').exists())


if __name__=='__main__':
    unittest.main(verbosity=2)
