// Import from ego-browser nodejs. Read-only DOM/network observation; no cloud writes.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export async function saveEvidence(filename, data) {
  const dest = path.resolve(filename);
  const skill = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  await fs.mkdir(path.dirname(dest), {recursive:true, mode:0o700});
  const parent = await fs.realpath(path.dirname(dest));
  if (parent === skill || parent.startsWith(skill + path.sep)) throw new Error('证据须保存到 Skill 外');
  const target = path.join(parent, path.basename(dest));
  const temporary = target + '.tmp-' + crypto.randomUUID();
  try {
    await fs.writeFile(temporary, JSON.stringify(data, null, 2) + '\n', {mode:0o600, flag:'wx'});
    await fs.rename(temporary, target);
  } finally {
    await fs.unlink(temporary).catch(error => {if(error.code !== 'ENOENT') throw error;});
  }
}

export function collectDOM({kind}) {
  // This function is serialized into the Page; it must have no module closures.
  const tables = [...document.querySelectorAll('table')];
  const text = tables.map(e => e.innerText).join('\n');
  const empty = /暂无数据|没有查询到符合条件的记录/.test(text);
  if ([...document.querySelectorAll('[aria-busy="true"]')].some(e=>e.getBoundingClientRect().height>0)) return null;
  let items = [];
  if (kind === 'buckets') {
    if (!text.includes('Bucket 名称')) return null;
    for (const a of document.querySelectorAll('table a[href]')) {
      const url = new URL(a.getAttribute('href'), location.href);
      const m = url.pathname.match(/^\/bucket\/(oss-[^/]+)\/([^/]+)\/object\/?$/);
      if (m) items.push({region:m[1].replace(/^oss-/, ''), bucket:decodeURIComponent(m[2]), url:url.origin+url.pathname});
    }
  } else if (kind === 'domains') {
    if (!text.includes('HTTPS 证书') || !text.includes('OSS 域名绑定')) return null;
    const query = document.querySelector('input[placeholder="请输入域名"]')?.value || '';
    if (query) throw new Error('全量清单仍有域名筛选，请先清空搜索');
    for (const row of document.querySelectorAll('table tr')) {
      const cells = [...row.querySelectorAll(':scope > td')].map(e=>e.innerText.trim());
      if (cells.length < 3 || !cells[0] || /\s|\//.test(cells[0]) || !cells[0].includes('.')) continue;
      const domain = new URL('https://' + cells[0]).hostname;
      items.push({domain, bound:cells[1] === '已绑定', hasCertificate:cells.some(e=>e.includes('证书详情'))});
    }
  } else throw new Error('未知清单类型');
  items = [...new Map(items.map(item=>[kind==='buckets'?item.region+'/'+item.bucket:item.domain,item])).values()];
  if (!items.length && !empty) return null; // Loading or failed extraction is never an empty inventory.
  const labels = [...document.querySelectorAll('button[aria-label]')].map(e=>e.getAttribute('aria-label'));
  const pageLabel = labels.find(s=>/^第\d+页，共\d+页$/.test(s));
  const numbers = pageLabel?.match(/^第(\d+)页，共(\d+)页$/);
  const page = numbers ? Number(numbers[1]) : null;
  const totalPages = numbers ? Number(numbers[2]) : null;
  const complete = numbers ? page===1 && totalPages===1 : kind==='domains';
  return {kind,observed_at:new Date().toISOString(),source_url:location.origin+location.pathname,
    items,empty:items.length===0,complete,page,total_pages:totalPages,explicit_empty_message:empty};
}

export async function readInventory(page, kind) {
  await page.waitForFunction(collectDOM,{kind},{timeout:15000});
  const result = await page.evaluate(collectDOM,{kind});
  if (!result) throw new Error('清单未完成加载或提取失败，不可报告零目标');
  return result;
}

export function parsePublicResponse(raw) {
  let data = raw;
  for (let i=0;i<4;i++) {
    if (typeof data === 'string') {data=JSON.parse(data);continue;}
    if (data && typeof data==='object' && 'data' in data) {data=data.data;continue;}
    break;
  }
  const info = data?.CertificateInfo;
  if (!info?.CertIdentifier || !info.SerialNo || !Number.isFinite(info.AfterDate)) throw new Error('缺少公开证书身份/期限');
  const pem = data.X509Certificate?.replaceAll('\\n','\n');
  if (typeof pem !== 'string' || pem.includes('PRIVATE KEY')) throw new Error('没有可安全导出的公开证书');
  const leaf = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/);
  if (!leaf) throw new Error('公开证书 PEM 无效');
  return {observed_at:new Date().toISOString(),certificate_id:info.CertIdentifier,certificate_name:info.CertName,
    serial_number:info.SerialNo.toUpperCase().replace(/^0+/,''),
    provider_not_before:new Date(info.BeforeDate).toISOString(),provider_not_after:new Date(info.AfterDate).toISOString(),
    sans:info.Sans.split(',').map(s=>s.trim()),public_certificate:leaf[0]+'\n'};
}

export async function capturePublicCertificate(page, openSelector, certificateId) {
  await page.cdp('Network.enable');
  await page.events();
  await page.click(openSelector);
  await page.waitForFunction(id=>[...document.querySelectorAll('[role="dialog"]')].some(e=>e.innerText.includes(id)),certificateId,{timeout:15000});
  const events = await page.events();
  const hits = events.filter(e=>e.method==='Network.responseReceived' &&
    new URL(e.params.response.url).pathname==='/ajax/bucket/domain/get_cert_public_key.json');
  if (hits.length!==1) throw new Error('未唯一捕获本次公开证书响应，请只读重查，不沿用旧请求 ID');
  const response = await page.cdp('Network.getResponseBody',{requestId:hits[0].params.requestId});
  const result = parsePublicResponse(JSON.parse(response.body));
  if (result.certificate_id!==certificateId) throw new Error('公开证书响应与当前绑定 ID 不匹配');
  return result;
}
