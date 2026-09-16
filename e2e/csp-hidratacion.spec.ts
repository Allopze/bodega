/**
 * E2E: todo HTML que sirve la app tiene que poder hidratar bajo la CSP del proxy.
 *
 * `proxy.ts` emite `script-src 'self' 'nonce-…'` por request (lib/security/csp.ts)
 * y Next sólo puede estampar ese nonce en el HTML que renderiza en la petición:
 * en una página prerenderizada el script inline del flight queda horneado **sin**
 * nonce, el navegador lo bloquea y la app nunca hidrata. La corrida de capturas
 * del 2026-09-16 lo mostró en /recuperar —dos violaciones de `script-src` y React
 * #412 en cada carga—, que era la única página HTML estática junto con el 404.
 *
 * El mismo build dejaba React #418 en /ppa: `useOnlineStatus` leía
 * `navigator.onLine` durante el primer render y, desde Node 22, el runtime del
 * servidor también expone un `navigator` (sin `onLine`), así que el servidor
 * renderizaba el aviso "Sin conexión" y el navegador el formulario.
 *
 * Las aserciones son sobre el invariante y sobre su síntoma, no sobre la
 * implementación: cualquier página que vuelva a prerenderizarse, o cualquier
 * lectura de `navigator` en el primer render, falla acá.
 */
import { expect, test } from "@playwright/test"

/** Rutas sin sesión: son las únicas que pueden llegar prerenderizadas. */
const RUTAS_PUBLICAS = ["/recuperar", "/login", "/registro", "/ppa", "/tae"]

function nonceDeLaCsp(csp: string | undefined): string {
  return /\bnonce-([A-Za-z0-9+/=]+)/.exec(csp ?? "")?.[1] ?? ""
}

test.describe("CSP con nonce — hidratación del HTML servido", () => {
  for (const ruta of RUTAS_PUBLICAS) {
    test(`${ruta} sirve sus scripts inline con el nonce de la CSP`, async ({ page }) => {
      const response = await page.request.get(ruta)
      expect(response.status()).toBe(200)

      const nonce = nonceDeLaCsp(response.headers()["content-security-policy"])
      expect(nonce, "la respuesta no trae CSP con nonce: el invariante no se está verificando").not.toBe("")

      const inline = (await response.text()).match(/<script\b(?![^>]*\bsrc=)[^>]*>/gi) ?? []
      expect(inline.length, "sin scripts inline la aserción no verificaría nada").toBeGreaterThan(0)

      const sinNonce = inline.filter((tag) => !tag.includes(`nonce="${nonce}"`))
      expect(sinNonce, `scripts inline sin el nonce de la CSP: ${sinNonce.join(" | ")}`).toHaveLength(0)
    })
  }

  test("las rutas públicas hidratan sin errores de página", async ({ page }) => {
    const pageErrors: string[] = []
    page.on("pageerror", (error) => pageErrors.push(error.message))

    for (const ruta of ["/recuperar", "/ppa"]) {
      await page.goto(ruta, { waitUntil: "domcontentloaded" })
      await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined)
      expect(pageErrors, `${ruta} registró errores: ${pageErrors.join(" | ")}`).toHaveLength(0)
    }
  })

  test("/ppa no recibe desde el servidor el aviso de falta de conexión", async ({ page }) => {
    // El servidor no puede saber si el trabajador está en línea, así que no
    // puede ser quien decida el aviso: si lo renderiza, el cliente lo quita al
    // hidratar y React descarta el árbol completo (error #418).
    const response = await page.request.get("/ppa")
    expect(await response.text()).not.toContain("Sin conexión: tu PPA se guardará")
  })
})
