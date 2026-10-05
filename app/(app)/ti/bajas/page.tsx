import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { can, requirePermission } from "@/lib/auth/can"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { db } from "@/db"
import { itAssets, users, workers, worksites } from "@/db/schema"
import { eq, asc, and, inArray, sql } from "drizzle-orm"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { listRetirements } from "@/lib/services/ti/retirements"
import { listAssetOptions } from "@/lib/services/ti/assets"
import { RetirementTable } from "./retirement-table"
import { RetirementCta } from "./retirement-sheet"
import { RetirementFilters } from "./retirement-filters"
import { IT_RETIREMENT_REASONS } from "@/lib/validation/ti"

export const metadata: Metadata = { title: "Bajas" }

export default async function BajasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  let session
  try { session = await requirePermission("ti:view") }
  catch { redirect("/forbidden") }

  const canManage = can(session, "ti:manage_assets")
  // Permiso separado: revertir deshace el doble control de la baja, así que
  // no lo tiene automáticamente quien puede registrarla.
  const canReverse = can(session, "ti:reverse_retirement")
  const sp = await searchParams
  const motivo = typeof sp.motivo === "string" && (IT_RETIREMENT_REASONS as readonly string[]).includes(sp.motivo) ? sp.motivo : ""
  const faena = typeof sp.faena === "string" ? sp.faena : ""
  // La faena pedida se intersecta con el alcance del usuario: una ajena da vacío.
  const scope = worksiteScopeSql(session, itAssets.worksiteId, faena || undefined)
  const optionScope = worksiteScopeSql(session, itAssets.worksiteId)
  const worksiteScope = worksiteScopeSql(session, worksites.id)

  const [rows, assetOptions, techUsers, worksitesList] = await Promise.all([
    listRetirements({ scope, reason: motivo || undefined }),
    listAssetOptions(optionScope),
    db.select({ id: users.id, name: users.name })
      .from(users).where(eq(users.isActive, true)).orderBy(asc(users.name)),
    db.select({ id: worksites.id, name: worksites.name })
      .from(worksites).where(and(eq(worksites.isActive, true), worksiteScope)).orderBy(asc(worksites.name)),
  ])

  // Contexto de cada activo para la hoja de baja: quien da de baja necesita ver
  // de quién es el equipo y en qué faena está, no solo su código.
  const workerIds = [...new Set(assetOptions.map((a) => a.workerId).filter((id): id is string => Boolean(id)))]
  const custodians = workerIds.length
    ? await db.select({ id: workers.id, name: sql<string>`trim(concat(${workers.firstName}, ' ', ${workers.lastName}))` })
        .from(workers).where(inArray(workers.id, workerIds))
    : []
  const workerName = new Map(custodians.map((w) => [w.id, w.name]))
  const siteName = new Map(worksitesList.map((w) => [w.id, w.name]))
  const retirementAssets = assetOptions.map((a) => ({
    id: a.id,
    code: a.code,
    typeName: a.typeName,
    brand: a.brand,
    model: a.model,
    workerName: a.workerId ? workerName.get(a.workerId) ?? null : null,
    worksiteName: a.worksiteId ? siteName.get(a.worksiteId) ?? null : null,
  }))

  return (
    <PageContainer>
      <PageHeader
        title="Bajas"
        description="Proceso formal de baja: el activo conserva su historial completo para siempre."
        breadcrumb={<Breadcrumbs items={[{ label: "TI", href: "/ti" }, { label: "Bajas" }]} />}
        actions={canManage ? (
          <RetirementCta assets={retirementAssets} users={techUsers} />
        ) : undefined}
      />

      <RetirementFilters current={{ motivo, faena }} worksites={worksitesList} />

      <RetirementTable rows={rows} canManage={canReverse} />
    </PageContainer>
  )
}
