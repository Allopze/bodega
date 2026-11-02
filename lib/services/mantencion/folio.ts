import { sql } from "drizzle-orm"
import type { Tx } from "@/db"
import { mantFolioCounters } from "@/db/schema"
import { formatFolio } from "@/lib/mantencion/normalize"
import type { MantFolioKind } from "@/lib/mantencion/types"
import { formatWorkOrderFolio } from "@/lib/mantencion/work-order-states"
import { ensureFolioCode } from "./worksites"

/**
 * Siguiente folio de la faena y el tipo (regla 12): `MP-BIO-0001`, `MC-BIO-0001`
 * u `OT-BIO-0001`.
 *
 * El incremento es atómico en la base (`INSERT … ON CONFLICT DO UPDATE …
 * RETURNING`): dos registros simultáneos en la misma faena y tipo toman filas
 * distintas del contador, porque el segundo espera el bloqueo de fila del
 * primero hasta que éste confirma. Corre DENTRO de la transacción del registro:
 * si ésta se revierte, el contador también, así que no quedan huecos. Llamarla
 * lo más tarde posible dentro de la transacción reduce el tiempo que se
 * mantiene el bloqueo.
 */
export async function nextFolio(tx: Tx, worksiteId: string, kind: MantFolioKind): Promise<string> {
  const code = await ensureFolioCode(tx, worksiteId)
  const [row] = await tx
    .insert(mantFolioCounters)
    .values({ worksiteId, kind, last: 1 })
    .onConflictDoUpdate({
      target: [mantFolioCounters.worksiteId, mantFolioCounters.kind],
      set: { last: sql`${mantFolioCounters.last} + 1`, updatedAt: sql`now()` },
    })
    .returning({ last: mantFolioCounters.last })
  if (!row) throw new Error("No se pudo asignar el folio")
  return kind === "OT" ? formatWorkOrderFolio(code, row.last) : formatFolio(kind, code, row.last)
}
