import { eq } from "drizzle-orm"
import { db } from "@/db"
import {
  preventionPermitCrew,
  preventionTrainingAttendance,
  preventionTrainingCourseVersions,
  preventionTrainingCourses,
  preventionTrainingSessions,
  preventionWorkPermits,
  workers,
} from "@/db/schema"
import { verifyPreventionAckToken } from "@/lib/services/prevention-ack-token"

/**
 * `CAP-002` / `PER-002` (auditoría 2026-09-14): lecturas de la vía de acuse sin
 * cuenta. Sirven sólo lo que el trabajador necesita ver para saber qué está
 * acusando —qué curso o qué permiso, y su propio nombre—; nada del expediente
 * interno viaja al enlace público, igual que en PPA y TAE.
 *
 * La autorización es la posesión del token. Sin token válido no se devuelve
 * nada: `null`, para que la página responda 404 y el enlace no funcione como
 * oráculo de existencia de ids.
 */
export interface PublicAckView {
  kind: "capacitacion" | "permiso"
  targetId: string
  workerName: string
  title: string
  detail: string
  acknowledgedAt: string | null
  /** El acuse sólo tiene sentido sobre una asistencia registrada. */
  eligible: boolean
  ineligibleReason: string | null
}

export async function getTrainingAckPublicView(attendanceId: string, token: unknown): Promise<PublicAckView | null> {
  if (!attendanceId || !verifyPreventionAckToken("capacitacion", attendanceId, token)) return null
  const [row] = await db.select({
    attendance: preventionTrainingAttendance,
    sessionCode: preventionTrainingSessions.code,
    scheduledAt: preventionTrainingSessions.scheduledAt,
    courseName: preventionTrainingCourses.name,
    firstName: workers.firstName,
    lastName: workers.lastName,
  })
    .from(preventionTrainingAttendance)
    .innerJoin(preventionTrainingSessions, eq(preventionTrainingAttendance.sessionId, preventionTrainingSessions.id))
    .innerJoin(preventionTrainingCourseVersions, eq(preventionTrainingSessions.courseVersionId, preventionTrainingCourseVersions.id))
    .innerJoin(preventionTrainingCourses, eq(preventionTrainingCourseVersions.courseId, preventionTrainingCourses.id))
    .innerJoin(workers, eq(workers.id, preventionTrainingAttendance.workerId))
    .where(eq(preventionTrainingAttendance.id, attendanceId))
    .limit(1)
  if (!row) return null
  const attended = row.attendance.status === "attended"
  return {
    kind: "capacitacion",
    targetId: attendanceId,
    workerName: `${row.firstName} ${row.lastName}`.trim(),
    title: row.courseName,
    detail: `Sesión ${row.sessionCode}`,
    acknowledgedAt: row.attendance.acknowledgedAt,
    eligible: attended,
    ineligibleReason: attended ? null : "Todavía no hay una asistencia registrada para esta capacitación.",
  }
}

export async function getPermitCrewAckPublicView(crewId: string, token: unknown): Promise<PublicAckView | null> {
  if (!crewId || !verifyPreventionAckToken("permiso", crewId, token)) return null
  const [row] = await db.select({
    crew: preventionPermitCrew,
    permitCode: preventionWorkPermits.code,
    taskDescription: preventionWorkPermits.taskDescription,
    location: preventionWorkPermits.location,
    firstName: workers.firstName,
    lastName: workers.lastName,
  })
    .from(preventionPermitCrew)
    .innerJoin(preventionWorkPermits, eq(preventionPermitCrew.permitId, preventionWorkPermits.id))
    .innerJoin(workers, eq(workers.id, preventionPermitCrew.workerId))
    .where(eq(preventionPermitCrew.id, crewId))
    .limit(1)
  if (!row) return null
  return {
    kind: "permiso",
    targetId: crewId,
    workerName: `${row.firstName} ${row.lastName}`.trim(),
    title: `Permiso ${row.permitCode}`,
    detail: `${row.taskDescription} · ${row.location}`,
    acknowledgedAt: row.crew.acknowledgedAt,
    eligible: true,
    ineligibleReason: null,
  }
}
