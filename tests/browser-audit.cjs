/* Browser audit; production remains a self-contained HTML file. */
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const {chromium,firefox,webkit}=require('playwright');
const browserName=process.env.AUDIT_BROWSER||'chromium';
const pageFile=process.env.AUDIT_PAGE||'preview.html';
const root=path.resolve(__dirname,'..');
const output=process.env.AUDIT_OUTPUT||path.resolve(root,'../../work/audit-results');
const widths=[320,390,768,1024,1440];
const feed='id,lab,term,type,student_name\naspire,ASPIRE Lab,Spring 2027,DIS,PRIVATE_FEED_NAME\nplant,Plant Lab,Spring 2027,DIS,PRIVATE_FEED_NAME\n';
const report={browser:browserName,page:pageFile,checks:[],violations:[],failures:[]};
let browser,server;
const checks=[];
function block(html,id){const m=html.match(new RegExp('<script id="'+id+'"[^>]*>([\\s\\S]*?)</script>'));assert(m,id+' missing');return m[1]}
async function check(name,fn){await fn();checks.push(name);report.checks.push(name);console.log('PASS '+name)}
async function main(){
 assert(['preview.html','index.html'].includes(pageFile));
 assert(['chromium','firefox','webkit'].includes(browserName));
 await fs.mkdir(output,{recursive:true});
 const html=await fs.readFile(path.join(root,pageFile),'utf8');
 const data=JSON.parse(block(html,'research-data')),meta=JSON.parse(block(html,'guide-meta'));
 await check('data schema and every source URL',async()=>{
  assert.equal(data.length,meta.records);assert.equal(new Set(data.map(r=>r.id)).size,data.length);
  for(const r of data){
   for(const k of ['id','name','mentor','category','area','status','requirements','modality','checked'])assert.equal(typeof r[k],'string',r.id+' '+k);
   assert(/^[a-z0-9_-]+$/i.test(r.id));assert(r.urls.length>0);
   for(const k of ['checked','deadline','applicationStart'])if(r[k]){assert(/^\d{4}-\d{2}-\d{2}$/.test(r[k]));assert.equal(new Date(r[k]+'T12:00:00Z').toISOString().slice(0,10),r[k])}
   for(const s of r.urls)assert(['http:','https:'].includes(new URL(s.url).protocol));
   if(r.email)assert(/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(r.email));
  }
  for(const id of ['guide-meta','email-templates','placements-config'])JSON.parse(block(html,id));
  if(pageFile==='preview.html')assert(/<meta name="robots" content="noindex">/.test(html));
 });
 const documents=new Map();
 server=http.createServer(async(req,res)=>{
  try{const pathname=new URL(req.url,'http://localhost').pathname;
   if(documents.has(pathname)){res.setHeader('content-type','text/html; charset=utf-8');res.end(documents.get(pathname));return}
   const file=path.resolve(root,'.'+pathname);if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return}
   const body=await fs.readFile(file);res.setHeader('content-type',file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.png')?'image/png':'application/octet-stream');res.end(body);
  }catch{res.writeHead(404);res.end('Not found')}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port,url=origin+'/'+pageFile;
 const options={headless:true};if(process.env.AUDIT_CHROMIUM_EXECUTABLE&&browserName==='chromium'){options.executablePath=process.env.AUDIT_CHROMIUM_EXECUTABLE;options.args=['--no-sandbox']}
 browser=await ({chromium,firefox,webkit}[browserName]).launch(options);
 async function session(width=390,opts={}){
  const context=await browser.newContext({viewport:{width,height:width<800?844:1000},colorScheme:'light',timezoneId:'America/New_York',javaScriptEnabled:opts.js!==false});
  if(opts.init)await context.addInitScript(opts.init);
  await context.addInitScript(()=>{window.__auditCopied=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>window.__auditCopied.push(text)}})});
  await context.route('**/*',route=>{
   const target=route.request().url();
   if(target.startsWith(origin))return route.continue();
   if(target.startsWith('https://docs.google.com/'))return route.fulfill({status:opts.feedStatus||200,contentType:'text/csv',headers:{'access-control-allow-origin':'*'},body:opts.feed||feed});
   return route.abort();
  });
  const p=await context.newPage();p.setDefaultTimeout(12000);const errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'&&!opts.expectedNetworkError)errors.push(m.text())});
  await p.goto(url+'#view=directory&section=labs');if(opts.js!==false){await p.waitForFunction(()=>document.documentElement.classList.contains('js-ready'));await p.evaluate(()=>document.fonts.ready)}
  return {p,context,errors,close:async()=>{assert.deepEqual(errors,[],'browser exceptions');await context.close()}};
 }
 async function axe(p,label){
  if(!await p.evaluate(()=>!!window.axe))await p.evaluate(await fs.readFile(require.resolve('axe-core/axe.min.js'),'utf8'));
  const issues=await p.evaluate(async()=>(await window.axe.run(document)).violations.map(v=>({id:v.id,impact:v.impact,targets:v.nodes.map(n=>n.target)})));
  report.violations.push(...issues.map(v=>({label,...v})));assert.deepEqual(issues,[],label+' accessibility: '+JSON.stringify(issues));
 }
 const count=async p=>Number((await p.locator('#result-count').innerText()).match(/^\d+/)[0]);
 for(const width of widths)await check('layout and user flows '+width,async()=>{
  const s=await session(width),{p}=s;await p.screenshot({path:path.join(output,'directory-'+width+'.png')});
  assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  if(width===390)assert((await p.locator('#cards').boundingBox()).y<844);
  assert.equal(await p.locator('#cards .lab-row').count(),12);
  await axe(p,'directory '+width);
  if(width<=760){
   for(const id of ['application','remote','psychology','biology','health']){
    await p.goto(url+'#view=directory&section=labs');const chip=p.locator('[data-quick-filter="'+id+'"]');const n=Number((await chip.locator('.shortcut-count').innerText()).replace(/\D/g,''));await chip.click();assert.equal(await count(p),n,id+' count');assert.equal(await chip.getAttribute('aria-pressed'),'true');
   }
   await p.goto(url+'#view=directory&section=labs');await p.locator('#toggle-filters').click();await p.locator('#mode').selectOption('remote');assert.equal(await p.locator('[data-quick-filter="remote"]').getAttribute('aria-pressed'),'true');await p.locator('#show-filter-results').click();assert.equal(await p.evaluate(()=>document.activeElement.id),'result-count');await p.locator('#active-filters [data-remove-filter="mode"]').click();assert.equal(await p.locator('#mode').inputValue(),'');
   await p.locator('#toggle-filters').click();await axe(p,'filters '+width);await p.keyboard.press('Escape');assert.equal(await p.locator('#toggle-filters').getAttribute('aria-expanded'),'false');
   await p.locator('#calendar-label').click();assert(await p.locator('#deadlines').isVisible());assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await p.locator('#calendar-label').click();
  }else assert(await p.locator('#cards .fit-preview').first().isVisible());
  await p.locator('#search').fill('aspire');await p.waitForTimeout(180);assert.equal(await count(p),1);await p.locator('#clear-search').click();await p.locator('[data-page="2"]').click();assert((await p.locator('#pagination').innerText()).includes('Page 2'));
  await p.goto(url+'#view=directory&section=all&archived=1&lab=aspire');assert.equal(await p.locator('#detail-title').innerText(),'ASPIRE Lab');await axe(p,'detail '+width);await p.locator('#detail-body [data-share-record]').click();assert((await p.evaluate(()=>window.__auditCopied[window.__auditCopied.length-1])).startsWith('https://macin123.github.io/cells-research/'));
  const save=width<=760?'#detail-actions [data-save]':'#detail-body [data-save]';await p.locator(save).click();await p.reload();assert.equal(await p.locator(save).getAttribute('aria-pressed'),'true');await p.locator(save).click();await p.reload();assert.equal(await p.locator(save).getAttribute('aria-pressed'),'false');
  await p.locator('#detail-body [data-draft]').click();await p.locator('#draft-name').fill('Audit Student');await p.locator('#draft-major').fill('Biology');assert(decodeURIComponent(await p.locator('#draft-send').getAttribute('href')).includes('Audit Student'));await axe(p,'draft '+width);await p.keyboard.press('Escape');await p.waitForTimeout(150);
  await p.goto(url+'#view=directory&section=labs');await p.locator('#cards [data-save]').nth(0).click();await p.locator('#cards [data-save]').nth(1).click();await p.locator('.navigation [data-view="saved"]').click();await p.locator('#cards [data-compare-select]').nth(0).click();await p.locator('#cards [data-compare-select]').nth(1).click();await axe(p,'saved '+width);await p.locator('#compare-open').click();assert.equal(await p.locator('#comparison-table thead th').count(),3);await axe(p,'comparison '+width);await p.keyboard.press('Escape');
  if(width<=760)await p.locator('#mobile-result-tools summary').click();const dw=p.waitForEvent('download');await p.locator(width<=760?'#mobile-export-results':'#export-results').click();const d=await dw;const file=path.join(output,'records-'+width+'.csv');await d.saveAs(file);assert((await fs.readFile(file,'utf8')).includes('"requirements"'));
  const jw=p.waitForEvent('download');await p.locator('#export-saved').click();const jd=await jw,jfile=path.join(output,'saved-'+width+'.json');await jd.saveAs(jfile);assert.equal(JSON.parse(await fs.readFile(jfile,'utf8')).ids.length,2);await p.locator('#cards [data-save]').first().click();await p.locator('#cards [data-save]').first().click();assert.equal(await count(p),0);assert.equal(await p.evaluate(()=>document.activeElement.id),'result-count');await p.locator('#saved-import').setInputFiles(jfile);await p.waitForTimeout(150);assert.equal(await count(p),2);
  await p.locator('.navigation [data-view="templates"]').click();await axe(p,'templates '+width);await p.locator('#template-inquiry-subject').fill('Audit subject');await p.locator('[data-template-copy="inquiry"][data-template-part="subject"]').click();assert.equal(await p.evaluate(()=>window.__auditCopied[window.__auditCopied.length-1]),'Audit subject');await p.locator('[data-template-reset="inquiry"]').click();assert((await p.locator('#template-inquiry-subject').inputValue()).includes('[Research Topic]'));assert(await p.locator('#download-resume').isVisible());
  await p.locator('.navigation [data-view="guide"]').click();await axe(p,'guide '+width);assert.equal(await p.locator('.guide-step').count(),5);await p.locator('.navigation [data-view="about"]').click();await axe(p,'about '+width);await p.locator('#audit-search').fill('aspire');assert.equal(Number((await p.locator('#audit-count').innerText()).match(/^\d+/)[0]),data.filter(r=>[r.name,r.mentor,r.auditNote].join(' ').toLowerCase().includes('aspire')).length);
  await s.close();
 });
 await check('every record renders at 320 and 1440 without overflow',async()=>{
  for(const width of [320,1440]){const s=await session(width);const failures=await s.p.evaluate(()=>{
   const failed=[];for(const r of DATA){openDetail(r.id,{fromRoute:true});const d=document.getElementById('detail'),body=document.getElementById('detail-body');if(!document.getElementById('detail-title').textContent||!body.textContent.includes(r.mentor)||!body.textContent.includes(r.auditNote))failed.push(r.id+': content');if(d.scrollWidth>d.clientWidth+1||body.scrollWidth>body.clientWidth+1)failed.push(r.id+': overflow');const urls=[...body.querySelectorAll('.source-links a')].map(a=>a.href);if(urls.length!==r.urls.length||r.urls.some(s=>!urls.includes(new URL(s.url).href)))failed.push(r.id+': sources')}closeDetail({fromRoute:true});return failed;
  });assert.deepEqual(failures,[]);await s.close()}
 });
 await check('draft fields persist and exported guide contains no personal state',async()=>{
  const s=await session();const {p}=s;await p.goto(url+'#view=directory&section=all&lab=aspire');await p.locator('#detail-body [data-draft]').click();await p.locator('#draft-name').fill('AUDIT_PRIVATE_MARKER');await p.locator('#draft-greeting').fill('Dr. Custom Contact');await p.locator('#draft-topic').fill('Topic One');await p.locator('#draft-topic').fill('Topic Two');await p.locator('[data-draft-back]').click();await p.locator('#detail-body [data-draft]').click();assert.equal(await p.locator('#draft-greeting').inputValue(),'Dr. Custom Contact');assert.equal(await p.locator('#draft-topic').inputValue(),'Topic Two');await p.locator('[data-draft-kind="followup"]').click();await p.locator('#draft-topic').fill('Followup One');await p.locator('#draft-topic').fill('Followup Two');assert((await p.locator('#draft-body').inputValue()).includes('followup Two'));await p.locator('#close-detail').click();await p.waitForTimeout(150);await p.locator('.navigation [data-view="templates"]').click();const dw=p.waitForEvent('download');await p.locator('#download-guide').click();const d=await dw;const target=path.join(output,'offline.html');await d.saveAs(target);const exported=await fs.readFile(target,'utf8');assert(!exported.includes('AUDIT_PRIVATE_MARKER'));assert(!exported.includes('Dr. Custom Contact'));for(const id of ['research-data','guide-meta','placements-config','email-templates'])assert.equal(block(exported,id),block(html,id));documents.set('/offline.html',exported);await p.goto(origin+'/offline.html');assert(await p.locator('#cards .lab-row').first().isVisible());assert((await p.evaluate(()=>publicRecordUrl('aspire','file:///tmp/FSU-CELLS-Research-Directory.html'))).startsWith('https://macin123.github.io/cells-research/#'));
  await p.emulateMedia({media:'print'});await p.evaluate(()=>preparePrint());assert(await p.locator('#cards .fit-preview').first().isVisible());assert(!(await p.locator('#quick-shortcuts').isVisible()));await p.emulateMedia({media:'screen'});await p.evaluate(()=>restorePrint());await s.close();
 });
 await check('corrupt storage and unavailable storage recover',async()=>{
  let s=await session(390,{init:()=>{localStorage.setItem('cells-research-profile-v1','"broken"');localStorage.setItem('cells-research-drafts-v1','{"aspire":"broken"}');localStorage.setItem('cells-research-shortlist-v1','{invalid')}});let p=s.p;await p.goto(url+'#view=directory&section=all&lab=aspire');await p.locator('#detail-body [data-draft]').click();await p.locator('#draft-name').fill('Recovered');await p.locator('#draft-body').fill('Recovered draft');assert((await p.locator('#draft-storage-note').innerText()).includes('saved'));await s.close();
  s=await session(390,{init:()=>{Storage.prototype.getItem=()=>{throw new Error('Storage unavailable')};Storage.prototype.setItem=()=>{throw new Error('Storage unavailable')}}});p=s.p;await p.goto(url+'#view=directory&section=all&lab=aspire');await p.locator('#detail-body [data-draft]').click();await p.locator('#draft-body').fill('Session-only letter');assert((await p.locator('#draft-storage-note').innerText()).includes('unavailable'));await s.close();
 });
 await check('clipboard failure downloads a portable link',async()=>{
  const s=await session(390,{init:()=>Object.defineProperty(navigator,'clipboard',{configurable:true,get:()=>undefined})});await s.p.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined}));await s.p.goto(url+'#view=directory&section=all&lab=aspire');await s.p.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined}));const dw=s.p.waitForEvent('download');await s.p.locator('#detail-body [data-share-record]').click();const d=await dw,file=path.join(output,'share.txt');await d.saveAs(file);assert((await fs.readFile(file,'utf8')).startsWith('https://macin123.github.io/cells-research/'));await s.close();
 });
 await check('placement validation, caching, and escaped public output',async()=>{
  const s=await session();const results=await s.p.evaluate(()=>{
   const a=setPlacements('id,lab,term,type\naspire,,Spring 2027,DIS\n,,Spring 2027,DIS\n');const n=placed.rows.length;const b=setPlacements('term\nSpring 2027\n');const kept=placed.rows.length;const c=setPlacements('\ufefflab,term,type\r\n"Unknown, Lab",Spring 2027,Volunteer\r\n');renderPlacements();return {a,n,b,kept,c,lab:placed.rows[0]?.lab};
  });assert.deepEqual(results,{a:true,n:1,b:false,kept:1,c:true,lab:'Unknown, Lab'});assert(!(await s.p.locator('body').innerText()).includes('PRIVATE_FEED_NAME'));await s.close();
  const offline=await session(390,{feedStatus:503,expectedNetworkError:true,init:()=>localStorage.setItem('cells-research-placements-v1','id,lab,term,type\naspire,ASPIRE Lab,Spring 2027,DIS\n')});assert((await offline.p.locator('#impact-line').innerText()).includes('1 CELLS member'));await offline.close();
 });
 await check('no-JS tabs are keyboard accessible at every width',async()=>{
  for(const width of widths){const s=await session(width,{js:false});assert.equal(await s.p.locator('#nojs-directory .nojs-card').count(),meta.records);await s.p.locator('#tab-directory').focus();await s.p.keyboard.press('ArrowRight');assert(await s.p.locator('#panel-guide').isVisible());await s.p.keyboard.press('ArrowRight');assert(await s.p.locator('#panel-templates').isVisible());assert(await s.p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await s.p.keyboard.press('ArrowLeft');await s.p.keyboard.press('ArrowLeft');await s.p.locator('#nojs-labs summary').first().click();assert(await s.p.locator('#nojs-labs .nojs-card').first().isVisible());await axe(s.p,'no-JS '+width);await s.close()}
 });
 await check('Safari 15 fallback modals trap focus and block background',async()=>{
  const s=await session(390,{init:()=>{if(window.HTMLDialogElement){HTMLDialogElement.prototype.showModal=undefined;HTMLDialogElement.prototype.close=undefined;Object.defineProperty(HTMLDialogElement.prototype,'open',{configurable:true,get:()=>undefined})}}});const p=s.p;await p.locator('#toggle-filters').click();assert(await p.locator('#fallback-backdrop').isVisible());assert.equal(await p.locator('#main').getAttribute('aria-hidden'),'true');await p.locator('#show-filter-results').focus();await p.keyboard.press('Tab');assert.equal(await p.evaluate(()=>document.activeElement.id),'dismiss-filters');await axe(p,'fallback filters');await p.keyboard.press('Escape');assert(!(await p.locator('#fallback-backdrop').isVisible()));assert.equal(await p.locator('#main').getAttribute('aria-hidden'),null);await p.locator('#cards .lab-name').first().click();assert(await p.locator('#detail').evaluate(e=>e.hasAttribute('open')));assert((await p.locator('#detail-actions').boundingBox()).y<844);await axe(p,'fallback record');await p.keyboard.press('Escape');await p.waitForTimeout(150);assert.equal(await p.evaluate(()=>document.activeElement.dataset.detail),'plant');await s.close();
 });
 await check('dates expire correctly at FSU midnight',async()=>{
  for(const [iso,expired] of [['2026-10-15T16:00:00Z',false],['2026-10-16T06:00:00Z',true]]){
   const context=await browser.newContext({viewport:{width:390,height:844},timezoneId:'America/New_York'});await context.addInitScript(({iso})=>{const Real=Date;window.Date=class extends Real{constructor(...args){super(...(args.length?args:[iso]))}static now(){return new Real(iso).getTime()}}},{iso});await context.route('https://docs.google.com/**',r=>r.fulfill({status:200,contentType:'text/csv',headers:{'access-control-allow-origin':'*'},body:'id,lab,term,type\n'}));const p=await context.newPage();await p.goto(url);assert.equal(await p.locator('#cards [data-detail="plant"]').count()>0,!expired);await p.goto(url+'#view=directory&section=all&archived=1&lab=plant');assert.equal((await p.locator('#detail-body').innerText()).includes('Deadline passed'),expired);await context.close();
  }
 });
 await check('untrusted text and invalid route keys cannot inject UI',async()=>{
  const s=await session();await s.p.goto(url+'#view=directory&section=__proto__&category=constructor');assert.equal(await s.p.locator('#collection').inputValue(),'labs');assert.equal(await s.p.locator('#category').inputValue(),'');await s.p.locator('#search').fill('<img src=x onerror="window.__attack=1">');await s.p.waitForTimeout(180);assert.equal(await s.p.locator('#active-filters img').count(),0);assert((await s.p.locator('#active-filters').innerText()).includes('<img'));
  await s.p.evaluate(()=>{setPlacements('lab,term,type\n<img src=x onerror=window.__attack=1>,Spring 2027,DIS\n');renderPlacements()});assert.equal(await s.p.locator('#placements-body img').count(),0);assert.equal(await s.p.evaluate(()=>window.__attack),undefined);await s.close();
 });
 report.records=data.length;report.sourceReferences=data.reduce((n,r)=>n+r.urls.length,0);report.status='passed';
}
(async()=>{try{await main()}catch(e){report.status='failed';report.failures.push(e.stack||String(e));console.error(e);process.exitCode=1}finally{await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve))}})();
