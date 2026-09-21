import { test, expect } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"
import { login } from "./helpers"

/**
 * El shell expone un `banner` de primer nivel.
 *
 * Hasta el 2026-09-21 la aplicación no tenía ningún landmark de cabecera: la
 * `TopBar` se montaba dentro de `<main id="main-content">`, y un `<header>`
 * descendiente de `main` pierde la correspondencia implícita con `banner`. Quien
 * navega por landmarks obtenía sólo `navigation` y `main`, y todo el cromo
 * global —buscador, notificaciones, menú de usuario, faena— quedaba dentro del
 * landmark del contenido de la página.
 *
 * ## Por qué `withRules` y no los tags de la suite
 *
 * Las reglas de landmark de axe son tag `best-practice`, y `AXE_TAGS`
 * (`e2e/accessibility-targets.ts`) sólo lleva tags WCAG —un contrato que
 * `e2e/accessibility-targets.test.ts` congela a propósito—. Añadir
 * `best-practice` ahí encendería decenas de reglas sobre las ~207 rutas del
 * inventario: sería un cambio de alcance de auditoría disfrazado de guarda.
 * `withRules` sustituye la selección de reglas SÓLO en esta ejecución, así que
 * la red nueva es exactamente del tamaño del cambio y el contrato queda intacto.
 *
 * `region` queda fuera a propósito: exige que TODO el contenido viva dentro de
 * un landmark, y fuera quedan el propio skip link, el portal del toaster y la
 * paleta de comandos. Meterla convertiría esto en una discusión de tres
 * componentes ajenos, y es trabajo aparte.
 *
 * ## Por qué tres rutas y no el inventario
 *
 * La estructura de landmarks la produce el shell y es idéntica en todas las
 * rutas autenticadas. Correr axe 207 veces no aporta información y sí minutos.
 */
const REGLAS_DE_LANDMARK = [
  "landmark-one-main",
  "landmark-banner-is-top-level",
  "landmark-no-duplicate-banner",
  "landmark-no-duplicate-main",
  "landmark-unique",
]

const RUTAS = [
  { path: "/dashboard", name: "Inicio (ruta canónica, con buscador de shell)" },
  { path: "/prevencion/inspecciones", name: "Inspecciones (acciones en la TopBar, sin buscador de shell)" },
  // `FORM_ROUTE` en `top-bar.tsx`: la cabecera esconde el buscador, así que es
  // el caso en que el contenido del `banner` más cambia.
  { path: "/soporte/nuevo", name: "Nuevo ticket (formulario: la TopBar esconde el buscador)" },
] as const

test.describe("Shell — landmarks", () => {
  for (const ruta of RUTAS) {
    test(`${ruta.name} expone un banner de primer nivel`, async ({ page }) => {
      await login(page)
      await page.goto(ruta.path)
      await expect(page.getByRole("banner")).toBeVisible({ timeout: 30_000 })
      await page.waitForLoadState("networkidle").catch(() => undefined)

      // La aserción directa del defecto que se arregló, sin depender de axe.
      const bannerFueraDeMain = await page.evaluate(() => {
        const header = document.querySelector("header")
        return Boolean(header) && header!.closest("main") === null
      })
      expect(bannerFueraDeMain, "el <header> volvió a quedar dentro de <main>").toBe(true)

      const resultados = await new AxeBuilder({ page }).withRules(REGLAS_DE_LANDMARK).analyze()
      expect(resultados.violations).toEqual([])
    })
  }

  test("el cromo global vive en el banner, no en el landmark del contenido", async ({ page }) => {
    await login(page)
    await page.goto("/dashboard")
    const banner = page.getByRole("banner")
    await expect(banner).toBeVisible({ timeout: 30_000 })

    // El buscador del shell es el cromo más visible: si aparece dentro de
    // `main`, la TopBar volvió a estar donde estaba.
    await expect(banner.getByRole("searchbox")).toBeVisible()
    await expect(page.getByRole("main").getByRole("searchbox")).toHaveCount(0)
  })

  test("abrir el cajón en móvil no anida ni duplica landmarks", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 })
    await login(page)
    await page.goto("/dashboard")
    await expect(page.getByRole("banner")).toBeVisible({ timeout: 30_000 })

    await page.getByRole("button", { name: "Abrir menú", exact: true }).click()
    // El cajón es hermano del pozo y `fixed`: no debe introducir una segunda
    // cabecera ni meter el banner dentro de otro landmark.
    const resultados = await new AxeBuilder({ page }).withRules(REGLAS_DE_LANDMARK).analyze()
    expect(resultados.violations).toEqual([])
    await expect(page.getByRole("banner")).toHaveCount(1)
  })
})
