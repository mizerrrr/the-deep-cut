import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GET as thumb } from './api/thumb.mjs';
import { GET as pool } from './api/pool.mjs';

const ROOT=path.dirname(fileURLToPath(import.meta.url));

function loadLocalEnv(){
  try{
    const source=fs.readFileSync(path.join(ROOT,'.env'),'utf8');
    source.split(/\r?\n/).forEach(line=>{
      const match=line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if(!match||match[1] in process.env)return;
      let value=match[2];
      if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))value=value.slice(1,-1);
      process.env[match[1]]=value;
    });
  }catch(error){if(error.code!=='ENOENT')throw error;}
}
loadLocalEnv();

/* Runs a Vercel-style handler (Request in, Response out) on the local server */
async function runHandler(handler,request,response){
  const result=await handler(new Request(new URL(request.url,'http://localhost')));
  response.writeHead(result.status,Object.fromEntries(result.headers));
  response.end(Buffer.from(await result.arrayBuffer()));
}
const mimeTypes={'.html':'text/html; charset=utf-8','.txt':'text/plain; charset=utf-8','.xml':'application/xml; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.ttf':'font/ttf','.woff2':'font/woff2','.webmanifest':'application/manifest+json; charset=utf-8'};
function serveFile(request,response){
  let pathname;try{pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);}catch(_){response.writeHead(400);response.end('Bad request');return;}
  if(pathname==='/')pathname='/index.html';
  // Clean URLs, as vercel.json's cleanUrls does in production: /about → about.html, /guides → guides/index.html
  if(!path.extname(pathname)){
    const base=path.resolve(ROOT,'.'+pathname.replace(/\/$/,''));
    if(fs.existsSync(base+'.html'))pathname=pathname.replace(/\/$/,'')+'.html';
    else if(fs.existsSync(path.join(base,'index.html')))pathname=pathname.replace(/\/$/,'')+'/index.html';
  }
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
  if(pathname==='/api/thumb'){runHandler(thumb,request,response);return;}
  if(pathname==='/api/pool'){runHandler(pool,request,response);return;}
  serveFile(request,response);
});
const port=Number(process.env.PORT)||4177;
server.listen(port,'127.0.0.1',()=>console.log('THE DEEP CUT listening at http://127.0.0.1:'+port));
