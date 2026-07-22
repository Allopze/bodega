import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { requireAuth, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { listPdtpPrograms, getPdtpComplianceIndicatorsForScope } from "@/lib/services/prevention-pdtp"
import { listScopedWorksites } from "@/lib/services/ppa"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Plus } from "@phosphor-icons/react/dist/ssr"
import { buildPdtpProgramHref, resolvePdtpYear } from "./pdtp-context"

export const metadata: Metadata = { title: "Programa de Trabajo Preventivo SG-SST" }

type PdtpListPageProps = {
  searchParams: Promise<{ hoja?: string; faena?: string; vista?: string; anio?: string }>
}

export default async function PdtpListPage({ searchParams }: PdtpListPageProps) {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:pdtp:view")) redirect("/forbidden")

  const query = await searchParams
  const canManageProgram = can(session, "prevention:pdtp:program:manage")
  const year = resolvePdtpYear(query.anio)
  const programs = await listPdtpPrograms({ year })

  // Un único programa anual es contexto predeterminado. Con varios programas
  // nunca elegimos silenciosamente una versión: se muestra el selector.
  if (programs.length === 1) {
    redirect(buildPdtpProgramHref(programs[0]!.id, query))
  }

  // UX-01: omitir worksiteId deja `executed` en 0 aunque exista avance real
  // (loadProgramScheduleAndExecutions no agrega ejecuciones sin faena). El
  // agregado se calcula sobre las faenas que el usuario realmente puede ver,
  // nunca "todas" por omisión.
  const scope = resolveWorksiteScope(session)
  const scopedWorksites = await listScopedWorksites(scope.mode === "all" ? "all" : scope.mode === "some" ? scope.ids : [])
  const worksiteIds = scopedWorksites.map((w) => w.id)

  // Fetch quick compliance for each program. Antes se limitaba a los
  // primeros 5 (`slice(0, 5)`) sin avisar — programas 6+ mostraban la
  // card sin % de cumplimiento en silencio. En paralelo en vez de
  // secuencial: mismo costo total, N veces más rápido.
  const complianceEntries = await Promise.all(programs.map(async (program) => {
    try {
      return [program.id, await getPdtpComplianceIndicatorsForScope(program.id, worksiteIds)] as const
    } catch {
      return [program.id, null] as const
    }
  }))
  const complianceByProgram = new Map(complianceEntries)

  return (
    <PageContainer>
      <PageHeader
        title="Programa de Trabajo Preventivo SG-SST"
        description={`Programa anual ${year}: adapta y ejecuta el trabajo por faena.`}
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Prevención", href: "/prevencion" },
            { label: "Programa preventivo SG-SST" },
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
            const statusLabel = program.status === "active" ? "Activo" : program.status === "closed" ? "Cerrado" : "Borrador"
            const statusClass = program.status === "active"
              ? "bg-[var(--color-success-tint)] text-[var(--color-success)]"
              : program.status === "closed"
                ? "bg-[var(--color-text-muted)]/10 text-[var(--color-text-muted)]"
                : "bg-[var(--color-warning-tint)] text-[var(--color-warning)]"

            return (
              <Link
                key={program.id}
                href={buildPdtpProgramHref(program.id, query)}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 transition-shadow hover:shadow-md"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold text-[var(--color-text)]">{program.title}</p>
                    <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                      Año {program.year} · v{program.version}
                    </p>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClass}`}>
                    {statusLabel}
                  </span>
                </div>
                <div className="mt-3 flex items-center gap-4 text-xs text-[var(--color-text-subtle)]">
                  {indicators?.annual && (
                    <span title={`Ejecutado / planificado agregado sobre ${indicators.worksiteCount} faena(s) autorizada(s)`}>
                      Cumplimiento ({indicators.worksiteCount} faena{indicators.worksiteCount === 1 ? "" : "s"}): {indicators.annual.percent !== null ? `${Math.round(indicators.annual.percent * 100)}%` : "—"}
                    </span>
                  )}
                  <span>Elaborado por: {program.elaboratedByName}</span>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </PageContainer>
  )
}
