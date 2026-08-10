import { expect, test, type Locator, type Page } from "@playwright/test"
import { login, selectRadixById, pickCurrentMonthDate, idFromUrl } from "./helpers"

/**
 * El correlativo como identidad: SOL y OC a través de las secciones, y frente a
 * cambios del catálogo de EPP.
 *
 * Tres preguntas, ninguna cubierta hoy:
 *
 * 1. ¿La misma solicitud muestra el MISMO número en todas las pantallas donde
 *    aparece? `purchase-flow.spec.ts` recorre el ciclo completo, pero usa el
 *    código sólo para acotar sus localizadores: nunca afirma que el listado, la
 *    bandeja de aprobación, la cola de pendientes y la OC hablen del mismo
 *    documento. Si una pantalla resolviera el código por su cuenta, o mostrara
 *    el de otro documento, la suite actual seguiría verde.
 *
 * 2. ¿El correlativo sobrevive al flujo de la OC? Cada transición (borrador →
 *    emitida → enviada → recepciones → completada) reescribe la fila de la
 *    orden; ninguna debe tocar `code`.
 *
 * 3. ¿Tocar el catálogo de EPP mueve los correlativos? Es la pregunta de fondo.
 *    El SKU del catálogo se genera por un camino propio y aleatorio
 *    (`generateUniqueProductSku`), mientras que SOL y OC salen de la secuencia
 *    nativa de Postgres (`next_document_code`, ver `lib/code-sequences.ts`): son
 *    dos series independientes, y esta prueba es la que lo deja fijado. Agregar
 *    un producto y renombrar el que ya está comprometido en una solicitud y en
 *    una OC no debe reescribir ni reiniciar nada ya emitido.
 *
 * Los tres corren en serie porque comparten un documento: la solicitud que crea
 * el primero es la OC del segundo y el sujeto del tercero.
 *
 * Omisión deliberada: no se afirma el NOMBRE del ítem después de renombrar el
 * producto. Hoy las vistas resuelven el nombre en vivo contra `products` —no hay
 * columnas de snapshot en `purchase_request_items`—, así que renombrar sí cambia
 * lo que se lee. Ese es el asunto de PLAN_SNAPSHOT_EPP_SOLICITUDES_OC_2026-08-02
 * y no el de esta prueba, que es el correlativo.
 */

// Un sufijo por corrida: el catálogo es compartido y estos productos se quedan.
// Los tres nombres son disjuntos a propósito: los localizadores por nombre
// accesible ("Editar producto X", "Incluir X") matchean por substring, así que
// un nombre que sea prefijo de otro rompe por strict mode, no por el código.
const RUN = Date.now().toString(36).toUpperCase().slice(-5)
const EPP_NAME = `Guante Correlativo ${RUN}`
const EPP_RENAMED = `Guante Renombrado ${RUN}`
const EPP_EXTRA = `Casco Agregado ${RUN}`

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * El correlativo, tal cual, en la pantalla actual.
 *
 * `exact` no sirve: unas pantallas lo imprimen solo en su `<span>` y otras lo
 * concatenan ("SOL-0042 · 2 ítems", "Solicitud: SOL-0042"). El `(?!\d)` evita que
 * `SOL-0042` se dé por encontrado dentro de `SOL-00420`, que es exactamente la
 * confusión que esta prueba existe para detectar.
 *
 * `visible: true` antes de `.first()`: varias pantallas renderizan las DOS
 * representaciones —tarjeta y tabla— y ocultan una por CSS según el ancho
 * (contrato de TASK-UI-004, el mismo motivo por el que existe `listRecord` en
 * helpers). Sin el filtro, `.first()` cae en la copia móvil oculta y la
 * aserción falla por el viewport, no por el correlativo.
 */
async function expectCode(page: Page, code: string) {
  const token = new RegExp(`${escapeRegExp(code)}(?!\\d)`)
  await expect(page.getByText(token).filter({ visible: true }).first())
    .toBeVisible({ timeout: 15_000 })
}

/** El número del correlativo, para comparar el avance de la serie. */
function sequenceOf(code: string): number {
  const digits = code.match(/(\d+)$/)?.[1]
  expect(digits, `correlativo sin número: ${code}`).toBeTruthy()
  return Number(digits)
}

async function submitSheet(page: Page, sheet: Locator) {
  // Mismo camino que `admin-flow.spec.ts`: el formulario del catálogo es un
  // asistente de 3 pasos, pero lleva todos sus campos en inputs ocultos, así que
  // enviarlo directo evita recorrer pasos que esta prueba no está probando.
  await sheet.locator("form").evaluate((el) => (el as HTMLFormElement).requestSubmit())
  await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 30_000 })
}

/**
 * El catálogo cambió de verdad: sin esto la prueba 3 no estaría probando nada.
 *
 * Sin filtrar: `/admin/productos` no le pasa `search` a `DataTable`, así que la
 * tabla no tiene buscador propio (el del TopBar es otra cosa). La base E2E se
 * reconstruye en cada corrida y queda con un puñado de productos, muy por debajo
 * del `pageSize` de 25, así que la fila está siempre en la primera página.
 */
async function expectProductInCatalog(page: Page, name: string) {
  await page.goto("/admin/productos")
  await expect(page.getByRole("button", { name: `Editar producto ${name}`, exact: true }))
    .toBeVisible({ timeout: 15_000 })
}

/**
 * Abre un panel del catálogo reintentando el clic hasta que aparece.
 *
 * El catálogo es un componente de cliente puro: si el clic llega antes de que
 * React hidrate, el navegador mueve el foco al botón —queda `[active]` en el
 * snapshot— pero no corre ningún manejador, y el panel no abre nunca. Playwright
 * no reintenta un clic ya entregado, así que la prueba se queda esperando un
 * diálogo que no va a existir y agota su presupuesto completo. Es la causa
 * recurrente de las fallas sólo-en-CI de este repositorio, y se reproduce en
 * local con la máquina cargada. `toPass` vuelve a intentar el clic.
 */
async function openCatalogSheet(page: Page, buttonName: string, sheetName: string) {
  const sheet = page.getByRole("dialog", { name: sheetName })
  await expect(async () => {
    await page.getByRole("button", { name: buttonName, exact: true }).click()
    await expect(sheet).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 60_000 })
  return sheet
}

async function createEppProduct(page: Page, name: string) {
  await page.goto("/admin/productos")
  const sheet = await openCatalogSheet(page, "Nuevo producto", "Nuevo producto")
  await sheet.getByRole("textbox", { name: "Nombre" }).fill(name)
  await selectRadixById(page, "p-cat", "EPP E2E")
  await submitSheet(page, sheet)
  await expectProductInCatalog(page, name)
}

async function renameProduct(page: Page, from: string, to: string) {
  await page.goto("/admin/productos")
  const sheet = await openCatalogSheet(page, `Editar producto ${from}`, `Editar: ${from}`)
  await sheet.getByRole("textbox", { name: "Nombre" }).fill(to)
  await submitSheet(page, sheet)
  await expectProductInCatalog(page, to)
}

/** Crea una solicitud de EPP de un ítem y devuelve su correlativo. */
async function createEppRequest(page: Page, productName: string, quantity: string) {
  await page.goto("/solicitudes/nueva")
  await selectRadixById(page, "worksiteId", "Faena E2E")
  await selectRadixById(page, "requestType", "EPP")
  await selectRadixById(page, "urgency", "Normal")
  await pickCurrentMonthDate(page, "Seleccionar fecha")

  await page.getByPlaceholder(/Buscar en catálogo o escribir producto/i).fill(productName)
  const option = page
    .getByRole("listbox")
    .getByRole("option", { name: new RegExp(escapeRegExp(productName)) })
  await expect(option.first()).toBeVisible({ timeout: 10_000 })
  await option.first().click()
  await page.locator('input[id^="qty-"]').first().fill(quantity)

  await page.getByRole("button", { name: /enviar a aprobación/i }).click()
  await expect(page).toHaveURL(/\/solicitudes\/(?!nueva$)[^/]+$/, { timeout: 20_000 })

  // El correlativo es el título de la página de detalle. `textContent` y no
  // `innerText`: el h1 de `PageHeader` es `lg:sr-only` en escritorio. Hay que
  // esperar a que el h1 SEA el correlativo: mientras el detalle carga, el
  // esqueleto de `loading.tsx` monta su propio h1 ("Solicitud") y leerlo de
  // inmediato devolvía el título del esqueleto.
  const heading = page.getByRole("heading", { level: 1 }).first()
  await expect(heading).toHaveText(/^SOL-\d{4,}$/, { timeout: 20_000 })
  const code = (await heading.textContent())?.trim() ?? ""
  return code
}

/**
 * La fila de un ítem en el formulario de OC: el elemento más interno que
 * contiene a la vez el checkbox del producto y el código de su solicitud.
 *
 * Se resuelve por contenido y no por estructura. `div:has(> input[type=checkbox])`
 * —el idioma que usa `purchase-flow.spec.ts`— depende de que el input sea hijo
 * directo de la fila, y deja de matchear en cuanto el checkbox se envuelve en su
 * `<label>`. Los ancestros vienen en orden de documento, así que `.last()` es el
 * más interno: la fila, sea cual sea el envoltorio del control.
 */
function ocFormItemRow(page: Page, productName: string, code: string) {
  return page
    .locator("div")
    .filter({ has: page.getByRole("checkbox", { name: `Incluir ${productName}`, exact: true }) })
    .filter({ hasText: `SOL ${code}` })
    .last()
}

/** Registra una recepción de la OC en la etapa indicada. */
async function registerReception(page: Page, orderId: string, stage: "Oficina" | "Faena", quantity: string) {
  await page.goto(`/recepcion/nueva?oc=${orderId}`)
  await page.getByRole("button", { name: new RegExp(`Recepción en ${stage}`, "i") }).click()
  await page.getByLabel(`Cantidad a recibir de ${EPP_NAME}`, { exact: true }).fill(quantity)
  await page.getByRole("button", { name: "Marcar como recibido" }).click()
  // Anclar en el código de la recepción creada y no en la URL: `/recepcion/[id]`
  // también matchea `/recepcion/nueva`, y la espera se cumpliría sola antes de
  // que el server action commiteara (misma trampa documentada en oc-flow).
  await expect(page.getByRole("heading", { name: /^REC-/ })).toBeVisible({ timeout: 30_000 })
}

test.describe.serial("Correlativos entre secciones", () => {
  let requestCode = ""
  let requestId = ""
  let orderCode = ""
  let orderId = ""
  let traceItemId = ""

  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("la solicitud lleva el mismo correlativo en detalle, listado, pendientes, aprobaciones y compras", async ({ page }) => {
    // El producto es propio de esta corrida: la prueba 3 lo renombra, y hacerlo
    // sobre un producto del seed rompería a los specs que lo buscan por nombre.
    await createEppProduct(page, EPP_NAME)

    requestCode = await createEppRequest(page, EPP_NAME, "6")
    requestId = idFromUrl(page)
    expect(requestId).toBeTruthy()

    // ── Sección 1: detalle ──────────────────────────────────────────────────
    await expect(page.getByRole("heading", { level: 1, name: requestCode })).toBeVisible()

    // ── Sección 2: listado de solicitudes ───────────────────────────────────
    await page.goto(`/solicitudes?q=${requestCode}`)
    await expect(page.getByRole("link", { name: `Ver solicitud ${requestCode}`, exact: true }))
      .toHaveCount(1, { timeout: 15_000 })

    // ── Sección 3: cola de pendientes ───────────────────────────────────────
    await page.goto(`/pendientes?q=${requestCode}`)
    await expectCode(page, requestCode)

    // ── Sección 4: bandeja de aprobaciones ──────────────────────────────────
    await page.goto(`/aprobaciones?q=${requestCode}`)
    await expectCode(page, requestCode)

    const ownGroup = page.locator("div:has(> ul)").filter({ hasText: requestCode })
    await expect(ownGroup).toHaveCount(1)
    await ownGroup.getByRole("button", { name: "Aprobar", exact: true }).click()
    await page.getByRole("button", { name: "Confirmar aprobación" }).click()
    await expect(ownGroup).toHaveCount(0, { timeout: 30_000 })

    // ── Sección 5: selector de ítems de una OC nueva ────────────────────────
    await page.goto("/compras/nueva")
    // Un solo ítem para este producto, y su fila lleva el código de ESTA
    // solicitud: es la forma de afirmar que el número mostrado le pertenece.
    await expect(page.getByRole("checkbox", { name: `Incluir ${EPP_NAME}`, exact: true }))
      .toHaveCount(1, { timeout: 15_000 })
    await expect(ocFormItemRow(page, EPP_NAME, requestCode)).toBeVisible()
  })

  test("el correlativo de la OC no cambia al avanzar el flujo, y arrastra el de su solicitud", async ({ page }) => {
    await page.goto("/compras/nueva")
    await selectRadixById(page, "ocWorksiteId", "Faena E2E")
    await selectRadixById(page, "supplierId", "Proveedor E2E")

    const ownItem = page.getByRole("checkbox", { name: `Incluir ${EPP_NAME}`, exact: true })
    await expect(ownItem).toHaveCount(1)
    await expect(ocFormItemRow(page, EPP_NAME, requestCode)).toBeVisible()
    await ownItem.check()
    await page.getByRole("button", { name: /Crear OC \(1 ítem\)/ }).click()
    await expect(page).toHaveURL(/\/compras\/(?!nueva$)[^/]+$/, { timeout: 20_000 })

    orderId = idFromUrl(page)
    expect(orderId).toBeTruthy()
    const orderHeading = page.getByRole("heading", { level: 1 }).first()
    await expect(orderHeading).toHaveText(/^OC-\d{4}-\d{4,}$/, { timeout: 20_000 })
    orderCode = (await orderHeading.textContent())?.trim() ?? ""

    // La OC nace mostrando el correlativo de la solicitud que la originó: es el
    // único punto donde ambas series se leen juntas.
    await expectCode(page, requestCode)

    // ── El correlativo sobrevive cada transición ────────────────────────────
    const sendButton = page.getByRole("button", { name: "Emitir y enviar" })
    await expect(sendButton).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole("heading", { level: 1, name: orderCode })).toBeVisible()

    await sendButton.click()
    await expect(sendButton).toBeHidden({ timeout: 30_000 })
    await expect(page.getByRole("heading", { level: 1, name: orderCode })).toBeVisible()

    // ── Sección: listado de compras ─────────────────────────────────────────
    await page.goto(`/compras?q=${orderCode}`)
    await expect(page.getByRole("link", { name: `Ver OC ${orderCode}`, exact: true }))
      .toHaveCount(1, { timeout: 15_000 })

    // ── Sección: bandeja de recepción ───────────────────────────────────────
    // La bandeja se renderiza en el servidor: si se pide antes de que el commit
    // de "Emitir y enviar" sea visible llega vacía y ninguna espera de
    // Playwright la rellena. Hay que volver a pedirla.
    const receptionLink = page.getByRole("link", { name: `Ver OC ${orderCode}`, exact: true })
    await expect.poll(async () => {
      await page.goto(`/recepcion?q=${orderCode}`)
      return receptionLink.count()
    }, { timeout: 30_000 }).toBe(1)

    // ── Sección: cola de pendientes ─────────────────────────────────────────
    await page.goto(`/pendientes?q=${orderCode}`)
    await expectCode(page, orderCode)

    // ── Recepciones: el estado avanza, el correlativo no ────────────────────
    await registerReception(page, orderId, "Oficina", "6")
    await page.goto(`/compras/${orderId}`)
    await expect(page.getByRole("heading", { level: 1, name: orderCode })).toBeVisible()
    await expect(page.getByText(/Recibido en oficina/).first()).toBeVisible()

    await registerReception(page, orderId, "Faena", "6")
    await page.goto(`/compras/${orderId}`)
    await expect(page.getByRole("heading", { level: 1, name: orderCode })).toBeVisible()
    await expect(page.getByText(/Completada/).first()).toBeVisible()

    // ── Sección: trazabilidad ───────────────────────────────────────────────
    // Acotado por estado: la matriz pagina de a bloques y ordena por fecha, así
    // que sin filtro el ítem depende de cuántas filas dejaron otros specs.
    await page.goto("/trazabilidad?estado=received")
    await expect(page.getByRole("link", { name: new RegExp(escapeRegExp(requestCode)) }).first())
      .toBeVisible({ timeout: 15_000 })

    await page.getByRole("link", { name: new RegExp(escapeRegExp(EPP_NAME)) }).first().click()
    await expect(page).toHaveURL(/\/trazabilidad\/[^/?]+$/, { timeout: 15_000 })
    traceItemId = idFromUrl(page)
    expect(traceItemId).toBeTruthy()
    // El detalle del ítem sólo publica el correlativo de la OC: el de la
    // solicitud se queda en la matriz, que es de donde venimos. No se afirma
    // acá para no fijar como contrato algo que la pantalla no muestra.
    await expectCode(page, orderCode)
  })

  test("agregar y modificar el catálogo de EPP no reescribe los correlativos ya emitidos ni reinicia la serie", async ({ page }) => {
    // ── Se toca el catálogo: uno nuevo, y renombrado el que ya está en la OC ─
    await createEppProduct(page, EPP_EXTRA)
    await renameProduct(page, EPP_NAME, EPP_RENAMED)

    // ── Los correlativos emitidos siguen siendo los mismos, sección a sección ─
    await page.goto(`/solicitudes/${requestId}`)
    await expect(page.getByRole("heading", { level: 1, name: requestCode })).toBeVisible()

    await page.goto(`/solicitudes?q=${requestCode}`)
    await expect(page.getByRole("link", { name: `Ver solicitud ${requestCode}`, exact: true }))
      .toHaveCount(1)

    await page.goto(`/compras/${orderId}`)
    await expect(page.getByRole("heading", { level: 1, name: orderCode })).toBeVisible()
    // El vínculo OC → solicitud tampoco se movió.
    await expectCode(page, requestCode)

    // El listado que corresponde acá es el de Recepción, no el de Compras: a
    // esta altura la OC ya se cerró, y una OC con la recepción terminada sale de
    // la bandeja de Compras —que muestra trabajo de abastecimiento pendiente— y
    // vive en Recepción, bajo su tab "Completadas". Buscarla en /compras probaba
    // la pertenencia a una bandeja, no la estabilidad del correlativo, que es el
    // asunto de esta prueba; la sección Compras ya quedó cubierta arriba con su
    // ficha. La prueba 2 sí la busca en /compras, con la OC recién emitida.
    await page.goto(`/recepcion?q=${orderCode}`)
    await expect(page.getByRole("link", { name: `Ver OC ${orderCode}`, exact: true })).toHaveCount(1)

    // La trazabilidad del ítem, que es la vista histórica del recorrido.
    await page.goto(`/trazabilidad/${traceItemId}`)
    await expectCode(page, orderCode)

    // ── Y la serie sigue hacia adelante, sin reusar lo ya emitido ───────────
    // Estrictamente mayor y no "+1": con 2 workers otro spec puede tomar
    // correlativos en el intertanto. Lo que importa es que la serie avanza y
    // nunca vuelve sobre un número ya entregado, no que este test sea el único
    // que la consume.
    const nextCode = await createEppRequest(page, EPP_RENAMED, "2")
    expect(nextCode).not.toBe(requestCode)
    expect(sequenceOf(nextCode)).toBeGreaterThan(sequenceOf(requestCode))
    // El formato tampoco cambió: SOL sin año (serie global), OC con año.
    expect(nextCode).toMatch(/^SOL-\d{4,}$/)
    expect(orderCode).toMatch(/^OC-\d{4}-\d{4,}$/)
  })

  test("una solicitud que se queda sin OC conserva su número y no enlaza con la OC de la siguiente", async ({ page }) => {
    // El escenario: A no llega nunca a OC, B sí. Son dos series distintas
    // (`code_seq_sol_0` y `code_seq_oc_2026`, una secuencia nativa por prefijo),
    // así que el número de OC no se deriva del de la solicitud y A no reserva
    // nada en la serie de compras — simplemente no participa de ella.
    const solA = await createEppRequest(page, EPP_RENAMED, "3")
    const requestAId = idFromUrl(page)
    expect(requestAId).toBeTruthy()

    const solB = await createEppRequest(page, EPP_RENAMED, "4")
    // La serie de solicitudes avanza con cada solicitud, llegue o no a OC.
    expect(solB).not.toBe(solA)
    expect(sequenceOf(solB)).toBeGreaterThan(sequenceOf(solA))

    // ── Sólo B se aprueba y llega a OC ──────────────────────────────────────
    await page.goto(`/aprobaciones?q=${solB}`)
    const groupB = page.locator("div:has(> ul)").filter({ hasText: solB })
    await expect(groupB).toHaveCount(1)
    await groupB.getByRole("button", { name: "Aprobar", exact: true }).click()
    await page.getByRole("button", { name: "Confirmar aprobación" }).click()
    await expect(groupB).toHaveCount(0, { timeout: 30_000 })

    await page.goto("/compras/nueva")
    await selectRadixById(page, "ocWorksiteId", "Faena E2E")
    await selectRadixById(page, "supplierId", "Proveedor E2E")
    // A comparte producto con B pero no está aprobada, así que no llega acá: un
    // solo ítem, y su fila lleva el código de B.
    const itemB = page.getByRole("checkbox", { name: `Incluir ${EPP_RENAMED}`, exact: true })
    await expect(itemB).toHaveCount(1)
    await expect(ocFormItemRow(page, EPP_RENAMED, solB)).toBeVisible()
    await itemB.check()
    await page.getByRole("button", { name: /Crear OC \(1 ítem\)/ }).click()
    await expect(page).toHaveURL(/\/compras\/(?!nueva$)[^/]+$/, { timeout: 20_000 })

    const orderB = (await page.getByRole("heading", { level: 1 }).first().textContent())?.trim() ?? ""
    expect(orderB).toMatch(/^OC-\d{4}-\d{4,}$/)
    expect(orderB).not.toBe(orderCode)

    // La OC enlaza a B y en ninguna parte a A: el correlativo de la solicitud
    // sin OC no se cuela en la orden de la siguiente.
    await expectCode(page, solB)
    await expect(page.getByText(new RegExp(`${escapeRegExp(solA)}(?!\\d)`))).toHaveCount(0)

    // ── A no se movió: mismo número, y sigue sin entrar a compras ───────────
    await page.goto(`/solicitudes/${requestAId}`)
    await expect(page.getByRole("heading", { level: 1, name: solA })).toBeVisible()
    await expect(page.getByText("Enviada").first()).toBeVisible()

    await page.goto(`/solicitudes?q=${solA}`)
    await expect(page.getByRole("link", { name: `Ver solicitud ${solA}`, exact: true }))
      .toHaveCount(1)
  })

  test("el expediente enlaza los libros entre sí, en el documento y desde la búsqueda por código", async ({ page }) => {
    const expediente = page.getByRole("navigation", { name: "Expediente del documento" })

    // ── En la OC: su solicitud de origen, sin salir de la página ────────────
    await page.goto(`/compras/${orderId}`)
    await expect(expediente).toBeVisible({ timeout: 15_000 })
    await expect(expediente.getByRole("link", { name: requestCode, exact: true })).toBeVisible()
    // El documento que estás mirando se marca y no se enlaza a sí mismo.
    await expect(expediente.getByRole("link", { name: orderCode, exact: true })).toHaveCount(0)
    await expect(expediente.getByText(orderCode, { exact: true })).toBeVisible()

    // Y el enlace lleva de verdad a la solicitud correcta.
    await expediente.getByRole("link", { name: requestCode, exact: true }).click()
    await expect(page.getByRole("heading", { level: 1, name: requestCode })).toBeVisible({ timeout: 15_000 })

    // ── En la recepción: la cadena completa ─────────────────────────────────
    // Se llega por el propio expediente y no por la bandeja de recepción: esta
    // OC ya está completada, así que salió de la cola. Ese es justamente el
    // caso donde el expediente sirve — un documento cerrado ya no se alcanza
    // desde ninguna lista operativa.
    await page.goto(`/compras/${orderId}`)
    await expediente.getByRole("link", { name: /^REC-/ }).first().click()
    await expect(page).toHaveURL(/\/recepcion\/(?!nueva)[^/?]+$/, { timeout: 15_000 })
    await expect(expediente.getByRole("link", { name: requestCode, exact: true })).toBeVisible()
    await expect(expediente.getByRole("link", { name: orderCode, exact: true })).toBeVisible()

    // ── Búsqueda por código: cualquier libro resuelve al expediente ─────────
    // Se busca por la OC y tienen que salir su solicitud y sus recepciones, que
    // es justo lo que el número por sí solo no permite deducir.
    await page.goto("/trazabilidad/documento")
    await page.getByLabel("Código del documento").fill(orderCode)
    await page.getByRole("button", { name: "Buscar" }).click()
    await expect(page).toHaveURL(/codigo=/, { timeout: 15_000 })

    const documentos = page.getByRole("list").filter({ hasText: orderCode })
    await expect(documentos.getByText(requestCode, { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(documentos.getByText(orderCode, { exact: true })).toBeVisible()
    await expect(documentos.getByText(/^REC-/).first()).toBeVisible()

    // El mismo expediente se alcanza entrando por la solicitud.
    await page.goto(`/trazabilidad/documento?codigo=${encodeURIComponent(requestCode)}`)
    await expect(page.getByText(orderCode, { exact: true }).first()).toBeVisible({ timeout: 15_000 })

    // Un código inexistente no inventa un expediente.
    await page.goto("/trazabilidad/documento?codigo=OC-2026-9999")
    await expect(page.getByText(/No se encontró OC-2026-9999/)).toBeVisible({ timeout: 15_000 })
  })

  test("el detalle de trazabilidad publica el correlativo de la solicitud", async ({ page }) => {
    // El hueco que cerró esta tanda: la pantalla que existe para responder "¿de
    // dónde viene esto?" mostraba el código de la OC pero no el de la solicitud,
    // y obligaba a volver a la matriz para leerlo.
    await page.goto(`/trazabilidad/${traceItemId}`)
    await expectCode(page, requestCode)
    await expect(page.getByRole("link", { name: new RegExp(`Ver solicitud ${escapeRegExp(requestCode)}`) }))
      .toBeVisible({ timeout: 15_000 })
  })
})
