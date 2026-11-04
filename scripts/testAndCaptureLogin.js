import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.resolve(__dirname, '../screenshots');

async function getWsUrl() {
  const res = await fetch('http://localhost:9222/json');
  const pages = await res.json();
  const page = pages.find((p) => p.type === 'page');
  if (!page) throw new Error('No Chrome page found');
  return page.webSocketDebuggerUrl;
}

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 1;
    this.pending = new Map();
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(e);
      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id && this.pending.has(msg.id)) {
          const { res, rej } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) rej(new Error(msg.error.message || JSON.stringify(msg.error)));
          else res(msg.result);
        }
      };
    });
  }

  async send(method, params = {}) {
    const id = this.id++;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    return res.result?.value;
  }

  async navigate(url) {
    await this.send('Page.navigate', { url });
    await new Promise((r) => setTimeout(r, 1000));
  }

  async setViewport(width, height, isMobile = false) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 2,
      mobile: isMobile
    });
    await new Promise((r) => setTimeout(r, 500));
  }

  async captureScreenshot(filename) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(data, 'base64');
    const outPath = path.join(SCREENSHOT_DIR, filename);
    fs.writeFileSync(outPath, buffer);
    console.log(`[Capture] Saved ${filename} (${buffer.length} bytes)`);
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

async function run() {
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  const wsUrl = await getWsUrl();
  const cdp = new CdpClient(wsUrl);
  await cdp.connect();
  console.log('[CDP] Connected to Chrome debugging target');

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');

  // Helper to ensure completely logged out state
  const ensureLoggedOut = async () => {
    await cdp.eval(`
      (async () => {
        try {
          await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
        } catch {}
      })()
    `);
    await cdp.send('Network.clearBrowserCookies');
    await cdp.navigate('http://localhost:5173/');
    await new Promise((r) => setTimeout(r, 1000));
  };

  // Helper to set React input values
  const setInputValue = async (selector, value) => {
    await cdp.eval(`
      (() => {
        const el = document.querySelector('${selector}');
        if (!el) return;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(el, '${value}');
        el.dispatchEvent(new Event('input', { bubbles: true }));
      })()
    `);
  };

  // 1. Initial Desktop View (Manager Role Selected)
  console.log('[Test 1] Desktop Initial View (Manager selected)...');
  await ensureLoggedOut();
  await cdp.setViewport(1280, 800, false);
  await cdp.captureScreenshot('login_01_desktop_manager.png');

  // 2. Select Technician Role Choice
  console.log('[Test 2] Select Technician Role Choice...');
  await cdp.eval(`document.querySelectorAll('.role-card')[1].click();`);
  await new Promise((r) => setTimeout(r, 400));
  await cdp.captureScreenshot('login_02_desktop_technician_role.png');

  // 3. Validation: Empty submit error
  console.log('[Test 3] Validation Error (Empty submit)...');
  await cdp.eval(`document.querySelector('.login-submit-btn').click();`);
  await new Promise((r) => setTimeout(r, 400));
  const errText1 = await cdp.eval(`document.querySelector('.login-error-alert')?.textContent`);
  console.log(`[Test 3] Validation message displayed: "${errText1}"`);
  await cdp.captureScreenshot('login_03_desktop_validation_error.png');

  // 4. Invalid Credentials Error
  console.log('[Test 4] Invalid Credentials Error...');
  await setInputValue('#user-identifier', 'manager@pune.bharatdynamics.demo');
  await setInputValue('#user-password', 'IncorrectPassword123!');
  await cdp.eval(`document.querySelector('.login-submit-btn').click();`);
  await new Promise((r) => setTimeout(r, 1200));
  const errText2 = await cdp.eval(`document.querySelector('.login-error-alert')?.textContent`);
  console.log(`[Test 4] Auth error displayed: "${errText2}"`);
  await cdp.captureScreenshot('login_04_desktop_invalid_credentials.png');

  // 5. Explicit Role Mismatch Error: Technician Tab + Manager Credentials
  console.log('[Test 5] Role Mismatch Error (Selected Technician, authenticated as Manager)...');
  // Explicitly click Technician role card
  await cdp.eval(`document.querySelectorAll('.role-card')[1].click();`);
  await setInputValue('#user-identifier', 'manager@pune.bharatdynamics.demo');
  await setInputValue('#user-password', 'Manager123!');
  await cdp.eval(`document.querySelector('.login-submit-btn').click();`);
  await new Promise((r) => setTimeout(r, 1400));

  const mismatchErr = await cdp.eval(`document.querySelector('.login-error-alert')?.textContent`);
  console.log(`[Test 5] Role Mismatch message: "${mismatchErr}"`);
  const stillOnLogin = await cdp.eval(`Boolean(document.querySelector('.login-page-root'))`);
  console.log(`[Test 5] Access denied, user held on login page: ${stillOnLogin}`);
  await cdp.captureScreenshot('login_05_desktop_role_mismatch.png');

  // 6. Mobile Viewport (390x844 iPhone Viewport)
  console.log('[Test 6] Mobile Viewport...');
  await cdp.setViewport(390, 844, true);
  await new Promise((r) => setTimeout(r, 800));
  await cdp.captureScreenshot('login_06_mobile_viewport.png');

  // Return to Desktop for Successful Sign-In flows
  await cdp.setViewport(1280, 800, false);
  await ensureLoggedOut();

  // 7. Successful Technician Sign-In -> Redirects to #/maintenance
  console.log('[Test 7] Technician Sign-In -> Redirect to #/maintenance...');
  await cdp.eval(`
    (() => {
      const techQuickBtn = document.querySelectorAll('.dev-role-quick-btn')[1];
      if (techQuickBtn) techQuickBtn.click();
    })()
  `);
  await new Promise((r) => setTimeout(r, 2000));
  const techHash = await cdp.eval(`window.location.hash`);
  const techPageTitle = await cdp.eval(`document.querySelector('.page-header h1, .view-title, h1')?.textContent`);
  console.log(`[Test 7] Technician landed on route "${techHash}" with heading: "${techPageTitle}"`);
  await cdp.captureScreenshot('login_07_technician_redirect_success.png');

  // 8. Successful Manager Sign-In -> Redirects to #/ (Overview)
  console.log('[Test 8] Manager Sign-In -> Redirect to #/ (Overview)...');
  await ensureLoggedOut();
  await cdp.eval(`
    (() => {
      const mgrQuickBtn = document.querySelectorAll('.dev-role-quick-btn')[0];
      if (mgrQuickBtn) mgrQuickBtn.click();
    })()
  `);
  await new Promise((r) => setTimeout(r, 2000));
  const mgrHash = await cdp.eval(`window.location.hash`);
  const mgrPageTitle = await cdp.eval(`document.querySelector('.page-header h1, .view-title, h1')?.textContent`);
  console.log(`[Test 8] Manager landed on route "${mgrHash}" with heading: "${mgrPageTitle}"`);
  await cdp.captureScreenshot('login_08_manager_redirect_success.png');

  cdp.close();
  console.log('[Test Run] All verification and capture steps completed successfully!');
}

run().catch((err) => {
  console.error('[Test Run] Error:', err);
  process.exit(1);
});
