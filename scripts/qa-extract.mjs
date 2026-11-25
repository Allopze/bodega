import { chromium } from 'playwright'
// Credenciales de la sesión QA: vienen del entorno, nunca escritas aquí (mismas variables que scripts/qa-login.mjs).
const { QA_USER, QA_PASSWORD } = process.env
if (!QA_USER || !QA_PASSWORD) {
  console.error('Faltan QA_USER o QA_PASSWORD. Ejemplo: node --env-file=.env.qa scripts/qa-extract.mjs')
  process.exit(1)
}
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-CL', timezoneId: 'America/Santiago' })
const page = await ctx.newPage()
const baseUrl = 'http://localhost:3003'
await page.goto(baseUrl + '/login', { waitUntil: 'networkidle' })
await page.waitForSelector('input[type="password"]')
await page.waitForTimeout(3000)
await page.locator('input[name="email"]').first().fill(QA_USER)
await page.locator('input[name="password"]').first().fill(QA_PASSWORD)
await page.locator('button[type="submit"]').first().click()
await page.waitForTimeout(5000)
await page.goto(baseUrl + '/control-operacional', { waitUntil: 'domcontentloaded' })
await page.waitForLoadState('networkidle').catch(() => {})
await page.waitForTimeout(3000)

// Extraer badges de la tabla
const badges = await page.locator('table tbody tr td span').allInnerTexts()
console.log('table badges:', JSON.stringify(badges))

// Estado de la columna
const estados = await page.locator('table tbody tr td:nth-child(4)').allInnerTexts()
console.log('columna Estado (textos):', JSON.stringify(estados))

// Descripción del header
const desc = await page.locator('p.text-sub, [class*="text-sub"]').first().innerText().catch(() => null)
console.log('description:', desc)

// Tira editorial
const tira = await page.locator('[aria-label*="Resumen"]').innerText().catch(() => null)
console.log('tira editorial:', tira)

// Botón Restablecer
const rest = await page.locator('text=Restablecer').count()
console.log('botón Restablecer count:', rest)

// Título del card lateral
const cardTitle = await page.locator('h2').allInnerTexts()
console.log('h2s:', JSON.stringify(cardTitle))

// ¿Qué badge se muestra para "revertido"? Verifico
const sourceBadge = await page.locator('ul li span[class*="rounded-full"]').allInnerTexts()
console.log('source badge:', JSON.stringify(sourceBadge))

await page.screenshot({ path: 'audit/control-operacional-fixes/desktop-full.png', fullPage: true })
await browser.close()
