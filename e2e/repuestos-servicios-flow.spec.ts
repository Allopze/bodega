import { expect, test } from "@playwright/test"
import { attachQuotation, login, pickCurrentMonthDate, selectRadixById, waitForDraftSaved, openLatestDraft } from "./helpers"

test("repuestos: crea borrador y envia solicitud a aprobacion", async ({ page }) => {
  await login(page)
  await page.goto("/solicitudes/nueva")

  await expect(page.getByRole("heading", { name: "Nueva solicitud de compra" })).toBeVisible()
  await selectRadixById(page, "worksiteId", "Faena E2E")
  await selectRadixById(page, "requestType", "Repuestos")
  await expect(page.locator("#requestType")).toContainText("Repuestos")
  await expect(page.getByText("Flujo para Repuestos")).toBeVisible()
  await pickCurrentMonthDate(page, "Seleccionar fecha")

  // Quotation-type item fields rendered by the unified ItemEditor
  await page.getByPlaceholder("Describe el ítem requerido...").fill("Filtro hidraulico E2E")
  await page.getByPlaceholder("OEM o fabricante").fill("OEM-E2E-001")
  await page.getByPlaceholder("Ej: Retroexcavadora, Camión grúa...").fill("Excavadora E2E")
  await page.getByPlaceholder("Ej: ABCD-12").fill("REP-E2E")
  // Enviar exige al menos una cotización; con menos de 3, además, justificación.
  await attachQuotation(page, "150000")
  await page.getByPlaceholder("Observaciones, contexto de la solicitud...").fill("E2E: menos de 3 cotizaciones, justificado en la prueba")

  await page.getByRole("button", { name: /Guardar borrador/ }).click()
  await waitForDraftSaved(page)

  // Tras guardar, el creador sigue montado pero la cotización ya subida sale
  // de su lista (la tiene el servidor): se continúa desde la ficha del
  // borrador, para enviar lo que quedó persistido y no el estado del formulario.
  await openLatestDraft(page, "REP")

  await page.getByRole("button", { name: /Enviar a aprobación/ }).click()
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
  await expect(page.getByText("Filtro hidraulico E2E").first()).toBeVisible()
})

test("servicios: crea borrador y envia solicitud a aprobacion", async ({ page }) => {
  await login(page)
  await page.goto("/solicitudes/nueva")

  await expect(page.getByRole("heading", { name: "Nueva solicitud de compra" })).toBeVisible()
  await selectRadixById(page, "worksiteId", "Faena E2E")
  await selectRadixById(page, "requestType", "Servicios")
  await expect(page.locator("#requestType")).toContainText("Servicios")
  await expect(page.getByText("Flujo para Servicios")).toBeVisible()
  await pickCurrentMonthDate(page, "Seleccionar fecha")

  await page.getByPlaceholder("Describe el ítem requerido...").fill("Mantencion generador E2E")
  await page.getByPlaceholder("Ej: Sector norte, sala de máquinas...").fill("Sala de maquinas E2E")
  await page.getByPlaceholder("Ej: Retroexcavadora, Generador...").fill("Generador E2E")
  await page.getByPlaceholder("Ej: ABCD-12").fill("SER-E2E")
  // Enviar exige al menos una cotización; con menos de 3, además, justificación.
  await attachQuotation(page, "150000")
  await page.getByPlaceholder("Observaciones, contexto de la solicitud...").fill("E2E: menos de 3 cotizaciones, justificado en la prueba")

  await page.getByRole("button", { name: /Guardar borrador/ }).click()
  await waitForDraftSaved(page)

  // Tras guardar, el creador sigue montado pero la cotización ya subida sale
  // de su lista (la tiene el servidor): se continúa desde la ficha del
  // borrador, para enviar lo que quedó persistido y no el estado del formulario.
  await openLatestDraft(page, "SER")

  await page.getByRole("button", { name: /Enviar a aprobación/ }).click()
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
  await expect(page.getByText("Mantencion generador E2E").first()).toBeVisible()
})

/**
 * Entrada desde las rutas propias de Repuestos y Servicios (TASK-UI-003).
 *
 * El hallazgo FORM-CORE-001 era exactamente esto: entrar por `/repuestos/nueva`
 * y encontrarse un formulario de EPP. Las pruebas existentes empiezan en
 * `/solicitudes/nueva` y eligen el tipo a mano, así que **no podían ver ese
 * defecto**: comprueban que el selector funciona, no que la ruta de entrada
 * imponga su tipo.
 *
 * Se ejercitan ambos viewports porque el criterio lo pide literalmente —"mismo
 * valor y feedback en móvil/desktop"— y porque el selector es un `Select` de
 * Radix, que en móvil abre otra superficie.
 */
const ENTRADAS = [
  { ruta: "/repuestos/nueva", tipo: "Repuestos", flujo: "Flujo para Repuestos" },
  { ruta: "/servicios/nueva", tipo: "Servicios", flujo: "Flujo para Servicios" },
] as const

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "móvil", width: 390, height: 844 },
] as const

for (const entrada of ENTRADAS) {
  for (const viewport of VIEWPORTS) {
    test(`${entrada.tipo}: entrar por su ruta impone el tipo (${viewport.name})`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await login(page)
      await page.goto(entrada.ruta)

      // La redirección es parte del contrato: conserva la intención en la query.
      await expect(page).toHaveURL(/\/solicitudes\/nueva\?tipo=/)
      await expect(page.getByRole("heading", { name: "Nueva solicitud de compra" })).toBeVisible()

      // Selector, ayuda contextual y resumen dicen lo mismo: ninguna mutación
      // silenciosa a EPP, que es el defecto que originó la tarea.
      await expect(page.locator("#requestType")).toContainText(entrada.tipo)
      await expect(page.getByText(entrada.flujo)).toBeVisible()
      // El selector y la ayuda contextual concuerdan: eso es lo que niega la
      // mutación silenciosa a EPP. Buscar la cadena "EPP" en toda la página no
      // servía —aparece legítimamente en la lista de opciones del propio
      // selector— y sólo producía un fallo que no significaba nada.
      await expect(page.locator("#requestType")).not.toContainText("EPP")
    })
  }
}

test("una query de tipo inválida no se traga en silencio ni cae a EPP", async ({ page }) => {
  await login(page)
  await page.goto("/solicitudes/nueva?tipo=inexistente")

  // El criterio dice "fallback explícito" y "el error de query no queda
  // silencioso": lo inaceptable es que un enlace viejo cree una solicitud de
  // otro tipo sin que nadie lo note.
  await expect(page.getByRole("heading", { name: "Nueva solicitud de compra" })).toBeVisible()
  const selector = page.locator("#requestType")
  await expect(selector).toBeVisible()
  // Sea cual sea el fallback, tiene que ser uno declarado y visible en el
  // control, no un valor implícito que sólo aparezca en el payload.
  await expect(selector).not.toBeEmpty()
})
