/**
 * lib/services/prevention-committees.ts
 * CPHS, reuniones y acuerdos (PDTP N° 11-14).
 */

import { desc, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { committees, committeeMembers, committeeMeetings, committeeAgreements } from "@/db/schema"
import type { ReportData } from "@/lib/reports/export"
import { nanoid } from "@/lib/id"

type WorksiteScope = string[] | "all"

function assertWorksiteAccess(worksiteId: string, scope: WorksiteScope): void {
  if (scope === "all") return
  if (!scope.includes(worksiteId)) throw new Error("Sin acceso a esta faena.")
}

export async function createCommittee(input: { worksiteId: string; type: string }, scope: WorksiteScope) {
  assertWorksiteAccess(input.worksiteId, scope)
  const now = new Date().toISOString()
  const [row] = await db.insert(committees).values({
    id: `comm-${nanoid()}`,
    worksiteId: input.worksiteId,
    type: input.type,
    status: "activo",
    createdAt: now,
  }).onConflictDoUpdate({
    target: [committees.worksiteId, committees.type],
    set: { status: "activo" },
  }).returning()
  return row
}

export async function addCommitteeMember(input: {
  committeeId: string
  userId: string
  role: string
  startDate: string
}) {
  const now = new Date().toISOString()
  const [row] = await db.insert(committeeMembers).values({
    id: `cmmb-${nanoid()}`,
    committeeId: input.committeeId,
    userId: input.userId,
    role: input.role,
    startDate: input.startDate,
    createdAt: now,
  }).returning()
  return row
}

export async function scheduleMeeting(input: {
  committeeId: string
  scheduledAt: string
  agenda: string
  attendeeIds: string[]
}) {
  const now = new Date().toISOString()
  const [row] = await db.insert(committeeMeetings).values({
    id: `cmet-${nanoid()}`,
    committeeId: input.committeeId,
    scheduledAt: input.scheduledAt,
    attendees: input.attendeeIds,
    agenda: input.agenda,
    createdAt: now,
    updatedAt: now,
  }).returning()
  return row
}

export async function recordMeetingAttendance(meetingId: string, attendeeIds: string[]) {
  const now = new Date().toISOString()
  const [updated] = await db.update(committeeMeetings)
    .set({ heldAt: now, attendees: attendeeIds, updatedAt: now })
    .where(eq(committeeMeetings.id, meetingId))
    .returning()
  return updated
}

export async function addAgreement(input: {
  meetingId: string
  description: string
  responsibleId: string
  dueDate: string
}) {
  const now = new Date().toISOString()
  const [row] = await db.insert(committeeAgreements).values({
    id: `cagr-${nanoid()}`,
    meetingId: input.meetingId,
    description: input.description,
    responsibleId: input.responsibleId,
    dueDate: input.dueDate,
    status: "pendiente",
    createdAt: now,
    updatedAt: now,
  }).returning()
  return row
}

export async function listCommittees(scope: WorksiteScope) {
  const where = scope === "all" ? undefined : inArray(committees.worksiteId, scope)
  return db.select().from(committees).where(where).orderBy(committees.type)
}

export async function buildCommitteesExport(scope: WorksiteScope): Promise<ReportData> {
  const items = await listCommittees(scope)
  return {
    filenameBase: "comites",
    worksheetName: "Comités",
    headers: ["ID", "Faena", "Tipo", "Estado"],
    rows: items.map((c) => [c.id, c.worksiteId, c.type, c.status]),
  }
}
