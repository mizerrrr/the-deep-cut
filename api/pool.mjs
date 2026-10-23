/* Ready-made pool of six albums for one era filter, so a first visit does not
   have to search the archive itself. The CDN keeps each answer for a few
   minutes and serves the stale one while it rebuilds, so visitors almost never
   wait on the search. Runs as a Vercel Function at /api/pool and is reused by
   server.mjs locally. */
import { findAlbums } from '../albums.mjs';

const DECADES=new Set(['all','1960','1970','1980','1990','2000','2010','2025']);

export async function GET(request){
  const key=new URL(request.url).searchParams.get('decade')||'all';
  if(!DECADES.has(key))return Response.json({error:'Unknown era filter'},{status:400});
  try{
    // Each pool is built on its own, so the page enforces the shared Brazilian/Latin quota and swaps extras for spares
    const spares=[],items=await findAlbums(key==='all'?null:Number(key),new Set(),()=>{},{quota:{left:1},spares});
    if(!items.length)throw new Error('No albums found');
    return Response.json({items,spares},{headers:{'Cache-Control':'public, s-maxage=300, stale-while-revalidate=86400','X-Content-Type-Options':'nosniff'}});
  }catch(_){
    return Response.json({error:'Could not build the pool'},{status:502,headers:{'Cache-Control':'no-store'}});
  }
}
