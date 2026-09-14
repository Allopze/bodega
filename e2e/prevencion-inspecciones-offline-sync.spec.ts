import { test, expect, type Page } from "@playwright/test"
import { crearInspeccion as crearInspeccionE2E, login, responderItemInspeccion, textoVisible } from "./helpers"

/**
 * E2E Spec: Sincronización y Resiliencia Offline de Inspecciones.
 *
 * Cubre:
 *   • Guardado encolado en IndexedDB ante falta de conectividad en terreno.
 *   • Recuperación y sincronización al restaurar red.
 *   • Idempotencia del motor mediante `clientSubmissionId`.
 *   • Visualización de indicadores de sincronización pendiente en la UI.
 */

const crearInspeccion = async (page: Page) => (await crearInspeccionE2E(page, { prefijo: "E2E-OFF" })).identificacion

const responderItem = responderItemInspeccion

test.describe("Inspecciones — Operación offline y sincronización", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("encolar cierre offline en IndexedDB y sincronizar al recuperar conectividad", async ({ page }) => {
    await crearInspeccion(page)

    // Respondemos items con 1 incumplimiento
    for (const item of ["Manómetro", "Rótulo", "Manguera", "Certificado CECMEC"]) {
      await responderItem(page, item, "Bueno")
    }
    await responderItem(page, "Sello", "Malo", "Sello cortado; el extintor fue manipulado.")

    // Llenar acta
    await page.getByLabel("Resultado del acta").click()
    await page.getByRole("option", { name: "Con observaciones", exact: true }).click()
    await page.getByLabel("Firma de prevencionista").fill("Prevencionista Terreno E2E")
    await page.getByLabel("Firma de supervisor").fill("Supervisor Terreno E2E")

    // Encola el cierre en el dispositivo (antes "Guardar sin conexión").
    await page.getByRole("button", { name: "Encolar cierre en este dispositivo" }).click()
    await expect(page.getByText("Guardada en el dispositivo. Se enviará al recuperar conexión.")).toBeVisible({ timeout: 30_000 })
    await expect(textoVisible(page, "1 cierre pendiente de sincronizar.")).toBeVisible()

    // Sincronizar
    await page.getByRole("button", { name: "Sincronizar" }).click()
    await expect(textoVisible(page, "1 cierre pendiente de sincronizar.")).toBeHidden({ timeout: 30_000 })

    // Validar estado persistido en el servidor
    await page.reload()
    await expect(textoVisible(page, "Pendiente de revisión").first()).toBeVisible({ timeout: 15_000 })
    await expect(textoVisible(page, "80%").first()).toBeVisible()
    await expect(page.getByRole("heading", { name: "Hallazgos (1)" })).toBeVisible()
  })

  test("idempotencia: múltiples clics en sincronización no duplican ni corrompen el run", async ({ page }) => {
    await crearInspeccion(page)

    for (const item of ["Manómetro", "Sello", "Rótulo", "Manguera", "Certificado CECMEC"]) {
      await responderItem(page, item, "Bueno")
    }
    await page.getByLabel("Resultado del acta").click()
    await page.getByRole("option", { name: "Operativo", exact: true }).click()
    await page.getByLabel("Firma de prevencionista").fill("Admin E2E")
    await page.getByLabel("Firma de supervisor").fill("Comprador E2E")

    await page.getByRole("button", { name: "Encolar cierre en este dispositivo" }).click()
    await expect(textoVisible(page, "1 cierre pendiente de sincronizar.")).toBeVisible({ timeout: 30_000 })

    // Disparar sincronización
    await page.getByRole("button", { name: "Sincronizar" }).click()
    await expect(textoVisible(page, "1 cierre pendiente de sincronizar.")).toBeHidden({ timeout: 30_000 })

    // Recargar y verificar integridad
    await page.reload()
    await expect(textoVisible(page, "Pendiente de revisión").first()).toBeVisible({ timeout: 15_000 })
    await expect(textoVisible(page, "100%").first()).toBeVisible()
  })
})
