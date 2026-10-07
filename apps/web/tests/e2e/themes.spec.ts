import { expect, test, type Page } from '@playwright/test'

async function authenticate(page: Page) {
  const response = await page.request.post('/api/v1/auth/login', { data: { username: 'admin@northstar.example.com', password: process.env.EVALBOARD_DEMO_PASSWORD ?? 'Demo123!' } })
  expect(response.ok()).toBeTruthy()
}
const root = (page: Page) => page.locator('html')
const theme = (page: Page) => page.locator('.topbar').getByRole('combobox', { name: 'Theme', exact: true })

test('fresh dark default and legacy branding survive reload; invalid themes fall back safely', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.addInitScript(() => localStorage.setItem('evalboard.appearance.v1', JSON.stringify({ version: 1, appearance: { name: 'Legacy Client', tagline: 'Existing identity', accent: 'forest', density: 'compact', collapsed: false } })))
  await authenticate(page); await page.goto('/overview')
  await expect(root(page)).toHaveAttribute('data-theme', 'dark')
  await expect(root(page)).toHaveAttribute('data-accent', 'forest')
  await expect(page.locator('.brand-name')).toHaveText('Legacy Client')
  await theme(page).selectOption('light'); await page.reload()
  await expect(root(page)).toHaveAttribute('data-theme', 'light')
  await expect(root(page)).toHaveAttribute('data-density', 'compact')
  await page.evaluate(() => localStorage.setItem('evalboard.theme.v1', 'unrecognized'))
  await page.reload(); await expect(root(page)).toHaveAttribute('data-theme', 'dark')
})

test('system follows live OS changes while explicit choices ignore them', async ({ page }) => {
  await authenticate(page); await page.emulateMedia({ colorScheme: 'light' }); await page.goto('/overview')
  await theme(page).selectOption('system'); await expect(root(page)).toHaveAttribute('data-theme', 'light')
  await page.emulateMedia({ colorScheme: 'dark' }); await expect(root(page)).toHaveAttribute('data-theme', 'dark')
  await page.emulateMedia({ colorScheme: 'light' }); await expect(root(page)).toHaveAttribute('data-theme', 'light')
  await theme(page).selectOption('dark'); await page.emulateMedia({ colorScheme: 'dark' }); await page.emulateMedia({ colorScheme: 'light' })
  await expect(root(page)).toHaveAttribute('data-theme', 'dark')
  await theme(page).selectOption('light'); await page.emulateMedia({ colorScheme: 'dark' })
  await expect(root(page)).toHaveAttribute('data-theme', 'light')
  expect(await root(page).evaluate(element => getComputedStyle(element).colorScheme)).toBe('light')
})

test('theme switches preserve builder and appearance drafts without refetching business data', async ({ page }) => {
  await authenticate(page); await page.goto('/experiments/new'); await page.waitForLoadState('networkidle')
  await page.getByLabel('Experiment name').fill('A draft to preserve')
  await page.getByRole('button', { name: /Repeated check/ }).click()
  const requests: string[] = []
  page.on('request', request => { if (request.url().includes('/api/v1/')) requests.push(request.url()) })
  await theme(page).selectOption('light'); await theme(page).selectOption('dark')
  await expect(page.getByLabel('Experiment name')).toHaveValue('A draft to preserve')
  await expect(page.getByLabel('Repetitions')).toHaveValue('3')
  await expect(page).toHaveURL(/\/experiments\/new$/)
  expect(requests).toEqual([])
  await page.goto('/appearance'); await page.getByLabel('Product name').fill('Unapplied client identity')
  await page.locator('.theme-settings').getByRole('combobox', { name: 'Theme', exact: true }).selectOption('light')
  await expect(page.getByLabel('Product name')).toHaveValue('Unapplied client identity')
  await expect(page.locator('.brand-name')).toHaveText('EvalBoard')
  await expect(theme(page)).toHaveValue('light')
})

test('unavailable storage remains usable and explains session-only theme selection', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new DOMException('Blocked', 'SecurityError') }
    Storage.prototype.setItem = () => { throw new DOMException('Blocked', 'SecurityError') }
  })
  await authenticate(page); await page.goto('/overview')
  await expect(root(page)).toHaveAttribute('data-theme', 'dark')
  await theme(page).selectOption('light'); await expect(root(page)).toHaveAttribute('data-theme', 'light')
  await expect(page.getByText('Theme applies for this session.', { exact: false })).toBeVisible()
  await page.getByRole('link', { name: 'Experiments', exact: true }).click()
  await expect(page.locator('.experiment-item').first()).toBeVisible()
  await expect(root(page)).toHaveAttribute('data-theme', 'light')
})

test('saved preference is applied before the app bundle under a self-only script CSP', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('evalboard.theme.v1', 'light'))
  await page.route('**/src/main.tsx', route => route.abort())
  await page.route('**/overview', async route => {
    const response = await route.fetch()
    await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': "script-src 'self'; object-src 'none'" } })
  })
  await page.goto('/overview', { waitUntil: 'domcontentloaded' })
  await expect(root(page)).toHaveAttribute('data-theme', 'light')
  await expect(page.locator('#root')).toBeEmpty()
  expect(await root(page).evaluate(element => ({ scheme: getComputedStyle(element).colorScheme, background: getComputedStyle(element).backgroundColor }))).toEqual({ scheme: 'light', background: 'rgb(243, 245, 248)' })
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#f3f5f8')
})

test('theme can be selected from the keyboard without losing the current route', async ({ page }) => {
  await authenticate(page); await page.goto('/experiments?q=Timeout&sort=oldest')
  await theme(page).focus(); await page.keyboard.press('Home'); await page.keyboard.press('Enter')
  await expect(root(page)).toHaveAttribute('data-theme', 'light')
  await expect(page).toHaveURL(/q=Timeout&sort=oldest/)
  await expect(page.getByLabel('Search experiments')).toHaveValue('Timeout')
})

test('comparison matrix and repeated inspectors expose saved evidence in both themes', async ({ page }) => {
  await authenticate(page)
  const experiments = await (await page.request.get('/api/v1/experiments')).json() as { items: Array<{ id: string; name: string; status: string; failed_runs: number }> }
  const completed = experiments.items.find(item => item.name.toLowerCase().includes('regression'))!
  const failed = experiments.items.find(item => item.failed_runs > 0)!
  await page.goto('/compare/' + completed.id)
  await expect(page.getByRole('heading', { name: 'Metric comparison matrix' })).toBeVisible()
  await expect(page.locator('.metric-matrix tbody tr').first()).toBeVisible()
  const opener = page.locator('.example-row').first()
  await opener.click()
  const inspector = page.getByRole('dialog')
  await expect(inspector.locator('.pair-side')).toHaveCount(2)
  await expect(inspector.getByText('Recorded output', { exact: true })).toHaveCount(2)
  const bounds = await inspector.boundingBox()
  expect(bounds?.y).toBe(0)
  expect(bounds?.height).toBe(page.viewportSize()!.height)
  const caseKey = await inspector.locator('#pair-title').textContent()
  await inspector.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('light')
  await expect(inspector).toBeVisible(); await expect(inspector.locator('#pair-title')).toHaveText(caseKey!)
  await page.keyboard.press('Escape'); await expect(opener).toBeFocused()
  await opener.click(); await inspector.getByRole('button', { name: 'Close inspector', exact: true }).click()
  await expect(inspector).toHaveCount(0)
  await page.goto('/compare/' + failed.id)
  await page.getByRole('tab', { name: 'Overview', exact: true }).focus(); await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: 'Failure explorer' })).toBeFocused()
  await expect(page.getByRole('tabpanel', { name: 'Failure explorer' })).toBeVisible()
  await page.locator('tbody .button-link').first().click()
  await expect(inspector.locator('.pair-side')).toHaveCount(1)
  await expect(inspector.locator('.inline-error')).toBeVisible()
  await inspector.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('dark')
  await expect(inspector.locator('.inline-error')).toBeVisible()
  await page.keyboard.press('Escape'); await expect(page.locator('tbody .button-link').first()).toBeFocused()
})

test('core text tokens and primary actions have accessible contrast in both themes and palettes', async ({ page }) => {
  await authenticate(page); await page.goto('/overview')
  for (const preference of ['dark', 'light']) {
    await theme(page).selectOption(preference)
    for (const accent of ['ocean', 'forest', 'iris']) {
      const ratios = await page.evaluate(palette => {
        document.documentElement.dataset.accent = palette
        const style = getComputedStyle(document.documentElement)
        const rgb = (token: string) => {
          const span = document.createElement('span'); span.style.color = style.getPropertyValue(token); document.body.append(span)
          const values = getComputedStyle(span).color.match(/[\d.]+/g)!.slice(0, 3).map(Number); span.remove()
          return values.map(value => { const n = value / 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4 }).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0)
        }
        return [['--ink', '--surface'], ['--muted', '--surface'], ['--muted', '--canvas'], ['--cyan', '--surface'], ['--red', '--red-soft'], ['--green', '--green-soft'], ['--amber', '--amber-soft'], ['--on-accent', '--accent-solid']].map(([fg, bg]) => { const a = rgb(fg); const b = rgb(bg); return { fg, bg, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) } })
      }, accent)
      for (const result of ratios) expect(result.ratio, `${preference}/${accent} ${result.fg} on ${result.bg}`).toBeGreaterThanOrEqual(4.5)
    }
  }
})

test('printing from either theme keeps a neutral light canvas and restores the screen preference', async ({ page }) => {
  await authenticate(page); await page.goto('/overview')
  for (const preference of ['dark', 'light']) {
    await theme(page).selectOption(preference)
    await page.emulateMedia({ media: 'print' })
    expect(await root(page).evaluate(element => ({ background: getComputedStyle(element).backgroundColor, scheme: getComputedStyle(element).colorScheme }))).toEqual({ background: 'rgb(255, 255, 255)', scheme: 'light' })
    await page.emulateMedia({ media: 'screen' })
    await expect(root(page)).toHaveAttribute('data-theme', preference)
  }
})

test('overview and comparison fit mobile and intermediate widths in both themes', async ({ page }) => {
  await authenticate(page)
  for (const preference of ['dark', 'light']) {
    for (const width of [390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 }); await page.goto('/overview')
      await theme(page).selectOption(preference); await expect(page.locator('.overview-run').first()).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
      await page.goto('/compare'); await expect(page.locator('.metric-matrix tbody tr').first()).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
    }
  }
})
