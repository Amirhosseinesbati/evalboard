/* Capture current UI evidence using an isolated instance of the user's local Chrome. */
const fs = require('node:fs')
const path = require('node:path')
const webRoot = path.resolve(__dirname, '../apps/web')
const { chromium } = require(require.resolve('@playwright/test', { paths: [webRoot] }))
const origin = process.env.EVALBOARD_URL || 'http://127.0.0.1:4313'
const output = path.resolve(__dirname, '../docs/screenshots/workbench')
const temp = path.resolve(__dirname, '../.browser-tmp')
const chrome = process.env.PLAYWRIGHT_CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

async function main() {
  fs.mkdirSync(output, { recursive: true })
  fs.mkdirSync(temp, { recursive: true })
  const browser = await chromium.launch({ executablePath: chrome, headless: true, env: { ...process.env, TEMP: temp, TMP: temp } })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
  const manifest = []
  async function capture(file, route, width, height, ready, action) {
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    await page.setViewportSize({ width, height })
    await page.goto(origin + route, { waitUntil: 'networkidle' })
    await ready(page)
    if (action) await action(page)
    await page.screenshot({ path: path.join(output, file), fullPage: true, animations: 'disabled' })
    const overflow = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - innerWidth))
    manifest.push({ file, route, viewport: { width, height }, horizontal_overflow_px: overflow, errors })
    await page.close()
  }
  try {
    const login = await context.request.post(`${origin}/api/v1/auth/login`, { data: { username: 'admin@northstar.example.com', password: process.env.EVALBOARD_DEMO_PASSWORD || 'Demo123!' } })
    if (!login.ok()) throw new Error(`Synthetic demo login failed: ${login.status()}`)
    const overviewReady = page => page.locator('.overview-run').first().waitFor()
    await capture('overview-1440.png', '/overview', 1440, 1000, overviewReady)
    await capture('overview-390.png', '/overview', 390, 844, overviewReady)
    await capture('appearance-1440.png', '/appearance', 1440, 1000, page => page.getByLabel('Product name').waitFor())
    await capture('appearance-390.png', '/appearance', 390, 844, page => page.getByLabel('Product name').waitFor())
    await capture('appearance-import-error-390.png', '/appearance', 390, 844, page => page.getByLabel('Product name').waitFor(), async page => {
      await page.getByLabel('Appearance JSON file').setInputFiles({ name: 'invalid-demo.json', mimeType: 'application/json', buffer: Buffer.from('invalid JSON') })
      await page.getByRole('alert').waitFor()
    })
    await capture('history-1440.png', '/experiments?q=Timeout', 1440, 1000, page => page.locator('.experiment-item').first().waitFor())
    await capture('builder-1024.png', '/experiments/new', 1024, 1000, page => page.getByRole('button', { name: /Quick check/ }).waitFor())
    await capture('mobile-navigation-390.png', '/overview', 390, 844, overviewReady, page => page.getByRole('button', { name: 'Open navigation' }).click())
    fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify({ captured_at: new Date().toISOString(), origin, scope: 'Isolated synthetic local demonstration; user local Chrome, headless, fresh context', screenshots: manifest }, null, 2) + '\n')
    console.log(JSON.stringify({ screenshots: manifest.length, overflow: manifest.filter(item => item.horizontal_overflow_px), errors: manifest.flatMap(item => item.errors) }, null, 2))
  } finally { await context.close(); await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
