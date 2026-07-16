import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requireAuth, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import {
  getActivePdtpProgram,
  listActionsByProgram,
  listPdtpProgramActivities,
} from "@/lib/services/prevention-pdtp"
import { listScopedWorksites } from "@/lib/services/ppa"
import { currentPdtpPeriod } from "@/lib/services/pdtp/period"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { AccionesTable } from "./acciones-table"

export const metadata: Metadata = { title: "Plan de acción PDTP" }

type Props = {
  searchParams: Promise<{
    estado?: string | string[]
    prioridad?: string | string[]
    faena?: string | string[]
    vencidas?: string | string[]
  }>
}

export default async function PdtpAccionesPage({ searchParams }: Props) {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:pdtp:view")) redirect("/forbidden")

  const query = await searchParams
  const one = (v?: string | string[]) => Array.isArray(v) ? v[0] : v
  const estado = one(query.estado)
  const prioridad = one(query.prioridad)
  const worksiteId = one(query.faena)
  const soloVencidas = one(query.vencidas) === "1"

  const scope = resolveWorksiteScope(session)
  const worksiteIds: string[] | "all" = scope.mode === "all" ? "all" : scope.mode === "some" ? scope.ids : []
  const worksites = await listScopedWorksites(worksiteIds)

  const year = currentPdtpPeriod().year
  const program = await getActivePdtpProgram(year)

  const [items, activities] = program
    ? await Promise.all([
        listActionsByProgram(program.id, { estado, prioridad, worksiteId, soloVencidas, scope: worksiteIds }),
        listPdtpProgramActivities(program.id),
      ])
    : [[], []]

  const activityLabelById = new Map(activities.map((a) => [a.id, `N°${a.n} ${a.activity}`]))
  const worksiteNameById = new Map(worksites.map((w) => [w.id, w.name]))

  const canManage = can(session, "prevention:pdtp:action:manage")
  const canVerify = can(session, "prevention:pdtp:action:verify")

  return (
    <PageContainer>
      <PageHeader
        title="Plan de acción PDTP"
        description="Vista transversal de acciones correctivas de todas las actividades del programa activo."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Programas PDTP", href: "/prevencion/pdtp" },
            { label: "Plan de acción" },
          ]} />
        }
      />

      {!program ? (
        <p className="text-sm text-(--color-text-muted)">No hay un programa PDTP activo para {year}.</p>
      ) : (
        <AccionesTable
          items={items}
          activityLabelById={Object.fromEntries(activityLabelById)}
          worksiteNameById={Object.fromEntries(worksiteNameById)}
          worksites={worksites}
          filters={{ estado, prioridad, worksiteId, soloVencidas }}
          canManage={canManage}
          canVerify={canVerify}
          programId={program.id}
        />
      )}
    </PageContainer>
  )
}
