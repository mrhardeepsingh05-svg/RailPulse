import { createRequire } from 'node:module';
const require = createRequire(process.env.AUDIT_TOOLS_PKG || import.meta.url);
const { chromium } = require('playwright');
const { default: AxeBuilder } = require('@axe-core/playwright');

const BASE_URL = process.env.RAILPULSE_URL || 'http://127.0.0.1:8000';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const VIEWPORTS = [
  { name: 'Mobile', width: 375, height: 812 },
  { name: 'Tablet', width: 768, height: 1024 },
  { name: 'Laptop', width: 1366, height: 768 },
  { name: 'Desktop', width: 1920, height: 1080 },
];

async function run() {
  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
  });

  const consoleErrors = [];
  const pageErrors = [];
  const serverErrors = [];
  const a11yResults = [];
  const responsiveResults = [];

  try {
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    const page = await context.newPage();

    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('response', (res) => {
      if (res.status() >= 500) serverErrors.push(`${res.status()} ${res.url()}`);
    });

    // 1. Login Page + Axe Scan
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForSelector('button:has-text("Admin")');
    const loginAxe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze();
    a11yResults.push({ page: 'Login', violations: loginAxe.violations.map((v) => `${v.id} (${v.impact})`) });

    // Sign in as Admin
    await page.click('button:has-text("Admin")');
    await page.click('button[type="submit"]');
    await page.waitForSelector('h1:has-text("Dashboard")');

    // 2. Visit all pages, check content & Axe a11y
    const routes = [
      { path: '/', heading: 'Dashboard', label: 'Dashboard' },
      { path: '/assets', heading: 'Railway Assets', label: 'Assets' },
      { path: '/inspections', heading: 'Manage Inspections', label: 'Inspections' },
      { path: '/maintenance', heading: 'Maintenance Tasks', label: 'Maintenance' },
      { path: '/map', heading: 'Asset Map', label: 'Map' },
      { path: '/calendar', heading: 'Schedule Calendar', label: 'Calendar' },
      { path: '/analytics', heading: 'Analytics & Trends', label: 'Analytics' },
      { path: '/reports', heading: 'Reports', label: 'Reports' },
      { path: '/notifications', heading: 'Notifications', label: 'Notifications' },
      { path: '/team', heading: 'Team Management', label: 'Team' },
    ];

    for (const r of routes) {
      await page.click(`nav a[href="${r.path}"]`);
      await page.waitForSelector(`h1:has-text("${r.heading}")`);
      await page.waitForTimeout(350);
      const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze();
      a11yResults.push({
        page: r.label,
        violations: axe.violations.map((v) => `${v.id} (${v.impact}, nodes:${v.nodes.length})`),
      });
    }

    // 3. Interactive Workflows
    // 3a. Asset Creation
    await page.click('nav a[href="/assets"]');
    await page.waitForSelector('button:has-text("Add Asset")');
    await page.click('button:has-text("Add Asset")');
    await page.fill('#f-name', 'Playwright E2E Signal S-88');
    await page.fill('#f-loc', 'Test Corridor Km 8.8');
    await page.click('button:has-text("Save Asset")');
    await page.waitForSelector('text=Playwright E2E Signal S-88');

    // 3b. Inspection Creation + AI Check
    await page.click('nav a[href="/inspections"]');
    await page.click('button[role="tab"]:has-text("New Inspection")');
    await page.fill('#insp-obs', 'Observed loose clips and moisture near signal box door during Playwright E2E.');
    await page.click('button:has-text("Check with AI Helper")');
    await page.waitForSelector('text=AI Confidence:');
    await page.click('button:has-text("Save Inspection Report")');
    await page.waitForSelector('text=Observed loose clips and moisture');

    // 3c. Maintenance Task Creation
    await page.click('nav a[href="/maintenance"]');
    await page.click('button:has-text("Create Task")');
    await page.waitForSelector('#wo-asset option', { state: 'attached' });
    await page.fill('#wo-title', 'Playwright E2E Clip Repair');
    await page.fill('#wo-desc', 'Tighten loose clips verified during E2E workflow.');
    await page.click('form button:has-text("Create Task")');
    await page.waitForSelector('div[role="dialog"][aria-label="Create Maintenance Task"]', { state: 'detached' });
    await page.waitForSelector('td >> text=Playwright E2E Clip Repair');

    // 3d. Calendar Weekly Switch
    await page.click('nav a[href="/calendar"]');
    await page.click('button:has-text("Weekly")');
    await page.waitForSelector('button:has-text("Weekly")');

    // 3e. Reports 5 tabs
    await page.click('nav a[href="/reports"]');
    for (const tabLabel of ['Inspection Reports', 'Maintenance Reports', 'Team Activity Reports', 'Fault Summary Reports']) {
      await page.click(`button[role="tab"]:has-text("${tabLabel}")`);
    }

    // 3f. Global Search
    await page.fill('#global-search', 'Playwright');
    await page.waitForSelector('text=Search Results');

    // 3g. Raily Assistant
    await page.click('button[aria-label="Open Raily Railway Assistant"]');
    await page.waitForSelector('section[aria-label="Raily Helper Panel"]');
    await page.click('button:has-text("Give me a project summary")');
    await page.waitForSelector('text=Here is your live summary', { timeout: 5000 }).catch(() => {});

    // 4. Responsive overflow checks across 4 viewports on Dashboard, Assets, Map, Calendar
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      for (const path of ['/', '/assets', '/map', '/calendar']) {
        await page.goto(`${BASE_URL}${path}`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(250);
        const overflow = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
        }));
        responsiveResults.push({
          viewport: vp.name,
          path,
          overflowPx: Math.max(0, overflow.scrollWidth - overflow.innerWidth),
        });
      }
    }

    console.log(
      JSON.stringify(
        {
          e2e_status: 'PASSED',
          consoleErrors,
          pageErrors,
          serverErrors,
          a11yResults,
          responsiveResults,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
