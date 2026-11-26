import { expect, type Page } from "@playwright/test"
import { clearRateLimits } from "./helpers"
import { campoLectura, jpeg } from "./mantencion-app-helpers"
import { withSql } from "./mantencion-3-helpers"

/**
 * Ayudas de `notas-pedido.spec.ts` (E2E de punta a punta de las notas de pedido de repuestos,
 * ADR mantención 0001). Viven aparte para que el spec quede bajo el tope de líneas; no es un
 * `*.spec.ts`, así que Playwright no lo ejecuta.
 *
 * Usuarios de `e2e/fixtures/mantencion-setup.ts` (contraseña `chome2026`).
 */

export const JEFE = "jefe.mant@e2e.chome.cl"
export const ADMIN_CONTRATO = "admin.contrato@e2e.chome.cl"
export const MECANICO = "mecanico1@e2e.chome.cl"
export const NOMBRE_MECANICO = "Mecánico Uno E2E"
export const PIN = "1111"

/** Sufijo único por corrida: el spec se puede repetir sobre la misma base sin chocar con el SKU ni con el kárdex anterior. */
export const CORRIDA = Date.now().toString(36).toUpperCase()

export const REPUESTO = {
  id: `rpt-np-${CORRIDA.toLowerCase()}`,
  sku: `QA-NP-${CORRIDA}`,
  name: `QA_NP Filtro hidráulico ${CORRIDA}`,
  partNumber: `QA-NP-PN-${CORRIDA}`,
  stockInicial: 3,
} as const
export const REPUESTO_LIBRE = `QA_NP Manguera sin catalogar ${CORRIDA}`

/** Errores de consola y de página de UNA página. Sin señal el navegador avisa de cargas que no pudo hacer: no son de la app. */
export function vigilarConsola(page: Page, { sinSenal = false }: { sinSenal?: boolean } = {}): string[] {
  const errores: string[] = []
  const esperado = /ERR_INTERNET_DISCONNECTED|Failed to load resource|net::ERR_/
  page.on("console", (mensaje) => {
    if (mensaje.type() !== "error" || /favicon/i.test(mensaje.text())) return
    if (sinSenal && esperado.test(mensaje.text())) return
    errores.push(mensaje.text())
  })
  page.on("pageerror", (error) => errores.push(error.message))
  return errores
}

/** Login de la plataforma sin suponer adónde aterriza el rol. */
export async function entrarPlataforma(page: Page, email: string) {
  for (const intento of [1, 2]) {
    await clearRateLimits()
    await page.goto("/login")
    await page.getByLabel("Correo electrónico", { exact: true }).fill(email)
    await page.getByLabel("Contraseña", { exact: true }).fill("chome2026")
    await page.getByRole("button", { name: "Ingresar", exact: true }).click()
    try {
      await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })
      return
    } catch (error) {
      if (intento === 2) throw error
    }
  }
}

/**
 * El equipo de la prueba: el último (por código) de Biodiversa que tiene ficha de mantención, está operativo y no
 * tiene ninguna OT abierta. Puede medirse en km o en horas (la unidad la fija la ficha): la prueba lee el rótulo.
 */
export async function equipoDePrueba(): Promise<{ code: string; plate: string; worksiteId: string }> {
  return withSql(async (sql) => {
    const [row] = await sql`
      select v.code as code, v.plate as plate, w.id as worksite_id
      from mant_equipment_profiles p
      join fuel_vehicles v on v.id = p.vehicle_id
      join worksites w on w.id = v.worksite_id
      where w.name = 'Biodiversa' and v.is_active = true and v.operational_status = 'operativo' and v.code is not null
        and not exists (
          select 1 from mant_work_orders o
          where o.vehicle_id = v.id and o.status not in ('cerrada', 'anulada')
        )
      order by v.code desc
      limit 1`
    expect(row, "Biodiversa necesita un equipo operativo con ficha de mantención y sin OT abierta").toBeTruthy()
    return { code: row!.code as string, plate: row!.plate as string, worksiteId: row!.worksite_id as string }
  })
}

/**
 * Siembra el repuesto de catálogo y su stock en la faena del equipo: producto `is_spare_part`, fila de
 * `worksite_stock` y un `ajuste` en el kárdex que cuadra con ella (antes 0 → después N).
 */
export async function sembrarRepuestoConStock(worksiteId: string): Promise<void> {
  await withSql(async (sql) => {
    const now = new Date().toISOString()
    await sql`
      insert into products (id, sku, name, category_id, unit_of_measure, is_spare_part, part_number, is_active, created_at, updated_at)
      values (${REPUESTO.id}, ${REPUESTO.sku}, ${REPUESTO.name}, 'cat-repuestos', 'unidad', true, ${REPUESTO.partNumber}, true, ${now}, ${now})`
    await sql`
      insert into worksite_stock (id, worksite_id, product_id, quantity, min_stock, last_movement_at, updated_at)
      values (${`ws-np-${CORRIDA.toLowerCase()}`}, ${worksiteId}, ${REPUESTO.id}, ${REPUESTO.stockInicial}, 0, ${now}, ${now})`
    await sql`
      insert into inventory_movements (id, worksite_id, product_id, type, quantity, stock_before, stock_after, performed_by, performed_at, reason)
      values (${`mov-np-${CORRIDA.toLowerCase()}`}, ${worksiteId}, ${REPUESTO.id}, 'ajuste', ${REPUESTO.stockInicial}, 0, ${REPUESTO.stockInicial}, 'user-mant-jefe-e2e', ${now}, 'QA_ Stock inicial de la prueba de notas de pedido')`
  })
}

export async function stockDe(worksiteId: string): Promise<number> {
  return withSql(async (sql) => {
    const [row] = await sql`select quantity from worksite_stock where worksite_id = ${worksiteId} and product_id = ${REPUESTO.id}`
    return Number(row?.quantity ?? 0)
  })
}

export async function notaDeLaOt(workOrderId: string) {
  return withSql(async (sql) => {
    const [note] = await sql`select id, code, status, equipment_stopped from mant_parts_notes where work_order_id = ${workOrderId} order by created_at desc limit 1`
    if (!note) return null
    const items = await sql`
      select id, description, quantity::float8 as quantity, product_id, resolution
      from mant_parts_note_items where note_id = ${note.id} order by sort_order`
    return {
      id: note.id as string,
      code: note.code as string,
      status: note.status as string,
      equipmentStopped: note.equipment_stopped as boolean,
      items: items.map((item) => ({
        id: item.id as string, description: item.description as string, quantity: item.quantity as number,
        productId: item.product_id as string | null, resolution: item.resolution as string,
      })),
    }
  })
}

export async function reservaDeLaOt(workOrderId: string) {
  return withSql(async (sql) => {
    const [row] = await sql`
      select id, status, quantity::float8 as quantity, released_quantity::float8 as released_quantity
      from mant_parts_allocations where work_order_id = ${workOrderId} and product_id = ${REPUESTO.id}
      order by created_at desc limit 1`
    return row ? { id: row.id as string, status: row.status as string, quantity: row.quantity as number, released: row.released_quantity as number } : null
  })
}

export async function consumosDeLaOt(workOrderId: string) {
  return withSql(async (sql) => {
    const rows = await sql`
      select rp.id, rp.record_id, r.folio, r.status as record_status, rp.source, rp.stock_status, rp.product_id, rp.allocation_id,
             rp.inventory_movement_id, rp.reversal_movement_id, rp.quantity::float8 as quantity
      from mant_record_parts rp
      join mant_records r on r.id = rp.record_id
      where r.work_order_id = ${workOrderId}
      order by r.created_at, rp.id`
    return rows.map((row) => ({
      id: row.id as string, recordId: row.record_id as string, folio: row.folio as string | null, recordStatus: row.record_status as string,
      source: row.source as string, stockStatus: row.stock_status as string, productId: row.product_id as string | null,
      allocationId: row.allocation_id as string | null, movementId: row.inventory_movement_id as string | null,
      reversalId: row.reversal_movement_id as string | null, quantity: row.quantity as number,
    }))
  })
}

export async function registrosDeLaOt(workOrderId: string) {
  return withSql(async (sql) => {
    const rows = await sql`select id, folio, status from mant_records where work_order_id = ${workOrderId} order by created_at`
    return rows.map((row) => ({ id: row.id as string, folio: row.folio as string | null, status: row.status as string }))
  })
}

export async function eventosDeLaOt(workOrderId: string): Promise<string[]> {
  return withSql(async (sql) => {
    const rows = await sql`select type from mant_work_order_events where work_order_id = ${workOrderId} order by created_at`
    return rows.map((row) => row.type as string)
  })
}

export async function movimientosDelRepuesto(worksiteId: string) {
  return withSql(async (sql) => {
    const rows = await sql`
      select type, quantity::float8 as quantity, reference_type, reference_id, stock_before::float8 as stock_before, stock_after::float8 as stock_after
      from inventory_movements where worksite_id = ${worksiteId} and product_id = ${REPUESTO.id} order by performed_at, id`
    return rows.map((row) => ({
      type: row.type as string, quantity: row.quantity as number, referenceType: row.reference_type as string | null,
      referenceId: row.reference_id as string | null, stockBefore: row.stock_before as number, stockAfter: row.stock_after as number,
    }))
  })
}

export async function estadoOt(folio: string): Promise<{ id: string; status: string } | null> {
  return withSql(async (sql) => {
    const [row] = await sql`select id, status from mant_work_orders where folio = ${folio}`
    return row ? { id: row.id as string, status: row.status as string } : null
  })
}

/** Espera a que el servidor tenga la OT en ese estado (la cola del teléfono ya la envió). */
export async function esperarEstado(folio: string, status: string) {
  await expect.poll(async () => (await estadoOt(folio))?.status, { timeout: 90_000, message: `la OT ${folio} debe quedar «${status}» en el servidor` }).toBe(status)
}

/** Escapa un texto para usarlo dentro de una expresión regular. */
export const esc = (texto: string) => texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/**
 * Correctiva de la OT abierta en la app (equipo fijo). Con `usarBodega`, usa el chip «Disponibles para esta OT».
 * Termina en «Registro guardado» ya enviado y de vuelta en el inicio. Devuelve la lectura con que firmó.
 */
export async function registrarCorrectivaDesdeOt(
  app: Page,
  opciones: { folio: string; equipoCode: string; lectura: number; descripcion: string; usarBodega: boolean },
): Promise<number> {
  const { folio } = opciones
  await app.getByRole("dialog", { name: folio, exact: true }).getByRole("button", { name: "Registrar correctiva", exact: true }).click()
  await expect(app.getByText("PASO 2/5")).toBeVisible()
  await expect(app.getByRole("button", { name: /^Cambiar equipo/ })).toHaveCount(0)
  await expect(app.getByText(/Última lectura registrada: [\d.]+|No hay lecturas anteriores de este equipo\./)).toBeVisible()
  // La última lectura vigente la dice la propia pantalla (un registro anulado deja de contar): sólo se sube 1, sin salto que confirmar.
  const anterior = await app.getByText(/Última lectura registrada: [\d.]+/).count()
    ? Number(/registrada: ([\d.]+)/.exec(await app.getByText(/Última lectura registrada: [\d.]+/).innerText())?.[1]?.replace(/\./g, ""))
    : opciones.lectura
  const lectura = anterior + 1
  await campoLectura(app).fill(String(lectura))
  await app.getByRole("button", { name: "Continuar", exact: true }).click()

  await app.getByRole("group", { name: "Agregar trabajo" }).getByRole("button").first().click()
  await expect(app.getByText(/^Total: /)).toBeVisible()
  await app.getByRole("button", { name: "No se cambió aceite", exact: true }).click()
  await app.getByLabel("Trabajo realizado").fill(opciones.descripcion)

  if (opciones.usarBodega) {
    // Lo reservado para esta OT se ofrece sobre «+ Agregar repuesto»: un toque agrega la línea de bodega.
    const disponibles = app.getByRole("group", { name: "Disponibles para esta OT" })
    const chip = disponibles.getByRole("button", { name: new RegExp(`^\\+ ${esc(REPUESTO.name)} · 1 disp\\.$`) })
    await expect(chip).toBeVisible()
    await chip.click()
    const linea = app.getByRole("group", { name: `Repuesto de bodega: ${REPUESTO.name}` })
    await expect(linea).toBeVisible()
    await expect(linea.getByText("De la bodega · reservado para la OT")).toBeVisible()
    await expect(linea.getByText("de 1 disp.")).toBeVisible()
    // El tope es lo disponible: con 1 reservado, «+» no sube.
    await expect(linea.getByRole("button", { name: `Sumar uno a ${REPUESTO.name}` })).toBeDisabled()
    await expect(linea.getByRole("status")).toHaveText("1")
    await expect(disponibles.getByRole("button", { name: new RegExp(`^\\+ ${esc(REPUESTO.name)} · 0 disp\\.$`) })).toBeDisabled()
  } else {
    await app.getByRole("checkbox", { name: "No se usaron repuestos" }).check()
  }

  await app.getByLabel(/Conductores de las últimas 24 h/).fill("a")
  await app.getByRole("group", { name: "Conductores encontrados" }).getByRole("button").first().click()
  // Con una OT, ella lleva el taller: un chip con su folio reemplaza a «¿sigue en taller?».
  await expect(app.getByRole("group", { name: "Orden de trabajo" }).getByText(folio)).toBeVisible()
  await app.getByRole("button", { name: "Continuar a fotos", exact: true }).click()

  await expect(app.getByText("PASO 4/5")).toBeVisible()
  await app.getByLabel("Agregar foto del trabajo").setInputFiles(await jpeg(app, `${opciones.equipoCode} NP`))
  await expect(app.getByRole("img", { name: "Foto 1 del trabajo" })).toBeVisible()
  await app.getByRole("button", { name: "Revisar registro", exact: true }).click()
  await app.getByRole("button", { name: "Firmar y guardar", exact: true }).click()
  await expect(app.getByRole("heading", { name: "Registro guardado" })).toBeVisible()
  await expect(app.getByText(`Quedó enlazado a ${folio}.`)).toBeVisible()
  await expect(app.getByText("Ya llegó a la plataforma.")).toBeVisible({ timeout: 60_000 })
  await app.getByRole("button", { name: "Volver al inicio", exact: true }).click()
  return lectura
}
