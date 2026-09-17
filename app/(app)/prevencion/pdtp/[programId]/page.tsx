import type { Metadata } from "next"
import Link from "next/link"
import { redirect, notFound } from "next/navigation"
import { requireAuth, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import {
  getPdtpSheetViewByProgram,
  getPdtpProgram,
  getPdtpComplianceIndicators,
  getPdtpIntegralCompliance,
  getPdtpApprovalProgress,
  getPdtpSubmitReviewBlockers,
  getPdtpCoverageReport,
  getPdtpDocumentMetadata,
  listPdtpReconciliationCandidates,
  listPdtpProgramSheets,
} from "@/lib/services/prevention-pdtp"
import { currentPdtpPeriod } from "@/lib/services/pdtp/period"
import { listCatalogActivities } from "@/lib/services/pdtp/catalog-activities"
import { getPendingPdtpApprovalsForView, getPdtpChangeLog, listAccessiblePdtpProgramWorksites } from "@/lib/services/pdtp"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Button, buttonVariants } from "@/components/ui/button"
import { MetaBadge } from "@/components/states/state-badge"
import { EmptyState } from "@/components/ui/empty-state"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ChartBar, DotsThree, DownloadSimple, ListChecks, PencilSimple } from "@phosphor-icons/react/dist/ssr"
import { PdtpSheetTable } from "../pdtp-sheet-table"
import { PdtpSheetPicker, PdtpViewToggle, PdtpWorksitePicker } from "../pdtp-sheet-table-ui"
import { PdtpIndicatorsPanel } from "../pdtp-indicators-panel"
import { PdtpImportExcelDialog } from "../pdtp-import-excel-dialog"
import { resolveSelectedWorksiteId } from "../pdtp-context"
import type { PdtpActivityStatusFilter } from "@/lib/services/pdtp/period"
import { CoverageReportPanel } from "./coverage-report-panel"
import { FulfillmentBacklogPanel } from "./fulfillment-backlog-panel"
import { ProgramLifecycleControls } from "./program-lifecycle-controls"
import { ReconcileDeclaredActorButton } from "./reconcile-declared-actor-button"

export const metadata: Metadata = { title: "Programa de Trabajo Preventivo SG-SST" }

type PdtpPageProps = {
  params: Promise<{ programId: string }>
  searchParams: Promise<{ hoja?: string | string[]; faena?: string | string[]; vista?: string | string[]; anio?: string | string[]; estado?: string | string[]; overrideError?: string | string[] }>
}

export default async function PdtpDetailPage({ params, searchParams }: PdtpPageProps) {
  let session
  try { session = await requireAuth() }
  catch { redirect(`/forbidden?desde=${encodeURIComponent("/prevencion/pdtp")}`) }
  if (!can(session, "prevention:pdtp:view")) redirect(`/forbidden?desde=${encodeURIComponent("/prevencion/pdtp")}`)

  const { programId } = await params
  const program = await getPdtpProgram(programId)
  if (!program) notFound()
  const sourceProgram = program.sourceProgramId ? await getPdtpProgram(program.sourceProgramId) : null

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
  const overrideError = Array.isArray(query.overrideError) ? query.overrideError[0] : query.overrideError
  const viewMode: "semana" | "anual" = requestedView === "anual" ? "anual" : "semana"
  // La tabla escribe ?estado= al filtrar (router.replace); sin leerlo acá, un
  // enlace compartido o un remount del árbol volvían el filtro a "Todas".
  // Mismo patrón que actividades/page.tsx.
  const requestedStatus = Array.isArray(query.estado) ? query.estado[0] : query.estado
  const statusFilter: PdtpActivityStatusFilter | "all" = ["executed", "pending", "overdue", "not_scheduled", "not_performed", "en_cero"].includes(requestedStatus ?? "")
    ? requestedStatus as PdtpActivityStatusFilter
    : "all"
  const renderedAt = new Date().toISOString()
  const currentPeriod = currentPdtpPeriod()
  const sheetCode = normalizeSheetCode(requestedSheet, programSheets)
    ?? defaultSheetForRoles(session.user.roles, programSheets)
  const scope = resolveWorksiteScope(session)
  const worksiteIds: string[] | "all" =
    scope.mode === "all" ? "all" : scope.mode === "some" ? scope.ids : []
  const worksites = await listAccessiblePdtpProgramWorksites(programId, worksiteIds)
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
  // Dos lecturas de la compuerta que antes iban en serie. `submitBlockers` son
  // los requisitos de contenido del envío, que se consultan acá para mostrarlos
  // en la tarjeta de estado en vez de dejar que el envío falle.
  //
  // El informe por actividad se muestra SIEMPRE, también con el programa
  // activo. Antes se ocultaba al activar porque la compuerta no dejaba activar
  // nada con cobertura incompleta, así que a esa altura no quedaba nada que
  // mirar. Desde que faltar un curso, una plantilla, un plan o un mapa ya no
  // frena la activación, el caso normal es activar con cobertura incompleta:
  // ocultar la lista justo ahí dejaba al operador sin la única vista que le
  // dice qué actividades no están acreditando y por qué, que es precisamente
  // el trabajo que le queda por delante.
  const [submitBlockers, coverageReport] = await Promise.all([
    program.status === "draft" ? getPdtpSubmitReviewBlockers(programId) : Promise.resolve([] as string[]),
    getPdtpCoverageReport(programId),
  ])

  const canApprove = can(session, "prevention:pdtp:approve")

  const pendingApprovals: Array<{ id: string; activityId: string; month: number; week: number }> =
    canApprove && selectedWorksiteId && view && view.activities.length > 0
      ? await getPendingPdtpApprovalsForView({
          worksiteId: selectedWorksiteId,
          year: program.year,
          activityIds: view.activities.map((a) => a.id),
        })
      : []

  const canSignLegal = can(session, "prevention:pdtp:sign_legal")
  const canSubmitReview = can(session, "prevention:pdtp:submit_review")
  const canActivate = can(session, "prevention:pdtp:activate")
  const canManageLifecycle = can(session, "prevention:pdtp:lifecycle:manage")
  const canExecute = can(session, "prevention:pdtp:execute")
  const canManageProgram = can(session, "prevention:pdtp:program:manage")
  const catalogActivities = canManageProgram && program.status === "draft" ? await listCatalogActivities() : []
  const exportBaseHref = `/api/prevencion/pdtp/export?programId=${programId}&hoja=${sheetCode}${selectedWorksiteId ? `&faena=${selectedWorksiteId}` : ""}&year=${program.year}`
  const exportRe36Href = `${exportBaseHref}&formato=re36`
  const exportPlanoHref = `${exportBaseHref}&formato=plano`

  return (
    <PageContainer>
      <PageHeader
        title={program.title}
        description={`Programa anual de Trabajo Preventivo ${program.year}`}
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Prevención", href: "/prevencion" },
            { label: "Programas PDTP", href: "/prevencion/pdtp" },
            { label: program.title },
          ]} />
        }
        actions={
          <>
            {/* Botón visible de importación: solo en borrador y con permiso de
                gestión. Antes este flujo estaba escondido tras Editar → Revisión
                → "Vistas avanzadas", y el usuario no lo encontraba. */}
            {canManageProgram && program.status === "draft" && (
              <PdtpImportExcelDialog
                programId={programId}
                visibleWorksites={worksites}
                catalogActivities={catalogActivities.map((activity) => ({
                  id: activity.id,
                  code: activity.code,
                  title: activity.title,
                  description: activity.description,
                  status: activity.status as "draft" | "active" | "retired",
                }))}
              />
            )}
            {canApprove && (
              <Button asChild variant="secondary" size="sm">
                <Link href={`/prevencion/pdtp/aprobaciones?programId=${programId}`}>Aprobaciones</Link>
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger
                type="button"
                className={buttonVariants({ variant: "secondary", size: "sm" })}
                aria-label="Más acciones"
              >
                <DotsThree size={16} weight="bold" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <a href={exportRe36Href} download className="flex items-center gap-2">
                    <DownloadSimple size={14} />
                    Exportar RE-36
                  </a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a href={exportPlanoHref} download className="flex items-center gap-2">
                    <DownloadSimple size={14} />
                    Exportar planilla plana
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
                {/* La matriz de aplicabilidad (exclusiones por faena, regla R4) no
                    tenía ningún punto de entrada en la aplicación: no estaba en el
                    sidebar ni enlazada desde ninguna vista, pese a que sus
                    exclusiones sí afectan el cumplimiento calculado. */}
                {canManageProgram && (
                  <DropdownMenuItem asChild>
                    <Link href="/prevencion/pdtp/aplicabilidad" className="flex items-center gap-2">
                      <ListChecks size={14} />
                      Aplicabilidad por faena
                    </Link>
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <div className="space-y-4">
        {sourceProgram && (
          <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-subtle)]">Linaje de revisión</p>
            <p className="mt-1 text-sm text-[var(--color-text)]">
              <Link className="font-medium text-[var(--color-primary-ink)] hover:underline" href={`/prevencion/pdtp/${sourceProgram.id}`}>v{sourceProgram.version}</Link>
              {" → "}v{program.version}. La evidencia y las firmas de v{sourceProgram.version} permanecen en su versión de origen.
            </p>
          </section>
        )}
        {/* Program lifecycle status block, con la metadata del documento importado plegada dentro */}
        <CoverageReportPanel
          report={coverageReport}
          programId={programId}
          programStatus={program.status}
          canManageProgram={canManageProgram}
          canManageRoles={can(session, "admin:roles")}
        />
        <FulfillmentBacklogPanel programId={programId} canManageProgram={canManageProgram} programStatus={program.status} />

        <ProgramLifecycleControls
          program={program}
          permissions={{ canSubmitReview, canApprove, canSignLegal, canActivate, canManageLifecycle }}
          submitBlockers={submitBlockers}
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
        >
          <PdtpDocumentMetadataSection programId={programId} canReconcile={canManageProgram && program.status === "draft"} />
        </ProgramLifecycleControls>

        {/* Compliance indicators */}
        {indicators && <PdtpIndicatorsPanel data={indicators} integral={integral} asOf={renderedAt} worksiteId={selectedWorksiteId} />}

        <div className="flex flex-wrap items-center gap-3 border-y border-[var(--color-border)] py-3">
          <PdtpSheetPicker current={sheetCode} options={sheetOptions} programId={programId} worksiteId={selectedWorksiteId} viewMode={viewMode} />
          {worksites.length > 1 && (
            <PdtpWorksitePicker current={selectedWorksiteId} sheetCode={sheetCode} worksites={worksites} programId={programId} viewMode={viewMode} allHref={`/prevencion/pdtp/actividades?programa=${programId}&anio=${program.year}&hoja=${sheetCode}&vista=${viewMode}`} />
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
              initialStatusFilter={statusFilter}
            />
          </div>
        ) : (
          <EmptyState
            compact
            align="start"
            title="Catálogo PDTP no cargado"
            description="Agrega actividades al programa desde el editor para comenzar."
            action={canManageProgram && program.status === "draft" ? (
              <Button asChild size="sm">
                <Link href={`/prevencion/pdtp/${programId}/editar`}>Ir al editor</Link>
              </Button>
            ) : undefined}
          />
        )}

        {/* Change log */}
        <PdtpChangeLogSection programId={programId} />

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
    <details className="border-t border-[var(--color-border)]">
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
                  {adapterCode && <MetaBadge meta={{ label: adapterCode, variant: "outline" }} />}
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
  const entries = await getPdtpChangeLog(programId)

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
