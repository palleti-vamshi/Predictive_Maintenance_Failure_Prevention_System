import fs from 'node:fs';
import path from 'node:path';

async function main() {
  console.log('[Capture] Querying Chrome targets...');
  const targetsRes = await fetch('http://localhost:9222/json');
  const targets = await targetsRes.json();
  const pageTarget = targets.find((t) => t.type === 'page' && t.url.includes('localhost:5173'));

  if (!pageTarget) {
    throw new Error('No localhost:5173 page target found in Chrome.');
  }

  const wsUrl = pageTarget.webSocketDebuggerUrl;
  console.log('[Capture] Connecting to CDP WebSocket:', wsUrl);

  const ws = new WebSocket(wsUrl);

  let messageId = 1;
  const pending = new Map();

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.id && pending.has(data.id)) {
      const { resolve, reject } = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) reject(new Error(JSON.stringify(data.error)));
      else resolve(data.result);
    }
  };

  await new Promise((resolve) => {
    ws.onopen = resolve;
  });

  const send = (method, params = {}) => {
    const id = messageId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function setViewport(width, height, isMobile = false) {
    await send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 2,
      mobile: isMobile
    });
  }

  async function capture(filename) {
    const res = await send('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(res.data, 'base64');
    const outPath = path.resolve('screenshots', filename);
    fs.writeFileSync(outPath, buffer);
    console.log(`[Capture] Saved ${filename} (${buffer.length} bytes)`);
  }

  // 1. Capture Sign-In Page
  console.log('[Capture] 1. Sign-in page...');
  await send('Network.clearBrowserCookies');
  await send('Storage.clearDataForOrigin', { origin: 'http://localhost:5173', storageTypes: 'all' });
  await send('Page.navigate', { url: 'http://localhost:5173/' });
  await sleep(2000);
  await setViewport(1280, 850, false);
  await sleep(500);
  await capture('01_sign_in.png');

  // 2. Click Quick Demo Login for Factory Manager (Sunita Rao)
  console.log('[Capture] 2. Logging in as Factory Manager...');
  await send('Runtime.evaluate', {
    expression: `(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const mgrBtn = btns.find(b => b.textContent.includes('Factory Manager') || b.textContent.includes('Sunita Rao'));
      if (mgrBtn) mgrBtn.click();
    })()`
  });
  await sleep(2500);

  // Capture Manager Overview Dashboard
  await capture('02_manager_overview.png');

  // 3. Navigate to Maintenance Work View
  console.log('[Capture] 3. Navigating to Maintenance Work Orders...');
  await send('Runtime.evaluate', {
    expression: `(() => {
      window.location.hash = '#/maintenance';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    })()`
  });
  await sleep(2500);
  await capture('03_technician_work_view.png');

  // 4. Navigate to Dataset Upload Page
  console.log('[Capture] 4. Navigating to Dataset Upload / Ledger...');
  await send('Runtime.evaluate', {
    expression: `(() => {
      window.location.hash = '#/datasets/upload';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    })()`
  });
  await sleep(2500);
  await capture('04_dataset_upload.png');

  // 5. Mobile Viewport (390 x 844 iPhone 14 style)
  console.log('[Capture] 5. Capturing Mobile Viewport...');
  await setViewport(390, 844, true);
  await sleep(1500);
  await capture('05_mobile_viewport.png');

  ws.close();
  console.log('[Capture] All 5 screenshots successfully captured!');
}

main().catch((err) => {
  console.error('[Capture] Error:', err);
  process.exit(1);
});
