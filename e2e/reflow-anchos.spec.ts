import { test, expect } from "@playwright/test"
import { login } from "./helpers"

/**
 * Reflow en los anchos que faltaban: 320, 768 y 1024 (TASK-UI-004 y 014).
 *
 * La auditoría certificó 1920 y 390 con el capturador —cero scroll horizontal—
 * y dejó pendientes los otros tres. No era una omisión menor: 320 es donde el
 * reflow falla primero, 768 es el ancho en el que las listas cambian de tarjeta
 * a tabla, y 1024 es el que decide si el panel lateral cabe. Ninguno se había
 * ejercitado nunca en ningún viewport de la suite.
 *
 * WCAG 1.4.10 exige contenido sin scroll horizontal a 320 px de ancho
 * equivalente; el resto de anchos hereda el mismo contrato.
 */
const ANCHOS = [
  { name: "320", width: 320, height: 568 },
  { name: "768", width: 768, height: 1024 },
  { name: "1024", width: 1024, height: 768 },
] as const

/** Las mismas superficies densas que ya vigila la prueba de zoom 200 %. */
const PANTALLAS = [
  { path: "/dashboard", name: "Dashboard" },
  { path: "/pendientes", name: "Mis pendientes" },
  { path: "/solicitudes", name: "Solicitudes" },
  { path: "/compras", name: "Compras" },
  { path: "/bodega", name: "Bodega" },
  { path: "/prevencion/capa", name: "CAPA" },
  { path: "/prevencion/pdtp", name: "PDTP Programas" },
  { path: "/admin/usuarios", name: "Usuarios" },
] as const

for (const ancho of ANCHOS) {
  test.describe(`Reflow ${ancho.name} px`, () => {
    test(`ninguna pantalla densa desborda a ${ancho.name} px`, async ({ page }) => {
      await page.setViewportSize({ width: ancho.width, height: ancho.height })
      await login(page)

      const desbordan: string[] = []
      for (const pantalla of PANTALLAS) {
        await page.goto(pantalla.path)
        await page.waitForLoadState("networkidle").catch(() => undefined)

        const overflow = await page.evaluate(() => {
          const doc = document.documentElement
          // +1 absorbe el redondeo subpíxel del propio navegador; por encima de
          // eso es desbordamiento real, no error de medición.
          return doc.scrollWidth - doc.clientWidth
        })
        if (overflow > 1) desbordan.push(`${pantalla.name}: ${overflow}px`)
      }

      expect(desbordan).toEqual([])
    })
  })
}

test.describe("Reflow 320 px — la tarea sigue alcanzable", () => {
  test("el contenido principal y la navegación existen en el ancho mínimo", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 })
    await login(page)
    await page.goto("/dashboard")
    await page.waitForLoadState("networkidle").catch(() => undefined)

    // No basta con que no haya scroll: a 320 px la pantalla podía quedarse sin
    // acceso a los módulos, que es el criterio explícito de TASK-UI-005.
    await expect(page.locator("main")).toBeVisible()
    await expect(page.getByRole("button", { name: "Abrir menú" })).toBeVisible()
  })
})

/**
 * Teclado y foco visible en los anchos nuevos (TASK-UI-004 y 014).
 *
 * El reflow ya estaba certificado en cinco anchos, pero el criterio pide
 * además "teclado/zoom 200 % sin pérdida" y "foco no oculto". Eso sólo se
 * comprobaba a 960 px (zoom 200 %), donde el panel lateral aún cabe. A 320 y
 * 768 la navegación cambia de forma —rail, sheet, tarjetas en vez de tabla— y
 * es justo donde un foco puede quedar debajo de una cabecera pegajosa o dentro
 * de un contenedor con `overflow:hidden`.
 */
for (const ancho of ANCHOS) {
  test(`el foco es visible y alcanzable recorriendo con Tab a ${ancho.name} px`, async ({ page }) => {
    await page.setViewportSize({ width: ancho.width, height: ancho.height })
    await login(page)
    await page.goto("/pendientes")
    await page.waitForLoadState("networkidle").catch(() => undefined)

    const invisibles: string[] = []
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press("Tab")
      const foco = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null
        if (!el || el === document.body) return null
        const rect = el.getBoundingClientRect()
        const estilo = getComputedStyle(el)
        return {
          nombre: el.getAttribute("aria-label") || el.textContent?.trim().slice(0, 40) || el.tagName,
          // Un elemento enfocado que no ocupa área, o que quedó fuera de la
          // ventana, es un salto que el usuario no puede seguir.
          sinArea: rect.width === 0 || rect.height === 0,
          fueraDeVista: rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth,
          invisible: estilo.visibility === "hidden" || estilo.display === "none",
        }
      })
      if (!foco) continue
      // El *skip link* es invisible hasta recibir foco por diseño; para cuando
      // se mide ya lo tiene, así que no necesita excepción.
      if (foco.sinArea || foco.invisible || foco.fueraDeVista) {
        invisibles.push(`${foco.nombre} (${foco.sinArea ? "sin área" : foco.invisible ? "oculto" : "fuera de vista"})`)
      }
    }

    expect(invisibles).toEqual([])
  })
}
