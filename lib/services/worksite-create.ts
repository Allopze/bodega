import type { Tx } from "@/db"
import { worksites } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { ensurePreventionProgramSlotsForWorksiteTx } from "@/lib/services/prevention-program-slots"

/**
 * Alta de una faena: la fila, las casillas del programa preventivo (sólo si
 * nace activa) y la bitácora, todo dentro de la transacción del llamador.
 *
 * Existe porque la faena nace en más de un lugar —Administración y «Nueva
 * faena…» de la mantención de equipos— y el modo de falla de copiar el cuerpo
 * es el que ya documenta `prevention-program-slots.ts`: un alta nueva que
 * olvida las casillas deja una faena sin programa, invisible hasta la
 * fiscalización.
 *
 * La unicidad del código la valida quien llama (Administración la devuelve
 * como error del campo): aquí el índice único de la tabla es la última barrera.
 */
export interface CreateWorksiteInput {
  name: string
  code: string
  address?: string | null
  region?: string | null
  commune?: string | null
  adminContratoLabel?: string | null
  isActive: boolean
}

export interface WorksiteActor {
  userId: string | null
  email?: string | null
}

export async function createWorksiteTx(tx: Tx, input: CreateWorksiteInput, actor: WorksiteActor): Promise<{ id: string }> {
  const id = nanoid()
  await tx.insert(worksites).values({
    id,
    name: input.name,
    code: input.code,
    address: input.address ?? null,
    region: input.region ?? null,
    commune: input.commune || null,
    adminContratoLabel: input.adminContratoLabel || null,
    isActive: input.isActive,
  })
  if (input.isActive) await ensurePreventionProgramSlotsForWorksiteTx(tx, id)
  await recordAudit({
    userId: actor.userId,
    userEmail: actor.email ?? undefined,
    action: "create",
    entityType: "worksite",
    entityId: id,
    entityCode: input.code,
    newState: { name: input.name, code: input.code, isActive: input.isActive },
  }, tx)
  return { id }
}
