'use strict';
const assert = require('node:assert/strict');

async function runDesignStorageBrowser(browser, baseURL, apiURL) {
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  const endpoint = path => `${apiURL}/api/v1${path}`;
  const origin = { Origin: baseURL };
  try {
    await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => route.abort());
    const legacy = await context.newPage();
    await legacy.goto(`${baseURL}/index.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await legacy.waitForFunction(() => window.HomePlanner?.getScene()?.rooms?.length > 0);
    const fixture = await legacy.evaluate(() => JSON.parse(window.HomePlanner.exportProject()));
    await legacy.close();
    assert.equal((await context.request.get(endpoint('/health/ready'))).status(), 200);
    const challengeResponse = await context.request.post(endpoint('/auth/challenges'), {
      headers: origin, data: { phone: `+120255501${String(Math.floor(Math.random() * 100)).padStart(2, '0')}` },
    });
    assert.equal(challengeResponse.status(), 202);
    const challenge = await challengeResponse.json();
    const verified = await context.request.post(endpoint('/auth/verify'), {
      headers: origin, data: { challenge_id: challenge.challenge_id, code: '123456' },
    });
    assert.equal(verified.status(), 200);
    const account = await verified.json();
    const headers = { ...origin, 'X-CSRF-Token': account.csrf_token };
    const created = await context.request.post(endpoint('/projects'), {
      headers, data: { name: `Isolated Design storage parity ${Date.now()}` },
    });
    assert.equal(created.status(), 201);
    const record = await created.json();
    const designPath = `/projects/${record.id}/design`;
    // Proxy to the disposable real API, not a synthetic response or the user's database.
    await context.route('**/api/v1/**', async route => {
      const incoming = new URL(route.request().url());
      const response = await route.fetch({ url: `${apiURL}${incoming.pathname}${incoming.search}` });
      await route.fulfill({ response });
    });
    await page.goto(`${baseURL}/platform.html`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button').filter({ has: page.getByText(record.name, { exact: true }) }).click();
    await page.getByRole('navigation', { name: 'Project workspaces' }).getByRole('button', { name: 'Design', exact: true }).click();
    fixture.storageParityMetadata = { preserve: ['unknown', null, 0] };
    await page.locator('.native-design input[type="file"]').setInputFiles({
      name: 'storage-parity.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)),
    });
    await page.waitForFunction(() => document.querySelector('#roomPlan')?.innerHTML.length > 100);
    await page.locator('.native-design summary').filter({ hasText: 'Floors & history' }).click();
    await page.getByRole('button', { name: 'Duplicate active floor', exact: true }).click();
    const expectedFloors = fixture.floors.length + 1;
    const activeFloor = await page.locator('#hp-editor-floor-select').inputValue();
    const bedroom = fixture.legacy.context.plan.placed.find(room => room.req.id === 'bed-1');
    await page.locator('#hp-editor-object-select').selectOption(JSON.stringify({ kind: 'room', id: `${activeFloor}:bed-1` }));
    const width = page.locator('#hp-editor-room-w');
    await width.fill(String(bedroom.carpet.w - 0.03));
    const save = page.getByRole('button', { name: 'Save Design', exact: true });
    await save.click();
    await page.getByText('Saved Design version 1; unapplied fields are not included', { exact: true }).waitFor();
    const first = await (await context.request.get(endpoint(designPath))).json();
    assert.equal(first.document.id, fixture.id);
    assert.equal(first.document.floors.length, expectedFloors);
    assert.equal(first.document.floors[0].id, fixture.floors[0].id);
    assert.deepEqual(first.document.storageParityMetadata, fixture.storageParityMetadata);
    assert.deepEqual(first.document.environment, fixture.environment);
    assert.equal(first.document.legacy.context.plan.placed.find(room => room.req.id === 'bed-1').carpet.w, bedroom.carpet.w);
    assert.equal(Number(await width.inputValue()), bedroom.carpet.w - 0.03);
    await width.press('Escape');
    assert.equal(await save.isDisabled(), true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button').filter({ has: page.getByText(record.name, { exact: true }) }).click();
    await page.getByRole('navigation', { name: 'Project workspaces' }).getByRole('button', { name: 'Design', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#roomPlan')?.innerHTML.length > 100);
    assert.equal(await page.locator('#hp-editor-floor-select option').count(), expectedFloors);
    assert.equal(await save.isDisabled(), true);
    const external = structuredClone(first.document);
    external.storageParityMetadata.external = true;
    assert.equal((await context.request.post(endpoint(designPath), {
      headers, data: { expected_version: first.version, document: external },
    })).status(), 200);
    await page.locator('.native-design summary').filter({ hasText: 'Floors & history' }).click();
    await page.getByRole('button', { name: 'Duplicate active floor', exact: true }).click();
    assert.equal(await page.locator('#hp-editor-floor-select option').count(), expectedFloors + 1);
    await save.click();
    await page.getByRole('button', { name: 'Open saved Design; discard working copy', exact: true }).waitFor();
    assert.equal(await page.locator('#hp-editor-floor-select option').count(), expectedFloors + 1);
    const unchanged = await (await context.request.get(endpoint(designPath))).json();
    assert.equal(unchanged.version, 2);
    assert.deepEqual(unchanged.document, external);
    await page.getByRole('button', { name: 'Open saved Design; discard working copy', exact: true }).click();
    await page.getByText('Opened saved Design version 2', { exact: true }).waitFor();
    await page.waitForFunction(count => document.querySelectorAll('#hp-editor-floor-select option').length === count, expectedFloors);
    assert.equal(await save.isDisabled(), true);
    const designTab = name => page.getByRole('navigation', { name: 'Design sections' }).getByRole('button', { name, exact: true }).click();
    await designTab('Structure');
    await page.locator('#hp-structure-label').fill('Retained account discipline draft');
    await designTab('Plumbing');
    await page.locator('#hp-service-x').fill('2');
    await designTab('Structure');
    assert.equal(await page.locator('#hp-structure-label').inputValue(), 'Retained account discipline draft');
    await page.getByRole('navigation', { name: 'Project workspaces' }).getByRole('button', { name: 'Analyze', exact: true }).click();
    await page.getByRole('navigation', { name: 'Analyze sections' }).getByRole('button', { name: 'Light', exact: true }).click();
    await page.locator('#light-whole-house').waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    const overflow = await page.evaluate(() => [...document.querySelectorAll('body *')]
      .filter(node => { const box = node.getBoundingClientRect(); return box.width > 0 && box.right > innerWidth + 1; })
      .map(node => `${node.outerHTML.slice(0, 250)}: ${Math.round(node.getBoundingClientRect().right)}`));
    assert.deepEqual(overflow, []);
    assert.deepEqual(errors, []);
    return { saved: true, reopened: true, metadataAndFloorsPreserved: true, unappliedDraftExcluded: true,
      conflictRetainedEdits: true, explicitRecovery: true, disciplineDraftsRetained: true, analysisMounted: true, mobileOverflow: false, errors };
  } catch (error) {
    throw new Error(`${error.message}\nBrowser errors: ${errors.join('; ')}\n${await page.locator('body').innerText()}`, { cause: error });
  } finally {
    await context.close();
  }
}
module.exports = { runDesignStorageBrowser };
if (require.main === module) {
  const { chromium } = require(process.env.HOMEPLANNER_PLAYWRIGHT_MODULE || 'playwright');
  (async () => {
    const browser = await chromium.launch({ channel: 'msedge' });
    try {
      console.log(JSON.stringify(await runDesignStorageBrowser(browser,
        process.env.HOMEPLANNER_PLATFORM_URL || 'http://127.0.0.1:5175',
        process.env.HOMEPLANNER_FIXTURE_API || 'http://127.0.0.1:8003'), null, 2));
    } finally { await browser.close(); }
  })().catch(error => { console.error(error); process.exitCode = 1; });
}
