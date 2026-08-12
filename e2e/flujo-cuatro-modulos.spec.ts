import { expect, test, type Page } from "@playwright/test"
import { login, selectRadixById, pickCurrentMonthDate, idFromUrl, receiptSubmitName, receiptStageCard, clearGuidesFromReceptionQueue } from "./helpers"

/**
 * El flujo completo dentro de los cuatro módulos que existen —Solicitudes,
 * Aprobaciones, Compras, Recepción— sin ningún paso manual que mueva un
 * registro de uno a otro.
 *
 * `purchase-flow` ya recorre el camino feliz. Lo que cubre este spec es la
 * pertenencia a cada cola, que era justamente lo que no se probaba: Compras
 * conocía sus pendientes sólo como un contador ("N ítems aprobados sin incluir
 * en ninguna OC") y no había forma de comprobar QUÉ solicitudes esperaban,
 * porque no aparecían en ninguna lista.
 */

const PRODUCTO = "Guante E2E"
const SKU = "E2E-001"

/**
 * La fila de la cola de Compras correspondiente a una solicitud.
 *
 * `?q=<código>` y no `/compras` a secas: la cola es FIFO (lo que lleva más
 * tiempo esperando va primero) y la BD E2E llega con una decena de solicitudes
 * sembradas, así que la que acaba de crearse cae en la última página. Buscar por
 * código es además lo que hace un comprador que persigue una solicitud concreta,
 * y ejercita el filtro de la cola.
 */
function colaRow(page: Page, requestCode: string) {
  return page
    .getByRole("table", { name: /pendientes de orden de compra/i })
    .getByRole("row")
    .filter({ hasText: requestCode })
}

async function abrirCola(page: Page, requestCode: string) {
  await page.goto(`/compras?q=${requestCode}`)
  // La tabla llega en el HTML del servidor, así que esperarla evita contar filas
  // contra un documento a medio pintar. En 0 filas también existe: `DataTable`
  // renderiza la tabla con su estado vacío dentro.
  await page.getByRole("table", { name: /pendientes de orden de compra/i })
    .waitFor({ state: "visible", timeout: 15_000 })
}

/**
 * Espera a que la cola de Compras entregue exactamente `esperado` filas para esa
 * solicitud. Es un poll con re-navegación porque la página se renderiza en el
 * servidor: si se pide antes de que el commit de la transición sea visible llega
 * sin la fila y ninguna espera de Playwright la rellena.
 */
async function esperarEnCola(page: Page, requestCode: string, esperado: number) {
  await expect.poll(async () => {
    await abrirCola(page, requestCode)
    return colaRow(page, requestCode).count()
  }, { timeout: 60_000 }).toBe(esperado)
}

test.describe("Solicitudes → Aprobaciones → Compras → Recepción", () => {
  test("la solicitud aprobada aparece en Compras como registro, no sólo como contador", async ({ page }) => {
    await login(page)
    const requestCode = await crearSolicitud(page, [
      { nombre: PRODUCTO, cantidad: "4" },
    ])

    // ── Aprobaciones: la solicitud espera decisión ─────────────────────────
    await page.goto("/aprobaciones")
    const grupo = page.locator("div:has(> ul)").filter({ hasText: requestCode })
    await expect(grupo).toHaveCount(1)
    await grupo.getByRole("button", { name: "Aprobar", exact: true }).click()
    await page.getByRole("button", { name: "Confirmar aprobación" }).click()
    await expect(grupo).toHaveCount(0, { timeout: 30_000 })

    // ── Compras: aparece sin ninguna acción de "enviar a compras" ──────────
    await esperarEnCola(page, requestCode, 1)

    const fila = colaRow(page, requestCode).first()
    // La fila tiene lo que hace falta para decidir: quién pidió, dónde, cuántos
    // ítems esperan y una acción.
    await expect(fila).toContainText("Faena E2E")
    await expect(fila.getByRole("link", { name: `Ver solicitud ${requestCode}` })).toBeVisible()
    await expect(fila.getByRole("link", { name: "Generar OC" })).toBeVisible()

    // Y el desglose de sus ítems se puede abrir desde la misma fila.
    await fila.getByRole("button", { name: new RegExp(`Ver ítems de ${requestCode}`) }).click()
    const desglose = page.getByRole("table", { name: /pendientes de orden de compra/i })
    await expect(desglose.getByText("Aprobado · sin OC").first()).toBeVisible()

    // El resumen sigue existiendo, pero ahora acompaña a los registros.
    await expect(page.getByText(/ítems? aprobados? sin incluir en ninguna OC/)).toBeVisible()
  })

  test("aprobación parcial: sólo los ítems aprobados llegan a Compras", async ({ page }) => {
    await login(page)
    const requestCode = await crearSolicitud(page, [
      { nombre: PRODUCTO, cantidad: "3" },
      { nombre: "Rechazable E2E", cantidad: "2", libre: true },
    ])

    await page.goto("/aprobaciones")
    const grupo = page.locator("div:has(> ul)").filter({ hasText: requestCode })
    await expect(grupo).toHaveCount(1)

    // El diálogo de rechazo es Radix, o sea cliente puro: un clic antes de que
    // hidrate no abre nada y la falla aparece más abajo, en un `fill` contra un
    // campo que nunca existió.
    await page.waitForLoadState("networkidle").catch(() => undefined)
    const itemRechazado = grupo.getByRole("listitem").filter({ hasText: "Rechazable E2E" })
    await itemRechazado.getByRole("button", { name: "Rechazar" }).click()
    await page.getByPlaceholder("Explica por qué este ítem no puede ser aprobado...").fill("No corresponde")
    await page.getByRole("button", { name: "Confirmar rechazo" }).click()
    await expect(itemRechazado).toHaveCount(0, { timeout: 30_000 })

    const itemAprobado = grupo.getByRole("listitem").filter({ hasText: PRODUCTO })
    await itemAprobado.getByRole("button", { name: "Aprobar", exact: true }).click()
    await page.getByRole("button", { name: "Confirmar aprobación" }).click()
    await expect(grupo).toHaveCount(0, { timeout: 30_000 })

    await esperarEnCola(page, requestCode, 1)

    const fila = colaRow(page, requestCode).first()
    await fila.getByRole("button", { name: new RegExp(`Ver ítems de ${requestCode}`) }).click()

    const tabla = page.getByRole("table", { name: /pendientes de orden de compra/i })
    // El aprobado está como accionable y el rechazado, marcado como tal: la
    // aprobación parcial se lee como parcial.
    const lineaAprobada = tabla.getByRole("listitem").filter({ hasText: PRODUCTO })
    await expect(lineaAprobada.getByText("Aprobado · sin OC")).toBeVisible()
    const lineaRechazada = tabla.getByRole("listitem").filter({ hasText: "Rechazable E2E" })
    await expect(lineaRechazada.getByText("Rechazado")).toBeVisible()

    // Y el rechazado no es comprable desde el selector tampoco.
    await page.goto("/compras/nueva")
    await expect(page.getByText("Rechazable E2E")).toHaveCount(0)
  })

  test("generar la OC saca la solicitud de Compras y la deja en Recepción sin pasos manuales", async ({ page }) => {
    // Recorre los cuatro módulos y además coteja las dos GDI que dejan las dos
    // llegadas a oficina: son ~15 navegaciones más que cualquier otro test de
    // este archivo, y con la máquina cargada no cabía en los 150 s por defecto.
    test.setTimeout(300_000)
    await login(page)
    const requestCode = await crearSolicitud(page, [
      { nombre: PRODUCTO, cantidad: "6" },
    ])

    await page.goto("/aprobaciones")
    const grupo = page.locator("div:has(> ul)").filter({ hasText: requestCode })
    await expect(grupo).toHaveCount(1)
    await grupo.getByRole("button", { name: "Aprobar", exact: true }).click()
    await page.getByRole("button", { name: "Confirmar aprobación" }).click()
    await expect(grupo).toHaveCount(0, { timeout: 30_000 })

    await esperarEnCola(page, requestCode, 1)

    // ── "Generar OC" desde la fila: llega con los ítems ya marcados ─────────
    await colaRow(page, requestCode).first().getByRole("link", { name: "Generar OC" }).click()
    await expect(page).toHaveURL(/\/compras\/nueva\?/)
    await selectRadixById(page, "supplierId", "Proveedor E2E")
    // El botón anuncia el conteo, así que basta con leerlo para comprobar que
    // la preselección llegó: no hay que volver a marcar la casilla a mano.
    const crear = page.getByRole("button", { name: /Crear OC \(1 ítem\)/ })
    await expect(crear).toBeVisible()
    await crear.click()
    // La espera se ancla al encabezado de la OC y NO a `toHaveURL`. Se llega a
    // este formulario con query (`?faena=…&solicitud=…`), y contra esa URL el
    // patrón habitual `/\/compras\/(?!nueva$)[^/]+$/` se cumple de inmediato:
    // `[^/]+$` acepta la query, así que `nueva?faena=…` pasa el lookahead. Con
    // eso `idFromUrl` devolvía "nueva" y la navegación de más abajo volvía al
    // formulario — el mismo trampolín que documenta `idFromUrl` en helpers.
    const ocHeading = page.getByRole("heading", { level: 1, name: /^OC-/ })
    await expect(ocHeading).toBeVisible({ timeout: 30_000 })
    const orderCode = ((await ocHeading.textContent()) ?? "").trim()
    const orderId = idFromUrl(page)
    expect(orderId, "la creación no dejó la ficha de la OC en pantalla").not.toBe("nueva")

    // ── La solicitud desaparece de la cola activa de Compras ───────────────
    await esperarEnCola(page, requestCode, 0)

    // Pero sigue accesible: no se borró, salió de una cola.
    await page.goto(`/solicitudes?q=${requestCode}`)
    await expect(page.getByRole("link", { name: `Ver solicitud ${requestCode}`, exact: true })).toHaveCount(1)

    // ── Recepción: la OC llega sola, sin ningún "Mover a Recepciones" ──────
    await page.goto(`/compras/${orderId}`)
    // No existe ninguna acción de traslado entre módulos: la única transición
    // es la de negocio (emitir y enviar la OC al proveedor).
    await expect(page.getByRole("button", { name: /Mover a Recepci/i })).toHaveCount(0)
    await expect(page.getByRole("link", { name: /Mover a Recepci/i })).toHaveCount(0)
    const emitir = page.getByRole("button", { name: "Emitir y enviar" })
    await expect(emitir).toBeVisible({ timeout: 30_000 })
    await emitir.click()
    await expect(emitir).toBeHidden({ timeout: 30_000 })

    // Estar "en la cola" es tener acción pendiente, no sólo figurar: `/recepcion`
    // sin filtro lista también las completadas. Antes eso quedaba tapado porque
    // el localizador exigía el enlace `?oc=`, que sólo existe mientras la OC es
    // recibible; en cuanto la GDI cambia la acción a "Completar guía" ese
    // localizador daba la OC por desaparecida de la cola.
    const filaRecepcion = page.locator("tbody tr").filter({ hasText: orderCode })
    const accionPendiente = filaRecepcion.getByRole("link", { name: /Recibir|Completar guía|Cotejar/ })
    await expect.poll(async () => {
      await page.goto("/recepcion")
      return accionPendiente.count()
    }, { timeout: 30_000 }).toBe(1)

    // ── Recepción parcial: la OC se queda en la cola ───────────────────────
    await filaRecepcion.first().getByRole("link", { name: "Recibir" }).click()
    await receiptStageCard(page, "Oficina").click()
    await registrarRecepcion(page, "2")

    await expect.poll(async () => {
      await page.goto("/recepcion")
      return accionPendiente.count()
    }, { timeout: 30_000 }).toBe(1)

    // ── Recepción completa: sale de la cola activa y queda en Completadas ──
    // El saldo entra por oficina; la faena ya no se registra en el formulario,
    // se cierra cotejando las guías que dejó cada llegada.
    await recibirTodo(page, orderId, "4")
    await clearGuidesFromReceptionQueue(page, orderCode, 2)

    await expect.poll(async () => {
      await page.goto("/recepcion")
      return accionPendiente.count()
    }, { timeout: 30_000 }).toBe(0)

    // El historial no se pierde: sale de la cola activa y vive en su tab.
    await page.goto(`/recepcion?estado=received,closed&q=${orderCode}`)
    await expect(page.getByRole("link", { name: `Ver OC ${orderCode}`, exact: true })).toHaveCount(1)
    await page.goto(`/compras/${orderId}`)
    await expect(page.getByText(/Completada/).first()).toBeVisible()
  })

  test("el contador de Compras coincide con las filas que entrega", async ({ page }) => {
    await login(page)
    await page.goto("/compras")

    const resumen = page.getByText(/ítems? aprobados? sin incluir en ninguna OC/)
    const filas = page.getByRole("table", { name: /pendientes de orden de compra/i }).getByRole("row")

    if (await resumen.count() === 0) {
      // Cola vacía: el mensaje tiene que decirlo, no quedar en blanco.
      await expect(page.getByText(/No hay ítems aprobados esperando orden de compra|Ningún ítem aprobado sin OC/)).toBeVisible()
      return
    }

    const texto = (await resumen.innerText()).replace(/\s+/g, " ")
    const items = Number(texto.match(/(\d+)\s+ítems?/)?.[1] ?? "0")
    const solicitudes = Number(texto.match(/en\s+(\d+)\s+solicitudes?|en\s+(1)\s+solicitud/)?.slice(1).find(Boolean) ?? "0")
    expect(items).toBeGreaterThan(0)
    expect(solicitudes).toBeGreaterThan(0)

    // El resumen no puede prometer más solicitudes que las que la página
    // entrega: era exactamente la incoherencia que se buscaba cerrar. Menos sí,
    // porque la cola pagina y el resumen cuenta el total.
    const filasEnPagina = (await filas.count()) - 1 // menos la fila de encabezado
    expect(solicitudes).toBeGreaterThanOrEqual(filasEnPagina)
    // Y cada solicitud aporta al menos un ítem pendiente.
    expect(items).toBeGreaterThanOrEqual(solicitudes)
  })
})

/** Crea una solicitud con los ítems dados y devuelve su código. */
async function crearSolicitud(
  page: Page,
  items: Array<{ nombre: string; cantidad: string; libre?: boolean }>,
): Promise<string> {
  await page.goto("/solicitudes/nueva")
  await selectRadixById(page, "worksiteId", "Faena E2E")
  await pickCurrentMonthDate(page, "Seleccionar fecha")

  for (const [index, item] of items.entries()) {
    if (index > 0) await page.getByRole("button", { name: "Agregar ítem" }).click()
    // `.last()` y no `.nth(index)`: al elegir un producto el picker se
    // reemplaza por el nombre del ítem y un botón "Cambiar", así que el único
    // picker en pantalla es siempre el del ítem que se acaba de agregar.
    await page.getByPlaceholder("Buscar en catálogo o escribir producto...").last().fill(item.nombre)
    if (item.libre) {
      await page.getByRole("option", { name: new RegExp(`Usar “${item.nombre}”`) }).click()
    } else {
      await page.getByRole("option", { name: new RegExp(`${SKU}\\s*${item.nombre}`) }).click()
    }
    await page.getByRole("spinbutton", { name: "Cantidad" }).nth(index).fill(item.cantidad)
  }

  await page.getByRole("button", { name: "Crear y enviar a aprobación" }).click()
  // La espera se ancla al h1 QUE YA TRAE EL CÓDIGO. Con `toHaveURL` + lectura
  // inmediata se leía "Solicitud", que es el título del esqueleto
  // (`solicitudes/[id]/loading.tsx`): la URL cambia antes de que la ficha
  // termine de renderizar, así que la carrera se pierde de forma intermitente.
  const heading = page.getByRole("heading", { level: 1, name: /SOL-\d+/ })
  await expect(heading).toBeVisible({ timeout: 30_000 })
  // `textContent` y no `innerText`: el h1 del PageHeader es `lg:sr-only` en
  // desktop, así que `innerText` vuelve vacío.
  const text = ((await heading.textContent()) ?? "").trim()
  const code = text.match(/SOL-\d+/)?.[0]
  expect(code, `no se pudo leer el código de la solicitud en "${text}"`).toBeTruthy()
  return code!
}

async function registrarRecepcion(page: Page, cantidad: string) {
  await page.getByRole("spinbutton", { name: new RegExp(`Cantidad a recibir de ${PRODUCTO}`, "i") })
    .first()
    .fill(cantidad)
  await page.getByRole("button", { name: receiptSubmitName("Oficina") }).click()
  // Anclado al efecto real: `/recepcion/[id]` también matchea `/recepcion/nueva`,
  // que es la URL en la que ya estamos, así que esa espera se cumplía sola.
  await expect(page.getByRole("heading", { name: /^REC-/ })).toBeVisible({ timeout: 30_000 })
}

/** La faena ya no se registra aquí: se cierra cotejando la guía. */
async function recibirTodo(page: Page, orderId: string, cantidad: string) {
  await page.goto(`/recepcion/nueva?oc=${orderId}`)
  await receiptStageCard(page, "Oficina").click()
  await registrarRecepcion(page, cantidad)
}
