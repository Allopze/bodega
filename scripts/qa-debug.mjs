import { chromium } from 'playwright'
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

await page.locator('input[name="email"]').first().fill('allopze@gmail.com')
await page.locator('input[name="password"]').first().fill('Chgo1314')

// Esperar y clickear
await page.waitForTimeout(2000)
await page.locator('button[type="submit"]').first().click()
console.log('clicked, waiting 8s...')
await page.waitForTimeout(8000)
console.log('URL after 8s:', page.url())
const errText = await page.locator('[role="alert"]').first().innerText().catch(() => null)
console.log('alert:', errText)

await browser.close()
