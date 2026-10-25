import fs from 'node:fs/promises';
import {request as httpRequest} from 'node:http';

// The private key remains between local processes; the browser never receives it.
export function createPersonalSyncProxy({configPath,origins}){
  let config=null,loadedAt=0;
  return async function maybeHandle(request,response){
    const pathname=new URL(request.url,'http://127.0.0.1').pathname;
    const dedicated=pathname.startsWith('/api/personal-sync/');
    const shared=pathname==='/web-library/manifest.json'||pathname.startsWith('/web-library/files/')||pathname==='/api/database-manifest'||pathname==='/api/database-position';
    if(!dedicated&&!shared)return false;
    if(Date.now()-loadedAt>5000){config=await fs.readFile(configPath,'utf8').then(JSON.parse).catch(e=>{if(e.code==='ENOENT')return null;throw e;});loadedAt=Date.now();}
    const json=(code,value)=>{response.writeHead(code,{'content-type':'application/json','cache-control':'no-store'});response.end(JSON.stringify(value));};
    if(!config?.enabled){if(dedicated){json(200,{enabled:false});return true;}return false;}
    if(config.port!==8788||!/^[a-f0-9]{64}$/.test(config.secret??'')){json(503,{error:'Personal sync configuration needs attention'});return true;}
    const origin=String(request.headers.origin??'').replace(/\/$/,'');
    if(origin&&!origins.has(origin)){json(403,{error:'Origin is not allowed'});return true;}
    if(!['GET','HEAD'].includes(request.method)&&!String(request.headers['content-type']).startsWith('application/json')){json(415,{error:'JSON is required'});return true;}
    const upstream=httpRequest({hostname:'127.0.0.1',port:8788,path:request.url,method:request.method,headers:{'x-personal-sync-key':config.secret,'content-type':request.headers['content-type']??'application/json'}},incoming=>{
      response.writeHead(incoming.statusCode??502,{'content-type':incoming.headers['content-type']??'application/json','cache-control':'no-store'});incoming.pipe(response);
    });
    upstream.setTimeout(60_000,()=>upstream.destroy(Error('Personal sync timed out')));
    upstream.on('error',()=>{if(!response.headersSent)json(503,{error:'The shared library is temporarily offline. Your phone edits are preserved.'});else response.destroy();});
    request.on('aborted',()=>upstream.destroy());request.pipe(upstream);return true;
  };
}
