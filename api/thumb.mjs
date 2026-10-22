/* Same-origin copy of the archive.org thumbnail: archive.org sends no CORS header, so the page could not read its pixels for the palette.
   Runs as a Vercel Function at /api/thumb and is reused by server.mjs locally. */
const THUMB_MAX_BYTES=2*1024*1024;

export async function GET(request){
  const id=(new URL(request.url).searchParams.get('id')||'').trim();
  if(!/^[A-Za-z0-9._-]{1,200}$/.test(id))return new Response('Bad identifier',{status:400});
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8500);
  try{
    const upstream=await fetch('https://archive.org/services/img/'+encodeURIComponent(id),{signal:controller.signal});
    const type=upstream.headers.get('content-type')||'';
    if(!upstream.ok||!/^image\/(png|jpeg|gif|webp)\b/i.test(type))throw new Error('No thumbnail');
    const body=await upstream.arrayBuffer();
    if(body.byteLength>THUMB_MAX_BYTES)throw new Error('Thumbnail too large');
    return new Response(body,{status:200,headers:{'Content-Type':type,'X-Content-Type-Options':'nosniff','Cache-Control':'public, max-age=86400'}});
  }catch(_){return new Response('Thumbnail unavailable',{status:502});}
  finally{clearTimeout(timer);}
}
