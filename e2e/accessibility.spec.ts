import { test, expect, type Page } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"
import { login } from "./helpers"
import { accessibilityTargets, AXE_DISABLED_RULES, AXE_TAGS } from "./accessibility-targets"
import { cabecera, irAPaso, type PasoDelRiesgo } from "./miper-helpers"

/*
 * UX-001 y UX-002 (auditoría 2026-09-14).
 *
 * Antes: una lista `CRITICAL_PAGES` escrita a mano con ~20 rutas sobre 207, y
 * `.disableRules(["color-contrast"])` en las dos suites. Es decir, la
 * auditoría automática dejaba fuera módulos completos —combustibles, flota,
 * mantenciones, facturación, TI, recepción, trazabilidad— y renunciaba al
 * único criterio que más se rompe al cambiar estilos.
 *
 * Ahora el alcance sale del inventario de rutas (el mismo que alimenta las
 * capturas) y las reglas activas están declaradas en un módulo que se verifica
 * sin navegador, en `accessibility-targets.test.ts`.
 */
const targets = accessibilityTargets()

/** `incluir` acota la auditoría a una región (un selector CSS de axe, no un localizador de Playwright). */
async function auditar(page: Page, incluir?: string) {
  const builder = new AxeBuilder({ page })
    .withTags([...AXE_TAGS])
    .disableRules([...AXE_DISABLED_RULES])
  const results = await (incluir ? builder.include(incluir) : builder).analyze()

  expect(results.violations).toEqual([])
}

test.describe("Accessibility audit", () => {
  for (const { path, name, auth } of targets) {
    test(`${name} (${path})`, async ({ page }) => {
      if (auth) await login(page)
      await page.goto(path)

      await page.waitForLoadState("networkidle")

      await auditar(page)
    })
  }
})

/*
 * MIPER (A2, fila 17). El espacio de trabajo es una sola ruta dinámica con
 * cuatro vistas que viven en la URL: estructura, tarea (`?tarea=`), editor
 * (`?fila=&paso=`) y ficha (`?ficha=1`). El recorrido de arriba sólo visita la
 * estructura (`ROUTE_URL_OVERRIDES`); aquí se llega a las demás por la UI,
 * como una persona, sobre la MIPER vigente sembrada (`e2e/setup-db.ts`).
 */
const MIPER_VIGENTE = "/prevencion/miper/riskmatrix-controles-e2e"
const PELIGRO_SEMBRADO = "Atrapamiento en correa transportadora E2E"
const PASOS: PasoDelRiesgo[] = ["Identificación", "Evaluación", "Medidas de control", "Seguimiento"]

/**
 * Espera a que terminen las animaciones finitas (entrada del `Sheet`, fundido
 * del panel de la pestaña): axe mediría el contraste a medio fundido. Las
 * infinitas (spinners, esqueletos) se ignoran.
 */
async function sinAnimaciones(page: Page) {
  await page.evaluate(() => Promise.all(document.getAnimations()
    .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
    .map((animation) => animation.finished.catch(() => undefined))))
}

test.describe("Accessibility audit — MIPER: vistas del espacio de trabajo", () => {
  test("tarea, los cuatro pasos del editor y la ficha del documento", async ({ page }) => {
    await login(page)
    await page.goto(MIPER_VIGENTE)
    await page.waitForLoadState("networkidle")

    // El riesgo sembrado no trae actividad ni tarea: vive en «Sin actividad › Sin tarea».
    await page.getByRole("link", { name: /^Sin tarea/ }).click()
    await expect(page.getByRole("heading", { level: 2, name: "Sin tarea" })).toBeVisible()
    await sinAnimaciones(page)
    await auditar(page)

    await page.getByRole("link", { name: `Riesgo #1: ${PELIGRO_SEMBRADO}`, exact: true }).click()
    await expect(page.getByRole("heading", { level: 2, name: PELIGRO_SEMBRADO })).toBeVisible()
    for (const paso of PASOS) {
      await irAPaso(page, paso)
      await sinAnimaciones(page)
      await auditar(page)
    }

    await cabecera(page).getByRole("button", { name: "Ficha del documento", exact: true }).click()
    await expect(page.getByRole("dialog", { name: "Ficha del documento" })).toBeVisible()
    await sinAnimaciones(page)
    await auditar(page)
  })

  test("la pestaña Resumen y el menú «Cambiar de faena» (Fase B)", async ({ page }) => {
    await login(page)
    await page.goto(MIPER_VIGENTE)
    await page.waitForLoadState("networkidle")

    await page.getByRole("tab", { name: "Resumen", exact: true }).click()
    await expect(page.getByRole("link", { name: /^Riesgos completos/ })).toBeVisible()
    await sinAnimaciones(page)
    await auditar(page)

    // La lista se pide al abrir el menú: se espera a que llegue antes de auditar.
    await cabecera(page).getByRole("button", { name: "Cambiar de faena", exact: true }).click()
    await expect(page.getByRole("menuitem", { name: "Ver todas las faenas", exact: true })).toBeVisible()
    await expect(page.getByRole("menuitem", { name: /^Faena / })).not.toHaveCount(0)
    await sinAnimaciones(page)
    // Se audita el menú, no la página de fondo, que ya se auditó arriba con el menú cerrado.
    // El `DropdownMenu` de Radix es modal: al abrirse pone `aria-hidden` en todo lo demás
    // (`hideOthers`), atrapa el foco y anula Tab, así que nada oculto puede recibir foco. Axe
    // no lo sabe: sólo lo exime con un diálogo abierto (`isModalOpen` busca `role=dialog`; por
    // eso la «Ficha del documento» pasa entera) y marca `aria-hidden-focus` en la raíz del
    // shell. Le pasa a todo menú desplegable modal de la plataforma, no sólo a éste.
    await auditar(page, '[role="menu"]')
  })
})
