import { test, expect } from "@playwright/test"
import { expectPageTitle, login } from "./helpers"

/**
 * E2E: PDTP — Ciclo de vida del programa y flujo de aprobaciones.
 *
 * Covers:
 *   • Navegación al dashboard de aprobaciones (/prevencion/pdtp/aprobaciones)
 *   • Visualización de ejecuciones semanales pendientes de aprobación
 *   • Visualización de la tarjeta de estado de ciclo de vida del programa
 */
test.describe("PDTP — Ciclo de vida y aprobaciones", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("la página de aprobaciones PDTP carga correctamente el encabezado", async ({ page }) => {
    await page.goto("/prevencion/pdtp/aprobaciones")

    // Page Header
    await expect(page.getByRole("heading", { name: "Aprobaciones PDTP" })).toBeVisible()

    // Breadcrumbs
    // La reorganización del sidebar (4 grupos, renombres canónicos DS 44) dejó
    // la etiqueta en "Programa de trabajo": el grupo "Programa" ya da el
    // contexto y no necesita repetir la sigla.
    //
    // El sidebar (`aria-label="Navegación"`) tiene su propio ítem "Programa de
    // trabajo" además del breadcrumb (`aria-label="Navegación estructural"`):
    // un locator sin acotar resuelve a los dos y viola el modo estricto en
    // cuanto el sidebar hidrata, así que el resultado dependía de qué tan
    // rápido montara — a veces la aserción ya había pasado, a veces no.
    await expect(
      page.getByRole("navigation", { name: "Navegación estructural" }).getByRole("link", { name: "Programa de trabajo" }),
    ).toBeVisible()
  })

  test("la página de aprobaciones muestra la tabla o el estado sin pendientes", async ({ page }) => {
    await page.goto("/prevencion/pdtp/aprobaciones")
    // Que la página cargó se afirma aparte: sin esto, un /forbidden o un 500 se
    // leían igual que "no hay ni tabla ni vacío".
    await expectPageTitle(page, "Aprobaciones PDTP")

    /* `isVisible().catch(() => false)` sobre `getByRole("table")` se tragaba el
     * modo estricto: en la suite completa otros specs dejan aprobaciones
     * pendientes, la tabla se pinta con su cabecera fija —dos `<table>`— y la
     * violación de strict mode volvía como `false`, de modo que el caso fallaba
     * con "Received: false" sin decir que la tabla SÍ estaba.
     *
     * `.or()` afirma lo que el caso quiere —uno de los dos estados— y falla
     * mostrando cuál faltó. */
    const tabla = page.getByRole("table").first()
    const sinPendientes = page.getByText("Sin pendientes")
    await expect(tabla.or(sinPendientes).first()).toBeVisible({ timeout: 15_000 })
  })

  test("el detalle del programa muestra la tarjeta de estado del ciclo de vida", async ({ page }) => {
    await page.goto("/prevencion/pdtp/pdtp-prog-e2e")

    // Section title
    await expect(page.getByRole("heading", { name: "Estado del programa" })).toBeVisible()

    // Steps indicator
    await expect(page.getByText("Elaboración")).toBeVisible()
    await expect(page.getByText("Versión congelada")).toBeVisible()
  })

  test("el menú de acciones hidrata sin errores y se puede abrir", async ({ page }) => {
    const hydrationErrors: string[] = []
    page.on("console", (message) => {
      if (/hydration|server rendered html|did not match/i.test(message.text())) hydrationErrors.push(message.text())
    })
    page.on("pageerror", (error) => {
      if (/hydration|server rendered html|did not match/i.test(error.message)) hydrationErrors.push(error.message)
    })

    await page.goto("/prevencion/pdtp/pdtp-prog-e2e")
    await page.getByRole("button", { name: "Más acciones" }).click()
    // Task 1.7: el ítem único "Exportar programa" se separó en dos formatos
    // explícitos (RE-36 por defecto, planilla plana conservada).
    await expect(page.getByRole("menuitem", { name: "Exportar RE-36" })).toBeVisible()
    await expect(page.getByRole("menuitem", { name: "Exportar planilla plana" })).toBeVisible()
    expect(hydrationErrors).toEqual([])
  })

  // Usan pdtp-exec-approve-e2e (M7S2) / pdtp-exec-reject-e2e (M7S3), no
  // pdtp-exec-e2e (M7S1): ese lo consume el flujo de checklist de
  // e2e/pdtp-flow.spec.ts y aprobar/rechazarlo aquí lo dejaría en un estado
  // que rompería ese otro test según el orden de ejecución.
  test("aprobar una ejecución pendiente la remueve de la lista", async ({ page }) => {
    await page.goto("/prevencion/pdtp/aprobaciones")

    const approveButton = page.getByRole("button", { name: "Aprobar ejecución M7S2" })
    await expect(approveButton).toBeVisible()
    await approveButton.click()
    await expect(page.locator("[data-sonner-toast]").getByText(/aprobada/)).toBeVisible()

    // La aprobación es un form action (auto-refresca); recargar además
    // confirma que el cambio quedó persistido en el servidor.
    await page.reload()
    await expect(page.getByRole("button", { name: "Aprobar ejecución M7S2" })).toHaveCount(0)
  })

  test("rechazar una ejecución pendiente con motivo la remueve de la lista", async ({ page }) => {
    await page.goto("/prevencion/pdtp/aprobaciones")

    await page.getByRole("button", { name: "Rechazar ejecución M7S3" }).click()
    await expect(page.getByRole("dialog", { name: "Rechazar ejecución" })).toBeVisible()
    await page.getByPlaceholder("Motivo del rechazo (mín. 3 caracteres)").fill("Evidencia insuficiente E2E")
    await page.getByRole("button", { name: "Rechazar y devolver" }).click()
    await expect(page.locator("[data-sonner-toast]").getByText(/rechazada/)).toBeVisible()

    // El rechazo se dispara desde un onClick (no un form action), por lo que
    // no auto-refresca la lista SSR — recargar confirma el estado persistido.
    await page.reload()
    await expect(page.getByRole("button", { name: "Rechazar ejecución M7S3" })).toHaveCount(0)
  })
})
