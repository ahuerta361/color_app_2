const { launch, newCtx, open, test, ok, eq, report } = require('./harness');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function rng(seed) { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; }

async function fuzz(env, seed, login, steps) {
  const t = await newCtx(env); const pg = await open(t, login ? { login: true } : null);
  const R = rng(seed);
  const model = {};   // key -> Set of painted indices
  const keyOf = (cat, lvl, size) => `${cat}|${lvl}|${size}`;
  const cats = ['mandala', 'autumn', 'photography', 'foryou'];
  await pg.evaluate(u => { foryouList = Array.from({ length: 6 }, (_, i) => ({ title: 'File:F' + i + '.jpg', url: u })); saveForYou(); }, env.IMG);
  let inGame = false, cur = null;
  const open_ = async (cat, lvl) => pg.evaluate(async ([cat, lvl]) => {
    currentCategory = cat; document.getElementById('home-screen').classList.remove('active'); document.getElementById('game-screen').classList.add('active'); await initLevel(lvl);
  }, [cat, lvl]);
  const snapshot = () => pg.evaluate(() => { const s = []; for (let i = 0; i < userGrid.length; i++) if (userGrid[i]) s.push(i); return { s, extras: extraIndices.length, cat: currentCategory, lvl: currentLevel, size: GRID_SIZE }; });
  const log = [];
  for (let step = 0; step < steps; step++) {
    const r = R(); let act;
    if (!inGame) {
      const cat = cats[Math.floor(R() * cats.length)]; const lvl = Math.floor(R() * 4); const size = [150, 200][Math.floor(R() * 2)];
      act = `open ${cat} ${lvl} @${size}`; log.push(act);
      await pg.evaluate(async s => { if (GRID_SIZE !== s) { await updateGridDimensions(String(s)); } }, size);
      await open_(cat, lvl); cur = { cat, lvl, size }; inGame = true;
      const snap = await snapshot(); const k = keyOf(cat, lvl, size); const exp = model[k] || new Set();
      const have = new Set(snap.s); const lost = [...exp].filter(i => !have.has(i));
      if (lost.length) throw new Error(`LOSS seed=${seed} login=${login} at "${act}": ${lost.length} cells lost of ${exp.size}; log=${log.slice(-8).join(' > ')}`);
      model[k] = new Set([...exp, ...snap.s]);
    } else if (r < 0.45) {
      const n = 1 + Math.floor(R() * 400); const from = Math.floor(R() * 20000);
      act = `paint ${n}@${from}`; log.push(act);
      const painted = await pg.evaluate(([n, from]) => { if (isTimelapsePlaying) skipTimelapse(); const out = []; for (let i = from; i < Math.min(from + n, userGrid.length); i++) { if (!userGrid[i]) { userGrid[i] = answerGrid[i]; moveHistory.push(i); out.push(i); } } return out; }, [n, from]);
      const k = keyOf(cur.cat, cur.lvl, cur.size); model[k] = new Set([...(model[k] || []), ...painted]);
      if (R() < 0.5) await pg.evaluate(() => saveState(false));
    } else if (r < 0.58) { act = 'timelapse'; log.push(act); await pg.evaluate(() => playTimelapse()); await sleep(40 + Math.floor(R() * 120)); }
    else if (r < 0.66) { act = 'skip'; log.push(act); await pg.evaluate(() => skipTimelapse()); }
    else if (r < 0.74) {
      act = 'cfg'; const f = { login, failPut: R() < 0.4, failGet: R() < 0.2 }; log.push('cfg ' + JSON.stringify(f));
      await pg.evaluate(f => localStorage.setItem('__mockcfg', JSON.stringify(f)), f);
    } else if (r < 0.82) { act = 'reload'; log.push(act); await pg.evaluate(() => saveState(true)).catch(() => {}); await pg.reload(); await pg.waitForFunction(() => typeof initLevel === 'function'); await sleep(350); if (!login) await pg.evaluate(() => { if (!currentUser) bypassAuth(); }); inGame = false; }
    else if (r < 0.9) { act = 'next'; log.push(act); await pg.evaluate(() => moveLevel(1)); const c = await pg.evaluate(() => [currentCategory, currentLevel, GRID_SIZE]); cur = { cat: c[0], lvl: c[1], size: c[2] }; const snap = await snapshot(); const k = keyOf(cur.cat, cur.lvl, cur.size); const exp = model[k] || new Set(); const have = new Set(snap.s); const lost = [...exp].filter(i => !have.has(i)); if (lost.length) throw new Error(`LOSS seed=${seed} at next: ${lost.length}; log=${log.slice(-8).join(' > ')}`); model[k] = new Set([...exp, ...snap.s]); }
    else { act = 'gallery'; log.push(act); await pg.evaluate(() => returnToGallery()); inGame = false; }
  }
  // everything ever painted must still be recoverable
  await pg.evaluate(() => localStorage.setItem('__mockcfg', JSON.stringify({ login: !!(JSON.parse(localStorage.getItem('__mockcfg') || '{}').login) })));
  if (inGame) await pg.evaluate(() => returnToGallery());
  for (const [k, set] of Object.entries(model)) {
    const [cat, lvl, size] = k.split('|');
    await pg.evaluate(async s => { if (GRID_SIZE !== +s) await updateGridDimensions(s); }, size);
    await open_(cat, +lvl);
    const snap = await snapshot(); const have = new Set(snap.s); const lost = [...set].filter(i => !have.has(i));
    if (lost.length) throw new Error(`FINAL LOSS seed=${seed} login=${login} ${k}: ${lost.length}/${set.size}; log tail=${log.slice(-10).join(' > ')}`);
    await pg.evaluate(() => returnToGallery());
  }
  const errs = t.errors.filter(e => !/Cloud persist failed/.test(e)); await t.ctx.close();
  if (errs.length) throw new Error('page errors: ' + errs[0]);
}

(async () => {
  const env = await launch();
  for (const login of [false, true]) for (const seed of (process.env.SEEDS || "1,2,3,4,5,6").split(",").map(Number)) await test(`fuzz seed=${seed} login=${login}: no progress ever lost`, () => fuzz(env, seed, login, +(process.env.STEPS || 45)));
  await env.browser.close(); report();
})();
