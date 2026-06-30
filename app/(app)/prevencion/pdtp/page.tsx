import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { and, desc, eq, inArray } from "drizzle-orm"
import { requireAuth, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import {
  getPdtpSheetView,
  getPdtpComplianceIndicators,
} from "@/lib/services/prevention-pdtp"
import type { PdtpSheetCode } from "@/lib/services/prevention-pdtp-catalog"
import { listScopedWorksites } from "@/lib/services/ppa"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { PreventionExportButton } from "@/components/prevention/export-button"
import { PdtpSheetPicker, PdtpSheetTable, PdtpWorksitePicker } from "./pdtp-sheet-table"
import { PdtpIndicatorsPanel } from "./pdtp-indicators-panel"
import { approvePdtpProgramJdprAction, signPdtpProgramLegalAction, activatePdtpProgramAction } from "./actions"
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
  searchParams: Promise<{ hoja?: string | string[]; faena?: string | string[] }>
}

export default async function PdtpPage({ searchParams }: PdtpPageProps) {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:pdtp:view")) redirect("/forbidden")

  const query = await searchParams
  const requestedSheet = Array.isArray(query.hoja) ? query.hoja[0] : query.hoja
  const requestedWorksite = Array.isArray(query.faena) ? query.faena[0] : query.faena
  const sheetCode = normalizeSheetCode(requestedSheet) ?? defaultSheetForRoles(session.user.roles)
  const scope = resolveWorksiteScope(session)
  const worksiteIds: string[] | "all" =
    scope.mode === "all" ? "all" : scope.mode === "some" ? scope.ids : []
  const worksites = await listScopedWorksites(worksiteIds)
  const selectedWorksiteId = worksites.some((worksite) => worksite.id === requestedWorksite)
    ? requestedWorksite
    : worksites[0]?.id
  const view = await getPdtpSheetView(2026, sheetCode, selectedWorksiteId)
  const indicators = await getPdtpComplianceIndicators(2026, selectedWorksiteId)
  const canApprove = can(session, "prevention:pdtp:approve")

  // Fetch submitted executions pending approval for the selected worksite
  let pendingApprovals: Array<{ id: string; activityId: string; month: number; week: number }> = []
  if (canApprove && selectedWorksiteId && view && view.activities.length > 0) {
    const activityIds = view.activities.map((a) => a.id)
    pendingApprovals = await db
      .select({ id: pdtpExecutions.id, activityId: pdtpExecutions.activityId, month: pdtpExecutions.month, week: pdtpExecutions.week })
      .from(pdtpExecutions)
      .where(and(
        eq(pdtpExecutions.worksiteId, selectedWorksiteId),
        eq(pdtpExecutions.status, "submitted"),
        eq(pdtpExecutions.year, 2026),
        inArray(pdtpExecutions.activityId, activityIds),
      ))
  }
  const canSignLegal = can(session, "prevention:pdtp:sign_legal")
  const canManage = can(session, "prevention:pdtp:manage")
  const exportHref = `/api/prevencion/pdtp/export?hoja=${sheetCode}${selectedWorksiteId ? `&faena=${selectedWorksiteId}` : ""}`

  return (
    <PageContainer>
      <PageHeader
        title="Programa de Trabajo Preventivo SG-SST"
        description="Programa de Trabajo Preventivo 2026 por hoja oficial, responsable y planificación mensual."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Prevención", href: "/prevencion" },
            { label: "Programa preventivo SG-SST" },
          ]} />
        }
        actions={<PreventionExportButton href={exportHref} label="Exportar programa" />}
      />

      <div className="space-y-4">
        {/* Program lifecycle status block */}
        {view?.program && (
          <PdtpProgramStatusBlock
            program={view.program}
            canApprove={canApprove}
            canSignLegal={canSignLegal}
          />
        )}

        {/* Compliance indicators */}
        {indicators && <PdtpIndicatorsPanel data={indicators} />}

        <PdtpSheetPicker current={sheetCode} options={SHEET_OPTIONS} />
        <PdtpWorksitePicker current={selectedWorksiteId} sheetCode={sheetCode} worksites={worksites} />

        {view ? (
          <PdtpSheetTable view={view} worksiteId={selectedWorksiteId} canManage={canManage} canApprove={canApprove} pendingApprovals={pendingApprovals} />
        ) : (
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-5">
            <p className="font-medium text-[var(--color-text)]">Catálogo PDTP no cargado</p>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Ejecuta el seed después de aplicar migraciones para cargar el Programa de Trabajo Preventivo SG-SST 2026.
            </p>
          </div>
        )}

        {/* Change log */}
        {view?.program && <PdtpChangeLogSection programId={view.program.id} />}
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
        <form action={approvePdtpProgramJdprAction.bind(null, program.id)}>
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
        <form action={signPdtpProgramLegalAction.bind(null, program.id)}>
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
        <form action={activatePdtpProgramAction.bind(null, program.id)}>
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
