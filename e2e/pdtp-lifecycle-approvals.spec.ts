import { test, expect } from "@playwright/test"
import { login } from "./helpers"

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
    await expect(page.getByRole("link", { name: "Programa de trabajo" })).toBeVisible()
  })

  test("la página de aprobaciones muestra la tabla o el estado sin pendientes", async ({ page }) => {
    await page.goto("/prevencion/pdtp/aprobaciones")

    // Verifica que exista o la tabla de aprobaciones o el mensaje sin pendientes
    const hasTable = await page.getByRole("table").isVisible().catch(() => false)
    const hasEmptyState = await page.getByText("Sin pendientes").isVisible().catch(() => false)

    expect(hasTable || hasEmptyState).toBeTruthy()
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
    await expect(page.getByRole("menuitem", { name: "Exportar programa" })).toBeVisible()
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
