/* Builds pools/<era>.json: a few ready-made selections per era filter, served
   as static files. A first visit shows one of them at once when /api/pool is
   slow (its CDN cache is empty after a deploy or a quiet spell), instead of
   leaving the visitor in front of loading covers for 10 s or more.
   Run from the project root and commit the result:  node snapshot.mjs
   Re-run every week or two so first visits don't keep seeing the same albums. */
import fs from 'node:fs';
import { findAlbums } from './albums.mjs';

const KEYS=['all','1960','1970','1980','1990','2000','2010','2025'];
const SETS=3;

fs.mkdirSync(new URL('./pools/',import.meta.url),{recursive:true});
for(const key of KEYS){
  const sets=[],seen=new Set();
  for(let attempt=0;sets.length<SETS&&attempt<SETS*2;attempt++){
    try{
      // Same call as api/pool.mjs; seen keeps the sets of one era from sharing albums
      const spares=[],items=await findAlbums(key==='all'?null:Number(key),seen,()=>{},{quota:{left:1},spares});
      if(!items.length)continue;
      items.concat(spares).forEach(item=>seen.add(item.identifier));
      sets.push({items,spares});
    }catch(error){console.log(`${key}: attempt failed (${error.message})`);}
  }
  if(!sets.length){console.log(`${key}: no sets, file left as it was`);continue;}
  fs.writeFileSync(new URL(`./pools/${key}.json`,import.meta.url),JSON.stringify({built:new Date().toISOString(),sets}));
  console.log(`${key}: ${sets.length} sets`);
}
