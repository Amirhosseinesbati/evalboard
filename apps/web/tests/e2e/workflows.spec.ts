import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'

const password = process.env.EVALBOARD_DEMO_PASSWORD ?? 'Demo123!'

async function signIn(page: Page, username = 'admin@northstar.example.com') {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Sign in to EvalBoard' })).toBeVisible()
  await page.getByLabel('Email or username').fill(username)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('complementary', { name: 'Main navigation' })).toBeVisible()
}

async function items<T>(page: Page, path: string): Promise<T[]> {
  const response = await page.request.get(path)
  expect(response.ok(), `GET ${path}`).toBeTruthy()
  const payload = await response.json() as { items: T[] }
  return payload.items
}

test('cancels a persisted paired experiment from the run console', async ({ page }) => {
  await signIn(page)
  const datasets = await items<{ latest_version_id: string }>(page, '/api/v1/datasets')
  const configs = await items<{ id: string; name: string }>(page, '/api/v1/configs')
  const baseline = configs.find((item) => item.name.includes('Baseline · accurate'))
  const challenger = configs.find((item) => item.name.includes('Fast · corrected'))
  expect(datasets[0]).toBeTruthy()
  expect(baseline).toBeTruthy()
  expect(challenger).toBeTruthy()
  const name = `Browser cancellation ${Date.now()}`
  const created = await page.request.post('/api/v1/experiments', { data: {
    name, dataset_version_id: datasets[0].latest_version_id,
    candidate_a_id: baseline!.id, candidate_b_id: challenger!.id,
    split: 'held_out', max_cases: 30, repetitions: 1, budget_usd: 2,
  } })
  expect(created.status()).toBe(201)
  const experiment = await created.json() as { id: string }
  await page.goto(`/experiments/${experiment.id}`)
  await expect(page.getByRole('heading', { name })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel run' }).click()
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await page.getByRole('button', { name: 'Cancel experiment' }).click()
  await expect(page.getByText('cancelled', { exact: true }).first()).toBeVisible()
  const response = await page.request.get(`/api/v1/experiments/${experiment.id}`)
  expect((await response.json() as { status: string }).status).toBe('cancelled')
})

test('filters failed case runs and reveals the recorded failure reason', async ({ page }) => {
  await signIn(page)
  const experiments = await items<{ id: string; name: string }>(page, '/api/v1/experiments')
  const timeout = experiments.find((item) => item.name === 'Timeout spike')
  expect(timeout).toBeTruthy()
  await page.goto(`/experiments/${timeout!.id}`)
  await page.getByLabel('Filter status').selectOption('failed')
  const rows = page.locator('tbody tr')
  await expect(rows.first()).toBeVisible()
  expect(await rows.count()).toBeGreaterThan(0)
  await expect(rows.first().getByText('failed', { exact: true })).toBeVisible()
  await rows.first().getByRole('button', { name: /Inspect/ }).click()
  await expect(page.getByRole('dialog')).toContainText('Synthetic planted timeout')
})

test('reviewer uses keyboard selection in a blind queue and saves a decision', async ({ page }) => {
  await signIn(page, 'reviewer@northstar.example.com')
  await expect(page).toHaveURL(/\/reviews$/)
  await expect(page.getByRole('link', { name: 'Datasets' })).toHaveCount(0)
  const assignments = await items<{ id: string; decisions: unknown[] }>(page, '/api/v1/reviews')
  const available = assignments.find((item) => item.decisions.length < 3)
  test.skip(!available, 'The seeded reviewer assignment was already used; reset the demo dataset to submit again.')
  await page.goto('/reviews')
  await expect(page.getByRole('heading', { name: 'Which response is better?' })).toBeVisible()
  await page.keyboard.press('1')
  await expect(page.getByRole('radio', { name: /Left is better/ })).toBeChecked()
  await page.getByLabel('Reviewer notes').fill('Browser test: left answer better on recorded evidence.')
  await page.getByRole('button', { name: 'Submit review' }).click()
  await expect.poll(async () => {
    const updated = await items<{ id: string; decisions: unknown[] }>(page, '/api/v1/reviews')
    return updated.find((item) => item.id === available!.id)?.decisions.length ?? 0
  }).toBeGreaterThan(available!.decisions.length)
})

test('downloads a failed release decision with its recorded source', async ({ page }) => {
  await signIn(page)
  const experiments = await items<{ id: string; name: string }>(page, '/api/v1/experiments')
  const regression = experiments.find((item) => item.name === 'Cheaper faster, return regression')
  expect(regression).toBeTruthy()
  await page.goto(`/reports/${regression!.id}`)
  await expect(page.getByRole('heading', { name: 'Gate failed' })).toBeVisible()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export JSON' }).click(),
  ])
  expect(download.suggestedFilename()).toBe(`evalboard-report-${regression!.id}.json`)
  const path = await download.path()
  expect(path).not.toBeNull()
  const payload = JSON.parse(await readFile(path!, 'utf8')) as { decision: string; source: string; comparison: { regressions: unknown[] } }
  expect(payload.decision).toBe('fail')
  expect(payload.source).toBe('simulated_history')
  expect(payload.comparison.regressions.length).toBeGreaterThan(0)
})

test('traps focus in the gate dialog and restores the opener on Escape', async ({ page }) => {
  await signIn(page)
  const experiments = await items<{ id: string; name: string }>(page, '/api/v1/experiments')
  const regression = experiments.find((item) => item.name === 'Cheaper faster, return regression')
  expect(regression).toBeTruthy()
  await page.goto(`/reports/${regression!.id}`)
  const opener = page.getByRole('button', { name: 'Gates' })
  await opener.click()
  const dialog = page.getByRole('dialog', { name: 'Release gates' })
  await expect(dialog.getByRole('button', { name: 'Close gate editor' })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(dialog.getByRole('button', { name: 'Save gate' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('button', { name: 'Close gate editor' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(opener).toBeFocused()
})
