import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const url = process.env.URL || 'http://localhost:3003/control-operacional'
const user = process.env.QA_USER || 'allopze@gmail.com'
const pass = process.env.QA_PASS || 'Chgo1314'
const outDir = process.env.OUT_DIR || 'audit/control-operacional-fixes'
fs.mkdirSync(outDir, { recursive: true })

const consoleErrors = []
const pageErrors = []
const failedRequests = []

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-CL', timezoneId: 'America/Santiago' })
const page = await ctx.newPage()
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()) })
page.on('pageerror', e => pageErrors.push(e.message))
page.on('requestfailed', r => failedRequests.push({ url: r.url(), error: r.failure()?.errorText }))

const baseUrl = url.replace(/\/control-operacional.*$/, '')

console.log('→ goto /login')
await page.goto(baseUrl + '/login', { waitUntil: 'networkidle', timeout: 30000 })
await page.waitForSelector('input[type="password"]', { timeout: 15000 })
await page.waitForTimeout(3000)
await page.locator('input[name="email"]').first().fill(user)
await page.locator('input[name="password"]').first().fill(pass)
await page.locator('button[type="submit"]').first().click()
await page.waitForTimeout(5000)
console.log('post-login URL:', page.url())

// Ir a la página objetivo
console.log('→ goto target', url)
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
console.log('post-goto URL:', page.url())
await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {})
await page.waitForTimeout(3000)

const fullPath = path.resolve(outDir, 'desktop-control-operacional.png')
await page.screenshot({ path: fullPath, fullPage: true })
console.log('saved', fullPath)

const meta = {
  url, finalUrl: page.url(),
  h1: await page.locator('h1').first().innerText().catch(() => null),
  description: await page.locator('header p, [role="banner"] p').first().innerText().catch(() => null),
  h2s: await page.locator('h2').allInnerTexts(),
  kpiCount: await page.locator('[data-kpi-card]').count(),
  kpiLabels: await page.locator('[data-kpi-card] p').allInnerTexts(),
  tableSnippet: (await page.locator('table').first().innerText().catch(() => '')).slice(0, 1500),
  tableRowCount: await page.locator('table tbody tr').count(),
  badgeTexts: await page.locator('span[class*="rounded-full"]').allInnerTexts().catch(() => []),
  consoleErrors: consoleErrors.slice(0, 20),
  pageErrors: pageErrors.slice(0, 20),
  failedRequests: failedRequests.slice(0, 20),
}
fs.writeFileSync(path.resolve(outDir, 'meta.json'), JSON.stringify(meta, null, 2))
console.log('meta.json saved with', meta.kpiCount, 'KPIs')

await page.setViewportSize({ width: 390, height: 844 })
await page.waitForTimeout(1500)
const mobilePath = path.resolve(outDir, 'mobile-control-operacional.png')
await page.screenshot({ path: mobilePath, fullPage: true })
console.log('saved', mobilePath)

await browser.close()
console.log('done')
