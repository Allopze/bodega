/**
 * lib/services/workers.ts
 *
 * El embudo de escrituras sobre la dotación.
 *
 * Hasta ahora las cuatro escrituras vivían sueltas en las server actions de
 * `app/(app)/admin/trabajadores/actions.ts`, sin capa de servicio. Daba igual
 * mientras nadie tuviera que enterarse de ellas; dejó de dar igual cuando el
 * PDTP necesitó saber **cuándo entra una persona a una faena**, porque de eso
 * dependen la inducción (N°15), su prueba de evaluación (N°16), la habilitación
 * (N°52) y el umbral de dotación que obliga a constituir comité (N°11).
 *
 * Alcance deliberadamente acotado: **persistencia y derivación de eventos**. La
 * autorización, el zod, la auditoría y el `revalidatePath` se quedan en las
 * actions, que es donde corresponden y donde ya están probados. Este archivo no
 * decide quién puede escribir; decide qué significó lo escrito.
 *
 * `workers` **no tiene fecha de contratación** (`createdAt` es el timestamp de
 * la fila, no un dato de RRHH), así que el instante de la escritura es el único
 * ancla veraz de un evento de entrada. Es el mismo razonamiento que ya está
 * escrito en `lib/services/pdtp/subject-registry.ts` para el padrón de
 * trabajadores nuevos.
 */

import { eq } from "drizzle-orm"
import { db, type DB, type Tx } from "@/db"
import { workers } from "@/db/schema"

type Client = DB | Tx

type WorkerRow = typeof workers.$inferSelect
type WorkerInsert = typeof workers.$inferInsert

export type WorkerLifecycleEventKind = "alta" | "traslado" | "reactivacion" | "baja"

export type WorkerLifecycleEvent = {
  workerId: string
  worksiteId: string
  kind: WorkerLifecycleEventKind
  occurredAt: string
  previousWorksiteId?: string
}

type LifecycleBefore = Pick<WorkerRow, "worksiteId" | "isActive"> | null
type LifecycleAfter = Pick<WorkerRow, "id" | "worksiteId" | "isActive">

/**
 * Qué evento de entrada produjo un cambio sobre la dotación.
 *
 * Pura y sin base de datos a propósito: es la regla, y las reglas se prueban
 * solas. Tres entradas, y sólo tres:
 *
 * - **alta**: la persona no existía y queda activa.
 * - **traslado**: cambió de faena y sigue activa. El acta de trabajador nuevo
 *   cubre explícitamente "personal nuevo, reubicado o con cambio de función",
 *   así que una reubicación vuelve a hacer exigible la inducción.
 * - **reactivación**: estaba inactiva y vuelve a estarlo.
 *
 * Lo que **no** es un evento: dar de baja, renombrar, corregir una talla, o
 * trasladar a alguien que sigue inactivo. Una persona inactiva no está en la
 * dotación de ninguna faena, así que moverla de faena no la incorpora a nada.
 */
export function deriveWorkerLifecycleEvents(
  before: LifecycleBefore,
  after: LifecycleAfter,
  occurredAt: string,
): WorkerLifecycleEvent[] {
  if (!after.isActive) {
    /**
     * E2E-007 (auditoría 2026-09-14): el ciclo de vida sólo modelaba la entrada
     * —alta, traslado, reactivación— y la salida era una bandera silenciosa. En
     * ese momento quedan vivos los activos TI en poder de la persona, sus
     * accesos a sistemas, sus licencias, el EPP entregado y su pertenencia a
     * cuadrillas de permisos, y nada los reunía. La baja ahora es un hecho del
     * ciclo, con la faena de la que sale.
     */
    const leavesDotacion = before !== null && before.isActive
    return leavesDotacion
      ? [{ workerId: after.id, worksiteId: before.worksiteId, kind: "baja", occurredAt }]
      : []
  }

  if (before === null) {
    return [{ workerId: after.id, worksiteId: after.worksiteId, kind: "alta", occurredAt }]
  }

  if (before.worksiteId !== after.worksiteId) {
    return [{
      workerId: after.id,
      worksiteId: after.worksiteId,
      kind: "traslado",
      occurredAt,
      previousWorksiteId: before.worksiteId,
    }]
  }

  // Sólo si no hubo traslado: quien vuelve *y* cambia de faena entra una vez,
  // no dos. El hecho es la incorporación, y es una sola.
  if (!before.isActive) {
    return [{ workerId: after.id, worksiteId: after.worksiteId, kind: "reactivacion", occurredAt }]
  }

  return []
}

export async function insertWorker(values: WorkerInsert, client: Client = db): Promise<{ worker: WorkerRow; events: WorkerLifecycleEvent[] }> {
  const [worker] = await client.insert(workers).values(values).returning()
  if (!worker) throw new Error("No se pudo crear el trabajador.")
  return { worker, events: deriveWorkerLifecycleEvents(null, worker, new Date().toISOString()) }
}

/**
 * `known` evita releer la fila: los dos llamadores ya la cargaron para su
 * control de acceso, y volver a consultarla sería una segunda ida a la base
 * para saber algo que el llamador tiene en la mano.
 */
export async function updateWorkerFields(
  id: string,
  values: Partial<WorkerInsert>,
  known?: LifecycleBefore,
  client: Client = db,
): Promise<{ worker: WorkerRow; events: WorkerLifecycleEvent[] }> {
  const before = known ?? await client.query.workers.findFirst({ where: eq(workers.id, id) }) ?? null
  if (!before) throw new Error("Trabajador no encontrado")
  const [worker] = await client.update(workers).set(values).where(eq(workers.id, id)).returning()
  if (!worker) throw new Error("No se pudo actualizar el trabajador.")
  return { worker, events: deriveWorkerLifecycleEvents(before, worker, new Date().toISOString()) }
}

export async function setWorkerActive(
  id: string,
  isActive: boolean,
  known?: LifecycleBefore,
  client: Client = db,
): Promise<{ worker: WorkerRow; events: WorkerLifecycleEvent[] }> {
  return updateWorkerFields(id, { isActive }, known, client)
}

/**
 * Los eventos de un lote de la importación masiva.
 *
 * La importación conserva su transacción y su cláusula de alcance donde están
 * —el `worksiteScopeSql` del `WHERE` y el `returning()` que verifica que la
 * fila afectada seguía siendo del alcance son la única barrera contra que un
 * XLSX manipulado toque trabajadores de otra faena, y no se mueven de sitio—.
 * Lo que sí sale de ahí es la derivación, para que la importación y el alta
 * manual signifiquen exactamente lo mismo.
 */
export function importLifecycleEvents(
  rows: ReadonlyArray<{ before: LifecycleBefore; after: LifecycleAfter }>,
  occurredAt: string = new Date().toISOString(),
): WorkerLifecycleEvent[] {
  return rows.flatMap((row) => deriveWorkerLifecycleEvents(row.before, row.after, occurredAt))
}
