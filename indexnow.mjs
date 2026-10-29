/* Tells IndexNow search engines (Bing, Yandex, Seznam, Naver…) that the
   pages in sitemap.xml are new or changed, so they are crawled right away
   instead of whenever the crawler next comes by. Google doesn't use IndexNow.
   Run after a deploy that adds or changes pages:  node indexnow.mjs
   The key file at the site root proves the request comes from this site. */
import fs from 'node:fs';

const HOST='thedeepcut.vercel.app';
const KEY='299e29ae59635ea61d931131a67520b5';

const urlList=[...fs.readFileSync(new URL('./sitemap.xml',import.meta.url),'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map(m=>m[1]);
const response=await fetch('https://api.indexnow.org/indexnow',{
  method:'POST',
  headers:{'Content-Type':'application/json; charset=utf-8'},
  body:JSON.stringify({host:HOST,key:KEY,keyLocation:`https://${HOST}/${KEY}.txt`,urlList})
});
console.log(`IndexNow: ${response.status} ${response.statusText} for ${urlList.length} URLs`);
if(!response.ok)console.log(await response.text());
