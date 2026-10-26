/* Fetch every source page in the directory and save its text, so listings can be rechecked. */
const fs=require('node:fs/promises');const path=require('node:path');const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');const out=path.join(root,'refresh');
const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const extra=['https://psychology.fsu.edu/dis','https://cre.fsu.edu/urop-projects'];
const h=u=>crypto.createHash('sha1').update(u).digest('hex').slice(0,12);
const ent=t=>t.replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#0?39;|&rsquo;|&#8217;/g,"'").replace(/&ldquo;|&rdquo;|&#8220;|&#8221;/g,'"').replace(/&ndash;|&#8211;/g,'–').replace(/&mdash;|&#8212;/g,'—').replace(/&#(\d+);/g,(m,n)=>String.fromCharCode(+n));
function text(html){return ent(html.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi,' ').replace(/<!--[\s\S]*?-->/g,' ').replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr|\/td|\/th)[^>]*>/gi,'\n').replace(/<[^>]+>/g,' ')).replace(/[ \t\r\f\v]+/g,' ').replace(/\n\s*/g,'\n').trim()}
function links(html,base){const r=[];for(const m of html.matchAll(/<a\b[^>]*href="([^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi)){try{r.push([new URL(ent(m[1]),base).href,text(m[2]).slice(0,160)])}catch{}}return r}
async function get(url,attempt=0){const ctl=new AbortController();const t=setTimeout(()=>ctl.abort(),30000);
 try{const r=await fetch(url,{headers:{'user-agent':UA,'accept':'text/html,application/xhtml+xml,application/pdf,*/*'},redirect:'follow',signal:ctl.signal});const buf=Buffer.from(await r.arrayBuffer());return {status:r.status,final:r.url,type:r.headers.get('content-type')||'',buf}}
 catch(e){if(attempt<2){await new Promise(r=>setTimeout(r,3000));return get(url,attempt+1)}return {status:0,error:String(e.cause?.code||e.message),final:url,type:'',buf:Buffer.alloc(0)}}finally{clearTimeout(t)}}
async function main(){
 const html=await fs.readFile(path.join(root,'index.html'),'utf8');
 const data=JSON.parse(html.match(/<script id="research-data"[^>]*>([\s\S]*?)<\/script>/)[1]);
 const urls=[...new Set([...data.flatMap(r=>r.urls.map(u=>u.url)),...extra])];
 for(let p=1;p<=12;p++)urls.push('https://cre.fsu.edu/urop-projects?page='+p);
 await fs.mkdir(path.join(out,'pages'),{recursive:true});
 const index={};let i=0;
 async function worker(){while(i<urls.length){const url=urls[i++];const r=await get(url);const id=h(url);const isPdf=/pdf/i.test(r.type)||/\.pdf($|\?)/i.test(url);
  let body='',title='',lk=[];
  if(isPdf){body='[PDF '+r.buf.length+' bytes]';await fs.writeFile(path.join(out,'pages',id+'.pdf'),r.buf)}
  else{const s=r.buf.toString('utf8');title=text((s.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[,''])[1]).slice(0,200);body=text(s);lk=links(s,r.final)}
  await fs.writeFile(path.join(out,'pages',id+'.txt'),body.slice(0,300000));
  index[url]={id,status:r.status,error:r.error,final:r.final,type:r.type.split(';')[0],title,bytes:r.buf.length,textHash:crypto.createHash('sha1').update(body).digest('hex').slice(0,12),links:(extra.includes(url)||url.includes('urop-projects'))?lk:undefined};
  process.stdout.write('.');}}
 await Promise.all(Array.from({length:8},worker));
 await fs.writeFile(path.join(out,'index.json'),JSON.stringify({fetched:new Date().toISOString(),pages:index},null,1));
 const bad=Object.entries(index).filter(([,v])=>v.status!==200);console.log('\nfetched',urls.length,'not 200:',bad.length);
}
main();
