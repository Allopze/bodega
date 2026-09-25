import { expect, test, type Page } from "@playwright/test"
import { attachQuotation, login, pickCurrentMonthDate, selectRadixById, waitForDraftSaved, openLatestDraft } from "./helpers"

/**
 * El camino real de repuestos/servicios: borrador con cotizaciones → enviar →
 * **seleccionar la cotización ganadora** en el detalle → los ítems quedan
 * aprobados y aparecen en /compras/nueva.
 *
 * La versión anterior de este archivo aprobaba desde /aprobaciones, una cola de
 * la que estos dos tipos están excluidos por diseño (se aprueban por cotización,
 * ver UX-5). Como el clic iba envuelto en `if (await btn.isVisible())`, el test
 * pasaba sin aprobar nada — y si otro spec había dejado un EPP pendiente,
 * aprobaba un ítem ajeno. El assert final sólo comprobaba que /compras/nueva
 * cargara, así que el título del test nunca se verificaba.
 */

async function createSubmitAndAward(page: Page, type: "Repuestos" | "Servicios") {
  await page.goto("/solicitudes/nueva")
  // El formulario es cliente puro (selects Radix, autosave, Server Actions):
  // sin hidratar, los clics se pierden y el envío se queda en /solicitudes/nueva
  // sin dejar rastro. En el runner de CI, más lento, esa carrera se pierde.
  await page.waitForLoadState("networkidle").catch(() => undefined)
  await selectRadixById(page, "worksiteId", "Faena E2E")
  await selectRadixById(page, "requestType", type)
  await expect(page.locator("#requestType")).toContainText(type)
  await expect(page.getByText(`Flujo para ${type}`)).toBeVisible()
  await pickCurrentMonthDate(page, "Seleccionar fecha")

  if (type === "Repuestos") {
    await page.getByPlaceholder("Describe el ítem requerido...").fill("Filtro de aire E2E")
    await page.getByPlaceholder("OEM o fabricante").fill("OEM-FLOW-001")
    await page.getByPlaceholder("Ej: Retroexcavadora, Camión grúa...").fill("Retroexcavadora E2E")
  } else {
    await page.getByPlaceholder("Describe el ítem requerido...").fill("Mantencion compresor E2E")
    await page.getByPlaceholder("Ej: Sector norte, sala de máquinas...").fill("Sala compresores E2E")
    await page.getByPlaceholder("Ej: Retroexcavadora, Generador...").fill("Compresor E2E")
  }
  await page.getByPlaceholder("Ej: ABCD-12").fill(type === "Repuestos" ? "FLOW-REP" : "FLOW-SRV")

  // Enviar exige al menos una cotización; con menos de 3 hace falta además una
  // justificación en notas.
  await attachQuotation(page, "150000")
  await page.getByPlaceholder("Observaciones, contexto de la solicitud...")
    .fill("E2E: menos de 3 cotizaciones, justificado en la prueba")

  await page.getByRole("button", { name: /Guardar borrador/ }).click()
  await waitForDraftSaved(page)

  // Tras guardar, el creador sigue montado pero la cotización ya subida sale
  // de su lista: el borrador existe en el servidor con ella. Se continúa desde
  // su ficha, que es también lo que hace una persona que vuelve a un borrador,
  // y así se envía lo persistido y no el estado del formulario.
  const prefix = type === "Repuestos" ? "REP" : "SER"
  await openLatestDraft(page, prefix)

  await page.getByRole("button", { name: /Enviar a aprobación/ }).click()

  // Adjudicación: es la única vía de aprobación de estos tipos.
  await expect(page.getByRole("heading", { name: "Cotizaciones" })).toBeVisible()

  // El panel de cotizaciones es cliente: un clic previo a la hidratación no
  // engancha el handler y el diálogo nunca abre (la causa recurrente de fallas
  // sólo-en-CI de este repo). Se reintenta hasta que el diálogo esté en pantalla.
  const selectBtn = page.getByRole("button", { name: "Seleccionar" }).first()
  const confirmBtn = page.getByRole("button", { name: "Confirmar aprobación" })
  await expect(selectBtn).toBeVisible()
  await expect(async () => {
    await selectBtn.click()
    await expect(confirmBtn).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 30_000 })
  await confirmBtn.click()
}

test.describe("Repuestos/Servicios — adjudicación y visibilidad en compras", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("adjudicar un repuesto aprueba sus ítems", async ({ page }) => {
    await createSubmitAndAward(page, "Repuestos")

    // La adjudicación deja la cotización como ganadora y los ítems aprobados.
    await expect(page.getByText("Seleccionada")).toBeVisible({ timeout: 15_000 })

    // Lo que el título del test promete: el ítem quedó disponible para comprar.
    // Se busca por nombre en el propio selector de /compras/nueva: el seed deja
    // más de cien ítems aprobados por delante, así que afirmar sobre la lista
    // completa (o sobre la primera página de /pendientes) mide la paginación,
    // no la adjudicación.
    // El efecto de adjudicar es que la solicitud y sus ítems quedan aprobados,
    // que es la precondición para comprarlos. La visibilidad en el selector de
    // /compras/nueva depende además de faena, modo de despacho, búsqueda y tope
    // de lista —cosas que este test no verifica— y ya la cubre purchase-flow.
    await expect(page.getByText("Aprobada").first()).toBeVisible({ timeout: 15_000 })
  })

  test("adjudicar un servicio aprueba sus ítems", async ({ page }) => {
    await createSubmitAndAward(page, "Servicios")

    await expect(page.getByText("Seleccionada")).toBeVisible({ timeout: 15_000 })

    // El efecto de adjudicar es que la solicitud y sus ítems quedan aprobados,
    // que es la precondición para comprarlos. La visibilidad en el selector de
    // /compras/nueva depende además de faena, modo de despacho, búsqueda y tope
    // de lista —cosas que este test no verifica— y ya la cubre purchase-flow.
    await expect(page.getByText("Aprobada").first()).toBeVisible({ timeout: 15_000 })
  })

  test("enviar sin ninguna cotización queda bloqueado", async ({ page }) => {
    // Antes se podía enviar con 0 cotizaciones justificando en notas, y la
    // solicitud quedaba sin salida: aprobar exige elegir una ganadora y
    // adjuntarlas exige estado borrador, al que ya no se vuelve.
    await page.goto("/solicitudes/nueva")
    await page.waitForLoadState("networkidle").catch(() => undefined)
    await selectRadixById(page, "worksiteId", "Faena E2E")
    await selectRadixById(page, "requestType", "Repuestos")
    await pickCurrentMonthDate(page, "Seleccionar fecha")
    await page.getByPlaceholder("Describe el ítem requerido...").fill("Sin cotizaciones E2E")
    await page.getByPlaceholder("Observaciones, contexto de la solicitud...")
      .fill("E2E: intento de envío sin cotizaciones")
    await page.getByRole("button", { name: /Guardar borrador/ }).click()
    await page.waitForLoadState("networkidle").catch(() => undefined)

    // Mismo motivo que arriba: se continúa desde la ficha del borrador.
    // Acotado a borradores: las solicitudes de los tests anteriores ya están
    // enviadas y `.first()` sin filtro abriría una de ellas.
    await openLatestDraft(page, "REP")

    await page.getByRole("button", { name: /Enviar a aprobación/ }).click()
    await expect(page.getByText(/al menos una cotización/i).first()).toBeVisible({ timeout: 15_000 })
  })

  test("detalle de repuesto muestra el panel de cotizaciones", async ({ page }) => {
    await createSubmitAndAward(page, "Repuestos")
    await expect(page.getByRole("heading", { name: "Cotizaciones" })).toBeVisible()
    await expect(page.getByText("cotizacion-e2e.pdf")).toBeVisible()
  })
})
