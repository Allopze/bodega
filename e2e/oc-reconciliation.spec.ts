import { test, expect } from "@playwright/test"
import { login } from "./helpers"

const OC_FIXTURE_ID = "oc-e2e"
/** OC recibida completa y sin factura adjunta. */
const OC_SIN_FACTURA_ID = "oc-sin-factura-e2e"

test.describe("Conciliación OC-factura-recepción", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("OC detail page loads and shows conciliación panel", async ({ page }) => {
    await page.goto(`/compras/${OC_FIXTURE_ID}`)
    await expect(page.getByRole("heading", { name: /OC-2026/ })).toBeVisible({ timeout: 10_000 })

    // The reconciliation panel lives in the "Facturación" tab (OcDetailTabs),
    // which isn't the default active tab, and only renders once the OC has
    // an invoice attached.
    await page.getByRole("tab", { name: /^Facturación/ }).click()
    // El panel dejó de ser un resumen monetario con etiquetas propias: ahora es
    // la tarjeta "Conciliación de facturación" con una fila por línea de OC.
    await expect(page.getByRole("heading", { name: "Conciliación de facturación" })).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(/Tolerancia monetaria: \$1/)).toBeVisible()
    // La comparación es por línea y conserva las tres cantidades independientes.
    await expect(page.getByRole("columnheader", { name: "OC / aceptada / factura" })).toBeVisible()
    await expect(page.getByRole("columnheader", { name: "Precio factura" })).toBeVisible()
  })

  test("explica una sugerencia DTE enriquecida y permite revisar sus asociaciones", async ({ page }) => {
    await page.goto(`/compras/${OC_SIN_FACTURA_ID}?tab=facturacion`)

    await expect(page.getByRole("button", { name: "Actualizar sugerencias" })).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText("Factura electrónica N° 900004")).toBeVisible()
    await expect(page.getByText("Confianza alta")).toBeVisible()
    await expect(page.getByText(/Proveedor verificado · 1\/1 líneas vinculadas/)).toBeVisible()

    await page.getByRole("button", { name: "Usar este DTE" }).click()
    const dialog = page.getByRole("dialog", { name: "Revisar asociaciones del DTE" })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole("combobox", { name: "Asociar línea DTE 1" })).toBeVisible()
    const remember = dialog.getByRole("checkbox", { name: "Recordar esta correspondencia para este proveedor" })
    await expect(remember).toBeEnabled()
    await expect(remember).not.toBeChecked()
    await expect(dialog.getByRole("button", { name: "Confirmar y usar DTE" })).toBeVisible()
  })

  // Antes había que saber que existía la pestaña "Facturación" y bajar hasta el
  // final de su formulario para encontrar el campo del archivo.
  test("una OC recibida sin factura ofrece adjuntarla desde el rail", async ({ page }) => {
    await page.goto(`/compras/${OC_SIN_FACTURA_ID}`)
    await expect(page.getByText("Falta la factura de esta orden")).toBeVisible({ timeout: 10_000 })

    const cta = page.getByRole("link", { name: /adjuntar factura/i })
    await expect(cta).toHaveAttribute("href", `/compras/${OC_SIN_FACTURA_ID}?tab=facturacion`, { timeout: 10_000 })
    await cta.click()

    // El deep-link abre la pestaña y mantiene disponible la carga documental.
    // La lista opcional de recepciones ahora puede aparecer antes del archivo.
    await expect(page.getByRole("heading", { name: "Adjuntar factura" })).toBeVisible({ timeout: 10_000 })
    await expect(page.locator("#invoice-file")).toBeVisible()
  })

  test("el listado delata la OC recibida sin factura y permite filtrarla", async ({ page }) => {
    await page.goto("/compras?factura=pendiente")
    await expect(page.getByRole("link", { name: /Ver OC OC-2026-0091/ })).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText("Sin factura").first()).toBeVisible()
    // La OC con factura no pasa el filtro.
    await expect(page.getByRole("link", { name: /Ver OC OC-2026-0001/ })).toHaveCount(0)

    // El filtro se activa desde el chip del header, no desde la barra: sin un
    // control visible, la lista quedaba recortada sin explicación ni salida.
    // La salida es el chip de filtro activo de `FilterToolbar`, hoy un
    // <button aria-label="Eliminar filtro Factura">. Antes esto buscaba un
    // <link> llamado "Quitar filtro de facturas pendientes": el control se
    // generalizó a `Eliminar filtro {label}` y el nombre viejo no existe en
    // ninguna parte, así que el poll no clickeaba nada y agotaba su timeout
    // afirmando una regresión que no era tal.
    //
    // Dos problemas se sumaban acá, y el segundo escondía al primero:
    //
    //   1. El clic puede llegar antes de que React hidrate. `Link` ya hace
    //      preventDefault pero el router todavía no navega, así que se pierde
    //      sin dejar rastro. Por eso se reintenta en vez de clickear una vez.
    //   2. Tras un clic que SÍ funcionó, `page.url()` se lee antes de que la
    //      navegación del cliente aterrice, así que la primera vuelta devuelve
    //      la URL vieja. En la segunda, el chip ya está desapareciendo y un
    //      `click()` sin timeout se queda esperando actionability hasta el
    //      timeout del test (150 s): el poll no vuelve a muestrear nunca y
    //      agota sus 15 s con una sola medición. El timeout corto es lo que lo
    //      mantiene muestreando.
    await expect.poll(async () => {
      const chip = page.getByRole("button", { name: /Eliminar filtro Factura/i })
      if (await chip.count()) await chip.click({ timeout: 2_000 }).catch(() => undefined)
      return page.url()
    }, { timeout: 15_000 }).not.toMatch(/factura=pendiente/)
    // Sin el filtro, Compras vuelve a su bandeja de abastecimiento y la OC
    // recibida se va: `factura=pendiente` es su ÚNICA puerta de vuelta acá (lo
    // fija `STAGE_GROUPS` en `compras/page.tsx` — emitida la OC, el trabajo
    // pasa a Recepción). Antes esto afirmaba que reaparecía OC-2026-0001, que
    // por ser `sent` no está en esta bandeja con filtro ni sin él.
    await expect(page.getByRole("link", { name: /Ver OC OC-2026-0091/ })).toHaveCount(0, { timeout: 10_000 })
    // La anulada y no un borrador: `directo-faena-flow` emite OC-2026-0092 y la
    // saca de esta bandeja, así que en la suite completa la aserción dependía
    // de qué worker corriera antes.
    await expect(page.getByRole("link", { name: /Ver OC OC-INTEGRITY-E2E/ })).toBeVisible()

    // Y "Limpiar" —que sólo aparece con filtros activos— también lo apaga.
    // Este sí es un <button> con onClick: sin hidratar no hace absolutamente
    // nada, y es el que fallaba de forma reproducible en local.
    await page.goto("/compras?factura=pendiente")
    await expect.poll(async () => {
      const limpiar = page.getByRole("button", { name: "Limpiar" })
      // Mismo timeout corto y por la misma razón que el chip de arriba.
      if (await limpiar.count()) await limpiar.click({ timeout: 2_000 }).catch(() => undefined)
      return page.url()
    }, { timeout: 15_000 }).not.toMatch(/factura=pendiente/)
  })

  test("desde la recepción la preselecciona sin copiar la guía como folio", async ({ page }) => {
    await page.goto("/recepcion/rec-sin-factura-e2e")
    await expect(page.getByRole("heading", { name: "REC-2026-0091" })).toBeVisible({ timeout: 10_000 })

    const atajo = page.getByRole("link", { name: /Adjuntar factura/i })
    await expect(atajo).toHaveAttribute(
      "href",
      "/compras/oc-sin-factura-e2e?tab=facturacion&receiptId=rec-sin-factura-e2e",
    )
    await atajo.click()

    await expect(page.getByRole("heading", { name: "Adjuntar factura" })).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole("checkbox", { name: /REC-2026-0091/ })).toBeChecked()
    await expect(page.locator("#invoice-number")).toHaveValue("")
  })

  test("muestra una primera factura por 6 como parcial y su recepción asociada", async ({ page }) => {
    await page.goto("/compras/oc-facturacion-parcial-e2e?tab=facturacion")
    await expect(page.getByText("Facturación parcial").first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText("$4.760")).toBeVisible()
    await expect(page.getByText("10 / 6 / 6")).toBeVisible()
    await expect(page.getByText("Recepciones: REC-2026-0193")).toBeVisible()
    await expect(page.getByRole("button", { name: "Aceptar diferencias" })).toHaveCount(0)
  })

  test("muestra dos recepciones y dos facturas por 6 + 4 como conciliadas", async ({ page }) => {
    await page.goto("/compras/oc-facturacion-completa-e2e?tab=facturacion")
    await expect(page.getByText("Conciliada").first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole("heading", { name: "Facturas 2" })).toBeVisible()
    await expect(page.getByText("Saldo por facturar").locator("..").getByText("$0")).toBeVisible()
    await expect(page.getByText("10 / 10 / 10")).toBeVisible()
    await expect(page.getByText("Recepciones: REC-2026-0195-1")).toBeVisible()
    await expect(page.getByText("Recepciones: REC-2026-0195-2")).toBeVisible()
  })

  // La unidad ausente no es una discrepancia sino evidencia incompleta: el
  // `UnmdItem` del DTE es opcional. Antes bloqueaba la OC en revisión sin que
  // nadie pudiera resolverla, y la tabla igual imprimía `$0 (0.0%)` para una
  // comparación de precio que el motor no había corrido.
  test("una factura sin unidad declarada concilia y deja el supuesto a la vista", async ({ page }) => {
    await page.goto("/compras/oc-unidad-ausente-e2e?tab=facturacion")
    await expect(page.getByText("Conciliada").first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(/asumiendo que la unidad es la misma que la de la OC/)).toBeVisible()
    await expect(page.getByText("5 / 5 / 5")).toBeVisible()
    // El precio sí se compara: apagarlo dejaba sin control a las líneas peor
    // documentadas, que son justamente las que más lo necesitan.
    await expect(page.getByText("$0 (0.0%)")).toBeVisible()
    await expect(page.getByRole("button", { name: "Aceptar diferencias" })).toHaveCount(0)
  })

  test("una factura con otra unidad exige revisión y no afirma diferencia cero", async ({ page }) => {
    await page.goto("/compras/oc-unidad-distinta-e2e?tab=facturacion")
    await expect(page.getByText("Revisión requerida").first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText("Unidad documental distinta de la OC")).toBeVisible()
    await expect(page.getByText("No comparable")).toBeVisible()
    await expect(page.getByText("$0 (0.0%)")).toHaveCount(0)
  })

  test("la recepción lista su factura y permite adjuntar otra", async ({ page }) => {
    await page.goto("/recepcion/rec-facturacion-parcial-e2e")
    await expect(page.getByRole("heading", { name: "REC-2026-0193" })).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText("Facturas relacionadas (1)")).toBeVisible()
    await expect(page.getByRole("link", { name: "FAC-PARCIAL-6" })).toBeVisible()
    await expect(page.getByRole("link", { name: "Adjuntar otra factura" })).toHaveAttribute(
      "href",
      "/compras/oc-facturacion-parcial-e2e?tab=facturacion&receiptId=rec-facturacion-parcial-e2e",
    )
  })

  test("una factura completa antes de recibir queda en recepción pendiente", async ({ page }) => {
    await page.goto("/compras/oc-factura-anticipada-e2e?tab=facturacion")
    await expect(page.getByText("Recepción pendiente").first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(/la conciliación se actualizará automáticamente/i)).toBeVisible()
    await expect(page.getByRole("button", { name: "Aceptar diferencias" })).toHaveCount(0)
  })

  // VA AL FINAL A PROPÓSITO: consume el DTE candidato y le pone factura a
  // `oc-sin-factura-e2e`, así que las pruebas de arriba —que lo necesitan
  // libre— ya corrieron. El archivo no es paralelo (`fullyParallel: false`) y
  // este fixture no lo usa ningún otro spec.
  //
  // Hasta acá la cobertura llegaba a "el botón Confirmar existe": todo el
  // camino de servidor (validación bajo lock, resoluciones de línea, vínculo
  // del DTE, revalidación) no lo ejercitaba nada de punta a punta.
  test("confirmar el diálogo registra la factura y saca el DTE del pozo", async ({ page }) => {
    await page.goto(`/compras/${OC_SIN_FACTURA_ID}?tab=facturacion`)
    await expect(page.getByText("Factura electrónica N° 900004")).toBeVisible({ timeout: 10_000 })

    await page.getByRole("button", { name: "Usar este DTE" }).click()
    const dialog = page.getByRole("dialog", { name: "Revisar asociaciones del DTE" })
    await expect(dialog).toBeVisible()
    await dialog.getByRole("button", { name: "Confirmar y usar DTE" }).click()

    // El folio del XML, no uno tipeado: el servidor lo revalida contra la fila
    // del portal antes de aceptarlo.
    await expect(page.getByText("Factura 900004 adjuntada correctamente")).toBeVisible({ timeout: 20_000 })
    await expect(dialog).toBeHidden()
    await expect(page.getByRole("link", { name: "900004" })).toBeVisible({ timeout: 15_000 })

    // Con una factura arriba, el alta se pliega: hay que abrirla para ver que
    // el DTE ya no se ofrece —quedó vinculado a esta factura y salió del pozo—.
    await page.locator("summary", { hasText: "Adjuntar factura" }).click()
    await expect(page.getByText("No hay DTE elegibles sin registrar para esta orden")).toBeVisible({ timeout: 10_000 })
  })
})
