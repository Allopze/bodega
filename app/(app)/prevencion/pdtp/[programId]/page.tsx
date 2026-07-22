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
  getPdtpIntegralCompliance,
  getPdtpApprovalProgress,
  getPdtpDocumentMetadata,
  listPdtpReconciliationCandidates,
  listPdtpResponsibleCatalog,
  listPdtpProgramSheets,
} from "@/lib/services/prevention-pdtp"
import { listScopedWorksites } from "@/lib/services/ppa"
import { currentPdtpPeriod } from "@/lib/services/pdtp/period"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ChartBar, DotsThree, DownloadSimple, PencilSimple } from "@phosphor-icons/react/dist/ssr"
import { PdtpSheetTable } from "../pdtp-sheet-table"
import { PdtpSheetPicker, PdtpViewToggle, PdtpWorksitePicker } from "../pdtp-sheet-table-ui"
import { PdtpIndicatorsPanel } from "../pdtp-indicators-panel"
import { PdtpAddActivityForm } from "../pdtp-add-activity-form"
import { db } from "@/db"
import { pdtpExecutions, pdtpChangeLog } from "@/db/schema"
import { resolveSelectedWorksiteId } from "../pdtp-context"
import { ProgramLifecycleControls } from "./program-lifecycle-controls"
import { ReconcileDeclaredActorButton } from "./reconcile-declared-actor-button"

export const metadata: Metadata = { title: "Programa de Trabajo Preventivo SG-SST" }

type PdtpPageProps = {
  params: Promise<{ programId: string }>
  searchParams: Promise<{ hoja?: string | string[]; faena?: string | string[]; vista?: string | string[]; anio?: string | string[]; objetivo?: string | string[]; actividadError?: string | string[]; overrideError?: string | string[] }>
}

export default async function PdtpDetailPage({ params, searchParams }: PdtpPageProps) {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:pdtp:view")) redirect("/forbidden")

  const { programId } = await params
  const program = await getPdtpProgram(programId)
  if (!program) notFound()

  // Vistas reales del programa (plantillas globales + copias program-scoped,
  // dedupe por código con la copia program-scoped ganando). No asumen las
  // ocho hojas de la referencia 2026: un programa distinto solo trae las
  // vistas que realmente tiene.
  const programSheetsRaw = await listPdtpProgramSheets(programId)
  const programSheets = [...new Map(
    [...programSheetsRaw].sort((a, b) => (a.programId ? 1 : -1) - (b.programId ? 1 : -1))
      .map((s) => [s.code, s] as const),
  ).values()]
  const sheetOptions = programSheets.map((s) => ({ code: s.code, label: s.label }))

  const query = await searchParams
  const requestedSheet = Array.isArray(query.hoja) ? query.hoja[0] : query.hoja
  const requestedWorksite = Array.isArray(query.faena) ? query.faena[0] : query.faena
  const requestedView = Array.isArray(query.vista) ? query.vista[0] : query.vista
  const requestedObjective = Array.isArray(query.objetivo) ? query.objetivo[0] : query.objetivo
  const actividadError = Array.isArray(query.actividadError) ? query.actividadError[0] : query.actividadError
  const overrideError = Array.isArray(query.overrideError) ? query.overrideError[0] : query.overrideError
  const viewMode: "semana" | "anual" = requestedView === "anual" ? "anual" : "semana"
  const parsedObjective = Number.parseInt(requestedObjective ?? "", 10)
  const objectiveOrder = Number.isFinite(parsedObjective) ? parsedObjective : undefined
  const currentPeriod = currentPdtpPeriod()
  const sheetCode = normalizeSheetCode(requestedSheet, programSheets)
    ?? defaultSheetForRoles(session.user.roles, programSheets)
  const scope = resolveWorksiteScope(session)
  const worksiteIds: string[] | "all" =
    scope.mode === "all" ? "all" : scope.mode === "some" ? scope.ids : []
  const worksites = await listScopedWorksites(worksiteIds)
  const selectedWorksiteId = resolveSelectedWorksiteId(requestedWorksite, worksites)
  const [[view, indicators, integral], approvalProgress] = await Promise.all([
    selectedWorksiteId
      ? Promise.all([
        getPdtpSheetViewByProgram(programId, sheetCode, selectedWorksiteId),
        getPdtpComplianceIndicators(programId, selectedWorksiteId),
        getPdtpIntegralCompliance(programId, selectedWorksiteId),
      ])
      : Promise.resolve([null, null, null] as const),
    getPdtpApprovalProgress(programId),
  ])

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
  const canSubmitReview = can(session, "prevention:pdtp:submit_review")
  const canActivate = can(session, "prevention:pdtp:activate")
  const canManageLifecycle = can(session, "prevention:pdtp:lifecycle:manage")
  const canExecute = can(session, "prevention:pdtp:execute")
  const canManageProgram = can(session, "prevention:pdtp:program:manage")
  const exportHref = `/api/prevencion/pdtp/export?programId=${programId}&hoja=${sheetCode}${selectedWorksiteId ? `&faena=${selectedWorksiteId}` : ""}&year=${program.year}`

  const responsibleCatalog = canManageProgram && program.status === "draft"
    ? await listPdtpResponsibleCatalog()
    : []

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
            {canApprove && (
              <Button asChild variant="secondary" size="sm">
                <Link href={`/prevencion/pdtp/aprobaciones?programId=${programId}`}>Aprobaciones</Link>
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="sm" aria-label="Más acciones">
                  <DotsThree size={16} weight="bold" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <a href={exportHref} download className="flex items-center gap-2">
                    <DownloadSimple size={14} />
                    Exportar programa
                  </a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href={`/prevencion/pdtp/${programId}/reporte${selectedWorksiteId ? `?faena=${selectedWorksiteId}` : ""}`} className="flex items-center gap-2">
                    <ChartBar size={14} />
                    Reporte de gestión
                  </Link>
                </DropdownMenuItem>
                {selectedWorksiteId && (
                  <DropdownMenuItem asChild>
                    <a href={`/api/prevencion/pdtp/expediente-auditor?programId=${programId}&faena=${selectedWorksiteId}`} download className="flex items-center gap-2">
                      <DownloadSimple size={14} />
                      Expediente auditor
                    </a>
                  </DropdownMenuItem>
                )}
                {canManageProgram && program.status === "draft" && (
                  <DropdownMenuItem asChild>
                    <Link href={`/prevencion/pdtp/${programId}/editar`} className="flex items-center gap-2">
                      <PencilSimple size={14} />
                      Editar programa
                    </Link>
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <div className="space-y-4">
        {/* Program lifecycle status block */}
        <ProgramLifecycleControls
          program={program}
          permissions={{ canSubmitReview, canApprove, canSignLegal, canActivate, canManageLifecycle }}
          approvalSteps={approvalProgress.map((step) => ({
            id: step.id,
            code: step.code,
            label: step.label,
            isRequired: step.isRequired,
            canDecide: session.user.permissions.includes(step.requiredPermission),
            decision: step.decision ? {
              decision: step.decision.decision,
              decidedAt: step.decision.decidedAt,
            } : null,
          }))}
        />

        <PdtpDocumentMetadataSection programId={programId} canReconcile={canManageProgram && program.status === "draft"} />

        {/* Compliance indicators */}
        {indicators && <PdtpIndicatorsPanel data={indicators} integral={integral} asOf={new Date().toISOString()} />}

        <div className="flex flex-wrap items-center gap-3 border-y border-[var(--color-border)] py-3">
          <PdtpSheetPicker current={sheetCode} options={sheetOptions} programId={programId} worksiteId={selectedWorksiteId} viewMode={viewMode} />
          {worksites.length > 1 && (
            <PdtpWorksitePicker current={selectedWorksiteId} sheetCode={sheetCode} worksites={worksites} programId={programId} viewMode={viewMode} />
          )}
          <div className="ml-auto">
            <PdtpViewToggle current={viewMode} sheetCode={sheetCode} worksiteId={selectedWorksiteId} programId={programId} />
          </div>
        </div>

        {overrideError && (
          <p className="rounded-[var(--radius)] border border-[var(--color-danger-line)] bg-[var(--color-danger-tint)] px-3 py-2 text-sm text-[var(--color-danger)]">
            {overrideError}
          </p>
        )}

        {!selectedWorksiteId && worksites.length > 1 ? (
          <EmptyState
            compact
            align="start"
            tone="warning"
            title="Selecciona una faena para ver ejecución y cumplimiento"
            description="El programa se calcula por faena, por eso las actividades y métricas no se mezclan entre contratos."
            action={<div className="flex flex-wrap gap-2">{worksites.map((worksite) => <Button key={worksite.id} asChild size="sm"><Link href={`/prevencion/pdtp/${programId}?hoja=${sheetCode}&faena=${worksite.id}&vista=${viewMode}`}>{worksite.name}</Link></Button>)}</div>}
          />
        ) : view ? (
          <div id="registros-pdtp" className="scroll-mt-4">
            <PdtpSheetTable
              view={view}
              worksiteId={selectedWorksiteId}
              canExecute={canExecute}
              canManageProgram={canManageProgram}
              canApprove={canApprove}
              pendingApprovals={pendingApprovals}
              viewMode={viewMode}
              currentPeriod={currentPeriod}
              sheetCode={sheetCode}
              objectiveOrder={objectiveOrder}
              programId={programId}
            />
          </div>
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
        {canManageProgram && program.status === "draft" && (
          <PdtpAddActivityForm
            programId={programId}
            hoja={sheetCode}
            faena={selectedWorksiteId ?? ""}
            errorMessage={actividadError}
            responsibleCatalog={responsibleCatalog.map((r) => ({ slug: r.slug, displayName: r.displayName }))}
            sheetOptions={sheetOptions}
          />
        )}
      </div>
    </PageContainer>
  )
}

const DOCUMENT_ENTRY_LABEL: Record<string, string> = {
  elaboration: "Elaboración declarada",
  review: "Revisión declarada",
  approval: "Aprobación declarada",
  change_control: "Cambio documentado",
}

async function PdtpDocumentMetadataSection({ programId, canReconcile }: { programId: string; canReconcile: boolean }) {
  const [metadata, candidates] = await Promise.all([
    getPdtpDocumentMetadata(programId),
    canReconcile ? listPdtpReconciliationCandidates() : Promise.resolve([]),
  ])
  if (metadata.history.length === 0 && metadata.roleLegend.length === 0) return null

  return (
    <details className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-[var(--color-text)] marker:hidden">
        Historia y referencias del documento importado
        <span className="ml-2 font-normal text-[var(--color-text-muted)]">
          {metadata.history.length} declaración(es) · {metadata.roleLegend.length} código(s) de rol
        </span>
      </summary>
      <div className="border-t border-[var(--color-border)] px-4 py-4">
        <p className="max-w-3xl text-xs text-[var(--color-text-muted)]">
          Estos datos conservan lo declarado por la fuente. No sustituyen las identidades ni las aprobaciones nativas de Chome.
        </p>
        {metadata.history.length > 0 && (
          <div className="mt-3 divide-y divide-[var(--color-border)]">
            {metadata.history.map(({ entry, linkedUserName, adapterCode }) => (
              <div key={entry.id} className="grid gap-1 py-3 text-sm md:grid-cols-[12rem_minmax(0,1fr)_auto] md:gap-4">
                <span className="font-medium text-[var(--color-text)]">{DOCUMENT_ENTRY_LABEL[entry.entryKind] ?? entry.entryKind}</span>
                <div className="min-w-0 text-[var(--color-text-muted)]">
                  <p>{entry.declaredActorName || entry.description || "Sin persona declarada"}</p>
                  {(entry.declaredActorTitle || entry.declaredAtText) && <p className="mt-0.5 text-xs">{[entry.declaredActorTitle, entry.declaredAtText].filter(Boolean).join(" · ")}</p>}
                  {linkedUserName && <p className="mt-1 text-xs text-[var(--color-success)]">Reconciliado con {linkedUserName}</p>}
                </div>
                <div className="flex items-center gap-2">
                  {adapterCode && <Badge variant="outline">{adapterCode}</Badge>}
                  {canReconcile && entry.declaredActorName && (
                    <ReconcileDeclaredActorButton
                      programId={programId}
                      historyEntryId={entry.id}
                      declaredActorName={entry.declaredActorName}
                      linkedUserId={entry.linkedUserId}
                      candidates={candidates}
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {metadata.roleLegend.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2" aria-label="Leyenda de roles declarada">
            {metadata.roleLegend.map(({ entry }) => (
              <span key={entry.id} className="rounded-full border border-[var(--color-border)] px-2.5 py-1 text-xs text-[var(--color-text-muted)]" title={entry.label}>
                <strong className="font-mono text-[var(--color-text)]">{entry.code}</strong> · {entry.label}
              </span>
            ))}
          </div>
        )}
      </div>
    </details>
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

type PdtpProgramSheet = Awaited<ReturnType<typeof listPdtpProgramSheets>>[number]

function normalizeSheetCode(value: string | undefined, sheets: PdtpProgramSheet[]): string | null {
  if (!value) return null
  return sheets.some((sheet) => sheet.code === value) ? value : null
}

/**
 * Vista de aterrizaje por rol: prioriza la vista del programa cuyo
 * `defaultScopeRoles` intersecta los roles del usuario y es más específica
 * (menos roles en su alcance); ante empate o sin coincidencias, cae a
 * `pdtp_general` o a la primera vista disponible. No asume las ocho vistas
 * ni los roles de la referencia 2026: lee lo que este programa realmente
 * tiene configurado.
 */
function defaultSheetForRoles(roles: string[], sheets: PdtpProgramSheet[]): string {
  const match = sheets
    .map((sheet) => ({
      code: sheet.code,
      scopeRoles: Array.isArray(sheet.defaultScopeRoles) ? sheet.defaultScopeRoles as string[] : [],
    }))
    .filter((sheet) => sheet.scopeRoles.some((role) => roles.includes(role)))
    .sort((a, b) => a.scopeRoles.length - b.scopeRoles.length)[0]
  if (match) return match.code
  return sheets.find((sheet) => sheet.code === "pdtp_general")?.code ?? sheets[0]?.code ?? "pdtp_general"
}
