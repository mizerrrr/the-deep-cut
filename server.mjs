import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT=path.dirname(fileURLToPath(import.meta.url));
const CACHE_TTL=6*60*60*1000;
const UNCERTAIN_CACHE_TTL=30*1000;
const responseCache=new Map();

function loadLocalEnv(override=false){
  try{
    const source=fs.readFileSync(path.join(ROOT,'.env'),'utf8');
    source.split(/\r?\n/).forEach(line=>{
      const match=line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if(!match||(!override&&match[1] in process.env))return;
      let value=match[2];
      if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))value=value.slice(1,-1);
      if(override&&!value&&process.env[match[1]])return;
      process.env[match[1]]=value;
    });
  }catch(error){if(error.code!=='ENOENT')throw error;}
}
loadLocalEnv();

function normalize(value){
  return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g,' ')
    .replace(/\b(deluxe|expanded|anniversary|remastered|remaster|edition|explicit|clean|bonus tracks|full album|official audio|album version|album)\b/g,' ')
    .replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
}
function titleMatches(expected,candidate){
  const a=normalize(expected),b=normalize(candidate);if(!a||!b)return false;if(a===b)return true;
  const shorter=a.length<=b.length?a:b,longer=a.length>b.length?a:b;
  if(shorter.length>=8&&longer.startsWith(shorter)&&shorter.length/longer.length>=.82)return true;
  const ignored=new Set(['the','and','for','with','from','of','a','an','to','in','on','de','da','do','dos','das','e']);
  const expectedWords=a.split(' ').filter(word=>word.length>1&&!ignored.has(word)),candidateWords=new Set(b.split(' '));
  return expectedWords.length>=2&&expectedWords.every(word=>candidateWords.has(word));
}
function artistMatches(expected,candidate){
  const a=normalize(expected),b=normalize(candidate);if(!a)return true;if(!b)return false;if(a===b)return true;
  if(b.includes(a)&&a.length>=4)return true;
  const artistTokens=a.split(' ').filter(token=>token.length>1);
  return artistTokens.length>1&&artistTokens.every(token=>b.split(' ').includes(token));
}
function secureYouTubeUrl(value){
  try{
    const url=new URL(value);if(url.protocol!=='https:')return '';
    return ['music.youtube.com','youtube.com'].includes(url.hostname.toLowerCase())?url.href:'';
  }catch(_){return '';}
}
async function getJSON(url,options={},timeout=8500){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
  try{
    const response=await fetch(url,{...options,signal:controller.signal,headers:{Accept:'application/json',...(options.headers||{})}});
    if(!response.ok)throw new Error('Provider returned HTTP '+response.status);
    return await response.json();
  }finally{clearTimeout(timer);}
}
function unverified(reason){return {state:'unverified',reason};}
function missing(){return {state:'missing'};}
function available(url){const safe=secureYouTubeUrl(url);return safe?{state:'available',url:safe}:unverified('The catalog returned a link that could not be validated');}
async function checkYouTube(title,artist){
  const key=process.env.YOUTUBE_DATA_API_KEY;if(!key)return unverified('YouTube Music catalog search needs a YouTube Data API key');
  const url=new URL('https://www.googleapis.com/youtube/v3/search');url.search=new URLSearchParams({part:'snippet',type:'playlist',maxResults:'10',regionCode:'BR',q:[title,artist].filter(Boolean).join(' '),key});
  const data=await getJSON(url);if(!Array.isArray(data.items))throw new Error('YouTube returned an unexpected catalog response');const items=data.items;
  const match=items.find(item=>titleMatches(title,item.snippet?.title)&&artistMatches(artist,[item.snippet?.title,item.snippet?.channelTitle].filter(Boolean).join(' ')));
  const playlistId=match?.id?.playlistId;return playlistId?available('https://music.youtube.com/playlist?list='+encodeURIComponent(playlistId)):missing();
}
async function checkAlbum(title,artist){
  try{return {platforms:{youtube:await checkYouTube(title,artist)}};}
  catch(_){return {platforms:{youtube:unverified('YouTube Music catalog check failed; availability is unknown')}};}
}
function respondJSON(response,status,data){
  response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  response.end(JSON.stringify(data));
}
async function youtubeMusicLink(request,response){
  const priorConfig=process.env.YOUTUBE_DATA_API_KEY||'';
  loadLocalEnv(true);
  const currentConfig=process.env.YOUTUBE_DATA_API_KEY||'';
  if(priorConfig!==currentConfig)responseCache.clear();
  const url=new URL(request.url,'http://localhost');
  const title=(url.searchParams.get('title')||'').trim().slice(0,220),artist=(url.searchParams.get('artist')||'').trim().slice(0,180);
  if(!title)return respondJSON(response,400,{error:'An album title is required'});
  const cacheKey=normalize(title)+'|'+normalize(artist),cached=responseCache.get(cacheKey);
  if(cached&&Date.now()<cached.expiresAt)return respondJSON(response,200,cached.value);
  try{
    const value=await checkAlbum(title,artist),hasUnverified=Object.values(value.platforms).some(result=>result.state==='unverified');
    responseCache.set(cacheKey,{value,expiresAt:Date.now()+(hasUnverified?UNCERTAIN_CACHE_TTL:CACHE_TTL)});
    if(responseCache.size>500){for(const [key,item] of responseCache)if(Date.now()>=item.expiresAt)responseCache.delete(key);if(responseCache.size>500)responseCache.delete(responseCache.keys().next().value);}
    respondJSON(response,200,value);
  }catch(error){console.error('YouTube Music lookup failed:',error.message);respondJSON(response,502,{error:'Catalog lookup failed',platforms:{youtube:unverified('YouTube Music catalog could not be checked')}});}
}
const mimeTypes={'.html':'text/html; charset=utf-8','.txt':'text/plain; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.ttf':'font/ttf','.woff2':'font/woff2'};
function serveFile(request,response){
  let pathname;try{pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);}catch(_){response.writeHead(400);response.end('Bad request');return;}
  if(pathname==='/')pathname='/index.html';
  const file=path.resolve(ROOT,'.'+pathname),relative=path.relative(ROOT,file);
  if(relative.startsWith('..')||path.isAbsolute(relative)){response.writeHead(403);response.end('Forbidden');return;}
  if(path.basename(file)==='.env'){response.writeHead(404);response.end('Not found');return;}
  fs.stat(file,(error,stat)=>{
    if(error||!stat.isFile()){response.writeHead(404);response.end('Not found');return;}
    response.writeHead(200,{'Content-Type':mimeTypes[path.extname(file).toLowerCase()]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':path.extname(file)==='.html'?'no-cache':'public, max-age=3600'});
    fs.createReadStream(file).pipe(response);
  });
}
const server=http.createServer((request,response)=>{
  if(request.method!=='GET'){response.writeHead(405,{'Allow':'GET'});response.end('Method not allowed');return;}
  const pathname=new URL(request.url,'http://localhost').pathname;
  if(pathname==='/api/youtube-music-link'){youtubeMusicLink(request,response);return;}
  serveFile(request,response);
});
const port=Number(process.env.PORT)||4177;
server.listen(port,'127.0.0.1',()=>console.log('THE DEEP CUT listening at http://127.0.0.1:'+port));
