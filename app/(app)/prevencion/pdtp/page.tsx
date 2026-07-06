import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { requireAuth, can } from "@/lib/auth/can"
import { listPdtpPrograms, getPdtpComplianceIndicators } from "@/lib/services/prevention-pdtp"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Plus } from "@phosphor-icons/react/dist/ssr"

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
  const canManage = can(session, "prevention:pdtp:manage")
  const programs = await listPdtpPrograms()

  // If coming from old URL with hoja param and there's exactly one 2026 program, redirect
  if (query.hoja && programs.length === 1) {
    const params = new URLSearchParams()
    if (query.hoja) params.set("hoja", String(query.hoja))
    if (query.faena) params.set("faena", String(query.faena))
    if (query.vista) params.set("vista", String(query.vista))
    if (query.anio) params.set("anio", String(query.anio))
    const qs = params.toString()
    redirect(`/prevencion/pdtp/${programs[0]!.id}${qs ? `?${qs}` : ""}`)
  }

  // Fetch quick compliance for each program
  const complianceByProgram = new Map<string, { annual?: { percent: number | null } } | null>()
  for (const program of programs.slice(0, 5)) {
    try {
      const indicators = await getPdtpComplianceIndicators(program.id)
      complianceByProgram.set(program.id, indicators)
    } catch { /* ignore */ }
  }

  return (
    <PageContainer>
      <PageHeader
        title="Programa de Trabajo Preventivo SG-SST"
        description="Crea y gestiona programas de trabajo preventivo por año."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Prevención", href: "/prevencion" },
            { label: "Programa preventivo SG-SST" },
          ]} />
        }
        actions={
          canManage && (
            <Button asChild size="sm">
              <Link href="/prevencion/pdtp/nuevo">
                <Plus size={14} />
                Nuevo programa
              </Link>
            </Button>
          )
        }
      />

      {programs.length === 0 ? (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-8 text-center">
          <p className="font-medium text-[var(--color-text)]">Sin programas PDTP</p>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            No hay programas de trabajo preventivo registrados. Crea el primero para comenzar.
          </p>
          {canManage && (
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
                href={`/prevencion/pdtp/${program.id}`}
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
                    <span>
                      Cumplimiento: {indicators.annual.percent !== null ? `${Math.round(indicators.annual.percent * 100)}%` : "—"}
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
