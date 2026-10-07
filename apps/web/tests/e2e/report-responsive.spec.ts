import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'

async function openReport(page: Page, width: number, preference: 'dark' | 'light') {
  await page.setViewportSize({ width, height: 844 })
  const login = await page.request.post('/api/v1/auth/login', { data: { username: 'admin@northstar.example.com', password: process.env.EVALBOARD_DEMO_PASSWORD ?? 'Demo123!' } })
  expect(login.ok()).toBeTruthy()
  const response = await page.request.get('/api/v1/experiments')
  expect(response.ok()).toBeTruthy()
  const experiments = await response.json() as { items: Array<{ id: string; name: string; status: string }> }
  const regression = experiments.items.find(item => item.name === 'Cheaper faster, return regression')!
  expect(regression).toBeTruthy()
  await page.goto('/reports?experiment=' + regression.id)
  await page.locator('.topbar').getByRole('combobox', { name: 'Theme', exact: true }).selectOption(preference)
  await expect(page.getByRole('heading', { name: 'Gate failed', exact: true })).toBeVisible()
  return { regression, experiments: experiments.items }
}

async function fitsPage(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  for (const control of await page.locator('.report-page .btn, .report-page select').all()) {
    const bounds = await control.boundingBox()
    expect(bounds).not.toBeNull()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1)
  }
}

for (const preference of ['dark', 'light'] as const) {
  for (const width of [320, 390]) {
    test(`Reports keep controls and table scrolling usable at ${width}px in ${preference}`, async ({ page }) => {
      const { regression, experiments } = await openReport(page, width, preference)
      await fitsPage(page)
      for (const name of ['Task-specific paired correctness', 'Applicable metrics']) {
        const region = page.getByRole('region', { name: `${name} table, scroll horizontally for all columns`, exact: true })
        await expect(region.locator('tbody tr').first()).toBeVisible()
        const dimensions = await region.evaluate(element => ({ client: element.clientWidth, scroll: element.scrollWidth, overflow: getComputedStyle(element).overflowX }))
        expect(dimensions.overflow).toBe('auto')
        expect(dimensions.scroll).toBeGreaterThan(dimensions.client)
        await region.focus()
        await expect(region).toBeFocused()
        await page.keyboard.press('ArrowRight')
        await expect.poll(() => region.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
        await region.evaluate(element => { element.scrollLeft = element.scrollWidth })
        const visibleLastColumn = await region.evaluate(element => {
          const lastColumn = element.querySelector('th:last-child')!.getBoundingClientRect()
          const bounds = element.getBoundingClientRect()
          return lastColumn.left >= bounds.left && lastColumn.right <= bounds.right + 1
        })
        expect(visibleLastColumn).toBeTruthy()
        await fitsPage(page)
      }

      const opener = page.getByRole('button', { name: 'Gates', exact: true })
      for (let attempt = 0; attempt < 2; attempt++) {
        await opener.click()
        const dialog = page.getByRole('dialog', { name: 'Release gates', exact: true })
        await expect(dialog.getByRole('button', { name: 'Close gate editor' })).toBeFocused()
        const bounds = await dialog.boundingBox()
        expect(bounds!.x).toBeGreaterThanOrEqual(0)
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
        await expect(dialog.getByLabel('Gate name')).toBeVisible()
        await expect(dialog.getByLabel('Thresholds JSON')).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(dialog).toHaveCount(0)
        await expect(opener).toBeFocused()
      }

      const other = experiments.find(item => item.status === 'completed' && item.id !== regression.id)!
      expect(other).toBeTruthy()
      const selector = page.getByRole('combobox', { name: 'EXPERIMENT', exact: true })
      await selector.selectOption(other.id)
      await expect(page).toHaveURL(new RegExp('experiment=' + other.id))
      await expect(page.locator('.report-page .decision-hero')).toBeVisible()
      await fitsPage(page)
      await selector.selectOption(regression.id)
      await expect(page.getByRole('heading', { name: 'Gate failed', exact: true })).toBeVisible()
      await expect(page.getByRole('link', { name: 'Back to comparison' })).toHaveAttribute('href', '/compare/' + regression.id)

      const recorded = await (await page.request.get(`/api/v1/experiments/${regression.id}/report`)).json()
      for (const format of ['json', 'markdown'] as const) {
        const button = page.getByRole('button', { name: format === 'json' ? 'Export JSON' : 'Download Markdown', exact: true })
        const [download] = await Promise.all([page.waitForEvent('download'), button.click()])
        expect(download.suggestedFilename()).toBe(`evalboard-report-${regression.id}.${format === 'json' ? 'json' : 'md'}`)
        const file = await download.path()
        expect(file).not.toBeNull()
        const content = await readFile(file!, 'utf8')
        if (format === 'json') {
          const payload = JSON.parse(content)
          expect(payload.comparison).toEqual(recorded.comparison)
          expect(payload.gate).toEqual(recorded.gate)
          expect(payload.source).toBe('simulated_history')
          expect(payload.decision).toBe('fail')
        } else {
          expect(content).toContain('Decision: **FAIL**')
          expect(content).toContain('Source: `simulated_history`')
          expect(content).toContain(`Paired cases: ${recorded.comparison.paired_count} / ${recorded.comparison.denominator}`)
          expect(content).toContain('## Applicable metrics')
        }
        await expect(button).toBeEnabled()
      }
      await page.emulateMedia({ media: 'print' })
      expect(await page.locator('html').evaluate(element => ({ background: getComputedStyle(element).backgroundColor, scheme: getComputedStyle(element).colorScheme }))).toEqual({ background: 'rgb(255, 255, 255)', scheme: 'light' })
      await expect(page.getByRole('heading', { name: 'Gate failed', exact: true })).toBeVisible()
      await expect(page.locator('.report-page table')).toHaveCount(2)
      await fitsPage(page)
      await page.emulateMedia({ media: 'screen' })
      await expect(page.locator('html')).toHaveAttribute('data-theme', preference)
      await fitsPage(page)
    })
  }
}

test('Reports export error stays inside a 320px page and repeated export recovers', async ({ page }) => {
  const { regression } = await openReport(page, 320, 'dark')
  const exportRoute = `**/api/v1/experiments/${regression.id}/report/export?format=json`
  await page.route(exportRoute, route => route.fulfill({ status: 503, contentType: 'text/plain', body: 'Unavailable for the local error test' }))
  const exportButton = page.getByRole('button', { name: 'Export JSON', exact: true })
  await exportButton.click()
  const alert = page.getByRole('alert').filter({ hasText: 'Report download failed (503)' })
  await expect(alert).toBeVisible()
  await fitsPage(page)
  await expect(exportButton).toBeEnabled()
  await alert.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(alert).toHaveCount(0)
  await page.unroute(exportRoute)
  const [download] = await Promise.all([page.waitForEvent('download'), exportButton.click()])
  expect(download.suggestedFilename()).toBe(`evalboard-report-${regression.id}.json`)
  await expect(exportButton).toBeEnabled()
  await fitsPage(page)
})
