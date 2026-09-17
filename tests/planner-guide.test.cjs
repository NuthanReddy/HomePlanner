'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const Guide = require('../planner-guide.js');
const Workspace = require('../planner-workspace.js');
const root = path.join(__dirname, '..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');
const routes = Object.entries(Workspace.destinations).flatMap(([destination, value]) =>
  Object.keys(value.sections).map(section => `${destination}/${section}`));

test('every actual workspace section has distinct, complete, immutable guidance', () => {
  assert.deepEqual(Object.keys(Guide.guides).sort(), [...routes].sort());
  for (const key of routes) {
    const guide = Guide.getGuide(key), [destination, section] = key.split('/');
    assert.equal(Guide.getGuide({ destination, section }), guide);
    assert.ok(Object.isFrozen(guide));
    assert.ok(Object.isFrozen(guide.steps));
    for (const field of ['title', 'task', 'required', 'optional', 'result'])
      assert.ok(typeof guide[field] === 'string' && guide[field].length > 15, `${key}: ${field}`);
    assert.ok(guide.steps.length >= 3 && guide.steps.length <= 5, key);
    guide.steps.forEach(step => assert.ok(step.length > 20, key));
    assert.ok(guide.sources.length, `${key}: source evidence`);
    guide.sources.forEach(file => assert.ok(fs.existsSync(path.join(root, file)), file));
  }
  for (const field of ['title', 'task', 'required', 'optional', 'result'])
    assert.equal(new Set(Object.values(Guide.guides).map(guide => guide[field])).size, routes.length, field);
  assert.equal(new Set(routes.map(key => Guide.getGuide(key).steps.join('\n'))).size, routes.length);
  assert.ok(Object.isFrozen(Guide.guides));
});

test('unknown route keys do not silently substitute generic instructions', () => {
  for (const value of [undefined, null, '', '__proto__', 'constructor', 'design/unknown', 'missing/layout']) {
    assert.equal(Guide.getGuide(value), null);
    assert.equal(Guide.plannerURL(value), null);
  }
  assert.equal(Guide.mount(), null);
  assert.equal(Guide.mountAll(), null);
});

test('guide URLs use real local pages and round-trip through workspace routing', () => {
  assert.ok(fs.existsSync(path.join(root, 'user-guide.html')));
  assert.ok(fs.existsSync(path.join(root, 'index.html')));
  assert.equal(new Set(routes.map(Guide.anchorFor)).size, routes.length);
  for (const route of routes) {
    const url = Guide.plannerURL(route);
    assert.match(url, /^index\.html\?workspace=[a-z]+&section=[a-z]+$/);
    assert.equal(Workspace.normalizeRoute(url).destination + '/' + Workspace.normalizeRoute(url).section, route);
    assert.match(Guide.anchorFor(route), /^guide-[a-z]+-[a-z]+$/);
  }
  Guide.introduction.steps.forEach(step => assert.ok(Guide.getGuide(step.route)));
  assert.ok(Guide.glossary.length >= 12);
});

test('guidance distinguishes missing inputs and numerical results without claiming engineering', () => {
  const light = JSON.stringify(Guide.getGuide('environment/light'));
  assert.match(light, /Use project site/);
  assert.match(Guide.getGuide('environment/light').steps[0], /^Choose Analyze whole house/);
  assert.match(Guide.getGuide('environment/light').optional, /No room selection, date, time, location or near-horizon cutoff/);
  const airflow = Guide.getGuide('environment/airflow');
  assert.match(airflow.steps[0], /^Choose Use whole house/);
  assert.match(airflow.steps[0], /net usable area × supplied wall height/);
  assert.match(airflow.steps[0], /manual overrides are retained/);
  assert.match(airflow.steps[1], /without fetching/);
  assert.match(airflow.steps[2], /Use geometric opening areas \(estimate\).*upper bounds/);
  assert.match(airflow.required, /density.*Cd and signed pressure/);
  assert.doesNotMatch(light, /Copy project site|config\.period|lux values/i);
  assert.match(light, /does not calculate lux/);
  const terms = new Map(Guide.glossary);
  assert.match(terms.get('Near-horizon cutoff'), /greater than 0° and less than 90°/);
  assert.match(terms.get('Near-horizon cutoff'), /not.*recommended/);
  assert.match(terms.get('Window optics / VLT / SHGC'), /not interchangeable/);
  assert.match(terms.get('Clear volume'), /not.*automatically available/);
  for (const term of ['Unknown / blank', 'Not run / not evaluated', 'Blocked / failed', 'Zero / night', 'Stale'])
    assert.ok(terms.has(term), term);
  assert.match(Guide.introduction.paragraphs.join(' '), /optional next tasks/);
});

test('index integration is small, local and correctly ordered; no executable guide side effects', () => {
  const html = source('index.html'), js = source('planner-guide.js'), css = source('planner-guide.css');
  assert.equal((html.match(/id="workspaceGuide"/g) || []).length, 1);
  assert.equal((html.match(/src="planner-guide\.js"/g) || []).length, 1);
  assert.equal((html.match(/href="planner-guide\.css"/g) || []).length, 1);
  assert.ok(html.indexOf('id="workspaceGuide"') > html.indexOf('id="workspaceHeading"'));
  assert.ok(html.indexOf('id="workspaceGuide"') < html.indexOf('id="workspaceOverview"'));
  assert.ok(html.indexOf('src="planner-guide.js"') > html.indexOf('src="planner-workspace.js"'));
  assert.doesNotMatch(js, /\.innerHTML\s*=|\bfetch\s*\(|new Worker|\.localStorage|\.execute\s*\(|\.navigate\s*\(/);
  assert.match(js, /removeEventListener\('homeplanner:workspace-change'/);
  assert.match(css, /min-height: 44px/);
  assert.match(css, /:focus-visible/);
  assert.doesNotMatch(css, /var\(--accent/);
  const page = source('user-guide.html');
  assert.doesNotMatch(page, /https?:\/\/|cdn|markdown-it/i);
  assert.match(page, /src="planner-guide\.js" defer/);
});

function playwright() {
  const candidates = [
    process.env.HOMEPLANNER_PLAYWRIGHT_MODULE,
    'playwright',
    path.join(root, '.playwright-mcp', 'direct-model-actions', 'node_modules', 'playwright')
  ].filter(Boolean);
  for (const modulePath of candidates) {
    try { return require(modulePath); } catch (error) {
      if (error.code !== 'MODULE_NOT_FOUND') throw error;
    }
  }
  return null;
}

test('real browser: guide lifecycle, all routes, drafts and standalone local anchors', async t => {
  const installed = playwright();
  if (!installed) { t.skip('Existing Playwright unavailable; no dependencies installed.'); return; }
  const browser = await installed.chromium.launch({
    headless: true,
    channel: process.env.HOMEPLANNER_BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined)
  });
  t.after(() => browser.close());
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost/').pathname);
    const file = path.resolve(root, pathname === '/' ? 'index.html' : pathname.slice(1));
    if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
    fs.readFile(file, (error, body) => {
      if (error) { response.writeHead(404).end(); return; }
      const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
      response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }).end(body);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  t.after(() => context.close());
  await context.route('**/*', route => new URL(route.request().url()).origin === origin
    ? route.continue() : route.abort());
  const page = await context.newPage();

  await t.test('standalone page renders all local links, remains usable on phones and is idempotent', async () => {
    const requests = [];
    page.on('request', request => requests.push(request.url()));
    await page.goto(`${origin}/user-guide.html`, { waitUntil: 'networkidle' });
    assert.equal(await page.locator('.hp-guide-section').count(), routes.length + 1);
    const ids = await page.locator('[id]').evaluateAll(nodes => nodes.map(node => node.id));
    assert.equal(new Set(ids).size, ids.length);
    const broken = await page.locator('a[href^="#"]').evaluateAll(links =>
      links.map(link => link.getAttribute('href')).filter(href => !document.getElementById(href.slice(1))));
    assert.deepEqual(broken, []);
    for (const url of requests)
      assert.ok(['user-guide.html', 'planner-guide.js', 'planner-guide.css'].some(file => url.endsWith(file)), url);
    assert.equal(await page.evaluate(() => {
      const host = document.getElementById('homePlannerUserGuide'), api = HomePlannerGuide;
      const first = api.mountAll(), second = api.mountAll();
      if (first !== second) return false;
      first.dispose(); first.dispose();
      const third = api.mountAll();
      first.dispose();
      return api.mountAll() === third && !!host.querySelector('#glossary');
    }), true);
    assert.equal(await page.locator('.hp-guide-section').count(), routes.length + 1);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.getByRole('link', { name: 'Glossary', exact: true }).click();
    assert.equal(new URL(page.url()).hash, '#glossary');
  });

  await t.test('actual workspace route events preserve project, draft nodes and a closed compact guide', async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/index.html?workspace=design&section=layout`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.HomePlannerGuide && document.getElementById('workspaceGuide')?.homePlannerGuide);
    assert.equal(await page.locator('#workspaceGuide details').getAttribute('open'), null);
    assert.equal(await page.evaluate(() => {
      const host = document.getElementById('workspaceGuide');
      const first = HomePlannerGuide.mount();
      window.__guideTest = {
        project: JSON.stringify(HomePlanner.getProject()),
        draft: document.querySelector('#environmentWorkspace input[type="number"]'),
        resources: performance.getEntriesByType('resource').length
      };
      if (!window.__guideTest.draft) throw new Error('Existing input needed for draft-preservation test');
      window.__guideTest.draft.value = '17.4567';
      return first === HomePlannerGuide.mount() && host.children.length === 1;
    }), true);
    const summary = page.locator('#workspaceGuide summary');
    await summary.focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#workspaceGuide details').evaluate(node => node.open), true);
    assert.ok(await summary.evaluate(node => node.getBoundingClientRect().height >= 44));
    assert.equal(await summary.evaluate(node => getComputedStyle(node).outlineStyle), 'solid');
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('homeplanner:workspace-change')));
    assert.equal(await page.locator('#workspaceGuide details').evaluate(node => node.open), true);
    for (const route of routes) {
      await page.evaluate(value => HomePlannerWorkspace.navigate(value, { scroll: false, focus: false }), route);
      assert.equal(await page.locator('#workspaceGuide h3').textContent(), Guide.getGuide(route).title, route);
      assert.equal(await page.locator('#workspaceGuide details').evaluate(node => node.open), false, route);
      assert.equal(await page.locator('#workspaceGuide a').getAttribute('href'),
        `user-guide.html#${Guide.anchorFor(route)}`);
    }
    assert.equal(await page.evaluate(() => {
      const before = window.__guideTest;
      return before.project === JSON.stringify(HomePlanner.getProject()) &&
        before.draft === document.querySelector('#environmentWorkspace input[type="number"]') &&
        before.draft.value === '17.4567' &&
        before.resources === performance.getEntriesByType('resource').length;
    }), true, 'route navigation and guide reads preserve authored state, draft DOM and network silence');
    assert.equal(await page.evaluate(() => {
      const host = document.getElementById('workspaceGuide'), original = host.homePlannerGuide;
      original.dispose(); original.dispose();
      HomePlannerWorkspace.navigate('design/layout', { scroll: false, focus: false });
      if (host.children.length) return false;
      const next = HomePlannerGuide.mount();
      original.dispose();
      return next === HomePlannerGuide.mount() && host.children.length === 1;
    }), true, 'dispose removes subscriptions and remount creates only one owned disclosure');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.locator('#workspaceGuide').evaluate(node => node.getBoundingClientRect().height <= 50));
    await page.locator('#workspaceGuide summary').click();
    assert.equal(await page.locator('#workspaceGuide a').getAttribute('target'), '_blank');
    const ids = await page.locator('[id]').evaluateAll(nodes => nodes.map(node => node.id));
    assert.equal(new Set(ids).size, ids.length, 'no duplicate document IDs');
  });
});
