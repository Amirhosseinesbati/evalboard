/* Actual UI evidence, isolated headless instance of the user's local Chrome. */
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require(require.resolve('@playwright/test', { paths: [path.resolve(__dirname, '../apps/web')] }))
const origin = process.env.EVALBOARD_URL || 'http://127.0.0.1:4313'
const output = path.resolve(__dirname, '../docs/screenshots/theme-workbench')
const temp = path.resolve(__dirname, '../.browser-tmp')
const chrome = process.env.PLAYWRIGHT_CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

async function main() {
  fs.mkdirSync(output, { recursive: true }); fs.mkdirSync(temp, { recursive: true })
  const browser = await chromium.launch({ executablePath: chrome, headless: true, env: { ...process.env, TEMP: temp, TMP: temp } })
  const manifest = []
  try {
    for (const theme of ['dark', 'light']) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, colorScheme: 'light' })
      await context.addInitScript(value => localStorage.setItem('evalboard.theme.v1', value), theme)
      const login = await context.request.post(origin + '/api/v1/auth/login', { data: { username: 'admin@northstar.example.com', password: process.env.EVALBOARD_DEMO_PASSWORD || 'Demo123!' } })
      if (!login.ok()) throw new Error('Synthetic login failed: ' + login.status())
      const experiments = await (await context.request.get(origin + '/api/v1/experiments')).json()
      const compared = experiments.items.find(item => item.name.toLowerCase().includes('regression')) || experiments.items.find(item => item.status === 'completed')
      const failed = experiments.items.find(item => item.failed_runs > 0)
      const datasets = await (await context.request.get(origin + '/api/v1/datasets')).json()
      async function capture(name, route, width, ready, action) {
        const page = await context.newPage(); const errors = []
        page.on('pageerror', error => errors.push(error.message))
        page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
        await page.setViewportSize({ width, height: width < 500 ? 844 : 1000 })
        await page.goto(origin + route, { waitUntil: 'networkidle' })
        await ready(page); if (action) await action(page)
        const file = name + '-' + theme + '-' + width + '.png'
        const hasDialog = await page.getByRole('dialog').count() > 0
        await page.screenshot({ path: path.join(output, file), fullPage: !hasDialog, animations: 'disabled' })
        const overflow = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - innerWidth))
        manifest.push({ file, route, theme, viewport: page.viewportSize(), capture: hasDialog ? 'viewport, fixed dialog' : 'full page', horizontal_overflow_px: overflow, errors })
        await page.close()
      }
      const overviewReady = page => page.locator('.overview-run').first().waitFor()
      for (const width of [1440, 390]) {
        await capture('overview', '/overview', width, overviewReady)
        await capture('comparison', '/compare/' + compared.id, width, page => page.locator('.metric-matrix tbody tr').first().waitFor())
      }
      if (process.env.EVALBOARD_CAPTURE_QUICK !== '1') {
        for (const width of [1024, 768]) await capture('overview', '/overview', width, overviewReady)
        await capture('inspector', '/compare/' + compared.id, 1440, page => page.locator('.example-row').first().waitFor(), async page => {
          await page.locator('.example-row').first().click(); await page.locator('.pair-side .json-view').first().waitFor()
        })
        await capture('failure-inspector', '/compare/' + failed.id, 390, page => page.getByRole('tab', { name: 'Failure explorer' }).waitFor(), async page => {
          await page.getByRole('tab', { name: 'Failure explorer' }).click(); await page.locator('tbody .button-link').first().click(); await page.getByRole('dialog').getByText('Recorded output').waitFor()
        })
        await capture('mobile-navigation', '/overview', 390, overviewReady, page => page.getByRole('button', { name: 'Open navigation' }).click())
        await capture('builder', '/experiments/new', 1024, page => page.getByRole('button', { name: /Quick check/ }).waitFor())
        await capture('dataset', '/datasets/' + datasets.items[0].id, 1440, page => page.locator('.case-row').first().waitFor(), page => page.locator('.case-row').first().click())
        await capture('reviews', '/reviews', 1440, page => page.locator('.review-item').first().waitFor())
        await capture('report', '/reports/' + compared.id, 1440, page => page.locator('.decision-hero').waitFor())
        await capture('appearance-error', '/appearance', 390, page => page.getByLabel('Product name').waitFor(), async page => {
          await page.getByLabel('Appearance JSON file').setInputFiles({ name: 'invalid-demo.json', mimeType: 'application/json', buffer: Buffer.from('invalid JSON') }); await page.getByRole('alert').waitFor()
        })
      }
      await context.close()
    }
    fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify({ captured_at: new Date().toISOString(), origin, scope: 'Synthetic local QA database; isolated user local Chrome, headless; no live provider calls', screenshots: manifest }, null, 2) + '\n')
    console.log(JSON.stringify({ screenshots: manifest.length, overflow: manifest.filter(item => item.horizontal_overflow_px), errors: manifest.flatMap(item => item.errors) }, null, 2))
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
