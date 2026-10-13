import { build } from 'esbuild';
import { readdir, readFile, mkdir, cp, writeFile } from 'node:fs/promises';
import path from 'node:path';

const types={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.woff2':'font/woff2'};
const assets={};
async function collect(directory) {
  for(const item of await readdir(directory,{withFileTypes:true})) {
    const file=path.join(directory,item.name);
    if(item.isDirectory())await collect(file);
    else {
      const key='/'+path.relative('dist/client',file).replaceAll('\\','/');
      assets[key]={type:types[path.extname(file)]||'application/octet-stream',data:(await readFile(file)).toString('base64')};
    }
  }
}
await collect('dist/client');
await mkdir('dist/server',{recursive:true});
await build({entryPoints:['server/worker.js'],outfile:'dist/server/index.js',bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,define:{__HOUSE_ASSETS__:JSON.stringify(assets)}});
await mkdir('dist/.openai',{recursive:true});
try { await cp('.openai/hosting.json','dist/.openai/hosting.json'); }
catch(error) { if(error.code!=='ENOENT')throw error; await cp('.openai/hosting.example.json','dist/.openai/hosting.json'); }
await cp('drizzle','dist/.openai/drizzle',{recursive:true});
await writeFile('dist/server/package.json',JSON.stringify({type:'module'}));
console.log(`Built private Worker with ${Object.keys(assets).length} bundled public assets. No media uploads included.`);
