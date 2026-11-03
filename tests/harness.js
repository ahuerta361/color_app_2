const { chromium } = require('playwright');
const path = require('path');
const APP = process.env.APP || 'file://' + path.resolve(__dirname, '..', 'index.html');

const SUPA = `
window.__log=[];
window.supabase={createClient:()=>{
 const L=()=>JSON.parse(localStorage.getItem('__mockdb')||'{}'); const W=d=>localStorage.setItem('__mockdb',JSON.stringify(d));
 const cfg=()=>JSON.parse(localStorage.getItem('__mockcfg')||'{}');
 const auth={getSession:async()=>({data:{session:cfg().login?{user:{id:'u1',email:'t@t.t'}}:null}}),onAuthStateChange(){return{data:{subscription:{unsubscribe(){}}}}},signInWithPassword:async()=>({}),signUp:async()=>({}),signOut:async()=>({})};
 function from(){ const q={};
  const c={select(){return c},eq(k,v){q[k]=v;return c},order(){return c},
   async maybeSingle(){window.__log.push(['get',q.category,q.level_index]); if(cfg().failGet)return{data:null,error:{message:'x'}}; return{data:L()[[q.user_id,q.category,q.level_index].join('|')]||null,error:null}},
   then(res,rej){window.__log.push(['list',q.category]); const rows=Object.values(L()).filter(r=>r.user_id===q.user_id&&r.category===q.category); return Promise.resolve({data:rows,error:null}).then(res,rej)},
   async upsert(p){window.__log.push(['put',p.category,p.level_index,p.colored_indices.length,p.custom_url||null]); if(cfg().failPut)return{error:{message:'fail'}}; const db=L(); db[[p.user_id,p.category,p.level_index].join('|')]=JSON.parse(JSON.stringify(p)); W(db); return{error:null}}};
  return c;}
 return {auth,from,channel(){const ch={on(){return ch},subscribe(){return ch}};return ch},removeChannel(){}};
}};`;

function makeWiki() {
  const wiki = { log: [], failAll: false, emptySearch: false, cats: null, memberCount: 60 };
  wiki.handler = (q, IMG) => {
    const mk = (prefix, n, extra = []) => {
      const pages = {};
      for (let i = 0; i < n; i++) pages[100 + i] = { title: `File:${prefix}_${i}.jpg`, imageinfo: [{ mime: 'image/jpeg', thumburl: IMG }] };
      extra.forEach((e, i) => pages[900 + i] = e);
      return { query: { pages } };
    };
    if (q.get('prop') === 'categories') {
      const t = q.get('titles');
      const c = wiki.cats ? wiki.cats : ['Red foxes', 'Featured pictures of animals', '2019 in Texas', 'Mammals of Europe', 'Photographs by John Doe', 'Quality images'];
      return { query: { pages: { 1: { title: t, categories: c.map(x => ({ title: 'Category:' + x })) } } } };
    }
    if (q.get('generator') === 'search') {
      if (wiki.emptySearch) return { query: { pages: {} } };
      const key = (q.get('gsrsearch') || '').replace(/\W+/g, '');
      return mk('S' + key.slice(-14), 6);
    }
    if (q.get('generator') === 'categorymembers') {
      const t = q.get('gcmtitle');
      if (t.includes('Red foxes')) return mk('Fox', 20);
      if (t.includes('Mammals of Europe')) return mk('Mammal', 25);
      const subj = t.replace('Category:', '');
      return mk('P' + subj.slice(0, 8), wiki.memberCount, [
        { title: 'File:vector.svg', imageinfo: [{ mime: 'image/svg+xml', url: 'x' }] },
        { title: 'File:scan.tif', imageinfo: [{ mime: 'image/tiff', url: 'x' }] },
        { title: 'File:nolinfo.jpg' }
      ]);
    }
    return {};
  };
  return wiki;
}

async function launch() {
  const browser = await chromium.launch();
  const meta = await browser.newContext();
  const pg = await meta.newPage();
  const IMG = await pg.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 64;
    const x = c.getContext('2d');
    for (let i = 0; i < 64; i++) for (let j = 0; j < 64; j++) { x.fillStyle = `rgb(${i * 4},${j * 4},${(i * j) % 255})`; x.fillRect(i, j, 1, 1); }
    return c.toDataURL('image/png');
  });
  await meta.close();
  const PNG = Buffer.from(IMG.split(',')[1], 'base64');
  return { browser, IMG, PNG };
}

async function newCtx(env, opts = {}) {
  const ctx = await env.browser.newContext({ viewport: opts.viewport || { width: 900, height: 700 }, deviceScaleFactor: opts.dpr || 1, isMobile: !!opts.mobile, hasTouch: !!opts.mobile });
  const wiki = makeWiki();
  await ctx.route('**/supabase-js@2', r => r.fulfill({ contentType: 'application/javascript', body: SUPA }));
  await ctx.route('https://commons.wikimedia.org/**', r => {
    const q = new URL(r.request().url()).searchParams;
    wiki.log.push(Object.fromEntries(q.entries()));
    if (wiki.failAll) return r.fulfill({ status: 500, body: 'err' });
    r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(wiki.handler(q, env.IMG)) });
  });
  await ctx.route('https://img.test/**', r => {
    const u = r.request().url();
    if (u.endsWith('ok.png')) return r.fulfill({ contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: env.PNG });
    if (u.endsWith('nocors.png')) return r.fulfill({ contentType: 'image/png', body: env.PNG });
    return r.fulfill({ status: 404, body: 'nf' });
  });
  const errors = [];
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_/.test(m.text())) errors.push('console: ' + m.text()); });
  return { ctx, page, wiki, errors, env };
}
async function open(t, cfg = null) {
  await t.page.goto(APP);
  if (cfg) { await t.page.evaluate(c => localStorage.setItem('__mockcfg', JSON.stringify(c)), cfg); await t.page.reload(); }
  await t.page.waitForFunction(() => document.querySelectorAll('#in-progress-gallery .level-card').length > 0, null, { timeout: 8000 }).catch(() => {});
  if (!(cfg && cfg.login) && !t.keepAuth) await t.page.evaluate(() => { if (!currentUser) bypassAuth(); });
  return t.page;
}

let passed = 0, failed = [];
function ok(cond, msg) { if (!cond) throw new Error('ASSERT: ' + msg); }
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`ASSERT ${msg}: got ${JSON.stringify(a)} expected ${JSON.stringify(b)}`); }
async function test(name, fn) {
  const t0 = Date.now();
  try { await fn(); passed++; console.log(`PASS ${name} (${Date.now() - t0}ms)`); }
  catch (e) { failed.push(name); console.log(`FAIL ${name}: ${e.message.split('\n')[0]}`); }
}
function report() { console.log(`\n${passed} passed, ${failed.length} failed`, failed.length ? failed : ''); }
module.exports = { launch, newCtx, open, test, ok, eq, report, APP };
