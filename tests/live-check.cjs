/* Live-site check: the published FSU copy matches the repository and works in a real browser. */
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs/promises');
const path=require('node:path');
const {chromium,firefox,webkit}=require('playwright');
const base=process.env.LIVE_URL||'https://myweb.fsu.edu/mnb23f/';
const browserName=process.env.AUDIT_BROWSER||'chromium';
const root=path.resolve(__dirname,'..');
const output=process.env.AUDIT_OUTPUT||path.resolve(root,'live-results');
const report={base,browser:browserName,checks:[],notes:[]};
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
async function check(name,fn){try{const note=await fn();report.checks.push({name,ok:true,note});console.log('PASS '+name+(note?' :: '+note:''))}catch(e){report.checks.push({name,ok:false,error:String(e.message||e)});console.log('FAIL '+name+' :: '+(e.message||e))}}
async function main(){
 await fs.mkdir(output,{recursive:true});
 if(browserName==='chromium'){
  for(const file of ['index.html','og.png','apple-touch-icon.png'])await check('live '+file+' matches the repository',async()=>{
   const r=await fetch(base+(file==='index.html'?'':file));assert.equal(r.status,200);
   const live=Buffer.from(await r.arrayBuffer()),local=await fs.readFile(path.join(root,file));
   assert.equal(sha(live),sha(local),'live copy differs ('+live.length+' vs '+local.length+' bytes)');
   return r.headers.get('content-type')+', '+live.length+' bytes';
  });
  await check('http address',async()=>{const r=await fetch(base.replace('https:','http:'),{redirect:'manual'});return 'status '+r.status+(r.headers.get('location')?' -> '+r.headers.get('location'):' (served without redirect)')});
  await check('compression',async()=>{const r=await fetch(base,{headers:{'accept-encoding':'gzip, br'}});await r.arrayBuffer();return 'content-encoding: '+(r.headers.get('content-encoding')||'none')});
  await check('response headers',async()=>{const r=await fetch(base,{method:'HEAD'});const h={};for(const k of ['server','cache-control','expires','last-modified','etag','strict-transport-security','x-content-type-options','x-frame-options','content-security-policy','referrer-policy'])h[k]=r.headers.get(k);report.headers=h;return JSON.stringify(h)});
  await check('og image cache-busted URL serves',async()=>{const r=await fetch(base+'og.png?v=2');assert.equal(r.status,200);assert.match(r.headers.get('content-type')||'',/image\/png/)});
  await check('no stray public files',async()=>{const r=await fetch(base+'upload/');return 'upload/ -> '+r.status});
 }
 const browser=await {chromium,firefox,webkit}[browserName].launch();
 for(const [label,ctx] of [['phone',{viewport:{width:390,height:844},isMobile:browserName!=='firefox',hasTouch:true}],['laptop',{viewport:{width:1440,height:900}}]]){
  const c=await browser.newContext(ctx);
  if(browserName==='chromium')await c.grantPermissions(['clipboard-read','clipboard-write']);
  const p=await c.newPage();const errors=[],failed=[];
  p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
  p.on('requestfailed',r=>failed.push(r.url().slice(0,120)+' '+(r.failure()?.errorText||'')));
  p.on('response',r=>{if(r.status()>=400)failed.push(r.status()+' '+r.url().slice(0,120))});
  await check(label+': page loads and lists labs',async()=>{
   const t0=Date.now();await p.goto(base,{waitUntil:'load'});await p.locator('#cards .lab-row').first().waitFor();const ms=Date.now()-t0;
   assert.equal(await p.title(),'Research directory · FSU CELLS');
   assert((await p.locator('#cards .lab-row').count())>=10);
   assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth-innerWidth),0,'page scrolls sideways');
   assert.equal(await p.evaluate(()=>location.protocol),'https:');
   return 'loaded in '+ms+' ms';
  });
  await check(label+': search, filters and a lab record work',async()=>{
   await p.locator('#search').fill('neuro');await p.waitForTimeout(400);assert((await p.locator('#cards .lab-row').count())>0);
   await p.locator('#search').fill('');await p.waitForTimeout(300);
   await p.locator('#cards .lab-name').first().click();await p.locator('#detail[open]').waitFor();
   const name=await p.locator('#detail-title').innerText();await p.keyboard.press('Escape');await p.waitForTimeout(200);
   return 'opened '+name;
  });
  await check(label+': share link points at the FSU address',async()=>{
   await p.goto(base+'#view=directory&section=all&archived=1&lab=aspire');await p.locator('#detail-title').waitFor();
   assert.equal(await p.locator('#detail-title').innerText(),'ASPIRE Lab');
   const href=await p.evaluate(()=>publicRecordUrl('aspire'));assert(href.startsWith('https://myweb.fsu.edu/mnb23f/#'),href);return href;
  });
  await check(label+': saved list survives a reload',async()=>{
   await p.goto(base);await p.locator('#cards .lab-row').first().waitFor();
   await p.locator('#cards .save').first().click();await p.reload();await p.locator('#cards .lab-row').first().waitFor();
   assert.equal(await p.locator('#saved-count').innerText(),'1');
  });
  await check(label+': every tab renders',async()=>{
   for(const v of ['guide','templates','about']){await p.goto(base+'#view='+v);await p.waitForTimeout(300);assert(await p.locator('#panel-'+v).isVisible(),v)}
   await p.screenshot({path:path.join(output,label+'-about.png'),fullPage:true});
  });
  await check(label+': placement counts load from the sheet',async()=>{
   await p.goto(base+'#view=about');await p.waitForTimeout(2500);
   return (await p.locator('#placements').isVisible())?'placements: '+(await p.locator('#placements-body').innerText()).replace(/\s+/g,' ').slice(0,160):'placements section hidden';
  });
  await check(label+': accessibility (axe)',async()=>{
   await p.goto(base);await p.locator('#cards .lab-row').first().waitFor();
   await p.addScriptTag({path:require.resolve('axe-core/axe.min.js')});
   const r=await p.evaluate(async()=>(await axe.run(document,{runOnly:['wcag2a','wcag2aa','wcag21a','wcag21aa','best-practice']})).violations.map(v=>v.id+'('+v.nodes.length+')'));
   assert.deepEqual(r,[]);
  });
  await p.goto(base);await p.waitForTimeout(500);await p.screenshot({path:path.join(output,label+'-directory.png')});
  await check(label+': no script errors or failed requests',async()=>{assert.deepEqual(errors,[]);assert.deepEqual(failed.filter(u=>!/docs\.google\.com|googleusercontent/.test(u)),[]);return failed.length?'google only: '+failed.join('; '):''});
  await c.close();
 }
 await browser.close();
 await fs.writeFile(path.join(output,'live-report.json'),JSON.stringify(report,null,1));
 if(process.env.GITHUB_ACTIONS){const lines=report.checks.map(c=>(c.ok?'PASS ':'FAIL ')+c.name+(c.note?' :: '+c.note:'')+(c.error?' :: '+c.error:''));console.log('::notice title=live '+browserName+'::'+lines.join('\n').replace(/%/g,'%25').replace(/\r/g,'').replace(/\n/g,'%0A'))}
 if(report.checks.some(c=>!c.ok))process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1});
