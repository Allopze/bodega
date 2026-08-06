import { test, expect } from "@playwright/test"
import { login } from "./helpers"

/**
 * E2E: PDTP — Programa de Trabajo Preventivo SG-SST.
 *
 * Cubre el creador anual idempotente y el editor reducido a tres áreas.
 */
test.describe("PDTP — Creación y edición de programas", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("la página de creación muestra solo año y resumen de la Base 2026", async ({ page }) => {
    await page.goto("/prevencion/pdtp/nuevo")

    await expect(page.getByRole("heading", { name: "Nuevo programa preventivo" })).toBeVisible()
    await expect(page.getByLabel("Año del programa")).toBeVisible()
    // La descripción vive en el PageHeader y se repite como eco visual en la
    // barra superior; el contrato es el bloque semántico.
    await expect(page.getByText("Base preventiva 2026").first()).toBeVisible()
    await expect(page.getByLabel("Título del programa")).toHaveCount(0)
    await expect(page.getByText(/programa anterior|crear en blanco/i)).toHaveCount(0)
  })

  test("si el año ya existe lo abre sin duplicarlo", async ({ page }) => {
    await page.goto("/prevencion/pdtp/nuevo")
    // El rótulo del botón ("Crear" vs "Abrir") lo decide el cliente al detectar
    // que el año ya existe, o sea que depende del `onChange` de React: si el
    // `fill` llega antes de hidratar, el valor queda en el DOM pero el handler
    // nunca corre y el botón se queda en "Crear" para siempre. Se reintenta el
    // fill —idempotente— hasta que el cliente reacciona.
    await expect.poll(async () => {
      await page.getByLabel("Año del programa").fill("2027")
      return page.getByRole("button", { name: "Abrir programa anual" }).count()
    }, { timeout: 15_000 }).toBeGreaterThan(0)
    await page.getByRole("button", { name: "Abrir programa anual" }).click()
    await expect(page).toHaveURL(/\/prevencion\/pdtp\/pdtp-draft-e2e\/editar/, { timeout: 15_000 })
  })

  test("el editor muestra únicamente Actividades, Ajustes por faena y Revisión", async ({ page }) => {
    await page.goto("/prevencion/pdtp/pdtp-draft-e2e/editar")
    await expect(page.getByRole("tab", { name: /Actividades/ })).toBeVisible()
    await expect(page.getByRole("tab", { name: /Ajustes por faena/ })).toBeVisible()
    await expect(page.getByRole("tab", { name: /Revisión/ })).toBeVisible()
    await expect(page.getByRole("tab")).toHaveCount(3)
  })
})

/**
 * E2E: PDTP — flujo checklist → plan de acción (Gap 5 del checklist de
 * seguimiento). Usa el fixture sembrado por e2e/setup-db.ts
 * (pdtp-prog-e2e / pdtp-act-e2e / pdtp-exec-e2e con un checklist activo de
 * 1 ítem) en vez de crear el programa por UI — evita acoplar este spec al
 * flujo de creación, cubierto por separado más arriba. Solo verifica el
 * camino UI; el cálculo de % y las reglas de negocio
 * ya están cubiertos por lib/__tests__/pdtp-checklist-action-plan.test.ts.
 */
test.describe("PDTP — Checklist de verificación y plan de acción", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("marcar un ítem 'No cumple' genera automáticamente una acción correctiva", async ({ page }) => {
    await page.goto("/prevencion/pdtp/pdtp-prog-e2e/ejecucion/pdtp-exec-e2e")

    await expect(page.getByRole("heading", { name: /Verificación/ })).toBeVisible()

    // Inicia el checklist de faena única (patrón B — sin sujeto).
    await page.getByRole("button", { name: "Iniciar verificación" }).click()
    await expect(page.getByRole("button", { name: "Guardar respuestas" })).toBeVisible()

    // Marca el único ítem como "No cumple" y agrega la observación que se
    // convertirá en el hallazgo de la acción generada.
    await page.getByRole("button", { name: "No cumple" }).click()
    // El botón de la nota cambia de rótulo según el estado del ítem: al marcar
    // "No cumple" pasa a "Nota requerida" (requiresObservation), y una vez
    // escrita, a "Editar nota". El test buscaba sólo "Agregar nota", que es
    // justamente el único de los tres que ya no está en pantalla acá.
    await page.getByRole("button", { name: /Agregar nota|Nota requerida|Editar nota/ }).click()
    await page.getByPlaceholder("Agrega una nota breve...").fill("Falta EPP en terreno")
    await page.getByRole("button", { name: "Guardar nota" }).click()

    // Persiste la respuesta antes de enviar — "Enviar revisión" opera sobre lo
    // guardado en servidor, no sobre el draft local (draftsByInstance).
    await page.getByRole("button", { name: "Guardar respuestas" }).click()
    await expect(page.getByText("Pendiente de respuesta")).not.toBeVisible()

    await page.getByRole("button", { name: "Enviar revisión" }).click()

    // El checklist queda completado (badge) y el plan de acción muestra la
    // acción autogenerada con el hallazgo ingresado.
    await expect(page.getByText("Completado")).toBeVisible()
    await expect(page.getByRole("button", { name: /Falta EPP en terreno/ })).toBeVisible()
  })
})
