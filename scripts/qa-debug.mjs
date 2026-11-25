import { chromium } from 'playwright'
// Credenciales de la sesión QA: vienen del entorno, nunca escritas aquí (mismas variables que scripts/qa-login.mjs).
const { QA_USER, QA_PASSWORD } = process.env
if (!QA_USER || !QA_PASSWORD) {
  console.error('Faltan QA_USER o QA_PASSWORD. Ejemplo: node --env-file=.env.qa scripts/qa-debug.mjs')
  process.exit(1)
}
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const page = await browser.newPage()
page.on('console', m => console.log('[console]', m.type(), m.text()))
page.on('pageerror', e => console.log('[pageerror]', e.message))
page.on('request', r => { if (r.url().includes('api/auth') || r.url().includes('login')) console.log('[req]', r.method(), r.url()) })
page.on('response', r => { if (r.url().includes('api/auth') || r.url().includes('login')) console.log('[res]', r.status(), r.url()) })

await page.goto('http://127.0.0.1:3003/login', { waitUntil: 'networkidle' })
await page.waitForTimeout(3000)

// Verificar si React hidrató
const reactCheck = await page.evaluate(() => {
  const btn = document.querySelector('button[type="submit"]')
  if (!btn) return 'no btn'
  // React 18+ marca el root con un comentario
  const reactKey = Object.keys(btn).find(k => k.startsWith('__reactProps') || k.startsWith('__reactFiber'))
  return {
    hasReactKey: !!reactKey,
    btnDisabled: btn.disabled,
    btnText: btn.innerText,
  }
})
console.log('react check:', JSON.stringify(reactCheck))

await page.locator('input[name="email"]').first().fill(QA_USER)
await page.locator('input[name="password"]').first().fill(QA_PASSWORD)

// Esperar y clickear
await page.waitForTimeout(2000)
await page.locator('button[type="submit"]').first().click()
console.log('clicked, waiting 8s...')
await page.waitForTimeout(8000)
console.log('URL after 8s:', page.url())
const errText = await page.locator('[role="alert"]').first().innerText().catch(() => null)
console.log('alert:', errText)

await browser.close()
