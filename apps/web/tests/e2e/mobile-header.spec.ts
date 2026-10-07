import { expect, test, type Page } from '@playwright/test'

async function authenticate(page: Page) {
  const response = await page.request.post('/api/v1/auth/login', { data: { username: 'admin@northstar.example.com', password: process.env.EVALBOARD_DEMO_PASSWORD ?? 'Demo123!' } })
  expect(response.ok()).toBeTruthy()
}

test('mobile API status has readable text and an accessible live name in both themes', async ({ page }) => {
  await authenticate(page)
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/reports')
    for (const preference of ['dark', 'light']) {
      await page.locator('.topbar').getByRole('combobox', { name: 'Theme', exact: true }).selectOption(preference)
      const status = page.locator('.topbar').getByRole('status', { name: 'API connected', exact: true })
      await expect(status).toBeVisible()
      await expect(status.locator('span')).toHaveText('API connected')
      await expect(status.locator('span')).toBeVisible()
      await expect(status).toHaveAttribute('aria-atomic', 'true')
      const fit = await status.locator('span').evaluate(element => {
        const bounds = element.getBoundingClientRect()
        return { readable: parseFloat(getComputedStyle(element).fontSize) >= 9.9, inside: bounds.left >= 0 && bounds.right <= innerWidth }
      })
      expect(fit).toEqual({ readable: true, inside: true })
      expect(await page.locator('.topbar').evaluate(element => element.scrollWidth <= element.clientWidth)).toBeTruthy()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
    }
  }
})

test('mobile status communicates checking, disconnected and recovered states without color', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 })
  await authenticate(page)
  let first = true
  let disconnected = false
  let release: () => void = () => {}
  await page.route('**/api/v1/health', async route => {
    if (first) { first = false; await new Promise<void>(resolve => { release = resolve }) }
    if (disconnected) await route.abort()
    else await route.continue()
  })
  await page.goto('/overview', { waitUntil: 'domcontentloaded' })
  const header = page.locator('.topbar')
  await expect(header.getByRole('status', { name: 'Checking connection', exact: true }).locator('span')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  release()
  await expect(header.getByRole('status', { name: 'API connected', exact: true })).toBeVisible()
  disconnected = true
  await page.reload()
  const offline = header.getByRole('status', { name: 'API disconnected', exact: true })
  await expect(offline.locator('span')).toHaveText('API disconnected')
  await expect(offline.locator('span')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  disconnected = false
  await page.getByRole('button', { name: 'Retry connection' }).click()
  await expect(header.getByRole('status', { name: 'API connected', exact: true }).locator('span')).toBeVisible()
})
