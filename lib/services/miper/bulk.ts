/**
 * Acciones masivas de la MIPER (Fase D, spec §9):
 * - `bulkPatchMiperEntries`: el mismo cambio en N riesgos («Editar tarea»,
 *   «Cambiar ¿controlado?»). Nunca P×C: el esquema lo rechaza.
 * - `bulkAddMiperControl`: la misma medida en N riesgos.
 * - `bulkUpdateMiperControls`: responsable, plazo, «¿ya está implementada?» y
 *   frecuencia en N medidas.
 *
 * Cada una corre en UNA transacción con la matriz bloqueada (`lockMatrix`), el
 * permiso de editar en su faena y `assertEditable` (ni legacy ni reemplazada),
 * igual que el guardado de a uno. Cada elemento trae la versión que vio la
 * persona: con una sola vieja, o un elemento que no es de esta MIPER, no se
 * escribe nada. Hasta `MIPER_BULK_LIMIT` elementos. El historial lleva una
 * entrada por elemento escrito, con el `changeType` del guardado de a uno y el
 * motivo «Edición masiva». Un elemento que ya está como lo pide el lote no se
 * escribe (ver `BulkSaved`).
 *
 * Las reglas son las del guardado de a uno, no copias: `toColumns` (diccionario
 * y factor activo), `controlColumns` (D5), `controlResponsible` (persona activa),
 * `newControlRow` (toda medida nueva nace «propuesta»), `updateControlAtVersion`
 * y el «antes» del historial (`entryHistoryBefore`, `controlHistoryBefore`).
 */
import { and, eq, inArray, sql } from "drizzle-orm"
import { db } from "@/db"
import { preventionRiskControls, preventionRiskEntries } from "@/db/schema"
import { controlColumns, patchedControlValues } from "@/lib/prevention/miper/control-values"
import type { ControlHierarchy } from "@/lib/prevention/miper/snapshot"
import { RiskLegalDomainError } from "@/lib/services/prevention-risk-legal-errors"
import { countOf } from "@/lib/utils"
import { miperBulkAddControlSchema, miperBulkPatchEntriesSchema, miperBulkUpdateControlsSchema } from "@/lib/validation/prevention-module/miper"
import { controlHistoryBefore, controlResponsible, entryHistoryBefore, newControlRow, toColumns, touchMatrix, updateControlAtVersion } from "./entries"
import { assertEditable, lockMatrix, type MiperAccess, miperHistory, nowIso, requireAccess } from "./shared"

const EDIT = "prevention:risk:edit"
/** El motivo de cada entrada del historial que escribe una acción masiva. */
export const BULK_REASON = "Edición masiva"

const NO_ENTRY_CHANGES = "No hay cambios que aplicar a los riesgos: elige qué cambiar."
const NO_CONTROL_CHANGES = "No hay cambios que aplicar a las medidas: elige el responsable, el plazo o si ya está implementada."

type Nouns = { missing: [string, string]; stale: [string, string] }
const ENTRIES: Nouns = { missing: ["riesgo no existe", "riesgos no existen"], stale: ["riesgo cambió", "riesgos cambiaron"] }
const CONTROLS: Nouns = { missing: ["medida no existe", "medidas no existen"], stale: ["medida cambió", "medidas cambiaron"] }

/**
 * Lo que de verdad cambia un lote. El esquema cuenta una clave presente aunque
 * su valor sea `undefined` (`{ activity: undefined }` lo pasa), pero esa clave
 * no es un cambio: en `toColumns` se leería como «dejar sin actividad» a todos
 * los riesgos. Se descarta, y un lote que se queda sin nada se rechaza en vez de
 * subir versiones y escribir historial sin cambiar nada.
 */
function effectiveChanges<T extends object>(values: T, message: string): Partial<T> {
  const defined = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) as Partial<T>
  if (Object.keys(defined).length === 0) throw new RiskLegalDomainError(message)
  return defined
}

/** `after` no cambia nada de `before`: cada una de sus claves ya tiene ese valor. */
function sameValues(before: Readonly<Record<string, unknown>>, after: Readonly<Record<string, unknown>>) {
  return Object.entries(after).every(([key, value]) => before[key] === value)
}

/**
 * Lo que vio la persona contra lo que hay. Un elemento que no es de esta MIPER o
 * una versión vieja abortan TODO, con su cuenta: nada se escribe a medias. Rige
 * también para el elemento que después resulta no tener nada que cambiar: la
 * persona decidió sobre lo que vio.
 */
function assertCurrent<T extends { id: string; version: number }>(found: readonly T[], items: ReadonlyArray<{ id: string; expectedVersion: number }>, nouns: Nouns): Map<string, T> {
  const byId = new Map(found.map((row) => [row.id, row]))
  const absent = items.filter((item) => !byId.has(item.id)).length
  if (absent > 0) throw new RiskLegalDomainError(`${countOf(absent, ...nouns.missing)} en esta MIPER; recarga la matriz.`)
  const stale = items.filter((item) => byId.get(item.id)!.version !== item.expectedVersion).length
  if (stale > 0) throw new RiskLegalDomainError(`${countOf(stale, ...nouns.stale)} mientras editabas; recarga la matriz para ver los cambios de la otra persona.`)
  return byId
}

/**
 * Un elemento que el lote ESCRIBIÓ, con su versión nueva. Los resultados de
 * `bulkPatchMiperEntries` y `bulkUpdateMiperControls` traen sólo esos, en el
 * orden de `items`: el que ya estaba como lo pedía el lote (el mismo valor, o
 * una medida a la que D5 no le deja nada que cambiar) no se escribe, no sube de
 * versión ni deja historial, y no viene en el resultado. Conserva la versión con
 * que llegó, que el cliente ya tiene. Subírsela sin cambiarlo haría chocar
 * («cambió mientras editabas») a quien lo tenga abierto. Una lista vacía es un
 * lote que no tenía nada que cambiar, no un error.
 */
export type BulkSaved = { id: string; version: number }

export async function bulkPatchMiperEntries(input: unknown, access: MiperAccess): Promise<{ entries: BulkSaved[] }> {
  const data = miperBulkPatchEntriesSchema.parse(input)
  const values = effectiveChanges(data.values, NO_ENTRY_CHANGES)
  return db.transaction(async (tx) => {
    const matrix = await lockMatrix(tx, data.matrixId)
    requireAccess(access, EDIT, matrix.worksiteId)
    assertEditable(matrix)
    const ids = data.items.map((item) => item.entryId)
    // Los riesgos quedan bloqueados (`FOR UPDATE`) desde la lectura hasta el COMMIT. La matriz
    // bloqueada no alcanza: `verifyRiskControl` sube la versión del riesgo sin `lockMatrix`, y
    // sin este bloqueo el UPDATE de abajo se tragaría ese cambio.
    const found = await tx.select().from(preventionRiskEntries).where(and(eq(preventionRiskEntries.matrixId, matrix.id), inArray(preventionRiskEntries.id, ids))).for("update")
    const byId = assertCurrent(found, data.items.map((item) => ({ id: item.entryId, expectedVersion: item.expectedVersion })), ENTRIES)
    // El mismo cambio para todos: el diccionario y el factor se resuelven una sola vez.
    const columns = await toColumns(tx, matrix.worksiteId, values)
    const changed = data.items.map((item) => byId.get(item.entryId)!).filter((current) => !sameValues(entryHistoryBefore(current, columns), columns))
    if (changed.length === 0) return { entries: [] }
    const now = nowIso()
    // Ninguna versión cambió desde la lectura: los riesgos están bloqueados.
    const updated = await tx.update(preventionRiskEntries).set({ ...columns, version: sql`${preventionRiskEntries.version} + 1`, updatedAt: now })
      .where(and(eq(preventionRiskEntries.matrixId, matrix.id), inArray(preventionRiskEntries.id, changed.map((current) => current.id))))
      .returning({ id: preventionRiskEntries.id, version: preventionRiskEntries.version })
    for (const current of changed) {
      await miperHistory(tx, {
        matrixId: matrix.id, worksiteId: matrix.worksiteId, object: "entry", objectId: current.id, changeType: "entry_updated", reason: BULK_REASON,
        before: entryHistoryBefore(current, columns), after: columns, actorUserId: access.userId, actingAs: EDIT,
      })
    }
    await touchMatrix(tx, matrix.id, now)
    const versionOf = new Map(updated.map((row) => [row.id, row.version]))
    return { entries: changed.map((current) => ({ id: current.id, version: versionOf.get(current.id)! })) }
  })
}

/**
 * La misma medida en N riesgos: cada riesgo recibe una medida nueva, así que
 * todos se escriben. Como en el editor, agregar una medida no cambia la versión
 * del riesgo; la que trae cada elemento sólo confirma que la persona decidió
 * sobre el riesgo que hay ahora.
 */
export async function bulkAddMiperControl(input: unknown, access: MiperAccess): Promise<{ controls: Array<{ id: string; entryId: string }> }> {
  const data = miperBulkAddControlSchema.parse(input)
  return db.transaction(async (tx) => {
    const matrix = await lockMatrix(tx, data.matrixId)
    requireAccess(access, EDIT, matrix.worksiteId)
    assertEditable(matrix)
    const ids = data.items.map((item) => item.entryId)
    // Bloqueados hasta el COMMIT, como en `bulkPatchMiperEntries`: la versión comprobada sigue siendo la vigente.
    const found = await tx.select({ id: preventionRiskEntries.id, version: preventionRiskEntries.version }).from(preventionRiskEntries)
      .where(and(eq(preventionRiskEntries.matrixId, matrix.id), inArray(preventionRiskEntries.id, ids))).for("update")
    assertCurrent(found, data.items.map((item) => ({ id: item.entryId, expectedVersion: item.expectedVersion })), ENTRIES)
    const columns = controlColumns(data.values, await controlResponsible(tx, data.values), null)
    const now = nowIso()
    const created = await tx.insert(preventionRiskControls).values(data.items.map((item) => newControlRow(item.entryId, columns, now)))
      .returning({ id: preventionRiskControls.id, entryId: preventionRiskControls.riskEntryId })
    for (const control of created) {
      await miperHistory(tx, {
        matrixId: matrix.id, worksiteId: matrix.worksiteId, object: "control", objectId: control.id, changeType: "control_created", reason: BULK_REASON,
        after: { entryId: control.entryId, ...columns }, actorUserId: access.userId, actingAs: EDIT,
      })
    }
    await touchMatrix(tx, matrix.id, now)
    return { controls: created }
  })
}

export async function bulkUpdateMiperControls(input: unknown, access: MiperAccess): Promise<{ controls: BulkSaved[] }> {
  const data = miperBulkUpdateControlsSchema.parse(input)
  const patch = effectiveChanges(data.patch, NO_CONTROL_CHANGES)
  return db.transaction(async (tx) => {
    const matrix = await lockMatrix(tx, data.matrixId)
    requireAccess(access, EDIT, matrix.worksiteId)
    assertEditable(matrix)
    const ids = data.items.map((item) => item.controlId)
    const found = (await tx.select({ control: preventionRiskControls }).from(preventionRiskControls)
      .innerJoin(preventionRiskEntries, eq(preventionRiskEntries.id, preventionRiskControls.riskEntryId))
      .where(and(eq(preventionRiskEntries.matrixId, matrix.id), inArray(preventionRiskControls.id, ids)))).map((row) => row.control)
    const byId = assertCurrent(found, data.items.map((item) => ({ id: item.controlId, expectedVersion: item.expectedVersion })), CONTROLS)
    /* Sin `responsible` en el lote, cada medida conserva su responsable AUNQUE esa
     * persona ya esté inactiva: el lote no lo vuelve a validar. El editor de la
     * medida, en cambio, reenvía el responsable al guardar y `controlResponsible`
     * lo rechaza si está inactivo, así que ahí obliga a reasignarlo. */
    const assigned = patch.responsible
    const responsible = !assigned ? null
      : await controlResponsible(tx, assigned.kind === "user" ? { responsibleUserId: assigned.userId } : { responsibleName: assigned.name })
    const now = nowIso()
    const saved: BulkSaved[] = []
    for (const item of data.items) {
      const current = byId.get(item.controlId)!
      // Lo que el lote no trae se conserva; D5 decide qué queda vacío, igual que en el editor.
      const values = controlColumns(
        patchedControlValues({ ...current, hierarchy: current.hierarchy as ControlHierarchy }, patch),
        responsible ?? { responsibleUserId: current.responsibleUserId, responsibleSnapshot: current.responsibleSnapshot },
        current,
      )
      const before = controlHistoryBefore(current)
      if (sameValues(before, values)) continue
      // Sin bloqueo de fila: `verifyRiskControl` sí puede subir la versión de la medida, y entonces esto aborta el lote.
      saved.push(await updateControlAtVersion(tx, current, values, now, `${countOf(1, ...CONTROLS.stale)} mientras editabas; recarga la matriz para ver los cambios de la otra persona.`))
      await miperHistory(tx, {
        matrixId: matrix.id, worksiteId: matrix.worksiteId, object: "control", objectId: current.id, changeType: "control_updated", reason: BULK_REASON,
        before, after: values, actorUserId: access.userId, actingAs: EDIT,
      })
    }
    if (saved.length > 0) await touchMatrix(tx, matrix.id, now)
    return { controls: saved }
  })
}
