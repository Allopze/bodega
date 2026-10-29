import { sql } from "drizzle-orm"
import type { Tx } from "@/db"
import { mantFolioCounters } from "@/db/schema"
import { formatFolio } from "@/lib/mantencion/normalize"
import type { MantRecordKind } from "@/lib/mantencion/types"
import { ensureFolioCode } from "./worksites"

/**
 * Siguiente folio de la faena y el tipo (regla 12): `MP-BIO-0001`.
 *
 * El incremento es atómico en la base (`INSERT … ON CONFLICT DO UPDATE …
 * RETURNING`): dos registros simultáneos en la misma faena y tipo toman filas
 * distintas del contador, porque el segundo espera el bloqueo de fila del
 * primero hasta que éste confirma. Corre DENTRO de la transacción del registro:
 * si ésta se revierte, el contador también, así que no quedan huecos. Llamarla
 * lo más tarde posible dentro de la transacción reduce el tiempo que se
 * mantiene el bloqueo.
 */
export async function nextFolio(tx: Tx, worksiteId: string, kind: MantRecordKind): Promise<string> {
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
  return formatFolio(kind, code, row.last)
}
