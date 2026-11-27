import { expect, type APIResponse, type Browser, type BrowserContext, type Page } from "@playwright/test"
import ExcelJS from "exceljs"
import { cerrarSesion, selectRadixById } from "./helpers"
import { withSql } from "./mantencion-3-helpers"
import { entrarPlataforma } from "./notas-pedido-helpers"

/**
 * Ayudas de `notas-pedido-ciclo.spec.ts` (E2E del ciclo de la nota de pedido SIN OT: alta → aceptar → comprar → recepción
 * parcial → cierre automático, y sus casos negativos). Viven aparte para que el spec quede bajo el tope de líneas; no es
 * un `*.spec.ts`, así que Playwright no lo ejecuta. Usuarios de `e2e/fixtures/mantencion-setup.ts` (contraseña `chome2026`).
 */

export const ADMIN = "admin@e2e.chome.cl"
export const SUPERVISOR = "supervisor@e2e.chome.cl"
export const MECANICO_CHO = "mecanico.cho@e2e.chome.cl"
export const ADMIN_CONTRATO_CHO = "admin.contrato.cho@e2e.chome.cl"

/** Sufijo único por corrida: el spec se puede repetir sobre la misma base sin chocar con el SKU ni con el kárdex anterior. */
export const CICLO = Date.now().toString(36).toUpperCase()

/** El repuesto de catálogo que pide la nota (sin stock al empezar: lo que llegue por la OC es lo único que hay). */
export const REPUESTO_CICLO = {
  id: `rpt-ciclo-${CICLO.toLowerCase()}`,
  sku: `QA-CI-${CICLO}`,
  name: `QA_CICLO Filtro de aire ${CICLO}`,
  partNumber: `QA-CI-PN-${CICLO}`,
} as const
/** La línea en texto libre: Compras la cataloga al armar la OC. */
export const LIBRE_CICLO = `QA_CICLO Correa sin catalogar ${CICLO}`
export const LIBRE_PARTE = `QA-CI-NEW-${CICLO}`
/** Cantidades pedidas: el catálogo 3 y el libre 2 (la recepción parcial llega con 1 del catálogo). */
export const CANTIDAD = { catalogo: 3, libre: 2 } as const

export const escapar = (texto: string) => texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

// ── Sesiones ────────────────────────────────────────────────────────────────────────────────────

/** Un contexto de navegador nuevo, ya con la sesión de `email`: sirve para tener dos personas a la vez. */
export async function sesionComo(browser: Browser, email: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext()
  const page = await context.newPage()
  await entrarPlataforma(page, email)
  return { context, page }
}

export async function cambiarDeSesion(page: Page, email: string) {
  await cerrarSesion(page)
  await entrarPlataforma(page, email)
}

// ── Base de datos de la prueba ──────────────────────────────────────────────────────────────────

export interface EquipoDeCargo { id: string; code: string; plate: string; worksiteId: string; worksiteName: string }

/** El primer equipo (por código) de Biodiversa con ficha de mantención: el equipo al que se le carga la línea del catálogo. */
export async function equipoDeCargo(): Promise<EquipoDeCargo> {
  return withSql(async (sql) => {
    const [row] = await sql`
      select v.id as id, v.code as code, v.plate as plate, w.id as worksite_id, w.name as worksite_name
      from mant_equipment_profiles p
      join fuel_vehicles v on v.id = p.vehicle_id
      join worksites w on w.id = v.worksite_id
      where w.name = 'Biodiversa' and v.is_active = true and v.code is not null
      order by v.code asc
      limit 1`
    expect(row, "Biodiversa necesita un equipo con ficha de mantención").toBeTruthy()
    return { id: row!.id as string, code: row!.code as string, plate: row!.plate as string, worksiteId: row!.worksite_id as string, worksiteName: row!.worksite_name as string }
  })
}

export async function sembrarRepuestoCiclo(): Promise<void> {
  await withSql(async (sql) => {
    const now = new Date().toISOString()
    await sql`
      insert into products (id, sku, name, category_id, unit_of_measure, is_spare_part, part_number, is_active, created_at, updated_at)
      values (${REPUESTO_CICLO.id}, ${REPUESTO_CICLO.sku}, ${REPUESTO_CICLO.name}, 'cat-repuestos', 'unidad', true, ${REPUESTO_CICLO.partNumber}, true, ${now}, ${now})`
  })
}

export interface NotaEnBase {
  id: string; code: string; status: string; workOrderId: string | null; worksiteId: string; urgent: boolean
  lines: Array<{ id: string; description: string; quantity: number; productId: string | null; chargeVehicleId: string | null; resolution: string }>
}

/** La nota (con sus líneas) cuya primera línea lleva esa descripción; `null` si no existe. */
export async function notaPorDescripcion(descripcion: string): Promise<NotaEnBase | null> {
  return withSql(async (sql) => {
    const notes = await sql`
      select distinct n.id from mant_parts_notes n
      join mant_parts_note_items i on i.note_id = n.id
      where i.description = ${descripcion}`
    if (notes.length === 0) return null
    expect(notes, `una sola nota con «${descripcion}»`).toHaveLength(1)
    return notaPorId(notes[0]!.id as string)
  })
}

export async function notaPorId(id: string): Promise<NotaEnBase | null> {
  return withSql(async (sql) => {
    const [note] = await sql`select id, code, status, work_order_id, worksite_id, urgent from mant_parts_notes where id = ${id}`
    if (!note) return null
    const lines = await sql`
      select id, description, quantity::float8 as quantity, product_id, charge_vehicle_id, resolution
      from mant_parts_note_items where note_id = ${id} order by sort_order`
    return {
      id: note.id as string, code: note.code as string, status: note.status as string, workOrderId: note.work_order_id as string | null,
      worksiteId: note.worksite_id as string, urgent: note.urgent as boolean,
      lines: lines.map((line) => ({
        id: line.id as string, description: line.description as string, quantity: line.quantity as number,
        productId: line.product_id as string | null, chargeVehicleId: line.charge_vehicle_id as string | null, resolution: line.resolution as string,
      })),
    }
  })
}

export async function estadoDeNota(id: string): Promise<string | null> {
  return (await notaPorId(id))?.status ?? null
}

/** Espera a que el servidor tenga la nota en ese estado (la recepción y la compra la recalculan al terminar su transacción). */
export async function esperarEstadoDeNota(id: string, status: string) {
  await expect.poll(() => estadoDeNota(id), { timeout: 60_000, message: `la nota debe quedar «${status}»` }).toBe(status)
}

export interface EventoDeNota { kind: string; from: string | null; to: string; reason: string | null; actor: string | null }

export async function eventosDeNota(id: string): Promise<EventoDeNota[]> {
  return withSql(async (sql) => {
    const rows = await sql`
      select kind, from_status, to_status, reason, actor_user_id from mant_parts_note_events where note_id = ${id} order by seq`
    return rows.map((row) => ({
      kind: row.kind as string, from: row.from_status as string | null, to: row.to_status as string,
      reason: row.reason as string | null, actor: row.actor_user_id as string | null,
    }))
  })
}

/** Los ítems de solicitud que compran las líneas de la nota (`purchase_request_items.parts_note_item_id`). */
export async function comprasDeNota(noteId: string) {
  return withSql(async (sql) => {
    const rows = await sql`
      select i.id, i.request_id, i.parts_note_item_id, i.product_id, i.vehicle_id, i.work_order_id, i.status, r.code as request_code, r.worksite_id
      from purchase_request_items i
      join purchase_requests r on r.id = i.request_id
      join mant_parts_note_items n on n.id = i.parts_note_item_id
      where n.note_id = ${noteId}
      order by n.sort_order`
    return rows.map((row) => ({
      id: row.id as string, requestId: row.request_id as string, noteItemId: row.parts_note_item_id as string, productId: row.product_id as string | null,
      vehicleId: row.vehicle_id as string | null, workOrderId: row.work_order_id as string | null, status: row.status as string,
      requestCode: row.request_code as string, worksiteId: row.worksite_id as string,
    }))
  })
}

export async function stockEnFaena(worksiteId: string, productId: string): Promise<number> {
  return withSql(async (sql) => {
    const [row] = await sql`select quantity::float8 as quantity from worksite_stock where worksite_id = ${worksiteId} and product_id = ${productId}`
    return Number(row?.quantity ?? 0)
  })
}

export async function movimientosDe(worksiteId: string, productId: string) {
  return withSql(async (sql) => {
    const rows = await sql`
      select type, quantity::float8 as quantity, stock_before::float8 as stock_before, stock_after::float8 as stock_after
      from inventory_movements where worksite_id = ${worksiteId} and product_id = ${productId} order by performed_at, id`
    return rows.map((row) => ({ type: row.type as string, quantity: row.quantity as number, antes: row.stock_before as number, despues: row.stock_after as number }))
  })
}

/** Nombres de producto → id: el repuesto que Compras creó al catalogar la línea libre. */
export async function productoPorNumeroDeParte(partNumber: string): Promise<string> {
  return withSql(async (sql) => {
    const [row] = await sql`select id from products where part_number = ${partNumber}`
    expect(row, `el repuesto con N° de parte ${partNumber} existe`).toBeTruthy()
    return row!.id as string
  })
}

/** Cuántas notas hay con esa descripción en alguna línea (la prueba del reenvío: una sola). */
export async function contarNotasConLinea(descripcion: string): Promise<number> {
  return withSql(async (sql) => {
    const [row] = await sql`
      select count(distinct note_id)::int as total from mant_parts_note_items where description = ${descripcion}`
    return Number(row?.total ?? 0)
  })
}

// ── Server Actions por HTTP (negativos con la sesión) ───────────────────────────────────────────

export interface AccionCapturada { id: string; url: string }

/**
 * Ejecuta `disparar` (un clic de la interfaz) y devuelve el identificador de la Server Action que viajó (cabecera
 * `next-action`) con la URL a la que fue. Es estable dentro de una misma build: sirve para repetir la acción con la sesión
 * de otra persona y comprobar que es el SERVIDOR el que decide, no lo que muestra la pantalla.
 */
export async function capturarAccion(page: Page, disparar: () => Promise<void>): Promise<AccionCapturada> {
  const peticion = page.waitForRequest((request) => request.method() === "POST" && !!request.headers()["next-action"], { timeout: 30_000 })
  await disparar()
  const request = await peticion
  return { id: request.headers()["next-action"]!, url: request.url() }
}

export interface RespuestaDeAccion { ok: boolean | null; message: string | null; raw: string }

/**
 * Repite una Server Action capturada con la sesión de `page` y otros argumentos. Contesta lo que la acción devolvió
 * (`{ ok, message }`); si la respuesta no trae ese objeto, `ok` es `null` y `raw` permite ver qué llegó.
 */
export async function repetirAccion(page: Page, accion: AccionCapturada, argumentos: unknown, { ruta }: { ruta?: string } = {}): Promise<RespuestaDeAccion> {
  const url = ruta ? new URL(ruta, accion.url).toString() : accion.url
  const respuesta = await page.request.post(url, {
    headers: { "next-action": accion.id, "content-type": "text/plain;charset=UTF-8", accept: "text/x-component", origin: new URL(url).origin },
    data: JSON.stringify([argumentos]),
  })
  const raw = await respuesta.text()
  for (const linea of raw.split("\n")) {
    const separador = linea.indexOf(":")
    if (separador < 0) continue
    try {
      const valor = JSON.parse(linea.slice(separador + 1)) as { ok?: unknown; message?: unknown }
      if (typeof valor === "object" && valor !== null && typeof valor.ok === "boolean") {
        return { ok: valor.ok, message: typeof valor.message === "string" ? valor.message : null, raw }
      }
    } catch { /* línea de la flight que no es el resultado */ }
  }
  return { ok: null, message: null, raw }
}

// ── Excel ───────────────────────────────────────────────────────────────────────────────────────

/** Texto de todas las celdas del libro, para comprobar que una nota está en él sin atarse a sus columnas. */
export async function textoDelExcel(respuesta: APIResponse): Promise<string> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await respuesta.body() as unknown as ArrayBuffer)
  const celdas: string[] = []
  workbook.eachSheet((hoja) => hoja.eachRow((fila) => fila.eachCell((celda) => celdas.push(String(celda.text ?? celda.value ?? "")))))
  return celdas.join("\n")
}

// ── Alta rápida por la interfaz ─────────────────────────────────────────────────────────────────

/**
 * Crea por `/mantencion/notas-pedido/nueva` una nota sin OT con una sola línea en texto libre (la faena se elige sólo si
 * quien la pide tiene más de una) y devuelve lo que quedó en la base. Es el camino real, no un insert: así el historial
 * y el código de la nota nacen como en producción.
 */
export async function crearNotaPorUi(page: Page, opciones: { descripcion: string; cantidad?: number; faena?: string }): Promise<NotaEnBase> {
  await page.goto("/mantencion/notas-pedido/nueva")
  const faena = page.locator("#np-faena")
  await expect(faena).toBeVisible({ timeout: 30_000 })
  if ((await faena.evaluate((elemento) => elemento.tagName)) === "BUTTON") await selectRadixById(page, "np-faena", opciones.faena ?? "Biodiversa")
  const linea = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Repuesto 1", exact: true }) })
  await linea.getByRole("combobox", { name: /^Repuesto/ }).fill(opciones.descripcion)
  await linea.getByLabel(/^Cantidad/).fill(String(opciones.cantidad ?? 1))
  await page.getByRole("button", { name: "Enviar nota", exact: true }).click()
  await expect(page).toHaveURL(/\/mantencion\/notas-pedido\/(?!nueva)[^/?]+$/, { timeout: 30_000 })
  const nota = await notaPorDescripcion(opciones.descripcion)
  expect(nota, `la nota «${opciones.descripcion}» quedó guardada`).not.toBeNull()
  return nota!
}

// ── Repuesto con stock y consumo ────────────────────────────────────────────────────────────────

/** El repuesto de la prueba de consumo: tiene 1 unidad en la bodega de la faena del equipo. */
export const REPUESTO_CONSUMO = {
  id: `rpt-cons-${CICLO.toLowerCase()}`,
  sku: `QA-CO-${CICLO}`,
  name: `QA_CONS Bomba de refrigerante ${CICLO}`,
  partNumber: `QA-CO-PN-${CICLO}`,
} as const

/** Siembra el repuesto de catálogo con `stock` unidades en la faena (fila de stock y un ajuste en el kárdex que cuadra con ella). */
export async function sembrarRepuestoConsumo(worksiteId: string, stock: number): Promise<void> {
  await withSql(async (sql) => {
    const now = new Date().toISOString()
    await sql`
      insert into products (id, sku, name, category_id, unit_of_measure, is_spare_part, part_number, is_active, created_at, updated_at)
      values (${REPUESTO_CONSUMO.id}, ${REPUESTO_CONSUMO.sku}, ${REPUESTO_CONSUMO.name}, 'cat-repuestos', 'unidad', true, ${REPUESTO_CONSUMO.partNumber}, true, ${now}, ${now})`
    await sql`
      insert into worksite_stock (id, worksite_id, product_id, quantity, min_stock, last_movement_at, updated_at)
      values (${`ws-cons-${CICLO.toLowerCase()}`}, ${worksiteId}, ${REPUESTO_CONSUMO.id}, ${stock}, 0, ${now}, ${now})`
    await sql`
      insert into inventory_movements (id, worksite_id, product_id, type, quantity, stock_before, stock_after, performed_by, performed_at, reason)
      values (${`mov-cons-${CICLO.toLowerCase()}-0`}, ${worksiteId}, ${REPUESTO_CONSUMO.id}, 'ajuste', ${stock}, 0, ${stock}, 'user-mant-jefe-e2e', ${now}, 'QA_ Stock inicial de la prueba de consumo')`
  })
}

/** Alguien retira el repuesto de la bodega por fuera de la plataforma: el stock queda en 0 con su ajuste en el kárdex. */
export async function retirarTodoElStock(worksiteId: string, productId: string): Promise<void> {
  await withSql(async (sql) => {
    const now = new Date().toISOString()
    const [fila] = await sql`select quantity::float8 as quantity from worksite_stock where worksite_id = ${worksiteId} and product_id = ${productId}`
    const antes = Number(fila?.quantity ?? 0)
    await sql`update worksite_stock set quantity = 0, updated_at = ${now}, last_movement_at = ${now} where worksite_id = ${worksiteId} and product_id = ${productId}`
    await sql`
      insert into inventory_movements (id, worksite_id, product_id, type, quantity, stock_before, stock_after, performed_by, performed_at, reason)
      values (${`mov-cons-${CICLO.toLowerCase()}-1`}, ${worksiteId}, ${productId}, 'ajuste', ${-antes}, ${antes}, 0, 'user-mant-jefe-e2e', ${now}, 'QA_ Retiro físico fuera de la plataforma')`
  })
}
