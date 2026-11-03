# Tests

Browser tests (Playwright) with a mocked Supabase client and mocked Wikimedia Commons API. No network needed.

    npm i -D playwright && npx playwright install chromium
    node tests/core.js       # boot, painting, hint, timelapse, persistence, storage
    node tests/features.js   # cloud merge, seasons/pools, likes, For You, custom URL
    node tests/visual.js     # pixel checks of the cached low-zoom renderer
    SEEDS=1,2,3 STEPS=60 node tests/fuzz.js   # random action sequences; asserts no progress is ever lost

Set `APP=<url>` to test a deployed copy instead of the local `index.html`.
