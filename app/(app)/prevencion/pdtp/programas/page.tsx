import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { requireAuth, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { listPdtpPrograms, getPdtpComplianceIndicatorsForScope, listPdtpProgramWorksites, resolveProgramWorksiteIds } from "@/lib/services/prevention-pdtp"
import { listScopedWorksites } from "@/lib/services/ppa"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Plus } from "@phosphor-icons/react/dist/ssr"
import { buildPdtpProgramHref, resolvePdtpYear } from "../pdtp-context"
import { PdtpYearPicker } from "../pdtp-sheet-table-ui"
import { MetaBadge } from "@/components/states/state-badge"
import { pdtpProgramStatusLabel, pdtpProgramStatusVariant } from "@/lib/prevention/pdtp"
import { countOf, pluralize } from "@/lib/utils"

export const metadata: Metadata = { title: "Programas anuales" }

type PdtpProgramasListPageProps = {
  searchParams: Promise<{ hoja?: string; faena?: string; vista?: string; anio?: string }>
}

export default async function PdtpProgramasListPage({ searchParams }: PdtpProgramasListPageProps) {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:pdtp:view")) redirect("/forbidden")

  const query = await searchParams
  const canManageProgram = can(session, "prevention:pdtp:program:manage")
  const year = resolvePdtpYear(query.anio)
  const [programs, allPrograms] = await Promise.all([listPdtpPrograms({ year }), listPdtpPrograms()])

  const scope = resolveWorksiteScope(session)
  const scopedWorksites = await listScopedWorksites(scope.mode === "all" ? "all" : scope.mode === "some" ? scope.ids : [])
  const worksiteIds = scopedWorksites.map((w) => w.id)

  const complianceEntries = await Promise.all(programs.map(async (program) => {
    try {
      const members = await listPdtpProgramWorksites(program.id)
      const effectiveIds = resolveProgramWorksiteIds(
        members.map((member) => member.worksiteId),
        scope.mode === "all" ? "all" : scope.mode === "some" ? scope.ids : [],
        worksiteIds,
        program.appliesToAllWorksites,
      )
      return [program.id, await getPdtpComplianceIndicatorsForScope(program.id, effectiveIds)] as const
    } catch {
      return [program.id, null] as const
    }
  }))
  const complianceByProgram = new Map(complianceEntries)

  return (
    <PageContainer>
      <PageHeader
        title="Programas anuales"
        description={`Programas anuales ${year}: gestiona versiones, plantillas y accesos por faena.`}
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Prevención", href: "/prevencion" },
            { label: "Programa de trabajo", href: "/prevencion/pdtp" },
            { label: "Listado de programas" },
          ]} />
        }
        actions={
          canManageProgram && (
            <div className="flex items-center gap-2">
              <Button asChild size="sm" variant="secondary">
                <Link href="/prevencion/pdtp/plantillas">Plantillas</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/prevencion/pdtp/nuevo">
                  <Plus size={14} />
                  Nuevo programa
                </Link>
              </Button>
            </div>
          )
        }
      />

      <div className="mb-4 flex justify-end"><PdtpYearPicker current={year} years={allPrograms.map((program) => program.year)} hrefBase="/prevencion/pdtp/programas" /></div>

      {programs.length === 0 ? (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-8 text-center">
          <p className="font-medium text-[var(--color-text)]">Sin programa para {year}</p>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            No hay programas de trabajo preventivo registrados para este año. Crea el primero para comenzar.
          </p>
          {canManageProgram && (
            <Button asChild className="mt-4" size="sm">
              <Link href="/prevencion/pdtp/nuevo">Crear programa</Link>
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {programs.map((program) => {
            const indicators = complianceByProgram.get(program.id)

            return (
              <div key={program.id} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 transition-shadow hover:shadow-md">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold text-[var(--color-text)]">{program.title} <span className="font-mono text-xs font-normal text-[var(--color-text-muted)]">v{program.version}</span></p>
                    <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                      Año {program.year}
                    </p>
                  </div>
                  <MetaBadge meta={{ label: pdtpProgramStatusLabel(program.status), variant: pdtpProgramStatusVariant(program.status) }} dot />
                </div>
                <div className="mt-3 flex items-center gap-4 text-xs text-[var(--color-text-subtle)]">
                  {indicators?.annual && (
                    <span title={`Plan / ejecutado agregado sobre ${countOf(indicators.worksiteCount, "faena autorizada", "faenas autorizadas")}`}>
                      Cumplimiento ({indicators.worksiteCount} {pluralize(indicators.worksiteCount, "faena")}): {indicators.annual.percent !== null ? `${Math.round(indicators.annual.percent * 100)}%` : "—"}
                    </span>
                  )}
                  <span>Elaborado por: {program.elaboratedByName}</span>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button asChild size="sm"><Link href={`/prevencion/pdtp/actividades?programa=${program.id}&anio=${program.year}&vista=anual${query.faena ? `&faena=${query.faena}` : ""}`}>Ver actividades</Link></Button>
                  {canManageProgram && <Button asChild size="sm" variant="secondary"><Link href={buildPdtpProgramHref(program.id, query)}>Gestionar programa</Link></Button>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </PageContainer>
  )
}
