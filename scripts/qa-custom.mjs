import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-CL', timezoneId: 'America/Santiago' })
const page = await ctx.newPage()
const baseUrl = 'http://localhost:3003'
await page.goto(baseUrl + '/login', { waitUntil: 'networkidle' })
await page.waitForSelector('input[type="password"]')
await page.waitForTimeout(3000)
await page.locator('input[name="email"]').first().fill('allopze@gmail.com')
await page.locator('input[name="password"]').first().fill('Chgo1314')
await page.locator('button[type="submit"]').first().click()
await page.waitForTimeout(5000)
await page.goto(baseUrl + '/control-operacional?desde=2026-01-01&hasta=2026-06-30', { waitUntil: 'domcontentloaded' })
await page.waitForLoadState('networkidle').catch(() => {})
await page.waitForTimeout(2500)

const rest = await page.locator('text=Restablecer').count()
console.log('botón Restablecer count (período custom):', rest)

// Verificar description del header (es el primer <p> dentro de PageHeader que NO es eyebrow)
const desc = await page.locator('h1 ~ p').first().innerText().catch(() => null)
console.log('header description (custom period):', desc)

await page.screenshot({ path: 'audit/control-operacional-fixes/desktop-custom.png', fullPage: true })
console.log('saved desktop-custom')
await browser.close()
