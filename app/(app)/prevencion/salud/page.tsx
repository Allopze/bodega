import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { and, asc, eq, inArray } from "drizzle-orm"
import { requireAuth, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { scopeToIds } from "@/lib/ppa/utils"
import { db } from "@/db"
import { workers } from "@/db/schema/worksites"
import { listMinsalProtocols } from "@/lib/services/prevention-health"
import { PageContainer } from "@/components/ui/page-container"
import { SaludPanel } from "./salud-panel"

export const metadata: Metadata = { title: "Salud ocupacional" }

export default async function SaludPage() {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:health:view")) redirect("/forbidden")

  const scope = scopeToIds(resolveWorksiteScope(session))

  const [protocols, workerRows] = await Promise.all([
    listMinsalProtocols(),
    db
      .select({ id: workers.id, firstName: workers.firstName, lastName: workers.lastName, rut: workers.rut })
      .from(workers)
      .where(
        scope === "all"
          ? eq(workers.isActive, true)
          : scope.length > 0
            ? and(eq(workers.isActive, true), inArray(workers.worksiteId, scope))
            : undefined,
      )
      .orderBy(asc(workers.firstName), asc(workers.lastName)),
  ])

  const workerOptions = scope !== "all" && scope.length === 0
    ? []
    : workerRows.map((w) => ({ id: w.id, name: `${w.firstName} ${w.lastName}`.trim(), rut: w.rut ?? "" }))

  return (
    <PageContainer>
      <SaludPanel
        protocols={protocols}
        workers={workerOptions}
        canManage={can(session, "prevention:health:manage")}
        canRestrict={can(session, "prevention:health:restrict")}
      />
    </PageContainer>
  )
}
