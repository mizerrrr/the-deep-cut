/* Album search and validation for The Deep Cut.
   Shared by the page (index.html) and the server (/api/pool), so both pick
   albums with exactly the same rules. No DOM access in here. */
const API='https://archive.org/advancedsearch.php';
const FIELDS=['identifier','title','description','creator','year','date','mediatype','subject','publisher','coverage','language','collection','format'];
const SOURCES=[
  {name:'Jamendo albums',collection:'jamendo-albums',query:'mediatype:audio AND collection:jamendo-albums'},
  {name:'Netlabels',collection:'netlabels',query:'mediatype:audio AND collection:netlabels'},
  {name:'Open source albums',collection:'opensource_audio',query:'mediatype:audio AND collection:opensource_audio AND subject:album'},
  {name:'Open source album titles',collection:'opensource_audio',query:'mediatype:audio AND collection:opensource_audio AND title:album'}
];
const QUERY_TTL=5*60*1000,METADATA_TTL=30*60*1000;
/* Albums handed out recently; picks avoid them while there are alternatives */
export const recentIds=[];
const queryCache=new Map(),metadataCache=new Map(),pendingMetadata=new Map();

/* ── Utilities ── */
function scalar(v){if(Array.isArray(v))return v.map(scalar).filter(Boolean).join(', ');if(v&&typeof v==='object')return '';return v==null?'':String(v);}
export function clean(v,max){return scalar(v).replace(/<[^>]*>/g,' ').replace(/&amp;/gi,'&').replace(/&#39;|&apos;/gi,"'").replace(/&quot;/gi,'"').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/\s+/g,' ').trim().slice(0,max||500);}
export function values(v){return (Array.isArray(v)?v:[v]).map(x=>clean(x,160)).filter(Boolean);}
export function collectionList(v){return (Array.isArray(v)?v:[v]).map(x=>clean(x,100).toLowerCase()).filter(Boolean);}
function shuffle(list){const out=list.slice();for(let i=out.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[out[i],out[j]]=[out[j],out[i]];}return out;}
export function wait(ms){return new Promise(r=>setTimeout(r,ms));}
export function archiveUrl(item){return 'https://archive.org/details/'+encodeURIComponent(item.identifier);}
function encodePath(n){return String(n||'').split('/').map(encodeURIComponent).join('/');}
export function downloadUrl(item,file){return 'https://archive.org/download/'+encodeURIComponent(item.identifier)+'/'+encodePath(file.name);}

/* ── Fetch ── */
async function fetchJson(url){
  let lastErr;
  for(let attempt=0;attempt<2;attempt++){
    const ctrl=new AbortController(),t=setTimeout(()=>ctrl.abort(),8500);
    try{
      const r=await fetch(url,{signal:ctrl.signal,mode:'cors'});
      if((r.status===429||r.status>=500)&&attempt<1){await wait(250);continue;}
      if(!r.ok)throw new Error('HTTP '+r.status);
      const d=await r.json();
      if(!d||typeof d!=='object'||Array.isArray(d))throw new Error('Invalid response');
      return d;
    }catch(e){lastErr=e;if(attempt===1||e.name==='AbortError')break;await wait(250);}
    finally{clearTimeout(t);}
  }
  throw lastErr||new Error('Fetch failed');
}
function searchUrl(query,page,rows){return API+'?'+new URLSearchParams({q:query,fl:FIELDS.join(','),rows:String(rows||36),page:String(page),output:'json'});}
/* "10s+" runs 2010–2024; "25–26" holds the newest releases (open-ended, so later years still land here) */
function decadeRange(decade){return decade>=2025?'[2025 TO 2099]':decade>=2010?'[2010 TO 2024]':'['+decade+' TO '+(decade+9)+']';}
async function searchPage(source,wave,decade){
  let firstPage=1,cacheTotal=0;
  const decadeSuffix=decade?' AND year:'+decadeRange(decade):'';
  const query=source.query+decadeSuffix;
  const totalEntry=queryCache.get(query+'|total');
  if(!totalEntry||Date.now()-totalEntry.time>=QUERY_TTL){
    const first=await fetchJson(searchUrl(query,1,36));
    if(!first.response||!Array.isArray(first.response.docs))throw new Error('Bad format');
    cacheTotal=Number(first.response.numFound)||0;
    const pages=Math.max(1,Math.ceil(cacheTotal/36));
    firstPage=Math.min(pages,Math.floor(Math.random()*pages)+1);
    queryCache.set(query+'|total',{time:Date.now(),total:cacheTotal});
    if(firstPage===1){queryCache.set(query+'|1',{time:Date.now(),docs:first.response.docs,total:cacheTotal});return first.response.docs;}
  }else{
    const total=totalEntry&&Date.now()-totalEntry.time<QUERY_TTL?totalEntry.total:0;
    const pages=Math.max(1,Math.ceil(total/36));
    firstPage=Math.min(pages,Math.floor(Math.random()*pages)+1);
  }
  const key=query+'|'+firstPage,cached=queryCache.get(key);
  if(cached&&Date.now()-cached.time<QUERY_TTL)return cached.docs;
  const data=await fetchJson(searchUrl(query,firstPage,36));
  if(!data.response||!Array.isArray(data.response.docs))throw new Error('Bad format');
  const total=Number(data.response.numFound)||cacheTotal||(totalEntry&&totalEntry.total)||0;
  queryCache.set(key,{time:Date.now(),docs:data.response.docs,total});
  queryCache.set(query+'|total',{time:Date.now(),total});
  return data.response.docs;
}
function normalizeCandidate(doc,source){
  const identifier=clean(doc&&doc.identifier,220),title=clean(doc&&doc.title,220);
  if(!/^[a-z0-9._-]{1,220}$/i.test(identifier)||!title||/^(untitled|unknown|no title|none)$/i.test(title))return null;
  if(doc.mediatype&&clean(doc.mediatype,30).toLowerCase()!=='audio')return null;
  return {identifier,title,doc,sourceNames:[source.name],collections:collectionList(doc.collection)};
}
async function retrieveCandidates(wave,decade){
  const sources=shuffle(SOURCES),results=await Promise.allSettled(sources.map(s=>searchPage(s,wave,decade)));
  if(!results.some(r=>r.status==='fulfilled'))throw new Error('All archive searches failed');
  const unique=new Map();
  results.forEach((r,i)=>{
    if(r.status!=='fulfilled')return;
    r.value.forEach(doc=>{
      const c=normalizeCandidate(doc,sources[i]);if(!c)return;
      const old=unique.get(c.identifier);
      if(old){if(!old.sourceNames.includes(sources[i].name))old.sourceNames.push(sources[i].name);old.collections=Array.from(new Set(old.collections.concat(c.collections)));}
      else unique.set(c.identifier,c);
    });
  });
  return shuffle(Array.from(unique.values()));
}
export async function getMetadata(identifier){
  const cached=metadataCache.get(identifier);if(cached&&Date.now()-cached.time<METADATA_TTL)return cached.value;
  if(pendingMetadata.has(identifier))return pendingMetadata.get(identifier);
  const req=fetchJson('https://archive.org/metadata/'+encodeURIComponent(identifier)).then(data=>{
    if(!data.metadata||typeof data.metadata!=='object'||!Array.isArray(data.files))throw new Error('No metadata');
    const value={metadata:data.metadata,files:data.files.filter(f=>f&&typeof f==='object')};metadataCache.set(identifier,{time:Date.now(),value});return value;
  }).finally(()=>pendingMetadata.delete(identifier));
  pendingMetadata.set(identifier,req);return req;
}
function imageFile(f){const n=String(f.name||'').toLowerCase(),fmt=String(f.format||'').toLowerCase();return /\.(jpe?g|png|webp|gif|avif)$/i.test(n)||/(jpeg|png|webp|gif|avif)/.test(fmt);}
function audioFile(f){
  const n=String(f.name||'').toLowerCase(),fmt=String(f.format||'').toLowerCase();
  if(/(metadata|archive bittorrent|text|thumbnail)/.test(fmt)||/(_archive\.torrent|_files\.xml|_meta\.(xml|sqlite))$/i.test(n))return false;
  return (/\.(mp3|flac|ogg|oga|wav|m4a|aac|aiff|aif|wma|opus)$/i.test(n)||/(mpeg audio|mpeg-4 audio|ogg vorbis|flac|wave audio|apple lossless|advanced audio coding|windows media audio|opus)/i.test(fmt))&&(!f.size||Number(f.size)>12000);
}
export function rankAudioFiles(files){
  const ranked=(files||[]).map((file,index)=>{
    const name=String(file.name||'').split('/').pop(),base=name.replace(/\.[^.]+$/,'');
    const discMatch=base.match(/(?:^|[ ._-])(?:disc|cd)\s*0*(\d{1,2})(?:[ ._-]|$)/i);
    const metaTrack=String(file.track||file.tracknumber||file.track_number||'').match(/\d+/);
    const namedTrack=base.match(/(?:^|[ ._-])(?:track|trk)\s*0*(\d{1,3})(?:[ ._-]|$)/i);
    const leadTrack=base.match(/^\s*0*(\d{1,3})(?:[ ._-]|$)/);
    const parsedTrack=metaTrack?Number(metaTrack[0]):namedTrack?Number(namedTrack[1]):leadTrack?Number(leadTrack[1]):0;
    const ext=(name.match(/\.([^.]+)$/)||[])[1];
    const fmt=String(file.format||'').toLowerCase();
    const cr={mp3:0,m4a:1,aac:2,ogg:3,oga:3,opus:4,wav:5,aiff:6,aif:6,flac:7,wma:8};
    const codec=Object.prototype.hasOwnProperty.call(cr,String(ext||'').toLowerCase())?cr[String(ext).toLowerCase()]:/mpeg audio|mpeg-4 audio/.test(fmt)?0:/ogg vorbis/.test(fmt)?3:/flac/.test(fmt)?7:9;
    return {file,index,hasTrack:parsedTrack>0,track:parsedTrack||9999,disc:Number(discMatch&&discMatch[1])||1,codec,src:String(file.source||'').toLowerCase()==='original'?0:1};
  }).filter(r=>r.file&&r.file.name&&audioFile(r.file));
  ranked.sort((a,b)=>{
    if(a.hasTrack!==b.hasTrack)return a.hasTrack?-1:1;
    if(a.hasTrack&&(a.disc!==b.disc||a.track!==b.track))return a.disc-b.disc||a.track-b.track;
    if(!a.hasTrack&&a.index!==b.index)return a.index-b.index;
    return a.codec-b.codec||a.src-b.src||a.index-b.index;
  });
  return ranked;
}
function chooseFirstTrack(files){const r=rankAudioFiles(files);return r.length?r[0].file:null;}
export function chooseCover(files){
  const imgs=(files||[]).filter(f=>{
    const n=String(f.name||'').toLowerCase(),fmt=String(f.format||'').toLowerCase(),src=String(f.source||'').toLowerCase(),sz=Number(f.size)||0;
    if(!imageFile(f)||/(spectrogram|spectrum|waveform|sonogram|visuali[sz]ation|frequency|thumbnail|jpeg thumb|item tile)/i.test(n+' '+fmt))return false;
    if(/__ia_thumb|_thumb\./i.test(n)||/no.?cover|placeholder|default.?image/i.test(n))return false;
    const named=/cover|front|folder|album.?art|artwork/i.test(n);
    return (src==='original'&&sz>=8000)||(named&&src!=='derivative'&&sz>=8000);
  });
  if(!imgs.length)return null;
  const score=f=>{const n=String(f.name||'').toLowerCase(),sz=Number(f.size)||0;return (/cover|front|folder|album.?art|artwork/.test(n)?1e12:0)+(/back|disc|label/.test(n)?-1e8:0)+Math.min(sz,1500000)-(sz>4000000?sz:0);}; // big enough, but huge files are slow to fetch
  return shuffle(imgs).sort((a,b)=>score(b)-score(a))[0];
}
export function uniqueTrackCount(files){
  const names=(files||[]).filter(audioFile).map(f=>String(f.name||'').split('/').pop().replace(/\.[^.]+$/,'').normalize('NFKD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/^(?:(?:disc|cd)\s*\d+[\s._-]+)?(?:\d{1,2}[\s._-]+)+/,'').replace(/[^a-z0-9]+/g,' ').trim()).filter(n=>n.length>1);
  return new Set(names).size;
}
export function deriveYear(meta,doc){const v=clean(meta.year||doc.year||meta.date||doc.date,50),m=v.match(/\b(18|19|20|21)\d{2}\b/);return m?m[0]:'';}
function albumMarker(title,meta,doc){const s=values(meta.subject||doc.subject).join(' '),af=clean(meta.album||meta.release||'');return !!af||/\b(album|albums|ep|lp|full album|discography|record|soundtrack)\b|álbum/i.test(title+' '+s);}
export function resolveArtist(title,meta,doc){
  const direct=clean(meta.creator||meta.artist||meta.albumartist||meta.album_artist||doc.creator,180);
  if(direct&&!/^(unknown|artist not listed|none|n\/a|not listed)$/i.test(direct))return direct;
  const m1=title.match(/^(.{2,90}?)\s+[–—-]\s+(.{3,})$/);if(m1)return clean(m1[1],180);
  const m2=title.match(/^(.{2,60}?)\s+album\s+(.{3,})$/i);if(m2)return clean(m2[1],180);
  return '';
}
function genericTitle(t){return t.length<5||/^(?:untitled|unknown|album|full album|music|audio|track)(?:\s*[-#]?\s*\d+)?$/i.test(t);}
function isSpokenRecord(meta,doc,collections){
  const s=values(meta.subject||doc.subject).join(' '),words=[meta.title,meta.description,meta.genre,s].map(v=>clean(v,500)).join(' ');
  return collections.some(c=>/podcast|radiostation|radio_program|audiobook|librivox/i.test(c))||/\b(podcast|radio program|radio show|sermon|lecture|audiobook|audio book|talk show|news broadcast)\b/i.test(words);
}
/* ── AI slop filter (releases from 2025 on) ──
   Strong signals reject on their own: a declared AI tool in the text or the
   audio tags, or a cover whose file name is an AI image tool's default
   (ChatGPT saves "file_0000…png", Gemini "Gemini_Generated_Image_…", etc.).
   Weak signals only reject in pairs: keyword-stuffed tags, no artist, SEO
   titles like "(Hardpsy / Psytrance Fusion Album)", numbered mass series,
   mood filler titles, religious themes. A religious album by a
   named artist with ordinary metadata therefore still passes. */
const AI_TEXT_RE=/\b(?:udio|stable[\s-]?audio|comfyui|mubert|boomy|soundraw|riffusion|musicgen|aiva|soundful|beatoven|freegen|midjourney|dall[\s·.-]?e|leonardo\.ai|ideogram|artificial intelligence|ai[\s-]?(?:generated|music|songs?|album|artist|vocals?|voice|cover|art)|(?:generated|created|made|produced|composed)\s+(?:with|by|using|on|in)\s+(?:ai|a\.i\.|suno|udio)|suno(?:\.ai|\.com|\s?ai|\s?v\d)|a\.i\.?\s+(?:is\s+)?used)\b/i;
const AI_COVER_RE=/^(?:file_0{5,}[0-9a-f]+|chatgpt[\s_-]?image|dall[\s·._-]?e|gemini_generated_image|comfyui_|leonardo_|midjourney|firefly|ideogram|grok[\s_-]?image|imagefx|sora[\s_-])/i;
const RELIGIOUS_RE=/\b(?:worship|gospel|christian|jesus|christ|bible|biblical|scriptures?|psalms?|hymns?|prayers?|praise|prophec(?:y|ies)|holy spirit|lord|ministry|louvor|adora[cç][aã]o|evang[eé]lic[oa]s?|crist[aã]o?s?|deus|senhor)\b/i;
const AI_DENIAL_RE=/\b(?:no|not|without|zero|never|free of)\s+(?:any\s+|use of\s+)?(?:ai|a\.i\.|artificial intelligence)\b[\w\s-]{0,24}|\bai[\s-]free\b|\b100\s*%\s*human\b/gi;
const FILLER_RE=/\b(?:relax(?:ing)?|sleep(?:ing)?|meditation|healing|\d{3}\s?hz|study music|focus music|lo-?fi beats|spa music|yoga|background music|bgm|no copyright|royalty[\s-]free)\b/i;
export function aiSlopReason(info){
  const subjects=info.subjects||[],files=info.files||[];
  const text=[info.title,info.creator,info.description,subjects.join(' ; ')].join(' \n ');
  // "NO AI generated", "made without AI"… are claims of the opposite
  if(subjects.some(s=>/^(?:ai|a\.i\.|suno|udio)$/i.test(s.trim()))||AI_TEXT_RE.test(text.replace(AI_DENIAL_RE,' ')))return 'declared AI';
  const images=files.filter(imageFile).map(f=>String(f.name||'').split('/').pop());
  if(info.coverName)images.push(String(info.coverName).split('/').pop());
  if(images.some(n=>AI_COVER_RE.test(n)))return 'AI cover';
  if(files.some(f=>audioFile(f)&&AI_TEXT_RE.test([f.comment,f.title,f.album,f.artist].map(v=>clean(v,300)).join(' '))))return 'AI audio tags';
  let weak=0;
  // SEO stuffing: a long run of mostly one-word tags ("Free; Download; The; Album; Epic…")
  if(subjects.length>=18&&subjects.filter(s=>!/\s/.test(s.trim())).length/subjects.length>=.75)weak++;
  if(!info.creator||/^(?:undefined|null|unknown|various)$/i.test(info.creator))weak++;
  if(/\((?=[^)]*\balbum\b)[^)]*(?:\/|\sx\s)[^)]*\)/i.test(info.title))weak++;
  if(/^albums?\s*\d+|\balbums?\s*\d+\s*[-–]\s*\d+/i.test(info.title))weak++;
  if(FILLER_RE.test(info.title))weak++;
  if(RELIGIOUS_RE.test(info.title+' '+info.creator+' '+subjects.join(' ')))weak++;
  return weak>=2?'generic metadata':'';
}
function qualityCheck(candidate,details){
  const meta=details.metadata,doc=candidate.doc;
  const collections=Array.from(new Set(candidate.collections.concat(collectionList(meta.collection))));
  const sources=candidate.sourceNames.filter(name=>{
    if(name==='Jamendo albums')return collections.includes('jamendo-albums');
    if(name==='Netlabels')return collections.includes('netlabels');
    return collections.includes('opensource_audio');
  });
  if(!sources.length)return null;
  if(isSpokenRecord(meta,doc,collections))return null;
  const trackCount=uniqueTrackCount(details.files),albumEvidence=albumMarker(clean(meta.title||doc.title,220),meta,doc);
  const jamendo=sources.includes('Jamendo albums'),netlabel=sources.includes('Netlabels');
  if(!(trackCount>=4&&(jamendo||netlabel||albumEvidence)))return null;
  const title=clean(meta.title||doc.title,220);if(!title||genericTitle(title))return null;
  const creator=resolveArtist(title,meta,doc);
  const subjects=values(meta.subject||doc.subject).filter(v=>!/^\d{4}$/.test(v)&&!/^(album|music|audio)$/i.test(v));
  const genre=clean(meta.genre||subjects.slice(0,3).join(' · '),100);
  const description=clean(meta.description||doc.description,900);
  const cover=chooseCover(details.files);
  const firstTrack=chooseFirstTrack(details.files);
  if(!cover||!firstTrack)return null;
  const year=deriveYear(meta,doc);
  if(Number(year)>=2025&&aiSlopReason({title,creator,description:clean(meta.description||doc.description,4000),
    subjects:[].concat(meta.subject||doc.subject||[]).flatMap(s=>scalar(s).split(/\s*;\s*/)).map(s=>s.trim()).filter(Boolean),
    files:details.files,coverName:cover.name}))return null;
  const allRanked=rankAudioFiles(details.files);
  const tracks=allRanked.slice(0,40).map(r=>({name:r.file.name,url:downloadUrl({identifier:candidate.identifier},r.file)}));
  return {
    identifier:candidate.identifier,title,creator,description,year,date:clean(meta.date||doc.date,100),
    region:clean(meta.coverage||meta.country||doc.coverage,160),
    publisher:clean(meta.publisher||meta.label||doc.publisher,180),genre,
    subjects:subjects.slice(0,8).join(', '),language:clean(meta.language||doc.language,100),
    trackCount,source:sources[0],collections,coverName:cover.name,
    tracks,trackIndex:0,
    previewUrl:tracks.length?tracks[0].url:downloadUrl({identifier:candidate.identifier},firstTrack),
    imageUrl:downloadUrl({identifier:candidate.identifier},cover),
    coverLoaded:false
  };
}
async function inspectCandidates(candidates,already,limit,onProgress){
  const eligible=[],remaining=shuffle(candidates.filter(c=>!already.has(c.identifier))).slice(0,limit);
  let completed=0;
  for(let start=0;start<remaining.length;start+=6){
    const batch=remaining.slice(start,start+6);
    batch.forEach(c=>already.add(c.identifier));
    const results=await Promise.allSettled(batch.map(async c=>({candidate:c,details:await getMetadata(c.identifier)})));
    const items=results.filter(r=>r.status==='fulfilled').map(r=>qualityCheck(r.value.candidate,r.value.details)).filter(Boolean);
    eligible.push(...items);completed+=batch.length;
    if(onProgress)onProgress(completed,remaining.length,eligible.length);
    if(eligible.length>=6)break;
  }
  return eligible;
}
/* One album per artist in a pool. The key is the lead artist, so "Pink Floyd"
   and "The Pink Floyd & David Gilmour" collide; blank and "Various Artists"
   never do. */
function artistKey(item){
  const lead=String(item&&item.creator||'').normalize('NFKD').replace(/[̀-ͯ]/g,'').toLowerCase()
    .split(/\s*(?:[,;&+]|\bfeat\.?|\bft\.|\bfeaturing\b|\sx\s|\bvs\.?)\s*/)[0]
    .replace(/^the\s+/,'').replace(/[^a-z0-9Ͱ-￿]+/g,'');
  return /^(?:variousartists?|various|va|unknown|undefined|artistnotlisted)?$/.test(lead)?'':lead;
}
export function distinctArtists(items){
  const seen=new Set();
  return items.filter(item=>{const k=artistKey(item);if(!k)return true;if(seen.has(k))return false;seen.add(k);return true;});
}
function chooseSix(eligible){
  const byId=new Map();eligible.forEach(item=>{if(!byId.has(item.identifier))byId.set(item.identifier,item);});
  const all=Array.from(byId.values()),fresh=shuffle(all.filter(item=>!recentIds.includes(item.identifier)));
  return distinctArtists(fresh.concat(shuffle(all.filter(item=>recentIds.includes(item.identifier))))).slice(0,6);
}
export async function findAlbums(decade,exclude,onProgress){
  const inspected=new Set(),eligible=[];
  for(let wave=0;wave<3&&distinctArtists(eligible).length<6;wave++){
    const candidates=(await retrieveCandidates(wave,decade)).filter(c=>!exclude.has(c.identifier));
    const base=[0,.45,.75][wave],span=[.45,.3,.25][wave];
    const next=await inspectCandidates(candidates,inspected,wave===0?24:18,(done,total)=>onProgress(base+(total?done/total*span:span)));
    eligible.push(...next.filter(item=>!exclude.has(item.identifier)));
  }
  return chooseSix(eligible);
}
