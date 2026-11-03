const { launch, newCtx, open, test, ok, eq, report } = require('./harness');
(async () => {
  const env = await launch();
  for (const dpr of [1, 2]) await test(`render: low-zoom bitmap path shows painted cells in correct colors (dpr ${dpr})`, async () => {
    const t = await newCtx(env, { dpr }); const pg = await open(t);
    const r = await pg.evaluate(async () => {
      document.getElementById('home-screen').classList.remove('active'); document.getElementById('game-screen').classList.add('active'); await initLevel(0);
      for (let i = 0; i < answerGrid.length; i += 2) userGrid[i] = answerGrid[i];
      resetViewport(); draw();
      const d = devicePixelRatio, z = viewTransform.zoom; let good = 0, bad = 0, whiteOk = 0, whiteBad = 0;
      for (let k = 0; k < 400; k++) {
        const gx = 10 + (k * 7) % 130, gy = 10 + (k * 13) % 130, idx = gy * GRID_SIZE + gx;
        const px = Math.round((viewTransform.x + (gx + .5) * z) * d), py = Math.round((viewTransform.y + (gy + .5) * z) * d);
        const c = ctx.getImageData(px, py, 1, 1).data;
        if (userGrid[idx]) { const e = rgbPaletteParsed[userGrid[idx]]; (Math.abs(c[0] - e[0]) < 3 && Math.abs(c[1] - e[1]) < 3 && Math.abs(c[2] - e[2]) < 3) ? good++ : bad++; }
        else { (c[0] > 250 && c[1] > 250 && c[2] > 250) ? whiteOk++ : whiteBad++; }
      }
      return { z, good, bad, whiteOk, whiteBad };
    });
    ok(r.z <= 4 && r.good > 50 && r.bad <= r.good * 0.15 && r.whiteOk > 50, JSON.stringify(r));
    eq(t.errors, [], 'errors'); await t.ctx.close();
  });
  await test('render: switching levels/images invalidates cached bitmaps', async () => {
    const t = await newCtx(env); const pg = await open(t);
    const r = await pg.evaluate(async () => {
      document.getElementById('home-screen').classList.remove('active'); document.getElementById('game-screen').classList.add('active');
      await initLevel(0); for (let i = 0; i < 3000; i++) userGrid[i] = answerGrid[i]; resetViewport(); draw();
      const a = ctx.getImageData(Math.round((viewTransform.x + viewTransform.zoom / 2) * devicePixelRatio), Math.round((viewTransform.y + viewTransform.zoom / 2) * devicePixelRatio), 1, 1).data.join(',');
      await initLevel(1); for (let i = 0; i < 3000; i++) userGrid[i] = answerGrid[i]; resetViewport(); draw();
      const b = ctx.getImageData(Math.round((viewTransform.x + viewTransform.zoom / 2) * devicePixelRatio), Math.round((viewTransform.y + viewTransform.zoom / 2) * devicePixelRatio), 1, 1).data.join(',');
      const exp = rgbPaletteParsed[userGrid[0]].join(',');
      return { a, b, exp };
    });
    ok(r.a !== r.b && r.b.startsWith(r.exp.split(',').slice(0, 3).join(',')), JSON.stringify(r)); await t.ctx.close();
  });
  await env.browser.close(); report();
})();
