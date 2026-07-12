import type { Session } from "next-auth"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { users, workers } from "@/db/schema"
import { canAccessWorksite } from "@/lib/auth/can"
import type { ActionState } from "@/lib/validation/masters"

type WorksiteAssignment = { worksiteId: string; isPrimary: boolean }

export async function validateWorkerAssociation(
  session: Session,
  workerId: string | undefined,
  worksiteAssignments: WorksiteAssignment[],
  userId?: string,
): Promise<{ worker: typeof workers.$inferSelect | null; error: ActionState | null }> {
  if (!workerId) return { worker: null, error: null }

  const worker = await db.query.workers.findFirst({ where: eq(workers.id, workerId) })
  if (!worker) return { worker: null, error: { ok: false, fieldErrors: { workerId: ["El trabajador seleccionado no está disponible"] } } }
  if (!canAccessWorksite(session, worker.worksiteId)) {
    return { worker: null, error: { ok: false, fieldErrors: { workerId: ["No tienes acceso a la faena de este trabajador"] } } }
  }
  const linkedUser = await db.query.users.findFirst({ where: eq(users.workerId, workerId) })
  if (!worker.isActive && linkedUser?.id !== userId) {
    return { worker: null, error: { ok: false, fieldErrors: { workerId: ["El trabajador seleccionado no está disponible"] } } }
  }
  if (linkedUser && linkedUser.id !== userId) {
    return { worker: null, error: { ok: false, fieldErrors: { workerId: ["Este trabajador ya está asociado a otro usuario"] } } }
  }
  if (!worksiteAssignments.some((assignment) => assignment.worksiteId === worker.worksiteId)) {
    return { worker: null, error: { ok: false, fieldErrors: { workerId: ["Incluye la faena del trabajador en los accesos del usuario"] } } }
  }

  return { worker, error: null }
}
