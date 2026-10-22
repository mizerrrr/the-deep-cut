/* Album search and validation for The Deep Cut.
   Shared by the page (index.html) and the server (/api/pool), so both pick
   albums with exactly the same rules. No DOM access in here. */
const API='https://archive.org/advancedsearch.php';
const FIELDS=['identifier','title','description','creator','year','date','mediatype','subject','publisher','coverage','language','collection','format'];
/* trusted: every item in the collection is an album, so the "album" wording
   check is skipped (the four-track, cover and spoken-word checks still apply) */
const SOURCES=[
  {name:'Jamendo albums',collection:'jamendo-albums',trusted:true,query:'mediatype:audio AND collection:jamendo-albums'},
  {name:'Netlabels',collection:'netlabels',trusted:true,query:'mediatype:audio AND collection:netlabels'},
  {name:'Free Music Archive',collection:'freemusicarchive',trusted:true,query:'mediatype:audio AND collection:freemusicarchive'},
  {name:'Unlocked Recordings',collection:'unlockedrecordings',trusted:true,query:'mediatype:audio AND collection:unlockedrecordings'},
  // Most of this collection is anonymous DJ compilations ("VA-DJ X - Street Heat 18"); keep the artist mixtapes people played
  {name:'Hip-hop mixtapes',collection:'hiphopmixtapes',trusted:true,query:'mediatype:audio AND collection:hiphopmixtapes AND downloads:[1000 TO *] AND NOT title:(VA OR hosted OR presents OR chopped OR screwed OR "DJ")'},
  {name:'Digitized LPs',collection:'audio_music',query:'mediatype:audio AND collection:audio_music AND subject:LP'},
  {name:'Open source albums',collection:'opensource_audio',query:'mediatype:audio AND collection:opensource_audio AND subject:album'},
  {name:'Open source album titles',collection:'opensource_audio',query:'mediatype:audio AND collection:opensource_audio AND title:album'}
];
const QUERY_TTL=5*60*1000,TOTAL_TTL=60*60*1000,METADATA_TTL=30*60*1000;
/* The search API stops at result 10,000, so a page drawn from the whole
   collection mostly failed and the big collections were almost never read.
   Each search now picks one of these orderings and a page inside that window;
   big collections are first cut down by a random title prefix, so every part
   of them can come up. */
/* Classical items tagged as such are dropped by the search itself; isClassical() catches the rest */
const NO_CLASSICAL=' AND NOT subject:(classical OR symphony OR symphonies OR opera OR concerto OR concertos OR baroque)';
const PAGE_ROWS=36,MAX_PAGE=Math.floor(10000/PAGE_ROWS);
const SORTS=['titleSorter','creatorSorter','identifier','publicdate','downloads','item_size','avg_rating'];
const PREFIXES='a b c d e f g h i j k l m n o p r s t u v w y'.split(' ');
/* Albums handed out recently; picks avoid them while there are alternatives */
export const recentIds=[];
/* Styles of the latest pools; the next search puts other styles first so each Search More changes the mix */
export const recentStyles=[];
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
    const ctrl=new AbortController(),t=setTimeout(()=>ctrl.abort(),12000); // a cold first connection to the archive can take several seconds
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
function searchUrl(query,page,rows,sort){
  const params=new URLSearchParams({q:query,fl:FIELDS.join(','),rows:String(rows||PAGE_ROWS),page:String(page),output:'json'});
  if(sort)params.append('sort[]',sort);
  return API+'?'+params;
}
/* "10s+" runs 2010–2024; "25–26" holds the newest releases (open-ended, so later years still land here) */
function decadeRange(decade){return decade>=2025?'[2025 TO 2099]':decade>=2010?'[2010 TO 2024]':'['+decade+' TO '+(decade+9)+']';}
function pick(list){return list[Math.floor(Math.random()*list.length)];}
async function search(query,page,sort){
  const key=query+'|'+sort+'|'+page,cached=queryCache.get(key);
  if(cached&&Date.now()-cached.time<QUERY_TTL)return cached;
  const data=await fetchJson(searchUrl(query,page,PAGE_ROWS,sort));
  if(!data.response||!Array.isArray(data.response.docs))throw new Error(data.error||'Bad format');
  const entry={time:Date.now(),docs:data.response.docs,total:Number(data.response.numFound)||0};
  queryCache.set(key,entry);return entry;
}
async function searchPage(source,wave,decade){
  const query=source.query+NO_CLASSICAL+(decade?' AND year:'+decadeRange(decade):'');
  const known=queryCache.get(query+'|total');
  if(known&&Date.now()-known.time<TOTAL_TTL&&!known.total)return []; // nothing from this collection in this era
  const sort=pick(SORTS)+(Math.random()<.5?' asc':' desc');
  // Big result sets are cut by a random title prefix first; small ones are read whole
  const sliced=known&&known.total>MAX_PAGE*PAGE_ROWS?query+' AND title:('+pick(PREFIXES)+'*)':query;
  const first=await search(sliced,1,sort);
  if(sliced===query)queryCache.set(query+'|total',{time:Date.now(),total:first.total});
  const pages=Math.min(MAX_PAGE,Math.ceil(first.total/PAGE_ROWS));
  const page=Math.floor(Math.random()*pages)+1;
  if(pages<=1||page===1)return first.docs;
  return (await search(sliced,page,sort)).docs;
}
function normalizeCandidate(doc,source){
  const identifier=clean(doc&&doc.identifier,220),title=clean(doc&&doc.title,220);
  if(!/^[a-z0-9._-]{1,220}$/i.test(identifier)||!title||/^(untitled|unknown|no title|none)$/i.test(title))return null;
  if(doc.mediatype&&clean(doc.mediatype,30).toLowerCase()!=='audio')return null;
  return {identifier,title,doc,sourceNames:[source.name],collections:collectionList(doc.collection)};
}
async function retrieveCandidates(wave,decade){
  // A different handful of collections each wave keeps the archive load light and the mix varied
  const sources=shuffle(SOURCES).slice(0,5),results=await Promise.allSettled(sources.map(s=>searchPage(s,wave,decade)));
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
  if(String(f.private)==='true')return false; // listed, but the download is locked
  if(/_sample\.[a-z0-9]+$/i.test(n))return false; // the archive's 30-second previews
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
  // One entry per song: keep the most playable format and drop the copies
  const best=new Map();
  ranked.forEach(r=>{
    const k=trackKey(r.file),old=best.get(k);
    if(!old||r.codec<old.codec||(r.codec===old.codec&&r.src<old.src))best.set(k,r);
  });
  return ranked.filter(r=>best.get(trackKey(r.file))===r);
}
/* The same song uploaded in several formats (MP3 + FLAC + OGG…), in format
   folders, or as the archive's own derivatives (which name their source in
   "original") all share one key. The track number from the file name stays
   in the key, so two different songs called "Interlude" are both kept. */
export function trackKey(file){
  // Only an audio original counts: a split LP side names its segments .json as the source
  const derived=String(file.source||'').toLowerCase()==='derivative'&&/\.(mp3|flac|ogg|oga|wav|m4a|aac|aiff?|wma|opus)$/i.test(String(file.original||''))&&file.original;
  const path=String(derived?file.original:file.name||'').normalize('NFKD').replace(/[̀-ͯ]/g,'').toLowerCase();
  const base=path.split('/').pop().replace(/\.[^.]+$/,'').replace(/[\s._-]*(?:vbr|\d{2,3}kbp?s?|sample|hq|lq|stereo|mono)$/,'');
  // The disc can sit in a folder name ("CD2/01 Intro.mp3") as well as in the file name
  const disc=(path.match(/(?:^|[ /._-])(?:disc|disk|cd)\s*0*(\d{1,2})(?:[ /._-]|$)/)||[])[1]||'1';
  const num=(base.match(/(?:^|[ ._-])(?:track|trk)\s*0*(\d{1,3})(?:[ ._-]|$)/)||base.match(/^\s*(?:(?:disc|cd)\s*\d+[\s._-]+)?0*(\d{1,3})(?:[ ._-]|$)/)||[])[1]||'';
  const title=base.replace(/^(?:(?:disc|cd)\s*\d+[\s._-]+)?(?:\d{1,3}[\s._-]+)+/,'').replace(/[^a-z0-9]+/g,' ').trim();
  return disc+'|'+num+'|'+title;
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
/* Discogs files speeches, lessons and readings under the "Non-Music" genre */
const SPOKEN_RE=/\b(podcast|radio program|radio show|sermon|lecture|audiobook|audio book|talk show|news broadcast|non-music|spoken word)\b/i;
export function isSpokenText(text){return SPOKEN_RE.test(text);}
function isSpokenRecord(meta,doc,collections){
  const s=values(meta.subject||doc.subject).join(' '),words=[meta.title,meta.description,meta.genre,s].map(v=>clean(v,500)).join(' ');
  return collections.some(c=>/podcast|radiostation|radio_program|audiobook|librivox/i.test(c))||isSpokenText(words);
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
/* ── Classical filter ──
   Western classical recordings (symphonies, concertos, operas, the canon's
   composers and conductors, classical labels) are left out entirely. Only
   title, artist, subjects, genre and label are read: a description that
   mentions "classical influences" does not reject a rock record. */
const CLASSICAL_WORK_RE=/\b(?:symphon(?:y|ies|ic poem)|sinfon(?:ia|ie|ía|ias|ietta)|symphonie|concert(?:o|os|i|ino)|concierto|sonat(?:a|as|e|ina)|string quartet|quatuor|streichquartett|cuarteto para cuerdas|quarteto de cordas|philharmoni[ac]|symphony orchestra|chamber (?:music|orchestra)|orchestre|orchestra sinfonica|requiem|réquiem|cantatas?|oratori(?:o|um)|overtures?|nocturnes?|preludes? and fugues?|fugues?|partitas?|etudes?|études?|mass in [a-g]|operas?|opéra|operetta|lieder|baroque|barroco|classical|klassik|clásica|cl[aá]ssica|early music|renaissance music|der renaissance|instrumentalmusik|medieval music|gregorian|plainchant|chants? gr[eé]goriens?|missa|messes?|mše|motets?|madrigals?|frottol[ae]|sacred vocal music|choruses, sacred|string orchestra music|harpsichord|clavecin|cembalo|carmina burana|abbaye|benedictine monks|moines|moniales|domspatzen|pro musica|collegium|consort|concertgebouw|gewandhaus|staatskapelle|(?:bwv|kv|hob)\.?\s?\d+|(?:opus|op\.)\s?\d+|in [a-g](?:[\s-](?:flat|sharp|dur|moll|bémol|dièse))?[\s,-]+(?:major|minor))\b/i;
/* Catalog credits of the digitized LPs: "Fournet Jean, cond.", "Stader Maria, sop.",
   "Ruf Hugo, clav.", "c.b. David Munrow", and orchestra abbreviations ("S.O. Prague", "Radio Ph.O.") */
const CLASSICAL_CREDIT_RE=/,\s*(?:cond|sop|mezzo|alt|ten|clav|hpd|hpsd|rec)\.|(?:^|[\s;(])[cd]\.b\.\s|\b(?:s|ph|phil)\.\s?o\.|\b(?:supraphon|dgg|archiv|candide|l'oiseau-lyre|b[aä]e?renreiter|festival classique|melodiya|saga pan|red seal)\b/i;
const NOT_CLASSICAL_RE=/\b(?:rock opera|space opera|soap opera|punk opera|hip[\s-]?hop opera|neo[\s-]?classical (?:metal|darkwave)|classic rock)\b/gi;
const CLASSICAL_NAME_RE=/\b(?:beethoven|mozart|bach|brahms|mahler|haydn|handel|händel|haendel|vivaldi|chopin|liszt|wagner|verdi|puccini|debussy|ravel|stravinsk[yi]|dvo[rř][aá]k|mendelssohn|bruch|schumann|schubert|bruckner|sibelius|prokofiev|shostakovich|rachmaninoff?|tchaikovsk[yi]|tschaikowsk[iy]|grieg|elgar|holst|telemann|monteverdi|purcell|rossini|bizet|berlioz|saint-sa[eë]ns|faur[eé]|satie|bart[oó]k|mussorgsk[yi]|rimsky-korsakov|scarlatti|corelli|paganini|offenbach|donizetti|bellini|gounod|massenet|poulenc|britten|vaughan williams|rameau|couperin|lully|albinoni|sch[oö]e?nberg|webern|milhaud|honegger|ibert|roussel|dukas|chausson|d'indy|martin[uů]|kod[aá]ly|lassus|janequin|glinka|kabalevsky|khachaturian|hindemith|messiaen|ligeti|penderecki|orff|copland|tallis|byrd|palestrina|praetorius|charpentier|josquin|dufay|machaut|gesualdo|frescobaldi|buxtehude|pachelbel|gluck|dussek|dusik|loeillet|haitink|munrow|pergolesi|boccherini|hummel|smetana|janáček|janacek|borodin|glazunov|scriabin|respighi|mascagni|leoncavallo|villa-lobos|ginastera|rodrigo|albéniz|albeniz|granados|de falla|karajan|toscanini|ormandy|solti|furtwängler|furtwangler|klemperer|bernstein|leonhardt|brüggen|bruggen|harnoncourt|menuhin|heifetz|rostropovich|horowitz|rubinstein|callas|pavarotti|deutsche grammophon|philips classics|naxos|hyperion records|harmonia mundi|archiv produktion|erato|nonesuch explorer|telarc|chandos|musical heritage society)\b/i;
export function isClassical(info){
  const text=[info.title,info.creator,info.genre,info.publisher,(info.subjects||[]).join(' ; ')].join(' \n ').replace(NOT_CLASSICAL_RE,' ');
  return CLASSICAL_WORK_RE.test(text)||CLASSICAL_NAME_RE.test(text)||CLASSICAL_CREDIT_RE.test(text);
}
/* ── Genre ──
   Each album gets one style, the most specific one its genre tag, subjects or
   collection name: "industrial rock" and "rock" are different styles, while
   "rap", "hip-hop" and "hiphop" are the same. A pool holds one album per style. */
const STYLES=[
  ['industrial metal',/industrial[\s-]metal/],['industrial rock',/industrial[\s-]rock/],['black metal',/black[\s-]metal/],['death metal',/death[\s-]metal/],
  ['doom metal',/doom|sludge/],['thrash metal',/thrash/],['metalcore',/metalcore|deathcore/],['grindcore',/grindcore|goregrind/],['metal',/\bmetal\b/],
  ['post-rock',/post[\s-]?rock/],['post-punk',/post[\s-]?punk|coldwave|darkwave/],['shoegaze',/shoegaze|dream[\s-]?pop/],['math rock',/math[\s-]?rock/],
  ['psychedelic rock',/psych/],['progressive rock',/prog(?:ressive)?[\s-]?rock|\bprog\b|krautrock/],['stoner rock',/stoner|desert rock/],['garage rock',/garage rock/],
  ['grunge',/grunge/],['hard rock',/hard[\s-]rock/],['folk rock',/folk[\s-]rock/],['surf rock',/\bsurf\b/],['rockabilly',/rockabilly|rock[\s']*n[\s']*roll|rock and roll/],
  ['hardcore punk',/hardcore punk|\bhardcore\b(?![\s-]?(?:techno|rap|hip))/],['punk',/punk/],['emo',/\bemo\b|screamo/],['indie rock',/indie[\s-]?rock/],
  ['alternative rock',/alternative|alt[\s-]rock/],['rock',/\brock\b/],
  ['trap',/\btrap\b/],['instrumental hip hop',/instrumental hip[\s-]?hop|beat ?tape|lo-?fi hip[\s-]?hop/],['trip hop',/trip[\s-]?hop/],
  ['hip hop',/\brap\b|hip[\s-]?hop|hiphop|mixtape/],
  ['dark ambient',/dark[\s-]?ambient/],['ambient',/ambient/],['drone',/\bdrone\b/],['noise',/\bnoise\b/],['field recordings',/field recording|soundscape/],
  ['idm',/\bidm\b|intelligent dance/],['minimal techno',/minimal techno|\bminimal\b/],['techno',/techno/],['deep house',/deep[\s-]house/],['house',/\bhouse\b/],
  ['trance',/trance|\bgoa\b/],['drum and bass',/drum[\s'&n]*bass|\bdnb\b|jungle/],['dubstep',/dubstep/],['breakcore',/breakcore|breakbeat|\bbreaks\b/],
  ['chiptune',/chiptune|8[\s-]?bit|chipmusic/],['synthwave',/synthwave|retrowave|outrun/],['vaporwave',/vaporwave|future funk/],['downtempo',/downtempo|chill[\s-]?out/],
  ['glitch',/glitch|microsound/],['electro',/\belectro\b/],['synth-pop',/synth[\s-]?pop|new wave/],['experimental',/experimental|avant[\s-]?garde/],
  ['electronic',/electronic|electronica|\bedm\b|\bdance\b/],
  ['free jazz',/free jazz|free improvisation|\bimprov/],['jazz fusion',/jazz[\s-]?fusion|jazz[\s-]?rock/],['jazz',/jazz|bebop|\bswing\b/],['blues',/blues/],['soul',/\bsoul\b|motown/],
  ['funk',/\bfunk\b/],['r&b',/r&b|r'n'b|rhythm and blues|\brnb\b/],['disco',/disco/],['reggae',/reggae/],['dub',/\bdub\b/],['ska',/\bska\b|rocksteady/],
  ['dancehall',/dancehall/],['afrobeat',/afro[\s-]?beat|\bafro\b/],['bossa nova',/bossa/],['samba',/samba|pagode/],['mpb',/\bmpb\b/],['salsa',/salsa|mambo/],
  ['cumbia',/cumbia/],['tango',/tango/],['flamenco',/flamenco/],['latin',/\blatin/],['k-pop',/k-?pop/],['j-pop',/j-?pop|anime/],
  ['bluegrass',/bluegrass/],['country',/country|americana/],['folk',/\bfolk\b|acoustic|singer[\s-]?songwriter/],['world',/\bworld\b|traditional|ethnic/],
  ['soundtrack',/soundtrack|\bscore\b|motion picture|\bost\b/],['exotica',/exotica|lounge|easy listening/],['new age',/new age|meditation/],['children',/children|\bkids\b/],
  ['comedy',/comedy|humou?r/],['gospel',/gospel|worship|christian/],['polka',/polka/],['indie pop',/indie[\s-]?pop/],['pop',/\bpop\b/],['indie',/\bindie\b/]
];
const COLLECTION_STYLE={hiphopmixtapes:'hip hop'};
export function styleOf(genre,subjects,collections){
  const tries=[genre,(subjects||[]).join(' ; ')].map(v=>String(v||'').toLowerCase());
  for(const text of tries){if(!text)continue;const hit=STYLES.find(([,re])=>re.test(text));if(hit)return hit[0];}
  const c=(collections||[]).find(x=>COLLECTION_STYLE[x]);return c?COLLECTION_STYLE[c]:'';
}
/* Anonymous DJ compilations ("VA-DJ Kurupt - Streetcorner Gangstas 18", "... Hosted By ...") */
const DJ_COMPILATION_RE=/^\s*va\s*[-–]|\bhosted by\b|\bchopped (?:and|n|not) (?:screwed|slopped)\b|^\s*(?:dj|og)\s[^-–]{1,40}\s(?:presents?|&\s.+\spresent)\b/i;
function qualityCheck(candidate,details){
  const meta=details.metadata,doc=candidate.doc;
  const collections=Array.from(new Set(candidate.collections.concat(collectionList(meta.collection))));
  const sources=candidate.sourceNames.filter(name=>{const s=SOURCES.find(x=>x.name===name);return s&&collections.includes(s.collection);});
  if(!sources.length)return null;
  if(/^true$/i.test(clean(meta['access-restricted-item'],10)))return null; // borrow-only: nothing streams
  if(isSpokenRecord(meta,doc,collections))return null;
  const trackCount=uniqueTrackCount(details.files),albumEvidence=albumMarker(clean(meta.title||doc.title,220),meta,doc);
  const trusted=sources.some(name=>SOURCES.find(x=>x.name===name).trusted);
  if(!(trackCount>=4&&(trusted||albumEvidence)))return null;
  const title=clean(meta.title||doc.title,220);if(!title||genericTitle(title))return null;
  const creator=resolveArtist(title,meta,doc);
  const subjects=values(meta.subject||doc.subject).filter(v=>!/^\d{4}$/.test(v)&&!/^(album|music|audio)$/i.test(v));
  const genre=clean(meta.genre||subjects.slice(0,3).join(' · '),100);
  if(DJ_COMPILATION_RE.test(title)||DJ_COMPILATION_RE.test(creator))return null;
  const style=styleOf(clean(meta.genre,200),subjects,collections);
  const description=clean(meta.description||doc.description,900);
  if(isClassical({title,creator,genre:clean(meta.genre,200),publisher:clean(meta.publisher||meta.label||doc.publisher,180),subjects:values(meta.subject||doc.subject)}))return null;
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
    trackCount,source:sources[0],collections,coverName:cover.name,style,
    tracks,trackIndex:0,
    previewUrl:tracks.length?tracks[0].url:downloadUrl({identifier:candidate.identifier},firstTrack),
    imageUrl:downloadUrl({identifier:candidate.identifier},cover),
    coverLoaded:false
  };
}
async function inspectCandidates(candidates,already,limit,onProgress,enough){
  const eligible=[],remaining=shuffle(candidates.filter(c=>!already.has(c.identifier))).slice(0,limit);
  let completed=0;
  for(let start=0;start<remaining.length;start+=6){
    const batch=remaining.slice(start,start+6);
    batch.forEach(c=>already.add(c.identifier));
    const results=await Promise.allSettled(batch.map(async c=>({candidate:c,details:await getMetadata(c.identifier)})));
    const items=results.filter(r=>r.status==='fulfilled').map(r=>qualityCheck(r.value.candidate,r.value.details)).filter(Boolean);
    eligible.push(...items);completed+=batch.length;
    if(onProgress)onProgress(completed,remaining.length,eligible.length);
    if(enough(eligible))break;
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
/* Up to six albums, one per artist and one per style (an album with no
   recognisable style is never blocked). perStyle 2 is only the fallback when
   the searches could not turn up six different styles. */
function pickDiverse(items,perStyle){
  const artists=new Set(),styles=new Map(),out=[];
  for(const item of items){
    const a=artistKey(item),st=item.style||'';
    if(a&&artists.has(a))continue;
    if(st&&(styles.get(st)||0)>=perStyle)continue;
    if(a)artists.add(a);if(st)styles.set(st,(styles.get(st)||0)+1);
    out.push(item);if(out.length===6)break;
  }
  return out;
}
function chooseSix(eligible){
  const byId=new Map();eligible.forEach(item=>{if(!byId.has(item.identifier))byId.set(item.identifier,item);});
  // Unseen albums in styles not shown lately come first, then unseen albums in recent styles, then repeats
  const rank=item=>(recentIds.includes(item.identifier)?2:0)+(item.style&&recentStyles.includes(item.style)?1:0);
  const ordered=shuffle(Array.from(byId.values())).sort((a,b)=>rank(a)-rank(b));
  const strict=pickDiverse(ordered,1);
  return strict.length===6?strict:pickDiverse(ordered,2);
}
export async function findAlbums(decade,exclude,onProgress){
  const inspected=new Set(),eligible=[];
  const enough=more=>pickDiverse(eligible.concat(more),1).length>=6;
  for(let wave=0;wave<3&&!enough([]);wave++){
    const candidates=(await retrieveCandidates(wave,decade)).filter(c=>!exclude.has(c.identifier));
    const base=[0,.45,.75][wave],span=[.45,.3,.25][wave];
    const next=await inspectCandidates(candidates,inspected,wave===0?24:18,(done,total)=>onProgress(base+(total?done/total*span:span)),enough);
    eligible.push(...next.filter(item=>!exclude.has(item.identifier)));
  }
  return chooseSix(eligible);
}
