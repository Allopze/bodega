import { expect, test, type Page } from "@playwright/test"
import {
  cerrarSesion, issueOrderFromDetail, login, pickCurrentMonthDate, receiptSubmitName, receiptStageCard,
  selectRadixById, textoVisible,
} from "./helpers"
import { withSql } from "./mantencion-3-helpers"
import { REPUESTOS_CATALOGO_E2E } from "./fixtures/repuestos-catalogo-setup"

/**
 * Catálogo de repuestos (fase 2), pantalla `/mantencion/repuestos`.
 *
 * Los dos primeros tests cubren la pantalla misma: alta, N° de parte repetido, ficha, edición, baja y alta de nuevo,
 * y que la autorización viva en el servidor y no sólo en el menú. El tercero recorre los pasos 2–5 de la verificación
 * del plan, que cruzan solicitud, OC y recepción: pedir desde la OT con el buscador, catalogar al armar la OC, precio
 * al emitir y recepción en faena sin movimiento de Bodega. Los repuestos y la compra previa que ordena el buscador
 * los siembra `e2e/fixtures/repuestos-catalogo-setup.ts`.
 *
 * Los datos llevan el prefijo `QA_` y un N° de parte distinto en cada corrida: el catálogo no se vacía entre ellas.
 */

test("la jefatura de mantención crea un repuesto, uno repetido se rechaza bajo su campo y puede darlo de baja y de alta", async ({ page }) => {
  const partNumber = `QA-${Date.now().toString(36).toUpperCase()}`
  const name = `QA_Filtro de aceite ${partNumber}`

  await login(page, "jefe.mant@e2e.chome.cl")
  await page.goto("/mantencion/repuestos")
  await expect(page.getByRole("link", { name: "Catálogo de repuestos", exact: true }).first()).toBeVisible()

  // Alta.
  await page.getByRole("button", { name: "Nuevo repuesto" }).first().click()
  const alta = page.getByRole("dialog", { name: "Nuevo repuesto" })
  await alta.getByLabel("Nombre del repuesto").fill(name)
  await alta.getByLabel("N° de parte").fill(partNumber)
  await alta.getByLabel("Marca del repuesto").fill("Caterpillar")
  await alta.getByLabel("Precio de referencia (CLP)").fill("18990")
  await alta.getByRole("button", { name: "Crear repuesto" }).click()
  await expect(alta).toBeHidden()
  const fila = page.getByRole("link", { name, exact: true })
  await expect(fila).toBeVisible()
  await expect(textoVisible(page, `N° ${partNumber} · Caterpillar`)).toBeVisible()

  // El mismo N° de parte y marca (sin distinguir mayúsculas) se rechaza y el error queda bajo «N° de parte», sin perder lo escrito.
  await page.getByRole("button", { name: "Nuevo repuesto" }).first().click()
  const repetido = page.getByRole("dialog", { name: "Nuevo repuesto" })
  await repetido.getByLabel("Nombre del repuesto").fill("QA_Otro filtro")
  await repetido.getByLabel("N° de parte").fill(partNumber.toLowerCase())
  await repetido.getByLabel("Marca del repuesto").fill("caterpillar")
  await repetido.getByRole("button", { name: "Crear repuesto" }).click()
  await expect(repetido.getByRole("alert").filter({ hasText: /Ya existe el repuesto RPT-\d+ con ese N° de parte/ })).toBeVisible()
  await expect(repetido.getByLabel("Nombre del repuesto")).toHaveValue("QA_Otro filtro")
  await repetido.getByRole("button", { name: "Cancelar" }).click()
  await expect(repetido).toBeHidden()

  // Un formulario sin nombre dice qué falta.
  await page.getByRole("button", { name: "Nuevo repuesto" }).first().click()
  const vacio = page.getByRole("dialog", { name: "Nuevo repuesto" })
  await vacio.getByRole("button", { name: "Crear repuesto" }).click()
  await expect(vacio.getByRole("alert").filter({ hasText: "Escribe el nombre del repuesto" })).toBeVisible()
  await vacio.getByRole("button", { name: "Cancelar" }).click()

  // La búsqueda de la barra superior filtra la lista por N° de parte.
  await page.getByPlaceholder("Filtrar en esta página...").fill(partNumber.toLowerCase())
  await expect(fila).toBeVisible()
  await page.getByPlaceholder("Filtrar en esta página...").fill("zzz-no-existe")
  await expect(textoVisible(page, "Ningún repuesto coincide")).toBeVisible()
  await page.getByPlaceholder("Filtrar en esta página...").fill("")

  // Ficha: sin compras todavía, con una sola explicación; se edita desde ahí.
  await fila.click()
  await expect(page).toHaveURL(/\/mantencion\/repuestos\/[^/?]+$/)
  await expect(textoVisible(page, "Todavía no se ha comprado")).toBeVisible()
  await page.getByRole("button", { name: "Editar" }).first().click()
  const edicion = page.getByRole("dialog", { name: "Editar repuesto" })
  await edicion.getByLabel("Precio de referencia (CLP)").fill("20500")
  await edicion.getByRole("button", { name: "Guardar cambios" }).click()
  await expect(edicion).toBeHidden()
  await expect(textoVisible(page, "$20.500")).toBeVisible()

  // Baja con confirmación: el repuesto pasa a «Inactivos» y puede activarse de nuevo.
  await page.getByRole("button", { name: "Desactivar" }).first().click()
  const confirmar = page.getByRole("dialog", { name: /Desactivar QA_/ })
  await expect(confirmar.getByText(/Su historial de compras y de precios se conserva/)).toBeVisible()
  await confirmar.getByRole("button", { name: "Desactivar", exact: true }).click()
  await expect(page.getByRole("button", { name: "Activar", exact: true }).first()).toBeVisible()
  await page.goto("/mantencion/repuestos?estado=inactivos")
  await expect(page.getByRole("link", { name, exact: true })).toBeVisible()
  await page.getByRole("link", { name, exact: true }).click()
  await page.getByRole("button", { name: "Activar", exact: true }).first().click()
  await expect(page.getByRole("button", { name: "Desactivar" }).first()).toBeVisible()
})

test("quien no tiene repuestos:catalog no ve el ítem del menú y el servidor le cierra la pantalla y la ficha", async ({ page }) => {
  await login(page, "supervisor@e2e.chome.cl")
  // El supervisor de mantención ve el resto del grupo, pero no el catálogo.
  await page.goto("/mantencion/ot")
  await expect(page.getByRole("link", { name: "Órdenes de trabajo", exact: true }).first()).toBeVisible()
  await expect(page.getByRole("link", { name: "Catálogo de repuestos", exact: true })).toHaveCount(0)

  // La autorización es del servidor: por URL tampoco entra, ni a la lista ni a una ficha.
  for (const url of ["/mantencion/repuestos", "/mantencion/repuestos/cualquier-id"]) {
    await page.goto(url)
    await expect(page.getByRole("heading", { name: "Sin permisos suficientes", level: 1 }), `${url} debe quedar bloqueada`).toBeVisible()
  }
})

const JEFE = "jefe.mant@e2e.chome.cl"
const NOMBRE_MECANICO = "Mecánico Uno E2E"

/** El primer equipo de Biodiversa con ficha de mantención: el mismo para el que el sembrado registró la compra previa. */
async function equipoDeBiodiversa(): Promise<{ code: string; plate: string }> {
  return withSql(async (sql) => {
    const [row] = await sql`
      select v.code as code, v.plate as plate
      from mant_equipment_profiles p
      join fuel_vehicles v on v.id = p.vehicle_id
      join worksites w on w.id = v.worksite_id
      where w.name = 'Biodiversa' and v.is_active = true and v.code is not null
      order by v.code asc
      limit 1`
    expect(row, "Biodiversa necesita un equipo con ficha de mantención").toBeTruthy()
    return { code: row!.code as string, plate: row!.plate as string }
  })
}

async function crearOt(page: Page, equipo: { code: string }) {
  await page.goto("/mantencion/ot")
  await page.getByRole("button", { name: /^(Nueva OT|Crear la primera orden)$/ }).first().click()
  const hoja = page.getByRole("dialog", { name: "Nueva orden de trabajo" })
  await expect(hoja).toBeVisible()
  await hoja.locator("#ot-equipo").click()
  await hoja.locator("#ot-equipo").fill(equipo.code)
  await page.getByRole("option", { name: new RegExp(equipo.code) }).first().click()
  await selectRadixById(page, "ot-mecanico", NOMBRE_MECANICO)
  await hoja.locator("#ot-reparacion-desc").fill("QA_ Cambio de filtros del catálogo")
  await hoja.getByRole("button", { name: "Crear OT", exact: true }).click()
  await expect(page).toHaveURL(/\/mantencion\/ot\/[^/]+$/, { timeout: 30_000 })
  const otId = new URL(page.url()).pathname.split("/").pop() ?? ""
  const titulo = await page.getByRole("heading", { level: 1 }).first().innerText()
  const folio = /OT-[A-Z]+-\d{4}/.exec(titulo)?.[0] ?? ""
  expect(folio, "el título de la OT lleva su folio").not.toBe("")
  return { otId, folio }
}

/** La lista de OT con el filtro «esperando repuesto», releída hasta que el servidor confirme el estado esperado. */
async function expectOtEsperando(page: Page, folio: string, esperando: boolean) {
  const fila = page.getByRole("row").filter({ hasText: folio })
  await expect(async () => {
    await page.goto("/mantencion/ot?repuestos=pendientes")
    await expect(fila).toHaveCount(esperando ? 1 : 0, { timeout: 5_000 })
  }).toPass({ timeout: 60_000 })
}

test("pedir desde la OT con el catálogo, catalogar al armar la OC, precio al emitir y recepción en faena sin Bodega", async ({ page }) => {
  test.setTimeout(360_000)
  const { search, otherPart, vehiclePart } = REPUESTOS_CATALOGO_E2E
  const run = Date.now().toString(36).toUpperCase()
  const libre = `QA_Correa alternador ${run}`
  const libreParte = `QA-NEW-${run}`
  const equipo = await equipoDeBiodiversa()

  // ── Paso 2: desde la OT, el buscador ofrece primero lo ya comprado para el equipo y precarga su precio ──
  await login(page, JEFE)
  const { otId, folio } = await crearOt(page, equipo)
  await page.getByRole("button", { name: "Más acciones" }).click()
  await page.getByRole("menuitem", { name: "Pedir repuestos" }).click()
  await expect(page).toHaveURL(new RegExp(`/solicitudes/nueva\\?tipo=repuestos&ot=${otId}`))
  await page.waitForLoadState("networkidle").catch(() => undefined)
  await expect(page.getByRole("combobox", { name: "Equipo de flota" })).toHaveValue(new RegExp(equipo.plate))

  const buscador = page.getByRole("combobox", { name: /Descripción/ }).first()
  await buscador.click()
  await buscador.fill(search)
  const opciones = page.getByRole("option")
  // `QA_Aceite…` va antes por nombre, pero nunca se compró para este equipo: el filtro va primero.
  await expect(opciones.first()).toContainText(vehiclePart.name)
  await expect(opciones.first()).toContainText("Para este equipo")
  await expect(opciones.filter({ hasText: otherPart.name })).toHaveCount(1)
  await opciones.first().click()

  const elegido = page.getByRole("group", { name: "Repuesto elegido" })
  await expect(elegido).toContainText(vehiclePart.name)
  await expect(elegido).toContainText(vehiclePart.partNumber)
  await expect(page.getByLabel("Precio unitario estimado (CLP)").first()).toHaveValue(String(vehiclePart.preferredPrice))

  // Segunda línea en texto libre: Compras la catalogará al armar la OC.
  await page.getByRole("button", { name: /Agregar ítem/ }).click()
  await page.getByPlaceholder("Describe el ítem requerido...").fill(libre)
  await page.getByPlaceholder("OEM o fabricante").fill(libreParte)
  await page.getByLabel("Precio unitario estimado (CLP)").nth(1).fill("45000")
  await pickCurrentMonthDate(page, "Seleccionar fecha")
  await page.getByRole("button", { name: /Guardar borrador/ }).click()
  await expect(textoVisible(page, /^Borrador guardado/).first()).toBeVisible({ timeout: 30_000 })

  // Bajo el umbral basta el precio estimado: se envía sin cotización.
  await page.goto(`/mantencion/ot/${otId}`)
  await textoVisible(page, /^REP-/).first().click()
  await expect(page).toHaveURL(/\/solicitudes\/(?!nueva)[^/?]+$/, { timeout: 30_000 })
  const requestId = new URL(page.url()).pathname.split("/").pop() ?? ""
  const enviar = page.getByRole("button", { name: /Enviar a aprobación/ })
  await expect(enviar).toBeVisible({ timeout: 30_000 })
  await enviar.click()
  await expect(enviar).toHaveCount(0, { timeout: 30_000 })
  await expectOtEsperando(page, folio, true)

  // ── Paso 3: aprobación sin cotización; Compras arma la OC y cataloga la línea libre creando un repuesto ──
  await cerrarSesion(page)
  await login(page)
  await page.goto(`/solicitudes/${requestId}`)
  await expect(page.getByRole("heading", { name: "Cotizaciones" })).toBeVisible({ timeout: 15_000 })
  const aprobar = page.getByRole("button", { name: "Aprobar sin cotización", exact: true })
  const dialogoAprobar = page.getByRole("dialog", { name: "Aprobar sin cotización" })
  await expect(async () => {
    await aprobar.click()
    await expect(dialogoAprobar).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 30_000 })
  await dialogoAprobar.getByRole("button", { name: "Confirmar aprobación" }).click()
  await expect(textoVisible(page, "Aprobada").first()).toBeVisible({ timeout: 15_000 })

  const { worksiteId, libreItemId } = await withSql(async (sql) => {
    const rows = await sql`
      select r.worksite_id, i.id, i.product_id, i.product_name_free
      from purchase_request_items i join purchase_requests r on r.id = i.request_id
      where i.request_id = ${requestId}`
    expect(rows).toHaveLength(2)
    const libreRow = rows.find((row) => row.product_name_free === libre)
    expect(libreRow, "la línea libre se guardó como texto").toBeTruthy()
    expect(libreRow!.product_id).toBeNull()
    expect(rows.find((row) => row.product_id === vehiclePart.id), "la línea del catálogo guardó su repuesto").toBeTruthy()
    return { worksiteId: rows[0]!.worksite_id as string, libreItemId: libreRow!.id as string }
  })

  await page.goto(`/compras/nueva?faena=${worksiteId}&solicitud=${requestId}`)
  await page.waitForLoadState("networkidle").catch(() => undefined)
  await selectRadixById(page, "supplierId", "Proveedor E2E")
  // Sólo la línea en texto libre se ofrece para catalogar: la otra ya es un repuesto del catálogo.
  const catalogar = page.getByRole("button", { name: "Catalogar", exact: true })
  await expect(catalogar).toHaveCount(1)
  await catalogar.click()
  const hoja = page.getByRole("dialog", { name: "Catalogar repuesto" })
  await expect(hoja).toBeVisible()
  await hoja.getByRole("button", { name: "Crear uno nuevo", exact: true }).click()
  await expect(hoja.getByLabel("Nombre del repuesto")).toHaveValue(libre)
  await expect(hoja.getByLabel("N° de parte")).toHaveValue(libreParte)
  await hoja.getByRole("button", { name: "Crear y vincular", exact: true }).click()
  await expect(hoja).toBeHidden({ timeout: 15_000 })
  await expect(catalogar).toHaveCount(0)
  await page.locator(`#price-${libreItemId}`).fill("45000")

  const crear = page.getByRole("button", { name: /Crear OC \(2 ítems\)/ })
  await expect(crear).toBeVisible()
  await crear.click()
  const ocHeading = page.getByRole("heading", { level: 1, name: /^OC-/ })
  await expect(ocHeading).toBeVisible({ timeout: 30_000 })
  const orderId = new URL(page.url()).pathname.split("/").pop() ?? ""
  expect(orderId).not.toBe("nueva")

  // La solicitud queda con el repuesto nuevo: el vínculo no vive sólo en la OC.
  const newPartId = await withSql(async (sql) => {
    const [part] = await sql`select id, sku, is_spare_part from products where part_number = ${libreParte}`
    expect(part, "el repuesto creado desde la OC existe").toBeTruthy()
    expect(part!.is_spare_part).toBe(true)
    const [item] = await sql`select product_id, product_name_free from purchase_request_items where id = ${libreItemId}`
    expect(item!.product_id).toBe(part!.id)
    const [ocLine] = await sql`select product_id from purchase_order_items where request_item_id = ${libreItemId}`
    expect(ocLine!.product_id).toBe(part!.id)
    return part!.id as string
  })

  // ── Paso 4: al emitir, la ficha muestra el precio y la línea de historial ──
  await issueOrderFromDetail(page)
  await expect(page.getByText(/Pendiente de recepción/).first()).toBeVisible({ timeout: 30_000 })
  await page.goto(`/mantencion/repuestos/${newPartId}`)
  // `TableRoot` nombra su contenedor desplazable (una región), no la tabla.
  const proveedores = page.getByRole("region", { name: "Tabla de proveedores y precios" })
  await expect(proveedores.getByRole("row").filter({ hasText: "Proveedor E2E" })).toContainText("$45.000")
  const historial = page.getByRole("region", { name: "Tabla del historial de precio" })
  const filaHistorial = historial.getByRole("row").filter({ hasText: "Proveedor E2E" })
  await expect(filaHistorial).toHaveCount(1)
  await expect(filaHistorial).toContainText("Orden de compra")
  await expect(filaHistorial).toContainText("$45.000")

  // ── Paso 5: recepción en faena → «Entregado», sin movimiento en Bodega, y la OT deja de esperar ──
  await page.goto(`/recepcion/nueva?oc=${orderId}`)
  // Directo a faena (lo que propone una solicitud de repuestos): no hay etapa de oficina.
  await expect(receiptStageCard(page, "Oficina")).toHaveCount(0)
  for (const nombre of [vehiclePart.name, libre]) {
    await page.getByLabel(`Cantidad a recibir de ${nombre}`, { exact: true }).filter({ visible: true }).fill("1")
  }
  await page.getByRole("button", { name: receiptSubmitName("Faena") }).click()
  await expect(page.getByRole("heading", { name: /^REC-/ })).toBeVisible({ timeout: 30_000 })

  await withSql(async (sql) => {
    const items = await sql`select status from purchase_request_items where request_id = ${requestId}`
    expect(items.map((item) => item.status)).toEqual(["delivered", "delivered"])
    const [movements] = await sql`
      select count(*)::int as n from inventory_movements where product_id in (${vehiclePart.id}, ${newPartId})`
    expect(movements!.n, "un repuesto de catálogo no mueve Bodega").toBe(0)
    const [stock] = await sql`
      select count(*)::int as n from worksite_stock where product_id in (${vehiclePart.id}, ${newPartId})`
    expect(stock!.n).toBe(0)
  })
  await page.goto(`/solicitudes/${requestId}`)
  await expect(textoVisible(page, "Entregado").first()).toBeVisible({ timeout: 15_000 })
  await expectOtEsperando(page, folio, false)
})
