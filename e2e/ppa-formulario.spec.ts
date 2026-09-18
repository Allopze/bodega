/**
 * E2E: PPA Digital — el formulario, sin fontanería offline.
 *
 * Estos escenarios estaban dentro de `ppa-offline.spec.ts` y arrastraban su
 * destino: ese archivo prueba Service Worker, IndexedDB y permisos de
 * notificación con APIs que sólo Chromium expone, así que quedó fuera del
 * alcance móvil entero — y con él, la verificación de RUT y la progresión por
 * pasos, que son **el formulario** y sí funcionan en Safari.
 *
 * Separarlos no es orden por el orden: es lo que permite certificar en WebKit
 * lo que se puede certificar, en vez de dar por no probado un flujo de terreno
 * porque comparte archivo con pruebas de plumbing.
 */
import { expect, test } from "@playwright/test"
import { continuePpaStep } from "./helpers"

test.describe("PPA Digital — verificación de RUT", () => {
  test("RUT inválido muestra error de formato", async ({ page }) => {
    await page.goto("/ppa")
    await expect(page.locator("#rutSearch")).toBeVisible({ timeout: 15_000 })

    // Enter an invalid RUT (letters instead of digits)
    await page.locator("#rutSearch").fill("abc-def")
    await page.getByRole("button", { name: "Verificar" }).click()

    // Should show format error toast
    await expect(
      page.getByText(/RUT inválido|formato/),
    ).toBeVisible({ timeout: 10_000 })

    // Worker should NOT be verified
    await expect(page.getByText(/Verificado:/)).not.toBeVisible()
  })

  /*
   * PPA-002 (auditoría 2026-09-14): el aviso ya NO dice "no se encontró ningún
   * trabajador". Responder distinto según el RUT exista convertía el formulario
   * público en un oráculo de pertenencia a la faena, así que acierto y fallo
   * comparten un solo mensaje —y la misma cuota y el mismo piso de latencia—.
   * Este spec pedía el texto viejo: exigirlo de vuelta sería consagrar el
   * defecto, así que lo que se verifica es el mensaje uniforme.
   */
  test("un RUT ausente responde con el aviso uniforme, sin confirmar si existe", async ({ page }) => {
    await page.goto("/ppa")
    await expect(page.locator("#rutSearch")).toBeVisible({ timeout: 15_000 })

    // Enter a valid-format RUT that doesn't exist in the DB
    await page.locator("#rutSearch").fill("99999999-9")
    await page.getByRole("button", { name: "Verificar" }).click()

    await expect(
      page.getByText(/No pudimos identificarte automáticamente/i),
    ).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(/ningún trabajador/i)).toHaveCount(0)

    // Worker should NOT be verified
    await expect(page.getByText(/Verificado:/)).not.toBeVisible()
  })

  test("RUT vacío mantiene botón deshabilitado", async ({ page }) => {
    await page.goto("/ppa")
    await expect(page.locator("#rutSearch")).toBeVisible({ timeout: 15_000 })

    // Verify button is disabled when RUT is empty
    const verifyBtn = page.getByRole("button", { name: "Verificar" })
    await expect(verifyBtn).toBeDisabled()

    // Fill and clear — button should re-disable
    await page.locator("#rutSearch").fill("12345678-9")
    await expect(verifyBtn).not.toBeDisabled()
    await page.locator("#rutSearch").fill("")
    await expect(verifyBtn).toBeDisabled()
  })

  test("verificar con RUT exitoso muestra trabajador verificado", async ({ page }) => {
    await page.goto("/ppa")
    await expect(page.locator("#rutSearch")).toBeVisible({ timeout: 15_000 })

    // Enter the E2E worker RUT
    await page.locator("#rutSearch").fill("11111111-1")
    await page.getByRole("button", { name: "Verificar" }).click()

    // findWorkerByRutAction minimiza PII en la respuesta pública: el nombre
    // llega enmascarado (primer nombre + inicial apellido) y worksiteName
    // vacío. En el flujo !manual (este test) no hay ningún <select> de faena
    // visible en absoluto — solo aparece en modo manual (identificación
    // manual) — así que el nombre de faena no puede verificarse visualmente
    // aquí; worksiteId sí se propaga internamente para el submit.
    await expect(page.getByText(/Verificado:/)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/Trabajador E\./)).toBeVisible()
  })

  /**
   * El formulario dejó de ser una sola pantalla en la pasada 24: ya no se puede
   * llegar al envío con un campo obligatorio vacío, porque cada paso valida
   * antes de dejar avanzar. El contrato que corresponde comprobar hoy es ese —
   * el paso retiene, nombra lo que falta y lleva el foco al control.
   */
  test("un paso no avanza con un campo obligatorio vacío y lleva el foco al control", async ({ page }) => {
    await page.goto("/ppa")
    await expect(page.locator("#rutSearch")).toBeVisible({ timeout: 15_000 })

    await page.locator("#rutSearch").fill("11111111-1")
    await page.getByRole("button", { name: "Verificar" }).click()
    await expect(page.getByText(/Verificado:/)).toBeVisible({ timeout: 15_000 })

    // Sin elegir el trabajo, el paso no debe avanzar.
    await continuePpaStep(page)

    await expect(page.getByText("Selecciona el trabajo que vas a realizar.")).toBeVisible({ timeout: 10_000 })
    await expect(page.locator("#tipo")).toBeFocused()
    // El paso 2 no llegó a montarse.
    await expect(page.getByTestId("cambio-no")).toHaveCount(0)
    await expect(page).toHaveURL(/\/ppa$/)
  })
})
