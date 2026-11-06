// Offline regressions for the actual DOM collector and nested public responses.
import assert from 'node:assert/strict';
import {collectDOM,parsePublicResponse} from './live_browser.mjs';

globalThis.location=new URL('https://oss.console.aliyun.com/bucket');
let table='Bucket 名称';
let links=[];
let labels=['第1页，共1页'];
let busy=[];
globalThis.document={
  querySelectorAll(selector){
    if(selector==='table') return [{innerText:table}];
    if(selector==='table a[href]') return links.map(href=>({getAttribute:()=>href}));
    if(selector==='button[aria-label]') return labels.map(label=>({getAttribute:()=>label}));
    if(selector==='[aria-busy="true"]') return busy;
    return [];
  }
};
assert.equal(collectDOM({kind:'buckets'}),null,'Loading is not an empty inventory');
links=['/bucket/oss-cn-hangzhou/fixture-bucket/object?spm=tracking',
       'https://oss.console.aliyun.com/bucket/oss-cn-hangzhou/fixture-bucket/object?other=1'];
assert.equal(collectDOM({kind:'buckets'}).items.length,1,'Query strings and duplicate fixed columns are handled');
assert.equal(collectDOM({kind:'buckets'}).complete,true);
labels=['第1页，共2页'];
assert.equal(collectDOM({kind:'buckets'}).complete,false,'The first of two pages is not a full inventory');
busy=[{getBoundingClientRect:()=>({height:20})}];
assert.equal(collectDOM({kind:'buckets'}),null);
busy=[]; links=[]; labels=['第1页，共1页'];table='Bucket 名称\n暂无数据';
assert.equal(collectDOM({kind:'buckets'}).empty,true,'Only explicit empty state counts as empty');
const inner={CertificateInfo:{CertIdentifier:'fixture-cn-hangzhou',SerialNo:'00FA01',BeforeDate:1,AfterDate:2,Sans:'example.com'},
  X509Certificate:'-----BEGIN CERTIFICATE-----\\nZmFrZQ==\\n-----END CERTIFICATE-----\\n'};
const parsed=parsePublicResponse({success:true,data:JSON.stringify(inner)});
assert.equal(parsed.serial_number,'FA01');
assert.ok(parsed.public_certificate.includes('\nZmFrZQ==\n'));
assert.equal(parsed.provider_not_after,'1970-01-01T00:00:00.002Z');
assert.throws(()=>parsePublicResponse({data:{CertificateInfo:{}}}));
assert.throws(()=>parsePublicResponse({data:JSON.stringify({...inner,X509Certificate:'PRIVATE KEY'})}));
console.log('Browser evidence regressions passed: loading, query-string links, deduplication, pagination, explicit empty, nested JSON, public-only extraction.');
