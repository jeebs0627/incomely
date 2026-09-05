const { test, expect } = require('@playwright/test');
const D = require('../../js/data');
const today = new Date().toLocaleDateString('en-CA');
const entry = (id, amount = 50000) => ({ id, name: '디자인 외주 ' + id, amount, date: today, cat: 'freelance', createdAt: 1, paid: false, skin: 'pixel', memo: '' });
async function seed(page, entries) {
  await page.addInitScript(data => { localStorage.setItem('incomefarm:v1', JSON.stringify({ entries: data, goal: 1000000, sound: false })); localStorage.setItem('incomefarm:motion', 'off'); }, entries);
}
test('compact responsive layout, search, editing, CSV and keyboard access', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await seed(page, Array.from({ length: 24 }, (_, i) => ({ ...entry('a' + i), skin: ['soft','pixel','stripe','gem'][i % 4] })));
  await page.goto('/');
  await expect(page.locator('.block')).toHaveCount(24);
  await expect(page.locator('#result-count')).toHaveText('24');
  const cols = await page.locator('.tower').evaluate(n => getComputedStyle(n).gridTemplateColumns.split(' ').length);
  expect(cols).toBeGreaterThanOrEqual(4);
  await page.locator('#search').fill('외주 a23');
  await expect(page.locator('.block')).toHaveCount(1);
  await page.locator('.block').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#sheet-add')).toHaveClass(/open/);
  await page.locator('#in-paid').selectOption('paid');
  await page.locator('#in-skin').selectOption('gem');
  await page.locator('#btn-submit').click();
  await expect(page.locator('.block')).toHaveClass(/skin-gem/);
  await expect(page.locator('.paid-mark')).toHaveCount(1);
  await page.locator('#filter-paid').selectOption('pending');
  await expect(page.locator('.block')).toHaveCount(0);
  await expect(page.locator('#empty-hint')).toBeVisible();
  await page.locator('#filter-paid').selectOption('all');
  await page.locator('#btn-menu').click();
  const downloaded = page.waitForEvent('download'); await page.locator('#m-csv').click();
  expect((await downloaded).suggestedFilename()).toMatch(/\.csv$/);
  await page.locator('#search').fill('');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.screenshot({ path: 'artifacts/desktop.png', fullPage: true });
  expect(errors).toEqual([]);
});
test('local record survives reload and cancelled import changes nothing', async ({ page }) => {
  await page.goto('/'); await page.locator('#fab').click();
  await page.locator('#in-name').fill('새 기록'); await page.locator('#in-amount').fill('10000');
  await page.locator('#btn-submit').click(); await expect(page.locator('.block')).toHaveCount(1);
  await page.reload(); await expect(page.locator('.block')).toHaveCount(1);
  page.once('dialog', d => d.dismiss());
  await page.locator('#file-import').setInputFiles({ name: 'import.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ entries: [entry('import')], goal: 0 })) });
  await expect(page.locator('.block')).toHaveCount(1); await expect(page.locator('.b-name')).toHaveText('새 기록');
});

async function mockCloud(context, server, user = 'user-1') {
  await context.addInitScript(({ user }) => {
    localStorage.setItem('incomefarm:motion', 'off');
    localStorage.setItem('incomefarm:session:v2', JSON.stringify({ access_token: user, refresh_token: 'refresh', expires_at: Date.now() / 1000 + 3600, user: { id: user, email: user + '@example.com' } }));
  }, { user });
  await context.route('**/api/config', route => route.fulfill({ json: { configured: true, url: 'https://test.supabase.co', key: 'sb_publishable_test' } }));
  await context.route('https://test.supabase.co/**', async route => {
    if (server.offline) return route.abort();
    const req = route.request(), url = req.url();
    if (url.includes('/farms?')) return route.fulfill({ json: server.revision ? [{ data: server.data, revision: server.revision }] : [] });
    if (url.endsWith('/save_farm')) {
      const body = req.postDataJSON();
      if (server.failCAS) { server.failCAS = false; server.data.entries.push(D.clean({ entries: [entry('race')], goal: 0 }).entries[0]); server.revision++; return route.fulfill({ json: [] }); }
      if (body.expected_revision !== server.revision) return route.fulfill({ json: [] });
      server.data = body.next_data; server.revision++; return route.fulfill({ json: [{ data: server.data, revision: server.revision }] });
    }
    return route.fulfill({ status: 400, json: {} });
  });
}
async function edit(page, name) {
  await page.locator('#fab').click(); await page.locator('#in-name').fill(name); await page.locator('#in-amount').fill('20000'); await page.locator('#btn-submit').click();
}
test('two devices synchronize, merge offline changes and recover a CAS race', async ({ browser }) => {
  const server = { data: D.blank(), revision: 0 };
  const one = await browser.newContext({ serviceWorkers: 'block' }), two = await browser.newContext({ serviceWorkers: 'block' });
  await mockCloud(one, server); await mockCloud(two, server);
  const a = await one.newPage(), b = await two.newPage(); await a.goto('/'); await b.goto('/');
  await expect(a.locator('#sync-label')).toHaveText('동기화 완료'); await expect(b.locator('#sync-label')).toHaveText('동기화 완료');
  await edit(a, '기기 A');
  await expect.poll(() => server.data.entries.length).toBe(1);
  await b.evaluate(() => FarmCloud.sync()); await expect(b.locator('.b-name')).toHaveText('기기 A');
  server.offline = true;
  await edit(a, '오프라인 A'); await edit(b, '오프라인 B');
  await a.waitForTimeout(500); server.offline = false; server.failCAS = true;
  await a.evaluate(() => FarmCloud.sync()); await b.evaluate(() => FarmCloud.sync()); await a.evaluate(() => FarmCloud.sync());
  await expect.poll(() => server.data.entries.length).toBe(4);
  await expect(a.locator('.block')).toHaveCount(4); await expect(b.locator('.block')).toHaveCount(4);
  await one.close(); await two.close();
});
test('same-record conflict never overwrites the server; logout isolates guest records', async ({ browser }) => {
  const server = { data: D.clean({ entries: [entry('shared')], goal: 0 }), revision: 1 };
  const context = await browser.newContext({ serviceWorkers: 'block' }); await mockCloud(context, server);
  const page = await context.newPage(); await seed(page, [entry('guest')]); await page.goto('/');
  await expect(page.locator('#sync-label')).toHaveText('동기화 완료');
  server.offline = true;
  await page.locator('.block').focus(); await page.keyboard.press('Enter'); await page.locator('#in-amount').fill('777'); await page.locator('#btn-submit').click();
  await page.waitForTimeout(500); server.data.entries[0].amount = 888; server.revision++; server.offline = false;
  await page.evaluate(() => FarmCloud.sync());
  await expect(page.locator('#btn-account')).toHaveAttribute('data-kind', 'error'); expect(server.data.entries[0].amount).toBe(888);
  await page.locator('#btn-account').click(); await page.locator('#sign-out').click();
  await expect(page.locator('.b-name')).toHaveText('디자인 외주 guest');
  await context.close();
});
