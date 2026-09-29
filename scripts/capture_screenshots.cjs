/* Capture real EvalBoard UI states from a running local demo. */
const fs = require('node:fs')
const path = require('node:path')

const webRoot = path.resolve(__dirname, '../apps/web')
const { chromium } = require(require.resolve('@playwright/test', { paths: [webRoot] }))
const origin = process.env.EVALBOARD_URL || 'http://localhost:5173'
const outputDir = path.resolve(__dirname, '../docs/screenshots')
const chromePath = process.env.CHROME_PATH || process.env.PLAYWRIGHT_CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const tempDir = path.resolve(__dirname, '../.browser-tmp')

async function authenticate(context, username) {
  const response = await context.request.post(`${origin}/api/v1/auth/login`, {
    data: { username, password: process.env.EVALBOARD_DEMO_PASSWORD || 'Demo123!' },
  })
  if (!response.ok()) throw new Error(`Demo login failed for ${username}: HTTP ${response.status()}`)
}

async function items(context, route) {
  const response = await context.request.get(`${origin}/api/v1${route}`)
  if (!response.ok()) throw new Error(`${route}: HTTP ${response.status()}`)
  return (await response.json()).items || []
}

async function capture(context, manifest, name, route, viewport, action) {
  const page = await context.newPage()
  const issues = []
  page.on('pageerror', error => issues.push(`pageerror: ${error.message}`))
  page.on('console', message => { if (message.type() === 'error') issues.push(`console: ${message.text()}`) })
  await page.setViewportSize(viewport)
  await page.goto(`${origin}${route}`, { waitUntil: 'domcontentloaded' })
  await page.locator('main').first().waitFor({ timeout: 15000 })
  await page.waitForTimeout(750)
  if (action) await action(page)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(150)
  const horizontalOverflowPx = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - innerWidth))
  const target = path.join(outputDir, name)
  const fullPage = name !== '03-live-run-1440.png'
  await page.screenshot({ path: target, fullPage, animations: 'disabled' })
  manifest.push({ file: `docs/screenshots/${name}`, route, viewport, full_page: fullPage, horizontal_overflow_px: horizontalOverflowPx, issues })
  await page.close()
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true })
  fs.mkdirSync(tempDir, { recursive: true })
  const browser = await chromium.launch({ headless: true, executablePath: chromePath, args: ['--no-sandbox'], env: { ...process.env, TEMP: tempDir, TMP: tempDir } })
  const manifest = []
  try {
    const admin = await browser.newContext({ deviceScaleFactor: 1 })
    await authenticate(admin, 'admin@northstar.example.com')
    const datasets = await items(admin, '/datasets')
    const experiments = await items(admin, '/experiments')
    if (!datasets.length || !experiments.length) throw new Error('Seeded datasets/experiments not found')
    const experiment = experiments.find(item => /cheaper faster/i.test(item.name)) || experiments[0]
    const timeoutExperiment = experiments.find(item => item.name === 'Timeout spike')
    if (!timeoutExperiment) throw new Error('Seeded timeout experiment not found')
    const desktop = { width: 1440, height: 900 }
    const tablet = { width: 1024, height: 768 }
    const mobile = { width: 390, height: 844 }

    await capture(admin, manifest, '01-datasets-1440.png', '/datasets', desktop)
    await capture(admin, manifest, '02-experiment-builder-1024.png', '/experiments/new', tablet)
    await capture(admin, manifest, '03-live-run-1440.png', `/experiments/${experiment.id}`, desktop)
    await capture(admin, manifest, '04-comparison-1440.png', `/compare/${experiment.id}`, desktop)
    await capture(admin, manifest, '05-failure-explorer-1440.png', `/compare/${timeoutExperiment.id}`, desktop, async page => {
      await page.getByRole('tab', { name: 'Failure explorer' }).click()
      await page.getByRole('heading', { name: 'Failure explorer' }).waitFor()
      await page.locator('tbody tr').first().waitFor()
    })
    await capture(admin, manifest, '06-release-report-1440.png', `/reports/${experiment.id}`, desktop)
    await capture(admin, manifest, '07-mobile-comparison-390.png', `/compare/${experiment.id}`, mobile)

    const reviewer = await browser.newContext({ deviceScaleFactor: 1 })
    await authenticate(reviewer, 'reviewer@northstar.example.com')
    await capture(reviewer, manifest, '08-blinded-review-1440.png', '/reviews', desktop)
    await reviewer.close()
    await admin.close()
  } finally {
    await browser.close()
  }
  fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify({ captured_at: new Date().toISOString(), origin, screenshots: manifest }, null, 2) + '\n')
  console.log(JSON.stringify({ count: manifest.length, issues: manifest.flatMap(item => item.issues), overflow: manifest.filter(item => item.horizontal_overflow_px > 0) }, null, 2))
}

main().catch(error => { console.error(error); process.exitCode = 1 })
