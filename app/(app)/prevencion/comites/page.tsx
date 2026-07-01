import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { eq, inArray } from "drizzle-orm"
import { requireAuth, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { listCommittees } from "@/lib/services/prevention-committees"
import { listScopedWorksites } from "@/lib/services/ppa"
import { db } from "@/db"
import { users, committeeMembers, committeeMeetings, committeeAgreements } from "@/db/schema"
import { PageContainer } from "@/components/ui/page-container"
import { ComitesPanel } from "./comites-panel"

export const metadata: Metadata = { title: "Comités y reuniones" }

function scopeToIds(scope: ReturnType<typeof resolveWorksiteScope>): string[] | "all" {
  if (scope.mode === "all") return "all"
  if (scope.mode === "none") return []
  return scope.ids
}

export default async function ComitesPage() {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:cphs:view")) redirect("/forbidden")

  const scope = scopeToIds(resolveWorksiteScope(session))
  const canManage = can(session, "prevention:cphs:manage")

  const [items, worksites, activeUsers] = await Promise.all([
    listCommittees(scope),
    listScopedWorksites(scope),
    db.select({ id: users.id, name: users.name }).from(users).where(eq(users.isActive, true)).orderBy(users.name),
  ])

  const committeeIds = items.map((c) => c.id)
  const [members, meetings] = committeeIds.length === 0
    ? [[], []]
    : await Promise.all([
        db.select().from(committeeMembers).where(inArray(committeeMembers.committeeId, committeeIds)),
        db.select().from(committeeMeetings).where(inArray(committeeMeetings.committeeId, committeeIds)),
      ])

  const meetingIds = meetings.map((m) => m.id)
  const agreements = meetingIds.length === 0
    ? []
    : await db.select().from(committeeAgreements).where(inArray(committeeAgreements.meetingId, meetingIds))

  return (
    <PageContainer>
      <ComitesPanel
        committees={items}
        worksites={worksites}
        users={activeUsers}
        members={members}
        meetings={meetings}
        agreements={agreements}
        canManage={canManage}
      />
    </PageContainer>
  )
}

// ponytail: no dedicated "list active users" service helper exists yet anywhere
// in lib/services — every other prevention form that wants a "responsible
// person" uses free text instead of a real userId FK. This keeps the query
// inline (mirrors listScopedWorksites's shape) rather than adding a new
// service module for one query. Promote to lib/services/users.ts if a
// second screen needs the same picker.
