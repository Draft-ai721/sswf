import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceDownload} from '../worker/source-download.js';
const token='a'.repeat(64);
const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),x=>x.toString(16).padStart(2,'0')).join('');
const config={archive:btoa('PK-test-archive'),byteLength:15,sha256:'test-archive-hash',tokenSha256:hash,expiresAt:new Date(Date.now()+3600000).toISOString()};
const request=(query='',method='GET')=>new Request('https://studio.test/downloads/source-v6.zip'+query,{method});
test('Source delivery rejects missing and incorrect capability without returning archive bytes',async()=>{
 for(const query of ['', '?token=bad', '?token='+'b'.repeat(64)]){
  const response=await sourceDownload(request(query),config);assert.equal(response.status,404);assert.ok(!(await response.text()).includes('PK-test-archive'));assert.equal(response.headers.get('Cache-Control'),'private, no-store, max-age=0');
 }
});
test('Valid source capability produces an attachment; HEAD exposes no body',async()=>{
 const response=await sourceDownload(request('?token='+token),config);assert.equal(response.status,200);assert.equal(response.headers.get('Content-Type'),'application/zip');assert.ok(response.headers.get('Content-Disposition').startsWith('attachment;'));assert.equal(await response.text(),'PK-test-archive');assert.ok(response.headers.get('X-Robots-Tag').includes('noindex'));
 const head=await sourceDownload(request('?token='+token,'HEAD'),config);assert.equal(head.status,200);assert.equal(await head.text(),'');
});
test('Expired or absent delivery is inaccessible and cannot affect unrelated routes',async()=>{
 assert.equal((await sourceDownload(request('?token='+token),{...config,expiresAt:'2020-01-01T00:00:00Z'})).status,410);
 assert.equal((await sourceDownload(request('?token='+token),null)).status,404);
 assert.equal((await sourceDownload(request('?token='+token),{...config,expiresAt:'invalid'})).status,404);
 assert.equal(await sourceDownload(new Request('https://studio.test/'),config),null);
 assert.equal((await sourceDownload(request('?token='+token,'POST'),config)).status,405);
});
