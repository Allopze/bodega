/**
 * lib/services/prevention-committees.ts
 * CPHS, reuniones y acuerdos (PDTP N° 11-14).
 */

import { desc, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { committees, committeeMembers, committeeMeetings, committeeAgreements } from "@/db/schema"
import type { ReportData } from "@/lib/reports/export"
import { nanoid } from "@/lib/id"
import {
  committeeCreateSchema,
  committeeMemberAddSchema,
  committeeMeetingScheduleSchema,
  committeeAgreementAddSchema,
} from "@/lib/validation/prevention"

type WorksiteScope = string[] | "all"

function assertWorksiteAccess(worksiteId: string, scope: WorksiteScope): void {
  if (scope === "all") return
  if (!scope.includes(worksiteId)) throw new Error("Sin acceso a esta faena.")
}

export async function createCommittee(input: unknown, scope: WorksiteScope) {
  const data = committeeCreateSchema.parse(input)
  assertWorksiteAccess(data.worksiteId, scope)
  const now = new Date().toISOString()
  const [row] = await db.insert(committees).values({
    id: `comm-${nanoid()}`,
    worksiteId: data.worksiteId,
    type: data.type,
    status: "activo",
    createdAt: now,
  }).onConflictDoUpdate({
    target: [committees.worksiteId, committees.type],
    set: { status: "activo" },
  }).returning()
  return row
}

export async function addCommitteeMember(input: unknown) {
  const data = committeeMemberAddSchema.parse(input)
  const now = new Date().toISOString()
  const [row] = await db.insert(committeeMembers).values({
    id: `cmmb-${nanoid()}`,
    committeeId: data.committeeId,
    userId: data.userId,
    role: data.role,
    startDate: data.startDate,
    createdAt: now,
  }).returning()
  return row
}

export async function scheduleMeeting(input: unknown) {
  const data = committeeMeetingScheduleSchema.parse(input)
  const now = new Date().toISOString()
  const [row] = await db.insert(committeeMeetings).values({
    id: `cmet-${nanoid()}`,
    committeeId: data.committeeId,
    scheduledAt: data.scheduledAt,
    attendees: data.attendeeIds,
    agenda: data.agenda,
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

export async function addAgreement(input: unknown) {
  const data = committeeAgreementAddSchema.parse(input)
  const now = new Date().toISOString()
  const [row] = await db.insert(committeeAgreements).values({
    id: `cagr-${nanoid()}`,
    meetingId: data.meetingId,
    description: data.description,
    responsibleId: data.responsibleId,
    dueDate: data.dueDate,
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
