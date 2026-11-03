const { launch, newCtx, open, test, ok, eq, report } = require('./harness');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const startLevel = (pg, lvl = 0) => pg.evaluate(async l => {
  document.getElementById('home-screen').classList.remove('active');
  document.getElementById('game-screen').classList.add('active');
  await initLevel(l);
}, lvl);
const toGallery = pg => pg.evaluate(async () => { await returnToGallery(); });
const cards = pg => pg.evaluate(() => document.querySelectorAll('#in-progress-gallery .level-card').length);
const sw = async (pg, c) => { await pg.evaluate(async c => { switchCategory(c); await new Promise(r => setTimeout(r, 500)); }, c); await sleep(200); };
const paint = (pg, n, from = 0) => pg.evaluate(([n, from]) => { for (let i = from; i < from + n; i++) { userGrid[i] = answerGrid[i]; } }, [n, from]);
const reload = async (pg, login = false) => { await pg.reload(); await pg.waitForFunction(() => typeof initLevel === 'function'); await sleep(400); if (!login) await pg.evaluate(() => { if (!currentUser) bypassAuth(); }); };
const logOf = pg => pg.evaluate(() => window.__log);

(async () => {
  const env = await launch();

  // ---------------- cloud ----------------
  await test('cloud: upsert payload, dedupe unchanged saves, size-namespaced category', async () => {
    const t = await newCtx(env); const pg = await open(t, { login: true }); await startLevel(pg);
    await paint(pg, 5); await pg.evaluate(() => saveState(true));
    await pg.evaluate(() => saveState(true));
    let puts = (await logOf(pg)).filter(l => l[0] === 'put'); eq(puts.length, 1, 'one put (dedupe)'); eq(puts[0].slice(1, 4), ['mandala', 0, 5], 'payload');
    await paint(pg, 1, 5); await pg.evaluate(() => saveState(true));
    puts = (await logOf(pg)).filter(l => l[0] === 'put'); eq(puts[1][3], 6, 'second put grew');
    await pg.evaluate(() => updateGridDimensions('200')); await paint(pg, 3); await pg.evaluate(() => saveState(true));
    puts = (await logOf(pg)).filter(l => l[0] === 'put'); eq(puts[puts.length - 1][1], 'mandala@200', 'size namespaced');
    eq(t.errors, [], 'errors'); await t.ctx.close();
  });

  await test('cloud: put failure keeps local progress; reload heals cloud', async () => {
    const t = await newCtx(env); const pg = await open(t, { login: true }); await startLevel(pg);
    await pg.evaluate(() => localStorage.setItem('__mockcfg', JSON.stringify({ login: true, failPut: true })));
    await paint(pg, 8); const res = await pg.evaluate(() => saveState(true)); eq(res, false, 'save reports failure');
    eq(await pg.evaluate(() => unpackIdx(localStorage.getItem(getStorageKey('mandala', 0))).length), 8, 'local kept');
    await pg.evaluate(() => localStorage.setItem('__mockcfg', JSON.stringify({ login: true })));
    await reload(pg, true); await startLevel(pg); await sleep(300);
    const db = await pg.evaluate(() => JSON.parse(localStorage.getItem('__mockdb') || '{}'));
    eq((db['u1|mandala|0'] || {}).colored_indices, [0, 1, 2, 3, 4, 5, 6, 7], 'cloud healed with 8');
    eq(t.errors.filter(e => !/Cloud persist failed/.test(e)), [], 'errors'); await t.ctx.close();
  });

  await test('cloud: stale cloud vs newer local merges (never shrinks), heals; larger cloud merges into local', async () => {
    const t = await newCtx(env); const pg = await open(t, { login: true });
    await pg.evaluate(() => {
      const db = {}; db['u1|mandala|0'] = { user_id: 'u1', category: 'mandala', level_index: 0, colored_indices: [0, 1, 2] };
      db['u1|mandala|1'] = { user_id: 'u1', category: 'mandala', level_index: 1, colored_indices: [0, 1, 2, 3, 4, 5, 6, 7] };
      localStorage.setItem('__mockdb', JSON.stringify(db));
      localStorage.setItem('grid_save_u1_mandala_0_150', '0-9');
      localStorage.setItem('grid_save_u1_mandala_1_150', '0-1');
    });
    await startLevel(pg, 0); await sleep(200);
    eq(await pg.evaluate(() => userGrid.reduce((a, v) => a + (v ? 1 : 0), 0)), 10, 'level0 = union 10');
    ok((await logOf(pg)).some(l => l[0] === 'put' && l[2] === 0 && l[3] === 10), 'level0 cloud healed');
    await startLevel(pg, 1); await sleep(200);
    eq(await pg.evaluate(() => userGrid.reduce((a, v) => a + (v ? 1 : 0), 0)), 8, 'level1 = cloud 8');
    eq(await pg.evaluate(() => unpackIdx(localStorage.getItem('grid_save_u1_mandala_1_150')).length), 8, 'local updated');
    eq(t.errors, [], 'errors'); await t.ctx.close();
  });

  await test('cloud: get failure falls back to local without crash or heal', async () => {
    const t = await newCtx(env); const pg = await open(t, { login: true });
    await pg.evaluate(() => { localStorage.setItem('__mockcfg', JSON.stringify({ login: true, failGet: true })); localStorage.setItem('grid_save_u1_mandala_0_150', '0-4'); });
    await startLevel(pg); await sleep(200);
    eq(await pg.evaluate(() => userGrid.reduce((a, v) => a + (v ? 1 : 0), 0)), 5, 'local shown');
    eq((await logOf(pg)).filter(l => l[0] === 'put').length, 0, 'no put on failed read');
    eq(t.errors, [], 'errors'); await t.ctx.close();
  });

  await test('gallery: merges cloud and local without shrinking; size and theme filters', async () => {
    const t = await newCtx(env); const pg = await open(t, { login: true });
    await pg.evaluate(() => {
      const db = { 'u1|mandala|2': { user_id: 'u1', category: 'mandala', level_index: 2, colored_indices: [0, 1, 2, 3] } };
      localStorage.setItem('__mockdb', JSON.stringify(db));
      localStorage.setItem('grid_save_u1_mandala_2_150', '0-79');
      localStorage.setItem('grid_save_u1_mandala_3_200', '0-49');
      localStorage.setItem('grid_save_u1_mandala_4_150', '0-9');
    });
    await pg.evaluate(() => renderPortfolioGallery()); await sleep(300);
    const txt = await pg.evaluate(() => [...document.querySelectorAll('#in-progress-gallery .level-card')].map(c => c.children[1].textContent + '|' + c.children[2].textContent));
    ok(txt.includes('MANDALA #3|80 / 22500 px'), 'merged 80 ' + txt.slice(0, 5));
    ok(!txt.some(x => x.startsWith('MANDALA #4|50')), 'other size hidden'); ok(txt.includes('MANDALA #5|10 / 22500 px'), 'level 4 shown');
    eq(await pg.evaluate(() => unpackIdx(localStorage.getItem('grid_save_u1_mandala_2_150')).length), 80, 'local not shrunk');
    await pg.evaluate(() => { document.getElementById('theme-select').value = 'warm'; changeTheme('warm'); }); await sleep(300);
    const themed = await pg.evaluate(() => { const ids = [...document.querySelectorAll('#in-progress-gallery .level-card')].map(c => parseInt(c.children[1].textContent.split('#')[1]) - 1); return { n: ids.length, allWarm: ids.every(i => getLevelTheme(i) === 'warm') }; });
    ok(themed.n > 0 && themed.allWarm, 'theme filter ' + JSON.stringify(themed));
    eq(t.errors, [], 'errors'); await t.ctx.close();
  });

  // ---------------- pools / seasons ----------------
  await test('photography pool: filters svg/tif/no-imageinfo, caches, subject namespacing', async () => {
    const t = await newCtx(env); const pg = await open(t); await sw(pg, 'photography');
    const n1 = t.wiki.log.filter(q => q.generator === 'categorymembers').length;
    eq(await pg.evaluate(() => levelCount()), 60, 'count excludes bad entries');
    await sw(pg, 'photography'); eq(t.wiki.log.filter(q => q.generator === 'categorymembers').length, n1, 'cached');
    const keys = await pg.evaluate(() => { currentSubject = 'animals'; const a = getStorageKey('photography', 3); currentSubject = 'landscape'; const b = getStorageKey('photography', 3); currentSubject = 'general'; const c = getStorageKey('photography', 3); return [a, b, c]; });
    ok(new Set(keys).size === 3, 'distinct keys ' + keys);
    await pg.selectOption('#subject-select', 'animals'); await sleep(400);
    ok(t.wiki.log.some(q => (q.gcmtitle || '').includes('Featured_animals')), 'animals category requested');
    await pg.evaluate(() => { localStorage.setItem(`grid_save_guest_photography-animals_1_150`, '0-30'); renderPortfolioGallery(); }); await sleep(300);
    ok((await pg.evaluate(() => [...document.querySelectorAll('#in-progress-gallery .level-card div:last-of-type')].some(d => d.textContent.startsWith('31 /')))), 'animals progress shown');
    await pg.selectOption('#subject-select', 'landscape'); await sleep(400);
    ok(!(await pg.evaluate(() => [...document.querySelectorAll('#in-progress-gallery .level-card div:last-of-type')].some(d => d.textContent.startsWith('31 /')))), 'landscape does not show animals progress');
    eq(t.errors, [], 'errors'); await t.ctx.close();
  });

  await test('seasons: all five pools load, queries well-formed, levels load with real image, deduped and stable', async () => {
    const t = await newCtx(env); const pg = await open(t);
    for (const c of ['spring', 'summer', 'autumn', 'winter', 'holidays']) {
      await sw(pg, c);
      const info = await pg.evaluate(async c => { await startLevelX(); async function startLevelX() { document.getElementById('home-screen').classList.remove('active'); document.getElementById('game-screen').classList.add('active'); await initLevel(0); }
        const okImg = await loadPhotoFromUrl(currentEntry.url); const list = await getPoolEntries(c);
        const titles = list.map(e => e.title); const dedupe = new Set(titles).size === titles.length;
        await returnToGallery(); return { n: list.length, okImg, dedupe, cat: currentCategory, key: getStorageKey(c, 0) }; }, c);
      ok(info.n >= 6 && info.okImg && info.dedupe, `${c}: ${JSON.stringify(info)}`); ok(info.key.includes(`_${c}_0_`), 'key ' + info.key);
    }
    const searches = t.wiki.log.filter(q => q.generator === 'search').map(q => q.gsrsearch);
    ok(searches.length === 50, 'search count ' + searches.length);
    ok(searches.every(q => /incategory:"(Featured pictures on Wikimedia Commons|Quality images)" .+ filetype:bitmap$/.test(q)), 'query form');
    const a = await pg.evaluate(async () => (await getPoolEntries('autumn')).map(e => e.title).join('|'));
    const t2 = await newCtx(env); const pg2 = await open(t2); await sw(pg2, 'autumn');
    eq(await pg2.evaluate(async () => (await getPoolEntries('autumn')).map(e => e.title).join('|')), a, 'stable order across sessions');
    eq(t.errors.concat(t2.errors), [], 'errors'); await t.ctx.close(); await t2.ctx.close();
  });

  await test('seasons: progress isolated per season; cloud category is the season', async () => {
    const t = await newCtx(env); const pg = await open(t, { login: true });
    await sw(pg, 'autumn'); await startLevel(pg); await paint(pg, 7); await pg.evaluate(() => saveState(true));
    await toGallery(pg); await sw(pg, 'winter'); await startLevel(pg);
    eq(await pg.evaluate(() => userGrid.reduce((a, v) => a + (v ? 1 : 0), 0)), 0, 'winter empty');
    await toGallery(pg); await sw(pg, 'autumn'); await startLevel(pg); eq(await pg.evaluate(() => userGrid.reduce((a, v) => a + (v ? 1 : 0), 0)), 7, 'autumn kept');
    ok((await logOf(pg)).some(l => l[0] === 'put' && l[1] === 'autumn'), 'cloud autumn');
    eq(t.errors, [], 'errors'); await t.ctx.close();
  });

  await test('seasons/photography: Wikimedia failure or empty results fall back to procedural art without errors', async () => {
    for (const mode of ['failAll', 'emptySearch']) {
      const t = await newCtx(env); t.wiki[mode] = true; const pg = await open(t); await sw(pg, 'autumn');
      eq(await cards(pg), 24, mode + ' cards'); await startLevel(pg);
      const r = await pg.evaluate(() => ({ loaded: isLevelLoaded, min: Math.min(...answerGrid) })); ok(r.loaded && r.min >= 1, mode + ' fallback level');
      await toGallery(pg); await sw(pg, 'photography'); await startLevel(pg); ok(await pg.evaluate(() => isLevelLoaded), mode + ' photography fallback');
      eq(t.errors, [], mode + ' errors'); await t.ctx.close();
    }
  });

  await test('level navigation: capped at pool size', async () => {
    const t = await newCtx(env); t.wiki.memberCount = 5; const pg = await open(t); await sw(pg, 'photography'); await startLevel(pg, 4);
    await pg.evaluate(() => moveLevel(1)); eq(await pg.evaluate(() => currentLevel), 4, 'stays at last'); ok(await pg.evaluate(() => isLevelLoaded), 'still loaded');
    await pg.evaluate(() => moveLevel(-1)); eq(await pg.evaluate(() => currentLevel), 3, 'prev');
    await pg.evaluate(() => { currentLevel = 0; }); await pg.evaluate(() => moveLevel(-1)); ok(await pg.evaluate(() => isLevelLoaded), 'prev at 0 still loaded');
    eq(t.errors, [], 'errors'); await t.ctx.close();
  });

  await test('tabs: current season first for each month; holidays/foryou/liked/custom present', async () => {
    const expect = { '2026-01-15': 'Winter', '2026-04-10': 'Spring', '2026-07-04': 'Summer', '2026-10-20': 'Autumn', '2026-12-25': 'Winter', '2026-03-01': 'Spring', '2026-09-01': 'Autumn' };
    for (const [d, season] of Object.entries(expect)) {
      const t = await newCtx(env); await t.page.clock.install({ time: new Date(d + 'T12:00:00') }); const pg = await open(t);
      const tabs = await pg.evaluate(() => [...document.querySelectorAll('#category-tabs .tab-btn')].map(b => b.textContent));
      eq(tabs[2], `${season} (now)`, d); eq(tabs.slice(-4), ['Holidays', 'For You', 'Liked (0)', 'Custom URL'], 'tail ' + d);
      eq(t.errors, [], 'errors'); await t.ctx.close();
    }
  });

  // ---------------- custom url ----------------
  await test('custom URL: CORS-ok image saved; no-CORS and 404 rejected, not saved', async () => {
    const t = await newCtx(env); const pg = await open(t); await sw(pg, 'custom');
    const run = async url => { await pg.evaluate(() => { document.getElementById('game-screen').classList.remove('active'); document.getElementById('home-screen').classList.add('active'); }); await pg.fill('#custom-image-url', url); await pg.evaluate(() => loadCustomUrlFromInput()); await pg.waitForFunction(() => isLevelLoaded, null, { timeout: 8000 }); await sleep(200);
      return pg.evaluate(() => ({ url: customImageUrl, saved: localStorage.getItem('custom_url_guest_0'), title: document.getElementById('level-title').textContent })); };
    let r = await run('https://img.test/ok.png'); eq(r.url, 'https://img.test/ok.png', 'url set'); eq(r.saved, 'https://img.test/ok.png', 'saved'); ok(!/failed/.test(r.title), 'no failure text');
    await pg.evaluate(() => { localStorage.removeItem('custom_url_guest_0'); isLevelLoaded = false; });
    await pg.evaluate(() => { window.__origGID = CanvasRenderingContext2D.prototype.getImageData; CanvasRenderingContext2D.prototype.getImageData = function () { throw new DOMException('tainted', 'SecurityError'); }; });
    r = await run('https://img.test/nocors.png'); await pg.evaluate(() => { CanvasRenderingContext2D.prototype.getImageData = window.__origGID; }); eq(r.url, '', 'nocors url cleared'); eq(r.saved, null, 'nocors not saved'); ok(/failed/.test(r.title), 'nocors message');
    r = await run('https://img.test/404.png'); eq(r.url, '', '404 cleared'); eq(r.saved, null, '404 not saved'); ok(await pg.evaluate(() => Math.min(...answerGrid) >= 1), 'fallback playable');
    eq(t.errors, [], 'errors'); await t.ctx.close();
  });

  await test('custom URL cloud: custom_url persisted and restored on another device', async () => {
    const t = await newCtx(env); const pg = await open(t, { login: true }); await sw(pg, 'custom');
    await pg.fill('#custom-image-url', 'https://img.test/ok.png'); await pg.evaluate(() => loadCustomUrlFromInput()); await pg.waitForFunction(() => isLevelLoaded); await paint(pg, 4); await pg.evaluate(() => saveState(true));
    ok((await logOf(pg)).some(l => l[0] === 'put' && l[1] === 'custom' && l[4] === 'https://img.test/ok.png'), 'put has custom_url');
    await pg.evaluate(() => { localStorage.removeItem('custom_url_u1_0'); Object.keys(localStorage).filter(k => k.startsWith('grid_save')).forEach(k => localStorage.removeItem(k)); });
    await reload(pg, true); await pg.evaluate(() => { currentCategory = 'custom'; }); await startLevel(pg); await sleep(300);
    const r = await pg.evaluate(() => ({ url: customImageUrl, f: userGrid.reduce((a, v) => a + (v ? 1 : 0), 0) })); eq(r, { url: 'https://img.test/ok.png', f: 4 }, 'restored from cloud');
    eq(t.errors, [], 'errors'); await t.ctx.close();
  });

  // ---------------- likes / for you ----------------
  await test('likes: toggle in level, persists across reload, tab count, button state', async () => {
    const t = await newCtx(env); const pg = await open(t); await startLevel(pg, 2);
    eq(await pg.evaluate(() => document.getElementById('like-btn').textContent), 'Like', 'initial'); await pg.click('#like-btn');
    eq(await pg.evaluate(() => document.getElementById('like-btn').textContent), 'Liked', 'liked'); await toGallery(pg);
    ok((await pg.evaluate(() => [...document.querySelectorAll('.tab-btn')].map(b => b.textContent))).includes('Liked (1)'), 'tab count');
    await reload(pg); await startLevel(pg, 2);
    eq(await pg.evaluate(() => document.getElementById('like-btn').textContent), 'Liked', 'persisted');
    await pg.click('#like-btn'); eq(await pg.evaluate(() => getLikes().length), 0, 'unliked');
    eq(t.errors, [], 'errors'); await t.ctx.close();
  });

  await test('likes: gallery heart likes pool pictures with titles; Liked tab lists, opens correct level, unlike rerenders', async () => {
    const t = await newCtx(env); const pg = await open(t); await sw(pg, 'photography'); await pg.selectOption('#subject-select', 'animals'); await sleep(400);
    await pg.evaluate(() => document.querySelectorAll('#in-progress-gallery .heart-btn')[3].click()); await sleep(300);
    await sw(pg, 'autumn'); await pg.evaluate(() => document.querySelectorAll('#in-progress-gallery .heart-btn')[1].click()); await sleep(300);
    const likes = await pg.evaluate(() => getLikes()); eq(likes.length, 2, 'two likes'); ok(likes.every(l => l.title.startsWith('File:') && l.url), 'titles+urls');
    eq(likes.map(l => l.id).sort(), ['autumn:1', 'photography-animals:3'], 'ids');
    await sw(pg, 'liked'); eq(await cards(pg), 2, 'liked cards'); eq(await pg.evaluate(() => document.getElementById('like-controls').classList.contains('active')), true, 'controls shown');
    // open the photography/animals like
    await pg.evaluate(() => { const lbl = [...document.querySelectorAll('#in-progress-gallery .level-card')].find(c => c.children[2].textContent.includes('photography / animals')); lbl.click(); }); await pg.waitForFunction(() => isLevelLoaded, null, { timeout: 8000 });
    const o = await pg.evaluate(() => ({ c: currentCategory, s: currentSubject, l: currentLevel, sel: document.getElementById('subject-select').value, btn: document.getElementById('like-btn').textContent }));
    eq(o, { c: 'photography', s: 'animals', l: 3, sel: 'animals', btn: 'Liked' }, 'opened like');
    await toGallery(pg); await sw(pg, 'liked'); await pg.evaluate(() => document.querySelector('#in-progress-gallery .heart-btn').click()); await sleep(300);
    eq(await cards(pg), 1, 'unlike from liked tab removes card');
    eq(t.errors, [], 'errors'); await t.ctx.close();
  });

  await test('likes: untrusted titles are rendered as text (no HTML injection)', async () => {
    const t = await newCtx(env); const pg = await open(t);
    await pg.evaluate(() => { saveLikes([{ id: 'photography-general:1', category: 'photography', subject: 'general', level: 1, title: 'File:<img src=x onerror="window.__xss=1">.jpg', url: '', ts: 1 }]); foryouList = [{ title: '<b id=pwn>x</b>', url: '' }]; saveForYou(); });
    await sw(pg, 'liked'); await sw(pg, 'foryou'); await sleep(300);
    const r = await pg.evaluate(() => ({ xss: window.__xss, pwn: !!document.getElementById('pwn'), imgs: document.querySelectorAll('#in-progress-gallery img').length }));
    eq(r, { xss: undefined, pwn: false, imgs: 0 }, 'no injection'); eq(t.errors, [], 'errors'); await t.ctx.close();
  });

  await test('likes: mandala and custom likes supported', async () => {
    const t = await newCtx(env); const pg = await open(t);
    await pg.evaluate(async () => { await toggleLikeFor('mandala', 'general', 4); localStorage.setItem('custom_url_guest_2', 'https://img.test/ok.png'); await toggleLikeFor('custom', 'general', 2); });
    const likes = await pg.evaluate(() => getLikes()); eq(likes.map(l => l.id), ['mandala:4', 'custom:2'], 'ids'); eq(likes[1].url, 'https://img.test/ok.png', 'custom url');
    await sw(pg, 'liked'); eq(await cards(pg), 2, 'two cards');
    await pg.evaluate(() => [...document.querySelectorAll('#in-progress-gallery .level-card')].find(c => c.children[2].textContent === 'mandala').click()); await pg.waitForFunction(() => isLevelLoaded);
    eq(await pg.evaluate(() => [currentCategory, currentLevel]), ['mandala', 4], 'open mandala like');
    eq(t.errors, [], 'errors'); await t.ctx.close();
  });

  await test('find more: no likes message; mandala-only filters by palette theme', async () => {
    const t = await newCtx(env); const pg = await open(t); await sw(pg, 'liked');
    await pg.evaluate(() => findMoreLikeLiked()); ok(/Like at least one/.test(await pg.evaluate(() => document.getElementById('like-status').textContent)), 'message');
    await pg.evaluate(async () => { await toggleLikeFor('mandala', 'general', 7); await toggleLikeFor('mandala', 'general', 12); await toggleLikeFor('mandala', 'general', 2); });
    await pg.evaluate(() => findMoreLikeLiked()); await sleep(400);
    const r = await pg.evaluate(() => ({ cat: currentCategory, theme: activeTheme, sel: document.getElementById('theme-select').value, want: getLevelTheme(7) }));
    eq(r.cat, 'mandala', 'switched'); eq(r.theme, r.want, 'theme = most liked'); eq(r.sel, r.want, 'select synced');
    eq(t.errors, [], 'errors'); await t.ctx.close();
  });

  await test('find more: photo likes -> specific categories only, For You grows without duplicates, persists, playable', async () => {
    const t = await newCtx(env); const pg = await open(t); await sw(pg, 'photography');
    await pg.evaluate(() => document.querySelectorAll('#in-progress-gallery .heart-btn')[0].click()); await sleep(300);
    await sw(pg, 'liked'); await pg.evaluate(() => findMoreLikeLiked()); await sleep(1200);
    const cats = t.wiki.log.filter(q => q.generator === 'categorymembers' && !(q.gcmtitle || '').includes('Featured')).map(q => q.gcmtitle);
    ok(cats.includes('Category:Red foxes') && cats.includes('Category:Mammals of Europe'), 'specific categories ' + cats);
    ok(!cats.some(c => /Featured|2019|Photographs by|Quality/.test(c)), 'generic filtered ' + cats);
    let n = await pg.evaluate(() => foryouList.length); eq(n, 30, 'first run adds 15+15'); eq(await pg.evaluate(() => currentCategory), 'foryou', 'switched to For You');
    await pg.evaluate(() => findMoreLikeLiked()); await sleep(1200); await pg.evaluate(() => { /* second run */ });
    const titles = await pg.evaluate(() => foryouList.map(e => e.title)); eq(new Set(titles).size, titles.length, 'no duplicates after rerun'); ok(titles.length > 30, 'grew ' + titles.length);
    await reload(pg);
    eq(await pg.evaluate(() => foryouList.length), titles.length, 'persisted');
    await pg.evaluate(() => { currentCategory = 'foryou'; }); await startLevel(pg, 2); await paint(pg, 6); await pg.evaluate(() => saveState(true));
    eq(await pg.evaluate(() => currentEntry.title), titles[2], 'level uses entry'); await toGallery(pg);
    ok((await pg.evaluate(() => [...document.querySelectorAll('#in-progress-gallery .level-card div:last-of-type')].some(d => d.textContent.startsWith('6 /')))), 'foryou progress in gallery');
    eq(await pg.evaluate(() => levelCount()), titles.length, 'level cap');
    eq(t.errors, [], 'errors'); await t.ctx.close();
  });

  await test('find more: API failure is reported, nothing corrupted', async () => {
    const t = await newCtx(env); const pg = await open(t);
    await pg.evaluate(async () => { saveLikes([{ id: 'autumn:1', category: 'autumn', subject: 'general', level: 1, title: 'File:Leaf.jpg', url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', ts: 1 }]); });
    await sw(pg, 'liked'); t.wiki.failAll = true; await pg.evaluate(() => findMoreLikeLiked()); await sleep(800);
    const r = await pg.evaluate(() => ({ s: document.getElementById('like-status').textContent, n: foryouList.length })); eq(r.n, 0, 'unchanged'); ok(/No new matches|no specific/i.test(r.s), 'status ' + r.s);
    eq(t.errors, [], 'errors'); await t.ctx.close();
  });

  await test('for you: cloud row restores missing list entry from custom_url', async () => {
    const t = await newCtx(env); const pg = await open(t, { login: true });
    await pg.evaluate(() => { localStorage.setItem('__mockdb', JSON.stringify({ 'u1|foryou|3': { user_id: 'u1', category: 'foryou', level_index: 3, colored_indices: [1, 2], custom_url: 'https://img.test/ok.png' } })); });
    await sw(pg, 'foryou'); await pg.evaluate(() => renderPortfolioGallery()); await sleep(400);
    eq(await pg.evaluate(() => foryouList[3] && foryouList[3].url), 'https://img.test/ok.png', 'restored entry');
    eq(t.errors, [], 'errors'); await t.ctx.close();
  });

  await env.browser.close(); report();
})();
