import { expect, test, type Page } from "@playwright/test"
import { login, setPdtpResponsable } from "./helpers"

/**
 * E2E: PDTP — Ciclo de vida de aprobación del programa (borrador → en
 * revisión → activo, y los caminos de rechazo/reapertura/archivado).
 *
 * El paso JDPR no puede resolverlo quien elaboró el programa (regla de
 * segregación "not_elaborator") y el paso Legal debe resolverlo alguien
 * distinto de quien resolvió JDPR ("different_from_previous") — ver
 * lib/services/pdtp/approval-flow.ts. Por eso estos tests usan dos
 * usuarios/dos contextos de navegador: admin@e2e.chome.cl (elabora + firma
 * Legal) y comprador@e2e.chome.cl (aprueba/rechaza JDPR).
 *
 * Cada test crea un programa nuevo vía UI (no reutiliza el fixture
 * compartido pdtp-prog-e2e, que ya está "active") para poder recorrer la
 * transición completa desde "draft".
 */

async function createDraftProgramWithActivity(page: Page, title: string): Promise<string> {
  await page.goto("/prevencion/pdtp/nuevo")
  await page.getByLabel("Título del programa").fill(title)
  await page.getByRole("button", { name: "Crear programa" }).click()
  await expect(page).toHaveURL(/\/prevencion\/pdtp\/[^/]+\/editar/, { timeout: 15_000 })
  const programId = new URL(page.url()).pathname.split("/")[3]!

  // Lo mínimo para poder enviar a revisión: al menos una actividad, con
  // clasificación temporal resuelta (el modo por defecto "Con frecuencia" ya
  // la deja "confirmed", sin pasar por las validaciones extra de actividades
  // a demanda/evento).
  await page.getByRole("tab", { name: /Actividades/ }).click()
  await page.getByLabel("Nombre del nuevo objetivo").fill(`Objetivo ${title}`)
  await page.getByLabel("¿Qué actividad preventiva se realizará?").fill(`Actividad preventiva de ${title}`)
  await setPdtpResponsable(page)
  await page.getByRole("button", { name: "Guardar actividad" }).click()
  // No se espera el toast "Actividad guardada.": el submit exitoso dispara
  // router.refresh(), que a veces remonta las tabs antes de que Playwright
  // llegue a leer el mensaje transitorio (vuelve a "Datos básicos" con el
  // guardado ya persistido). El contador de actividades de la cabecera sí
  // es estable porque viene de datos de servidor, no de estado transitorio.
  await expect(page.getByText(/1 actividad\(es\)/)).toBeVisible({ timeout: 15_000 })

  await page.goto(`/prevencion/pdtp/${programId}`)
  return programId
}

const lifecycle = (page: Page) => page.getByRole("region", { name: "Estado del programa" })

async function submitForReview(page: Page) {
  await lifecycle(page).getByRole("button", { name: "Enviar a revisión" }).click()
  await page.getByRole("dialog").getByRole("button", { name: "Enviar a revisión" }).click()
  await expect(lifecycle(page).getByText("En revisión", { exact: true })).toBeVisible()
}

async function rejectPendingStep(page: Page, reason: string) {
  await lifecycle(page).getByRole("button", { name: "Rechazar versión" }).click()
  await page.getByRole("dialog").getByLabel("Motivo").fill(reason)
  await page.getByRole("dialog").getByRole("button", { name: "Rechazar versión" }).click()
  await expect(lifecycle(page).getByText("Rechazado", { exact: true })).toBeVisible()
}

test.describe("PDTP — Ciclo de vida de aprobación del programa", () => {
  test("enviar a revisión, aprobar JDPR y Legal activa la versión", async ({ page, browser }) => {
    await login(page)
    const programId = await createDraftProgramWithActivity(page, "Programa Lifecycle E2E Activar")

    await submitForReview(page)

    // Segundo usuario/contexto: aprueba JDPR (no puede ser quien elaboró el programa).
    const context2 = await browser.newContext()
    const page2 = await context2.newPage()
    await login(page2, "comprador@e2e.chome.cl")
    await page2.goto(`/prevencion/pdtp/${programId}`)
    await lifecycle(page2).getByRole("button", { name: "Aprobar: Revisión técnica JDPR" }).click()
    await expect(lifecycle(page2).getByText("Aprobada").first()).toBeVisible()
    await context2.close()

    // El admin firma Legal (distinto de quien aprobó JDPR) — la activación es automática.
    await page.reload()
    await lifecycle(page).getByRole("button", { name: "Aprobar: Aprobación Legal y RRHH" }).click()
    await expect(lifecycle(page).getByText("Activo", { exact: true })).toBeVisible()
  })

  test("rechazar el paso JDPR y reabrir como nueva versión", async ({ page, browser }) => {
    await login(page)
    const programId = await createDraftProgramWithActivity(page, "Programa Lifecycle E2E Reabrir")

    await submitForReview(page)

    const context2 = await browser.newContext()
    const page2 = await context2.newPage()
    await login(page2, "comprador@e2e.chome.cl")
    await page2.goto(`/prevencion/pdtp/${programId}`)
    await rejectPendingStep(page2, "Falta evidencia mínima definida para la actividad de prueba E2E.")
    await context2.close()

    await page.reload()
    await expect(lifecycle(page).getByText("Rechazado", { exact: true })).toBeVisible()
    await lifecycle(page).getByRole("button", { name: "Reabrir versión" }).click()
    await page.getByRole("dialog").getByLabel("Motivo").fill("Se corrige la evidencia y se reabre para una nueva revisión E2E.")
    await page.getByRole("dialog").getByRole("button", { name: "Reabrir versión" }).click()
    await expect(lifecycle(page).getByText("Borrador", { exact: true })).toBeVisible()
  })

  test("archivar una versión rechazada", async ({ page, browser }) => {
    await login(page)
    const programId = await createDraftProgramWithActivity(page, "Programa Lifecycle E2E Archivar")

    await submitForReview(page)

    const context2 = await browser.newContext()
    const page2 = await context2.newPage()
    await login(page2, "comprador@e2e.chome.cl")
    await page2.goto(`/prevencion/pdtp/${programId}`)
    await rejectPendingStep(page2, "Rechazo para probar el archivado de la versión E2E.")
    await context2.close()

    await page.reload()
    await lifecycle(page).getByRole("button", { name: "Archivar versión" }).click()
    await page.getByRole("dialog").getByLabel("Motivo").fill("Se archiva la versión rechazada; no se continuará con ella.")
    await page.getByRole("dialog").getByRole("button", { name: "Archivar versión" }).click()
    await expect(lifecycle(page).getByText("Archivado", { exact: true })).toBeVisible()
  })
})
