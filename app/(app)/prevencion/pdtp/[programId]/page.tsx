import type { Metadata } from "next"
import Link from "next/link"
import { redirect, notFound } from "next/navigation"
import { and, desc, eq, inArray } from "drizzle-orm"
import { requireAuth, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import {
  getPdtpSheetViewByProgram,
  getPdtpProgram,
  getPdtpComplianceIndicators,
} from "@/lib/services/prevention-pdtp"
import type { PdtpSheetCode } from "@/lib/services/prevention-pdtp-catalog"
import { listScopedWorksites } from "@/lib/services/ppa"
import { currentPdtpPeriod } from "@/lib/services/pdtp/period"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { PdtpYearPicker } from "../pdtp-year-picker"
import { Button } from "@/components/ui/button"
import { PreventionExportButton } from "@/components/prevention/export-button"
import { PdtpSheetTable } from "../pdtp-sheet-table"
import { PdtpSheetPicker, PdtpViewToggle, PdtpWorksitePicker } from "../pdtp-sheet-table-ui"
import { PdtpIndicatorsPanel } from "../pdtp-indicators-panel"
import { PdtpAddActivityForm } from "../pdtp-add-activity-form"
import { approvePdtpProgramJdprAction, signPdtpProgramLegalAction, activatePdtpProgramAction } from "../actions"
import { db } from "@/db"
import { pdtpExecutions, pdtpChangeLog } from "@/db/schema"

export const metadata: Metadata = { title: "Programa de Trabajo Preventivo SG-SST" }

const SHEET_OPTIONS: Array<{ code: PdtpSheetCode; label: string }> = [
  { code: "pdtp_general", label: "Programa preventivo general" },
  { code: "cphs", label: "Comité Paritario de Higiene y Seguridad" },
  { code: "prf_adm_contrato", label: "Prevencionista de faena y administración de contrato" },
  { code: "sup_jt", label: "Supervisión y jefatura de terreno" },
  { code: "prf", label: "Prevencionista de riesgos en faena" },
  { code: "adm_contrato", label: "Administración de contrato" },
  { code: "subgerente", label: "Subgerencia" },
  { code: "capacitacion", label: "Capacitación" },
]

type PdtpPageProps = {
  params: Promise<{ programId: string }>
  searchParams: Promise<{ hoja?: string | string[]; faena?: string | string[]; vista?: string | string[]; anio?: string | string[]; actividadError?: string | string[]; overrideError?: string | string[] }>
}

export default async function PdtpDetailPage({ params, searchParams }: PdtpPageProps) {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:pdtp:view")) redirect("/forbidden")

  const { programId } = await params
  const program = await getPdtpProgram(programId)
  if (!program) notFound()

  const query = await searchParams
  const requestedSheet = Array.isArray(query.hoja) ? query.hoja[0] : query.hoja
  const requestedWorksite = Array.isArray(query.faena) ? query.faena[0] : query.faena
  const requestedView = Array.isArray(query.vista) ? query.vista[0] : query.vista
  const requestedYearRaw = Array.isArray(query.anio) ? query.anio[0] : query.anio
  const parsedYear = requestedYearRaw ? Number.parseInt(requestedYearRaw, 10) : NaN
  const currentYear = new Date().getFullYear()
  const minYear = 2024
  const maxYear = currentYear + 2
  const selectedYear =
    Number.isFinite(parsedYear) && parsedYear >= minYear && parsedYear <= maxYear
      ? parsedYear
      : program.year
  const actividadError = Array.isArray(query.actividadError) ? query.actividadError[0] : query.actividadError
  const overrideError = Array.isArray(query.overrideError) ? query.overrideError[0] : query.overrideError
  const viewMode: "semana" | "anual" = requestedView === "anual" ? "anual" : "semana"
  const currentPeriod = currentPdtpPeriod()
  const sheetCode = normalizeSheetCode(requestedSheet) ?? defaultSheetForRoles(session.user.roles)
  const scope = resolveWorksiteScope(session)
  const worksiteIds: string[] | "all" =
    scope.mode === "all" ? "all" : scope.mode === "some" ? scope.ids : []
  const worksites = await listScopedWorksites(worksiteIds)
  const selectedWorksiteId = worksites.some((worksite) => worksite.id === requestedWorksite)
    ? requestedWorksite
    : worksites[0]?.id
  const view = await getPdtpSheetViewByProgram(programId, sheetCode, selectedWorksiteId)
  const indicators = await getPdtpComplianceIndicators(programId, selectedWorksiteId)

  const canApprove = can(session, "prevention:pdtp:approve")

  let pendingApprovals: Array<{ id: string; activityId: string; month: number; week: number }> = []
  if (canApprove && selectedWorksiteId && view && view.activities.length > 0) {
    const activityIds = view.activities.map((a) => a.id)
    pendingApprovals = await db
      .select({ id: pdtpExecutions.id, activityId: pdtpExecutions.activityId, month: pdtpExecutions.month, week: pdtpExecutions.week })
      .from(pdtpExecutions)
      .where(and(
        eq(pdtpExecutions.worksiteId, selectedWorksiteId),
        eq(pdtpExecutions.status, "submitted"),
        eq(pdtpExecutions.year, program.year),
        inArray(pdtpExecutions.activityId, activityIds),
      ))
  }

  const canSignLegal = can(session, "prevention:pdtp:sign_legal")
  const canManage = can(session, "prevention:pdtp:manage")
  const exportHref = `/api/prevencion/pdtp/export?programId=${programId}&hoja=${sheetCode}${selectedWorksiteId ? `&faena=${selectedWorksiteId}` : ""}&year=${program.year}`

  return (
    <PageContainer>
      <PageHeader
        title={program.title}
        description={`Programa de Trabajo Preventivo ${program.year} · v${program.version}`}
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Prevención", href: "/prevencion" },
            { label: "Programas PDTP", href: "/prevencion/pdtp" },
            { label: program.title },
          ]} />
        }
        actions={
          <>
            <PdtpYearPicker
              current={selectedYear}
              options={Array.from({ length: maxYear - minYear + 1 }, (_, i) => minYear + i)}
            />
            {canApprove && (
              <Button asChild variant="secondary" size="sm">
                <Link href={`/prevencion/pdtp/aprobaciones?programId=${programId}`}>Aprobaciones</Link>
              </Button>
            )}
            {canManage && program.status === "draft" && (
              <Button asChild variant="secondary" size="sm">
                <Link href={`/prevencion/pdtp/${programId}/editar`}>Editar programa</Link>
              </Button>
            )}
            <PreventionExportButton href={exportHref} label="Exportar programa" />
          </>
        }
      />

      <div className="space-y-4">
        {/* Program lifecycle status block */}
        <PdtpProgramStatusBlock
          program={program}
          canApprove={canApprove}
          canSignLegal={canSignLegal}
        />

        {/* Compliance indicators */}
        {indicators && <PdtpIndicatorsPanel data={indicators} />}

        <PdtpSheetPicker current={sheetCode} options={SHEET_OPTIONS} programId={programId} />
        <PdtpWorksitePicker current={selectedWorksiteId} sheetCode={sheetCode} worksites={worksites} programId={programId} />
        <PdtpViewToggle current={viewMode} sheetCode={sheetCode} worksiteId={selectedWorksiteId} programId={programId} />

        {overrideError && (
          <p className="rounded-[var(--radius)] border border-[var(--color-danger-line)] bg-[var(--color-danger-tint)] px-3 py-2 text-sm text-[var(--color-danger)]">
            {overrideError}
          </p>
        )}

        {view ? (
          <PdtpSheetTable
            view={view}
            worksiteId={selectedWorksiteId}
            canManage={canManage}
            canApprove={canApprove}
            pendingApprovals={pendingApprovals}
            viewMode={viewMode}
            currentPeriod={currentPeriod}
            sheetCode={sheetCode}
          />
        ) : (
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-5">
            <p className="font-medium text-[var(--color-text)]">Catálogo PDTP no cargado</p>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Agrega actividades al programa desde el editor para comenzar.
            </p>
          </div>
        )}

        {/* Change log */}
        <PdtpChangeLogSection programId={programId} />

        {/* Activity add form (draft programs only) */}
        {canManage && program.status === "draft" && (
          <PdtpAddActivityForm
            programId={programId}
            hoja={sheetCode}
            faena={selectedWorksiteId ?? ""}
            errorMessage={actividadError}
          />
        )}
      </div>
    </PageContainer>
  )
}

type PdtpProgramStatusBlockProps = {
  program: {
    id: string
    status: string
    elaboratedByName: string
    elaboratedByTitle: string
    approvedByJdprAt: string | null
    approvedByLegalAt: string | null
  }
  canApprove: boolean
  canSignLegal: boolean
}

function PdtpProgramStatusBlock({ program, canApprove, canSignLegal }: PdtpProgramStatusBlockProps) {
  const isActive = program.status === "active"
  const hasJdpr = !!program.approvedByJdprAt
  const hasLegal = !!program.approvedByLegalAt

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm">
      <span className="text-[var(--color-text-subtle)]">Elaborado por:</span>
      <span className="font-medium">{program.elaboratedByName}</span>
      <span className="text-[var(--color-text-faint)]">·</span>

      {hasJdpr ? (
        <span className="text-[var(--color-success)]">✓ Aprobado JDPR</span>
      ) : canApprove && !isActive ? (
        <form action={async () => { "use server"; await approvePdtpProgramJdprAction(program.id) }}>
          <button type="submit" className="rounded border border-[var(--color-border)] px-2 py-1 text-xs hover:bg-[var(--color-surface-2)]">
            Aprobar (JDPR)
          </button>
        </form>
      ) : (
        <span className="text-[var(--color-text-faint)]">Pendiente aprobación JDPR</span>
      )}

      <span className="text-[var(--color-text-faint)]">·</span>

      {hasLegal ? (
        <span className="text-[var(--color-success)]">✓ Firmado Legal</span>
      ) : canSignLegal && !isActive ? (
        <form action={async () => { "use server"; await signPdtpProgramLegalAction(program.id) }}>
          <button type="submit" className="rounded border border-[var(--color-border)] px-2 py-1 text-xs hover:bg-[var(--color-surface-2)]">
            Firmar (Legal)
          </button>
        </form>
      ) : (
        <span className="text-[var(--color-text-faint)]">Pendiente firma Legal</span>
      )}

      <span className="text-[var(--color-text-faint)]">·</span>

      {isActive ? (
        <span className="font-semibold text-[var(--color-success)]">● Activo</span>
      ) : hasJdpr && hasLegal && canApprove ? (
        <form action={async () => { "use server"; await activatePdtpProgramAction(program.id) }}>
          <button type="submit" className="rounded border border-[var(--color-primary)] bg-[var(--color-primary-tint)] px-2 py-1 text-xs font-medium text-[var(--color-text)]">
            Activar programa
          </button>
        </form>
      ) : (
        <span className="text-[var(--color-text-faint)]">Borrador</span>
      )}
    </div>
  )
}

async function PdtpChangeLogSection({ programId }: { programId: string }) {
  const entries = await db
    .select()
    .from(pdtpChangeLog)
    .where(eq(pdtpChangeLog.programId, programId))
    .orderBy(desc(pdtpChangeLog.changedAt))
    .limit(20)

  if (entries.length === 0) return null

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="border-b border-[var(--color-border)] px-4 py-3">
        <h3 className="text-sm font-semibold text-[var(--color-text)]">Control de cambios</h3>
      </div>
      <div className="divide-y divide-[var(--color-border)]">
        {entries.map((entry) => (
          <div key={entry.id} className="flex items-start gap-3 px-4 py-2.5 text-xs">
            <span className="mt-0.5 shrink-0 text-[var(--color-text-faint)]">{entry.changedAt.slice(0, 10)}</span>
            <span className="font-medium text-[var(--color-text-subtle)]">{entry.section}</span>
            <span className="text-[var(--color-text-muted)]">{entry.note}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function normalizeSheetCode(value: string | undefined): PdtpSheetCode | null {
  if (!value) return null
  return SHEET_OPTIONS.some((option) => option.code === value) ? value as PdtpSheetCode : null
}

function defaultSheetForRoles(roles: string[]): PdtpSheetCode {
  if (roles.includes("cphs")) return "cphs"
  if (roles.includes("supervisor_faena") || roles.includes("jefe_terreno")) return "sup_jt"
  if (roles.includes("admin_contrato")) return "prf_adm_contrato"
  if (roles.includes("prevencionista_faena")) return "prf"
  if (roles.includes("jefa_chome")) return "subgerente"
  return "pdtp_general"
}
