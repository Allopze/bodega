import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { Info, WarningCircle } from "@phosphor-icons/react/dist/ssr"
import { Callout } from "@/components/ui/callout"
import { ExportButton } from "@/components/ui/export-button"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { can, requirePermission } from "@/lib/auth/can"
import { DIFFERENCE_META } from "@/lib/integrations/talana/talana-differences"
import {
  filterByWorksiteScope,
  getTalanaOverview,
  listTalanaRunItems,
  listTalanaRuns,
  loadTalanaDifferences,
} from "@/lib/integrations/talana/talana-read"
import { exportTalanaXlsxAction } from "./actions"
import { FusibleBanner } from "./fusible-banner"
import { FIX_IN_LABELS, ITEM_KIND_LABELS, itemReasonLabel, runReasonText } from "./talana-labels"
import { TalanaStatusLine } from "./talana-status-line"
import { TalanaView, type ChangeTableRow, type DifferenceTableRow, type RunTableRow } from "./talana-view"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Sincronización Talana" }

const BREADCRUMBS = (
  <Breadcrumbs items={[
    { label: "Inicio", href: "/dashboard" },
    { label: "Administración", href: "/admin" },
    { label: "Sincronización Talana" },
  ]} />
)

const ACTIONS = <ExportButton action={exportTalanaXlsxAction} />

export default async function TalanaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  let session
  try { session = await requirePermission("admin:workers_hr") }
  catch { redirect("/forbidden") }

  const params = await searchParams
  const requestedRun = typeof params.corrida === "string" ? params.corrida : null

  const [overview, runs, { differences }] = await Promise.all([
    getTalanaOverview(),
    listTalanaRuns(30),
    loadTalanaDifferences(),
  ])

  // Una corrida que no está entre las listadas (id inventado, o más vieja que
  // las 30 mostradas) cae en la última: nunca se lee un id arbitrario del URL.
  const selectedRun = runs.find((run) => run.id === requestedRun) ?? runs[0] ?? null
  const items = selectedRun ? filterByWorksiteScope(session, await listTalanaRunItems(selectedRun.id)) : []
  const scopedDifferences = filterByWorksiteScope(session, differences)

  const differenceRows: DifferenceTableRow[] = scopedDifferences.map((difference, index) => ({
    id: `${difference.code}:${difference.workerId ?? difference.rut ?? "sin-rut"}:${index}`,
    personLabel: difference.personLabel,
    rut: difference.rut ?? "",
    codeLabel: DIFFERENCE_META[difference.code].label,
    detail: difference.detail,
    fixIn: difference.fixIn,
    fixInLabel: FIX_IN_LABELS[difference.fixIn],
  }))

  const changeRows: ChangeTableRow[] = items.map((item) => ({
    id: item.id,
    displayName: item.displayName,
    rut: item.rut ?? "",
    worksiteName: item.worksiteName ?? "",
    kind: item.kind,
    kindLabel: ITEM_KIND_LABELS[item.kind],
    beforeLabel: item.beforeLabel ?? "",
    afterLabel: item.afterLabel ?? "",
    outcome: item.outcome,
    reasonLabel: itemReasonLabel(item.reasonCode) ?? "",
  }))

  const runRows: RunTableRow[] = runs.map((run) => {
    const changes = run.traslados + run.cargos + run.jefes + run.sexos
    return {
      id: run.id,
      startedAt: run.startedAt,
      mode: run.mode,
      status: run.status,
      activeContracts: run.activeContracts,
      altas: run.altas + run.reactivaciones,
      bajas: run.bajas,
      changes,
      skipped: run.skipped,
      reason: runReasonText(run) ?? "",
      hasItems: run.altas + run.reactivaciones + run.bajas + changes + run.skipped + run.failed > 0,
    }
  })

  const { config, blockedRun } = overview
  const enabled = config.hasCredentials && config.mode !== "off"

  return (
    <PageContainer>
      <PageHeader
        title="Sincronización Talana"
        description="Contratos y ausencias desde Talana, una vez al día. Solo lectura: nunca escribe en Talana."
        breadcrumb={BREADCRUMBS}
        actions={ACTIONS}
      />

      {!enabled && (
        <Callout
          tone="warning"
          icon={<WarningCircle size={18} weight="bold" />}
          title="La sincronización con Talana no está habilitada"
          className="mb-4"
        >
          {config.hasCredentials
            ? "El servidor tiene el token de Talana, pero el modo de sincronización está apagado."
            : "Falta el token de Talana en el servidor."}
          {" "}Mientras tanto, esta pantalla muestra lo último que se descargó. Pídele a quien administra el servidor que lo configure.
        </Callout>
      )}

      {enabled && config.mode === "simulate" && (
        <Callout
          tone="info"
          icon={<Info size={18} weight="bold" />}
          title="Modo simulación"
          className="mb-4"
        >
          Calcula los cambios pero no los aplica: los trabajadores de Chome no se modifican. Revisa la pestaña «Cambios de la corrida» antes de pasar a aplicar.
        </Callout>
      )}

      {blockedRun && (
        <FusibleBanner runId={blockedRun.id} reason={blockedRun.fusibleReason} startedAt={blockedRun.startedAt} />
      )}

      <TalanaStatusLine overview={overview} differencesCount={differenceRows.length} />

      <TalanaView
        differences={differenceRows}
        changes={changeRows}
        runs={runRows}
        selectedRun={selectedRun
          ? { id: selectedRun.id, startedAt: selectedRun.startedAt, mode: selectedRun.mode, isLatest: selectedRun.id === runs[0]?.id }
          : null}
        hasSyncedData={overview.lastGoodSyncAt !== null}
        canViewWorkers={can(session, "admin:workers")}
      />
    </PageContainer>
  )
}
