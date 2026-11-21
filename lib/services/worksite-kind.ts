import { eq } from "drizzle-orm"
import type { Tx } from "@/db"
import { worksites } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import type { WorksiteAliasActor } from "@/lib/services/worksite-aliases"

import { isWorksiteKind, WORKSITE_KIND_LABELS, type WorksiteKind } from "@/lib/worksites/worksite-kind"

export { WORKSITE_KINDS, WORKSITE_KIND_LABELS, isWorksiteKind, type WorksiteKind } from "@/lib/worksites/worksite-kind"

/** Cambia el tipo de una faena y lo deja en la bitácora. Sin cambio no escribe nada. */
export async function setWorksiteKindTx(
  tx: Tx,
  actor: WorksiteAliasActor,
  input: { worksiteId: string; kind: WorksiteKind; reason?: string },
): Promise<{ ok: true; changed: boolean; message: string } | { ok: false; message: string }> {
  const [site] = await tx.select({ id: worksites.id, name: worksites.name, code: worksites.code, kind: worksites.kind })
    .from(worksites).where(eq(worksites.id, input.worksiteId))
  if (!site) return { ok: false, message: "Faena no encontrada." }
  if (site.kind === input.kind) return { ok: true, changed: false, message: `${site.name} ya es de tipo ${WORKSITE_KIND_LABELS[input.kind]}.` }
  await tx.update(worksites).set({ kind: input.kind, updatedAt: new Date().toISOString() }).where(eq(worksites.id, site.id))
  await recordAudit({
    userId: actor.userId,
    userEmail: actor.email ?? undefined,
    action: "update",
    entityType: "worksite",
    entityId: site.id,
    entityCode: site.code,
    oldState: { kind: site.kind },
    newState: { kind: input.kind },
    reason: input.reason,
    worksiteId: site.id,
  }, tx)
  return { ok: true, changed: true, message: `${site.name} ahora es de tipo ${WORKSITE_KIND_LABELS[input.kind]}.` }
}
