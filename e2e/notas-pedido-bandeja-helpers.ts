import { randomUUID } from "node:crypto"
import { expect, type Page } from "@playwright/test"
import { withSql } from "./mantencion-3-helpers"

/**
 * Ayudas de `notas-pedido-bandeja-lote.spec.ts` (E2E de la bandeja de notas de pedido: pestañas con sus conteos, decisiones en
 * lote desde la barra al pie, gráfico de antigüedad y chip de urgentes). No es un `*.spec.ts`, así que Playwright no lo ejecuta.
 *
 * Las notas se siembran por SQL (con su historial, que es append-only y es de donde sale la antigüedad) y se borran al terminar,
 * con las solicitudes que el lote les haya creado: la base de la corrida queda como estaba para las demás specs.
 */

/** Sufijo único por corrida: la spec se puede repetir sobre la misma base sin chocar con el código único de la nota. */
export const CORRIDA_LOTE = Date.now().toString(36).toUpperCase()
export const PREFIJO_LOTE = `QA_LOTE-${CORRIDA_LOTE}`
export const codigoLote = (numero: number) => `${PREFIJO_LOTE}-NP-${String(numero).padStart(4, "0")}`

export interface IdsBase { faenaId: string; faenaNombre: string; jefeId: string; solicitanteId: string; solicitanteNombre: string }

/** Biodiversa, la jefatura global de la fixture (`jefe.mant@`) y el mecánico que «pide» las notas. */
export async function idsBase(): Promise<IdsBase> {
  return withSql(async (sql) => {
    const [faena] = await sql`select id, name from worksites where name = 'Biodiversa'`
    const [jefe] = await sql`select id from users where email = 'jefe.mant@e2e.chome.cl'`
    const [mecanico] = await sql`select id, name from users where email = 'mecanico1@e2e.chome.cl'`
    expect(faena && jefe && mecanico, "la fixture de Mantención trae Biodiversa, la jefatura y el mecánico 1").toBeTruthy()
    return {
      faenaId: faena!.id as string, faenaNombre: faena!.name as string, jefeId: jefe!.id as string,
      solicitanteId: mecanico!.id as string, solicitanteNombre: mecanico!.name as string,
    }
  })
}

export interface NotaSembrada { id: string; code: string; lineIds: string[]; lineas: string[] }

/**
 * Una nota sin OT con sus líneas y su historial. `diasEnElEstado` es lo que lleva en su estado actual: el último evento se
 * fecha así de atrás (la bandeja mide la antigüedad desde ahí). Las líneas de una nota ya en compra, recibida o cerrada
 * quedan «en compra» (como las de una importada): lo que la bandeja lee de ellas es el estado de la cabecera.
 */
export async function sembrarNota(base: IdsBase, datos: {
  numero: number
  estado: "enviada" | "recibida_parcial" | "cerrada"
  lineas: string[]
  urgente?: boolean
  diasEnElEstado?: number
}): Promise<NotaSembrada> {
  const id = randomUUID()
  const code = codigoLote(datos.numero)
  const desde = new Date(Date.now() - (datos.diasEnElEstado ?? 0) * 86_400_000).toISOString()
  const resuelta = datos.estado !== "enviada"
  const lineIds = datos.lineas.map(() => randomUUID())
  await withSql(async (sql) => {
    await sql.begin(async (tx) => {
      await tx`
        insert into mant_parts_notes (id, code, worksite_id, requested_by_user_id, urgent, status, created_at, updated_at)
        values (${id}, ${code}, ${base.faenaId}, ${base.solicitanteId}, ${datos.urgente ?? false}, ${datos.estado}, ${desde}, ${desde})`
      for (const [orden, descripcion] of datos.lineas.entries()) {
        if (resuelta) {
          await tx`
            insert into mant_parts_note_items (id, note_id, description, quantity, unit_of_measure, sort_order, resolution, resolved_by_user_id, resolved_at)
            values (${lineIds[orden]!}, ${id}, ${descripcion}, 2, 'unidad', ${orden}, 'en_compra', ${base.jefeId}, ${desde})`
        } else {
          await tx`
            insert into mant_parts_note_items (id, note_id, description, quantity, unit_of_measure, sort_order)
            values (${lineIds[orden]!}, ${id}, ${descripcion}, 2, 'unidad', ${orden})`
        }
      }
      // El estado de una nota es siempre el `to_status` de su último evento.
      await tx`
        insert into mant_parts_note_events (id, note_id, kind, from_status, to_status, actor_user_id, created_at)
        values (${randomUUID()}, ${id}, 'creada', null, 'enviada', ${base.solicitanteId}, ${desde})`
      if (resuelta) {
        await tx`
          insert into mant_parts_note_events (id, note_id, kind, from_status, to_status, actor_user_id, created_at)
          values (${randomUUID()}, ${id}, 'transicion', 'enviada', ${datos.estado}, ${base.jefeId}, ${desde})`
      }
    })
  })
  return { id, code, lineIds, lineas: datos.lineas }
}

/** Los motivos con que quedaron rechazadas las líneas de la nota. */
export async function motivosDeRechazo(noteId: string): Promise<string[]> {
  return withSql(async (sql) => {
    const rows = await sql`select resolution_reason from mant_parts_note_items where note_id = ${noteId} and resolution = 'rechazada' order by sort_order`
    return rows.map((row) => String(row.resolution_reason))
  })
}

/**
 * Borra lo que sembró la spec y lo que el lote creó a partir de ello: las solicitudes de las líneas (con sus decisiones) y las
 * notas con su historial. El historial es append-only (trigger `mant_parts_note_events_append_only`, migración 0405): el trigger
 * se apaga SÓLO dentro de la transacción que lo borra y vuelve a encenderse con ella.
 */
export async function limpiarNotasLote(): Promise<void> {
  await withSql(async (sql) => {
    await sql.begin(async (tx) => {
      const patron = `${PREFIJO_LOTE}-NP-%`
      const solicitudes = await tx`
        select distinct i.request_id as id from purchase_request_items i
        join mant_parts_note_items n on n.id = i.parts_note_item_id
        join mant_parts_notes p on p.id = n.note_id
        where p.code like ${patron}`
      const ids = solicitudes.map((fila) => fila.id as string)
      if (ids.length > 0) {
        await tx`delete from approval_decisions where request_id in ${tx(ids)}`
        await tx`delete from purchase_request_items where request_id in ${tx(ids)}`
        await tx`delete from purchase_requests where id in ${tx(ids)}`
      }
      await tx`alter table mant_parts_note_events disable trigger mant_parts_note_events_append_only`
      await tx`delete from mant_parts_note_events where note_id in (select id from mant_parts_notes where code like ${patron})`
      await tx`alter table mant_parts_note_events enable trigger mant_parts_note_events_append_only`
      await tx`delete from mant_parts_notes where code like ${patron}`
    })
  })
}

export type Pestana = "Por revisar" | "En compra" | "En recepción" | "Cerradas"
export type ConteoPestanas = Record<Pestana, number>
export const PESTANAS: readonly Pestana[] = ["Por revisar", "En compra", "En recepción", "Cerradas"]

export const pestanas = (page: Page) => page.getByRole("navigation", { name: "Estado de las notas de pedido", exact: true })

/** El contador que cada pestaña muestra junto a su nombre («Por revisar 3»). */
export async function leerPestanas(page: Page): Promise<ConteoPestanas> {
  const conteo = {} as ConteoPestanas
  for (const nombre of PESTANAS) {
    const texto = await pestanas(page).getByRole("link", { name: new RegExp(`^${nombre}\\s+\\d+$`) }).innerText()
    conteo[nombre] = Number(/(\d+)\s*$/.exec(texto)?.[1])
  }
  return conteo
}
