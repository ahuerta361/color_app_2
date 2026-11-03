const { launch, newCtx, open, test, ok, eq, report } = require('./harness');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const startLevel = (pg, lvl = 0) => pg.evaluate(async l => {
  document.getElementById('home-screen').classList.remove('active');
  document.getElementById('game-screen').classList.add('active');
  await initLevel(l);
}, lvl);
const filled = pg => pg.evaluate(() => userGrid.reduce((a, v) => a + (v ? 1 : 0), 0));

(async () => {
  const env = await launch();

  await test('boot: no errors, tabs, gallery, offline mode', async () => {
    const t = await newCtx(env); const pg = await open(t);
    const r = await pg.evaluate(() => ({
      tabs: [...document.querySelectorAll('#category-tabs .tab-btn')].length,
      cards: document.querySelectorAll('#in-progress-gallery .level-card').length,
      status: document.getElementById('user-status').textContent,
      overlay: document.getElementById('auth-overlay').classList.contains('active'),
      subjectHidden: document.getElementById('subject-select').style.display
    }));
    eq(r.tabs, 10, 'tabs'); eq(r.cards, 24, 'cards'); eq(r.status, 'Offline Mode', 'status'); ok(!r.overlay, 'overlay hidden after offline bypass');
    eq(r.subjectHidden, 'none', 'subject hidden on mandala');
    eq(t.errors, [], 'errors'); await t.ctx.close();
  });

  await test('mandala level: answer grid valid, palette, title', async () => {
    const t = await newCtx(env); const pg = await open(t); await startLevel(pg, 3);
    const r = await pg.evaluate(() => ({
      min: Math.min(...answerGrid), max: Math.max(...answerGrid), pal: colorPalette.length,
      title: document.getElementById('level-title').textContent, swatches: document.querySelectorAll('.swatch').length, loaded: isLevelLoaded
    }));
    ok(r.min >= 1, 'no zero answers'); ok(r.max < r.pal, 'answer within palette'); ok(r.swatches > 0, 'swatches');
    ok(/MANDALA #4/.test(r.title), 'title ' + r.title); ok(r.loaded, 'loaded');
    eq(t.errors, [], 'errors'); await t.ctx.close();
  });

  await test('painting: correct color paints, wrong color does not, drag paints, dashboard updates', async () => {
    const t = await newCtx(env); const pg = await open(t); await startLevel(pg);
    const pos = await pg.evaluate(() => {
      const idx = answerGrid.findIndex((v, i) => v === activeColorId && userGrid[i] === 0);
      const wrong = answerGrid.findIndex((v, i) => v !== activeColorId && userGrid[i] === 0 && i % GRID_SIZE > 2);
      const gx = idx % GRID_SIZE, gy = Math.floor(idx / GRID_SIZE);
      viewTransform.zoom = 14; viewTransform.x = canvas.width / devicePixelRatio / 2 - (gx + .5) * 14; viewTransform.y = canvas.height / devicePixelRatio / 2 - (gy + .5) * 14; draw();
      const r = canvas.getBoundingClientRect();
      return { idx, wrong, x: r.left + canvas.width / devicePixelRatio / 2, y: r.top + canvas.height / devicePixelRatio / 2 };
    });
    await pg.mouse.click(pos.x, pos.y);
    eq(await pg.evaluate(i => userGrid[i] !== 0, pos.idx), true, 'painted');
    const dash = await pg.evaluate(() => document.getElementById('dash-left').textContent);
    eq(dash, String(150 * 150 - 1), 'dashboard remaining updated');
    // wrong color cell: find its screen position and click
    const w = await pg.evaluate(i => {
      const gx = i % GRID_SIZE, gy = Math.floor(i / GRID_SIZE); const r = canvas.getBoundingClientRect();
      viewTransform.x = canvas.width / devicePixelRatio / 2 - (gx + .5) * viewTransform.zoom; viewTransform.y = canvas.height / devicePixelRatio / 2 - (gy + .5) * viewTransform.zoom; draw();
      return { x: r.left + canvas.width / devicePixelRatio / 2, y: r.top + canvas.height / devicePixelRatio / 2 };
    }, pos.wrong);
    const before = await filled(pg);
    await pg.mouse.click(w.x, w.y);
    eq(await filled(pg), before, 'wrong color unchanged');
    // persisted locally after debounce/save
    await pg.evaluate(() => saveState(true));
    ok((await pg.evaluate(() => unpackIdx(localStorage.getItem(getStorageKey('mandala', 0))).length)) >= 1, 'stored');
    eq(t.errors, [], 'errors'); await t.ctx.close();
  });

  await test('hint: centers target at dpr 1/2/3 and picks nearest unfilled pixel of active color', async () => {
    for (const dpr of [1, 2, 3]) {
      const t = await newCtx(env, { dpr }); const pg = await open(t); await startLevel(pg);
      const res = await pg.evaluate(() => {
        const out = [];
        for (const [cx, cy, z] of [[10, 10, 6], [140, 20, 20], [75, 140, 3], [75, 75, 30]]) {
          const w = canvas.width / devicePixelRatio, h = canvas.height / devicePixelRatio;
          viewTransform.zoom = z; viewTransform.x = w / 2 - cx * z; viewTransform.y = h / 2 - cy * z;
          const before = activeColorId; triggerHint();
          let best = Infinity;
          for (let i = 0; i < answerGrid.length; i++) if (userGrid[i] === 0 && answerGrid[i] === before) { const d = ((i % GRID_SIZE) + .5 - cx) ** 2 + (Math.floor(i / GRID_SIZE) + .5 - cy) ** 2; if (d < best) best = d; }
          const hx = hintMarker.x, hy = hintMarker.y; const d = (hx - cx) ** 2 + (hy - cy) ** 2;
          const sx = hx * viewTransform.zoom + viewTransform.x, sy = hy * viewTransform.zoom + viewTransform.y;
          out.push({ nearest: Math.abs(d - best) < 1e-9, centered: Math.abs(sx - w / 2) < .01 && Math.abs(sy - h / 2) < .01, zoomOk: viewTransform.zoom >= 12 });
        }
        return out;
      });
      res.forEach((r, i) => { ok(r.nearest, `nearest dpr${dpr}#${i}`); ok(r.centered, `centered dpr${dpr}#${i}`); ok(r.zoomOk, `zoom dpr${dpr}#${i}`); });
      eq(t.errors, [], 'errors'); await t.ctx.close();
    }
  });

  await test('hint: switches color when active done, no-op when complete, blocked during timelapse, fast on 300 grid', async () => {
    const t = await newCtx(env); const pg = await open(t); await startLevel(pg);
    const r = await pg.evaluate(async () => {
      const a = activeColorId;
      for (let i = 0; i < answerGrid.length; i++) if (answerGrid[i] === a) userGrid[i] = a;
      triggerHint();
      const switched = activeColorId !== a && answerGrid[(hintMarker.y - .5) * GRID_SIZE + (hintMarker.x - .5)] === activeColorId;
      for (let i = 0; i < answerGrid.length; i++) userGrid[i] = answerGrid[i];
      hintMarker = null; triggerHint(); const noop = hintMarker === null;
      userGrid.fill(0); isTimelapsePlaying = true; triggerHint(); const blocked = hintMarker === null; isTimelapsePlaying = false;
      return { switched, noop, blocked };
    });
    ok(r.switched, 'switched to the hinted color'); ok(r.noop, 'no-op complete'); ok(r.blocked, 'blocked');
    await pg.evaluate(() => updateGridDimensions('300')); await pg.waitForFunction(() => GRID_SIZE === 300 && isLevelLoaded);
    const ms = await pg.evaluate(() => { const t0 = performance.now(); triggerHint(); return performance.now() - t0; });
    ok(ms < 100, 'hint speed ' + ms); eq(t.errors, [], 'errors'); await t.ctx.close();
  });

  await test('timelapse: saving mid-replay keeps real progress; leaving restores; skip restores', async () => {
    const t = await newCtx(env); const pg = await open(t); await startLevel(pg);
    const r = await pg.evaluate(async () => {
      for (let i = 0; i < 12000; i++) { userGrid[i] = answerGrid[i]; moveHistory.push(i); }
      await saveState(true);
      const key = getStorageKey('mandala', 0);
      playTimelapse(); await new Promise(r => setTimeout(r, 150));
      const mid = userGrid.reduce((a, v) => a + (v ? 1 : 0), 0);
      await saveState(true); const midSaved = unpackIdx(localStorage.getItem(key)).length;
      skipTimelapse(); const afterSkip = userGrid.reduce((a, v) => a + (v ? 1 : 0), 0);
      playTimelapse(); await new Promise(r => setTimeout(r, 100));
      await moveLevel(1); const moved = unpackIdx(localStorage.getItem(key)).length;
      return { mid, midSaved, afterSkip, moved, playing: isTimelapsePlaying };
    });
    ok(r.mid < 12000, 'timelapse partial'); eq(r.midSaved, 12000, 'saved mid-timelapse'); eq(r.afterSkip, 12000, 'skip restores');
    eq(r.moved, 12000, 'moveLevel during timelapse'); eq(r.playing, false, 'stopped');
    eq(t.errors, [], 'errors'); await t.ctx.close();
  });

  await test('completion: last cell triggers timelapse; leaving mid-timelapse keeps 100%; shows in Completed', async () => {
    const t = await newCtx(env); const pg = await open(t); await startLevel(pg);
    const pos = await pg.evaluate(() => {
      const last = answerGrid.length - 1;
      for (let i = 0; i < last; i++) { userGrid[i] = answerGrid[i]; moveHistory.push(i); }
      activeColorId = answerGrid[last]; updateDashboard();
      const gx = last % GRID_SIZE, gy = Math.floor(last / GRID_SIZE), z = 14, w = canvas.width / devicePixelRatio, h = canvas.height / devicePixelRatio;
      viewTransform.zoom = z; viewTransform.x = w / 2 - (gx + .5) * z; viewTransform.y = h / 2 - (gy + .5) * z; draw();
      const r = canvas.getBoundingClientRect(); return { x: r.left + w / 2, y: r.top + h / 2 };
    });
    await pg.mouse.click(pos.x, pos.y);
    await pg.waitForFunction(() => isTimelapsePlaying, null, { timeout: 4000 });
    await sleep(100);
    await pg.evaluate(() => returnToGallery());
    const r = await pg.evaluate(() => ({ stored: unpackIdx(localStorage.getItem(getStorageKey('mandala', 0))).length, completed: document.querySelectorAll('#completed-gallery .level-card').length }));
    eq(r.stored, 22500, 'stored full'); eq(r.completed, 1, 'completed card');
    eq(t.errors, [], 'errors'); await t.ctx.close();
  });

  await test('persistence: reload restores progress; legacy JSON and legacy key formats load', async () => {
    const t = await newCtx(env); const pg = await open(t); await startLevel(pg);
    await pg.evaluate(async () => { for (let i = 100; i < 700; i++) userGrid[i] = answerGrid[i]; await saveState(true); });
    await pg.reload(); await pg.waitForFunction(() => typeof initLevel === 'function'); await startLevel(pg);
    eq(await filled(pg), 600, 'restored after reload');
    await pg.evaluate(() => { localStorage.clear(); localStorage.setItem('grid_save_guest_mandala_0', JSON.stringify([1, 2, 3, 5000])); });
    await startLevel(pg); eq(await filled(pg), 4, 'legacy key no size');
    await pg.evaluate(() => { localStorage.clear(); localStorage.setItem('grid_save_guest_mandala_0_150', JSON.stringify([7, 8])); });
    await startLevel(pg); eq(await filled(pg), 2, 'legacy json with size');
    eq(t.errors, [], 'errors'); await t.ctx.close();
  });

  await test('storage helpers: pack/unpack fuzz, garbage input, quota errors, extras preserved', async () => {
    const t = await newCtx(env); const pg = await open(t); await startLevel(pg);
    const r = await pg.evaluate(async () => {
      let bad = 0;
      for (let n = 0; n < 300; n++) {
        const a = Array.from({ length: Math.floor(Math.random() * 400) }, () => Math.floor(Math.random() * 90000));
        const set = new Set(a); const back = new Set(unpackIdx(packIdx(a)));
        if (back.size !== set.size || [...back].some(v => !set.has(v))) bad++;
      }
      const garbage = ['abc', '5-', '-3', 'null', '1,,2', '9-3', ' ', '[', '{"a":1}'].map(g => { try { return unpackIdx(g).every(Number.isFinite); } catch (e) { return false; } });
      // quota failure: save must not throw and must not lose in-memory state
      const orig = Storage.prototype.setItem; Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); };
      let threw = false; try { userGrid[0] = answerGrid[0]; await saveState(true); } catch (e) { threw = true; }
      Storage.prototype.setItem = orig;
      // extras preservation: indices outside grid survive load -> save
      localStorage.setItem(getStorageKey('mandala', 0), packIdx([1, 2, 99999, 123456]));
      await loadState(); isLevelLoaded = true; await saveState(true);
      const saved = unpackIdx(localStorage.getItem(getStorageKey('mandala', 0)));
      return { bad, garbage, threw, kept: saved.includes(99999) && saved.includes(123456) && saved.includes(1) };
    });
    eq(r.bad, 0, 'fuzz mismatches'); ok(r.garbage.every(Boolean), 'garbage safe ' + r.garbage); ok(!r.threw, 'quota safe'); ok(r.kept, 'extras kept');
    eq(t.errors, [], 'errors'); await t.ctx.close();
  });

  await test('interaction: wheel/pinch zoom clamps 1..50, pan mode pans without painting', async () => {
    const t = await newCtx(env); const pg = await open(t); await startLevel(pg);
    const box = await pg.evaluate(() => { const r = canvas.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await pg.mouse.move(box.x, box.y);
    for (let i = 0; i < 40; i++) await pg.mouse.wheel(0, -100);
    let z = await pg.evaluate(() => viewTransform.zoom); ok(z <= 50.0001, 'max zoom ' + z);
    for (let i = 0; i < 80; i++) await pg.mouse.wheel(0, 100);
    z = await pg.evaluate(() => viewTransform.zoom); ok(z >= 1 - 1e-9, 'min zoom ' + z);
    await pg.evaluate(() => { toggleInteractionMode(); });
    const before = await pg.evaluate(() => ({ x: viewTransform.x, f: userGrid.reduce((a, v) => a + (v ? 1 : 0), 0) }));
    await pg.mouse.move(box.x, box.y); await pg.mouse.down(); await pg.mouse.move(box.x + 40, box.y + 10); await pg.mouse.up();
    const after = await pg.evaluate(() => ({ x: viewTransform.x, f: userGrid.reduce((a, v) => a + (v ? 1 : 0), 0) }));
    ok(after.x !== before.x, 'panned'); eq(after.f, before.f, 'no paint in pan mode');
    eq(t.errors, [], 'errors'); await t.ctx.close();
  });

  await test('settings persist and apply', async () => {
    const t = await newCtx(env); const pg = await open(t);
    await pg.evaluate(() => { updateSetting('showTime', false); updateSetting('autoTimelapse', false); });
    await pg.reload(); await pg.waitForFunction(() => typeof loadSettings === 'function'); await sleep(300);
    const r = await pg.evaluate(() => ({ s: settings.showTime, a: settings.autoTimelapse, cb: document.getElementById('set-time').checked }));
    eq(r, { s: false, a: false, cb: false }, 'settings'); eq(t.errors, [], 'errors'); await t.ctx.close();
  });

  await test('mobile emulation: boots, level loads, hint works', async () => {
    const t = await newCtx(env, { mobile: true, dpr: 3, viewport: { width: 390, height: 780 } }); const pg = await open(t); await startLevel(pg);
    const r = await pg.evaluate(() => { triggerHint(); const w = canvas.width / devicePixelRatio, h = canvas.height / devicePixelRatio; const sx = hintMarker.x * viewTransform.zoom + viewTransform.x, sy = hintMarker.y * viewTransform.zoom + viewTransform.y; return sx > 0 && sx < w && sy > 0 && sy < h; });
    ok(r, 'hint marker on screen'); eq(t.errors, [], 'errors'); await t.ctx.close();
  });

  await env.browser.close(); report();
})();
