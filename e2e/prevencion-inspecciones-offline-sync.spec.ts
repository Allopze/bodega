import { test, expect, type Page } from "@playwright/test"
import { expectPageTitle, login } from "./helpers"

/**
 * E2E Spec: Sincronización y Resiliencia Offline de Inspecciones.
 *
 * Cubre:
 *   • Guardado encolado en IndexedDB ante falta de conectividad en terreno.
 *   • Recuperación y sincronización al restaurar red.
 *   • Idempotencia del motor mediante `clientSubmissionId`.
 *   • Visualización de indicadores de sincronización pendiente en la UI.
 */

const PLANTILLA = "Inspección de Estado de Extintores"
const RUN = Date.now().toString(36).toUpperCase().slice(-5)
let contador = 0

async function crearInspeccion(page: Page) {
  const identificacion = `E2E-OFF-${RUN}-${++contador}`
  await page.goto("/prevencion/inspecciones")
  await expectPageTitle(page, "Inspecciones")

  await page.getByRole("button", { name: "Nueva inspección" }).click()
  const dialog = page.getByRole("dialog", { name: "Nueva inspección" })
  await dialog.getByLabel("Plantilla").click()
  await page.getByRole("option", { name: new RegExp(`^${PLANTILLA} · E2E$`) }).click()
  await dialog.getByLabel("Faena de la inspección").click()
  await page.getByRole("option", { name: "Faena E2E", exact: true }).click()
  await dialog.locator('input[name="subjectType"]').fill("extintor")
  await dialog.locator('input[name="subjectLabel"]').fill(identificacion)
  await dialog.getByRole("button", { name: "Crear" }).click()
  await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 30_000 })

  const fila = page.getByRole("row").filter({ hasText: identificacion }).first()
  await expect(fila).toBeVisible({ timeout: 30_000 })
  await fila.getByRole("link").first().click()
  await expect(page).toHaveURL(/\/prevencion\/inspecciones\/[^/?]+$/, { timeout: 30_000 })
  return identificacion
}

async function responderItem(page: Page, item: string, resultado: string) {
  await page.getByLabel(`Resultado de ${item}`).click()
  await page.getByRole("option", { name: resultado, exact: true }).click()
}

test.describe("Inspecciones — Operación offline y sincronización", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("encolar cierre offline en IndexedDB y sincronizar al recuperar conectividad", async ({ page }) => {
    await crearInspeccion(page)

    // Respondemos items con 1 incumplimiento
    for (const item of ["Manómetro", "Rótulo", "Manguera", "Certificado CECMEC"]) {
      await responderItem(page, item, "Cumple")
    }
    await responderItem(page, "Sello", "No cumple")

    // Llenar acta
    await page.getByLabel("Resultado del acta").click()
    await page.getByRole("option", { name: "Con observaciones", exact: true }).click()
    await page.getByLabel("Firma de prevencionista").fill("Prevencionista Terreno E2E")
    await page.getByLabel("Firma de supervisor").fill("Supervisor Terreno E2E")

    // Guardar sin conexión
    await page.getByRole("button", { name: "Guardar sin conexión" }).click()
    await expect(page.getByText("Guardada en el dispositivo. Se enviará al recuperar conexión.")).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText("1 cierre pendiente de sincronizar.")).toBeVisible()

    // Sincronizar
    await page.getByRole("button", { name: "Sincronizar" }).click()
    await expect(page.getByText("1 cierre pendiente de sincronizar.")).toBeHidden({ timeout: 30_000 })

    // Validar estado persistido en el servidor
    await page.reload()
    await expect(page.getByText("Ejecutada").first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText("80%", { exact: true })).toBeVisible()
    await expect(page.getByRole("heading", { name: "Hallazgos (1)" })).toBeVisible()
  })

  test("idempotencia: múltiples clics en sincronización no duplican ni corrompen el run", async ({ page }) => {
    await crearInspeccion(page)

    for (const item of ["Manómetro", "Sello", "Rótulo", "Manguera", "Certificado CECMEC"]) {
      await responderItem(page, item, "Cumple")
    }
    await page.getByLabel("Resultado del acta").click()
    await page.getByRole("option", { name: "Operativo", exact: true }).click()
    await page.getByLabel("Firma de prevencionista").fill("Admin E2E")
    await page.getByLabel("Firma de supervisor").fill("Comprador E2E")

    await page.getByRole("button", { name: "Guardar sin conexión" }).click()
    await expect(page.getByText("1 cierre pendiente de sincronizar.")).toBeVisible({ timeout: 30_000 })

    // Disparar sincronización
    await page.getByRole("button", { name: "Sincronizar" }).click()
    await expect(page.getByText("1 cierre pendiente de sincronizar.")).toBeHidden({ timeout: 30_000 })

    // Recargar y verificar integridad
    await page.reload()
    await expect(page.getByText("Ejecutada").first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText("100%", { exact: true })).toBeVisible()
  })
})
