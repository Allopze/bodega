"use client"

import * as React from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { Play } from "@phosphor-icons/react"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { useOperation } from "@/lib/hooks/use-operation"
import type { MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"
import { canExecuteProgramAction, type WorkspaceMode } from "@/lib/prevention/miper/workspace-mode"
import { hrefToEntry, hrefToTab } from "@/lib/prevention/miper/workspace-url"
import type { ProgramActionDetail, ProgramActionView, ProgramOccurrenceView, ProgramRecordView } from "@/lib/services/miper/program-queries"
import { formatDate, todayInChile } from "@/lib/utils"
import { voidOccurrenceRecordAction } from "../actions"
import { EvidenceSheet } from "./evidence-sheet"
import { LinkMeasuresDialog } from "./link-measures-dialog"
import { OccurrenceDialog } from "./occurrence-dialog"
import { occurrenceBadge, recordBadge } from "./program-badges"
import { ActionProgress } from "./program-action-card"
import { SCHEDULE_KIND_LABEL } from "./program-action-dialog"
import { loadProgramActionDetailAction } from "./program-actions"
import { WorkspaceLink } from "./workspace-nav"

/** El detalle se guarda junto con la actividad que lo pidió: una respuesta ajena se descarta. */
type LoadedDetail = { actionId: string; data: ProgramActionDetail }

const recordDateLabel = (record: ProgramRecordView) => formatDate(record.effectiveOn ?? record.recordedAt)

/**
 * Detalle de una actividad del programa (`?actividad=`): ficha, medidas del
 * MIPER que ejecuta, y por ocurrencia su resultado, registros y evidencia.
 *
 * Lee todo con **una** llamada (`loadProgramActionDetailAction`) al montar y otra
 * tras cada escritura exitosa. Cada ocurrencia abre un solo diálogo (registrar o
 * evidencia) sobre esta vista; ya no hay un `Sheet` apilado.
 */
export function ProgramActivityView({
  matrixId,
  programId,
  action,
  mode,
  userId,
  rows,
}: {
  matrixId: string
  programId: string
  action: ProgramActionView
  mode: WorkspaceMode
  userId: string
  users: Array<{ id: string; name: string }>
  rows: readonly MiperEntrySnapshot[]
  processes: Array<{ id: string; name: string }>
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const headingId = React.useId()
  const today = todayInChile()
  const [loaded, setLoaded] = React.useState<LoadedDetail | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [registerTarget, setRegisterTarget] = React.useState<ProgramOccurrenceView | null>(null)
  const [evidenceOccurrenceId, setEvidenceOccurrenceId] = React.useState<string | null>(null)
  const [voidTarget, setVoidTarget] = React.useState<{ recordId: string; label: string } | null>(null)
  const [linkOpen, setLinkOpen] = React.useState(false)
  const voidOperation = useOperation({ feedback: "toast" })
  const latestActionId = React.useRef(action.id)
  React.useEffect(() => { latestActionId.current = action.id }, [action.id])

  const load = React.useCallback(async () => {
    const requested = action.id
    const result = await loadProgramActionDetailAction({ matrixId, actionId: requested })
    if (latestActionId.current !== requested) return
    if (!result.ok) {
      setError(result.message ?? "No se pudo leer el detalle de la actividad.")
      return
    }
    const data = result.data as unknown as ProgramActionDetail
    // El servidor contestó por otra actividad: no es el detalle de esta vista.
    if (data.actionId !== requested) return
    setError(null)
    setLoaded({ actionId: requested, data })
  }, [matrixId, action.id])

  React.useEffect(() => { void load() }, [load])

  const detail = loaded && loaded.actionId === action.id ? loaded.data : null
  const detailOf = (occurrenceId: string) => detail?.occurrences.find((item) => item.occurrenceId === occurrenceId) ?? null
  const currentRecordOf = (occurrenceId: string) => {
    const found = detailOf(occurrenceId)
    return found?.records.find((record) => record.id === found.currentRecordId) ?? null
  }

  const entryIdByControl = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const row of rows) for (const control of row.controls) map.set(control.id, row.id)
    return map
  }, [rows])

  const canExecute = canExecuteProgramAction(mode, { userId, responsibleUserId: action.responsibleUserId })
  const active = action.status === "active"
  const occurrences = [...action.occurrences].sort((a, b) => a.dueOn.localeCompare(b.dueOn))
  const pendingOccurrences = active ? occurrences.filter((occurrence) => occurrence.outcome === "pending") : []
  const historicalOccurrences = occurrences.filter((occurrence) => !active || occurrence.outcome !== "pending")
  const evidenceOccurrence = evidenceOccurrenceId ? action.occurrences.find((item) => item.id === evidenceOccurrenceId) ?? null : null
  const evidenceRecord = evidenceOccurrence ? currentRecordOf(evidenceOccurrence.id) : null

  const renderOccurrence = (occurrence: ProgramOccurrenceView) => {
    const occurrenceDetail = detailOf(occurrence.id)
    const currentRecord = currentRecordOf(occurrence.id)
    const dueLabel = formatDate(occurrence.dueOn)
    return (
      <li key={occurrence.id} className="space-y-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium">Vence el {dueLabel}</p>
            <p className="text-xs text-[var(--color-text-subtle)]">
              {occurrence.effectiveOn ? `Efectiva el ${formatDate(occurrence.effectiveOn)}` : "Sin fecha efectiva"}
              {occurrence.reason ? ` · ${occurrence.reason}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <MetaBadge meta={occurrenceBadge(occurrence, today)} />
            {canExecute && active && occurrence.outcome !== "superseded" && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                aria-label={`Registrar la ejecución del ${dueLabel}`}
                onClick={() => setRegisterTarget(occurrence)}
              >
                <Play size={12} className="mr-1" />Registrar
              </Button>
            )}
            {currentRecord && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={`Ver la evidencia de la ejecución del ${dueLabel}`}
                onClick={() => setEvidenceOccurrenceId(occurrence.id)}
              >
                Evidencia
              </Button>
            )}
          </div>
        </div>

        {detail === null ? (
          error ? null : <Skeleton className="h-10 w-full" />
        ) : !occurrenceDetail || occurrenceDetail.records.length === 0 ? (
          <p className="text-xs text-[var(--color-text-subtle)]">Sin registros todavía.</p>
        ) : (
          <ol className="space-y-2 border-t border-[var(--color-border)] pt-2">
            {occurrenceDetail.records.map((record) => (
              <li key={record.id} className="space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs">
                    <MetaBadge meta={recordBadge(record)} />
                    <span className="ml-2 text-[var(--color-text-subtle)]">
                      {recordDateLabel(record)}
                      {record.late && !record.voidedAt ? " · fuera de plazo" : ""}
                      {record.recordedByName ? ` · ${record.recordedByName}` : ""}
                    </span>
                  </p>
                  {canExecute && !record.voidedAt && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label={`Anular el registro del ${recordDateLabel(record)}`}
                      onClick={() => setVoidTarget({ recordId: record.id, label: recordDateLabel(record) })}
                    >
                      Anular
                    </Button>
                  )}
                </div>
                {record.reason && <p className="text-xs text-[var(--color-text-subtle)]">Motivo: {record.reason}</p>}
                {record.notes && <p className="text-xs text-[var(--color-text-subtle)]">{record.notes}</p>}
                {record.voidedAt && (
                  <p className="text-xs text-[var(--color-warning-ink)]">
                    Motivo de la anulación: {record.voidReason}{record.voidedByName ? ` · ${record.voidedByName}` : ""}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </li>
    )
  }

  return (
    <section aria-labelledby={headingId} className="space-y-5">
      <div className="space-y-2">
        <WorkspaceLink href={hrefToTab(pathname, searchParams, "programa")} restoreScroll className="text-sm font-medium text-[var(--color-primary)] hover:underline">
          <span aria-hidden>‹</span> Volver al programa
        </WorkspaceLink>
        <h2 id={headingId} className="text-h2">{action.description}</h2>
        <p className="text-sm text-[var(--color-text-muted)]">Actividad N° {action.actionNumber}</p>
      </div>

      <section className="space-y-2" aria-labelledby={`${headingId}-executions`}>
        <h3 id={`${headingId}-executions`} className="text-sm font-semibold">Ejecuciones programadas</h3>
        <p className="text-sm text-[var(--color-text-muted)]">Las vencidas aparecen primero. Registra si la actividad se hizo y agrega la evidencia de esa ejecución.</p>
        {error && (
          <Callout tone="danger" role="alert" title="No se pudo leer el detalle de la actividad">
            <p>{error}</p>
            <Button type="button" size="sm" variant="secondary" className="mt-2" onClick={() => void load()}>Reintentar</Button>
          </Callout>
        )}
        {occurrences.length === 0 ? (
          <p className="text-sm text-[var(--color-text-subtle)]">
            Las ejecuciones se generan al aprobar la versión de la matriz.
          </p>
        ) : pendingOccurrences.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">No hay ejecuciones pendientes en esta actividad.</p>
        ) : (
          <ul className="space-y-2">
            {pendingOccurrences.map(renderOccurrence)}
          </ul>
        )}
      </section>

      {historicalOccurrences.length > 0 && (
        <details className="rounded-xl border border-[var(--color-border)] p-3">
          <summary className="cursor-pointer text-sm font-medium">Historial de ejecuciones ({historicalOccurrences.length})</summary>
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">Resultados registrados y ejecuciones de períodos reemplazados. Los registros anulados también se conservan.</p>
          <ul className="mt-3 space-y-2">{historicalOccurrences.map(renderOccurrence)}</ul>
        </details>
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Ficha</h3>
        <dl className="grid gap-2 sm:grid-cols-2">
          <Fact label="Proceso" value={action.processName} />
          <Fact label="Responsable" value={action.responsibleName} />
          <Fact label="Centro de trabajo" value={action.locationLabel} />
          <Fact label="Frecuencia" value={SCHEDULE_KIND_LABEL[action.scheduleKind]} />
          <Fact label="Inicio" value={formatDate(action.startsOn)} />
          {!active && <Fact label="Estado" value={`Retirada: ${action.retiredReason ?? ""}`} />}
        </dl>
        {/* El avance viene de las props: cada registro revalida la página y llega nuevo. */}
        <ActionProgress progress={action.progress} />
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Medidas de la MIPER que ejecuta</h3>
          {mode.canEdit && active && (
            <Button type="button" size="sm" variant="secondary" onClick={() => setLinkOpen(true)}>Vincular medidas</Button>
          )}
        </div>
        {action.controls.length === 0 ? (
          <p className="text-sm text-[var(--color-text-subtle)]">Esta actividad no está vinculada a ninguna medida de la MIPER.</p>
        ) : (
          <ul className="space-y-1">
            {action.controls.map((control) => {
              const entryId = entryIdByControl.get(control.id)
              return (
                <li key={control.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2">
                  <span className="text-sm">
                    <span className="font-mono text-xs tabular-nums">Riesgo #{control.rowNumber}</span> · {control.description}
                  </span>
                  {entryId && (
                    <WorkspaceLink
                      href={hrefToEntry(pathname, searchParams, entryId)}
                      aria-label={`Ver el riesgo ${control.rowNumber} en la MIPER`}
                      className="text-sm font-medium text-[var(--color-primary)] hover:underline"
                    >
                      Ver en la MIPER
                    </WorkspaceLink>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {registerTarget && (
        <OccurrenceDialog
          open
          matrixId={matrixId}
          onOpenChange={(value) => { if (!value) setRegisterTarget(null) }}
          occurrence={{ id: registerTarget.id, dueOn: registerTarget.dueOn }}
          alreadyRecorded={registerTarget.outcome !== "pending"}
          onRecorded={() => { setRegisterTarget(null); void load() }}
        />
      )}

      {evidenceOccurrence && (
        <EvidenceSheet
          open
          matrixId={matrixId}
          onOpenChange={(value) => { if (!value) setEvidenceOccurrenceId(null) }}
          record={evidenceRecord ? {
            id: evidenceRecord.id,
            outcome: evidenceRecord.outcome,
            effectiveOn: evidenceRecord.effectiveOn,
            voidedAt: evidenceRecord.voidedAt,
            evidence: evidenceRecord.evidence,
          } : null}
          occurrenceLabel={`Ejecución del ${formatDate(evidenceOccurrence.dueOn)}`}
          canExecute={canExecute}
          onChanged={() => void load()}
        />
      )}

      <ConfirmDialog
        open={voidTarget !== null}
        onOpenChange={(value) => { if (!value) setVoidTarget(null) }}
        title="Anular el registro de la ejecución"
        description={voidTarget ? `El registro del ${voidTarget.label} deja de estar vigente y la ejecución vuelve al resultado anterior. Nada se borra: queda en el historial.` : ""}
        confirmLabel="Anular registro"
        variant="warning"
        loading={voidOperation.pending}
        reasonLabel="Motivo de la anulación"
        reasonPlaceholder="Por qué se anula el registro (al menos 10 caracteres)"
        onConfirm={(reason) => voidOperation.run(
          () => voidOccurrenceRecordAction({ matrixId, recordId: voidTarget!.recordId, reason }),
          () => { setVoidTarget(null); void load() },
        )}
      />

      <LinkMeasuresDialog
        matrixId={matrixId}
        programId={programId}
        action={action}
        rows={rows}
        open={linkOpen}
        onOpenChange={setLinkOpen}
        onSaved={() => void load()}
      />
    </section>
  )
}

function Fact({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-sm font-semibold">{label}</dt>
      <dd className="text-sm">{value ?? <span className="text-[var(--color-text-subtle)]">Sin dato</span>}</dd>
    </div>
  )
}
