import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { requireAuth, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import {
  getActivePdtpProgram,
  getPdtpProgram,
  listActionsByProgram,
  listPdtpProgramActivities,
  listPdtpProgramWorksites,
  resolveProgramWorksiteIds,
} from "@/lib/services/prevention-pdtp"
import { listScopedWorksites } from "@/lib/services/ppa"
import { currentPdtpPeriod } from "@/lib/services/pdtp/period"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { AccionesTable } from "./acciones-table"
import { CreatePdtpRevisionButton } from "../[programId]/create-pdtp-revision-button"

export const metadata: Metadata = { title: "Medidas del programa" }

type Props = {
  searchParams: Promise<{
    estado?: string | string[]
    prioridad?: string | string[]
    faena?: string | string[]
    vencidas?: string | string[]
    programa?: string | string[]
    anio?: string | string[]
  }>
}

const one = (value?: string | string[]) => Array.isArray(value) ? value[0] : value

export default async function PdtpAccionesPage({ searchParams }: Props) {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:pdtp:view")) redirect("/forbidden")

  const query = await searchParams
  const estado = one(query.estado)
  const prioridad = one(query.prioridad)
  const worksiteId = one(query.faena)
  const soloVencidas = one(query.vencidas) === "1"
  const requestedProgramId = one(query.programa)

  const scope = resolveWorksiteScope(session)
  const worksiteIds: string[] | "all" = scope.mode === "all" ? "all" : scope.mode === "some" ? scope.ids : []
  const worksites = await listScopedWorksites(worksiteIds)

  const requestedYear = Number(one(query.anio))
  const year = Number.isInteger(requestedYear) && requestedYear >= 2024 && requestedYear <= 2100 ? requestedYear : currentPdtpPeriod().year
  const requestedProgram = requestedProgramId ? await getPdtpProgram(requestedProgramId) : null
  const program = requestedProgram?.year === year ? requestedProgram : await getActivePdtpProgram(year)
  const programMembers = program ? await listPdtpProgramWorksites(program.id) : []
  const effectiveWorksiteIds = program
    ? resolveProgramWorksiteIds(
        programMembers.map((member) => member.worksiteId),
        worksiteIds,
        worksites.map((worksite) => worksite.id),
        program.appliesToAllWorksites,
      )
    : []
  const effectiveWorksiteId = worksiteId && effectiveWorksiteIds.includes(worksiteId) ? worksiteId : undefined
  const effectiveWorksites = worksites.filter((worksite) => effectiveWorksiteIds.includes(worksite.id))
  const hasUndeclaredActiveScope = program?.status === "active"
    && !program.appliesToAllWorksites
    && programMembers.length === 0
  const hasNoAccessibleWorksites = Boolean(program) && effectiveWorksites.length === 0 && !hasUndeclaredActiveScope

  const [items, activities] = program
    ? await Promise.all([
        listActionsByProgram(program.id, effectiveWorksiteIds, { estado, prioridad, worksiteId: effectiveWorksiteId, soloVencidas }),
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
        title="Medidas del programa"
        description="Vista transversal de acciones correctivas de todas las actividades del programa activo."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Programa de trabajo", href: "/prevencion/pdtp" },
            { label: "Medidas" },
          ]} />
        }
      />

      {!program ? (
        <p className="text-sm text-(--color-text-muted)">No hay un programa PDTP activo para {year}.</p>
      ) : hasUndeclaredActiveScope ? (
        <EmptyState
          tone="warning"
          title="Alcance de faenas no declarado"
          description={canManage
            ? "La versión activa no tiene faenas asignadas ni declara alcance corporativo. Crea una revisión v+1 para definir dónde se puede ejecutar."
            : "La versión activa no tiene faenas asignadas ni declara alcance corporativo. Solicita a quien administra el programa que cree una revisión v+1."}
          action={canManage ? <CreatePdtpRevisionButton sourceProgramId={program.id} /> : undefined}
        />
      ) : hasNoAccessibleWorksites ? (
        <EmptyState
          tone="warning"
          title="Sin faenas accesibles para este programa"
          description="No tienes una faena de este programa dentro de tu alcance autorizado. Solicita la asignación correspondiente antes de revisar sus medidas correctivas."
          action={<Button asChild size="sm" variant="secondary"><Link href={`/prevencion/pdtp/${program.id}`}>Revisar programa</Link></Button>}
        />
      ) : (
        <AccionesTable
          items={items}
          activityLabelById={Object.fromEntries(activityLabelById)}
          worksiteNameById={Object.fromEntries(worksiteNameById)}
          worksites={effectiveWorksites}
          filters={{ estado, prioridad, worksiteId: effectiveWorksiteId, soloVencidas }}
          canManage={canManage}
          canVerify={canVerify}
          programId={program.id}
        />
      )}
    </PageContainer>
  )
}
