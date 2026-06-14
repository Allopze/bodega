import type { Session } from "next-auth"
import { asc, inArray } from "drizzle-orm"
import type { DB } from "@/db"
import { worksiteUsers } from "@/db/schema"
import { resolveWorksiteScope } from "./scope"

export async function visibleUserIdsForAdminScope(db: DB, session: Session): Promise<string[] | undefined> {
  const scope = resolveWorksiteScope(session)
  if (scope.mode === "all") return undefined
  if (scope.mode === "none") return []

  const rows = await db
    .select({ userId: worksiteUsers.userId })
    .from(worksiteUsers)
    .where(inArray(worksiteUsers.worksiteId, scope.ids))
    .groupBy(worksiteUsers.userId)
    .orderBy(asc(worksiteUsers.userId))

  return rows.map((row) => row.userId)
}

export async function canManageUserInAdminScope(db: DB, session: Session, userId: string): Promise<boolean> {
  const visibleUserIds = await visibleUserIdsForAdminScope(db, session)
  return visibleUserIds === undefined || visibleUserIds.includes(userId)
}
