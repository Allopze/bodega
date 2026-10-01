"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { ClipboardText, Play, Plus } from "@phosphor-icons/react"
import { MetaBadge, type StateMetaInput } from "@/components/states/state-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { DatePicker } from "@/components/ui/date-picker"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Field } from "@/components/ui/field"
import { FilterSearchInput } from "@/components/ui/filter-search-input"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/ui/option-select"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetBody, SheetCloseButton, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useOperation } from "@/lib/hooks/use-operation"
import type { ProgramProgress } from "@/lib/prevention/miper/progress"
import { canExecuteProgramAction, type WorkspaceMode } from "@/lib/prevention/miper/workspace-mode"
import type { ProgramActionView, ProgramHeaderView, ProgramOccurrenceView, ProgramWorkspace } from "@/lib/services/miper/program-queries"
import { formatDate, todayInChile } from "@/lib/utils"
import { loadOccurrenceDetailAction, loadProgramWorkspaceAction, saveProgramHeaderAction, voidOccurrenceRecordAction } from "../actions"
import { EvidenceSheet, type OccurrenceEvidenceView } from "./evidence-sheet"
import { GenerateActionsDialog } from "./generate-actions-dialog"
import { OccurrenceDialog } from "./occurrence-dialog"
import { PROGRAM_SCHEDULE_OPTIONS, ProgramActionDialog, RetireActionDialog, SCHEDULE_KIND_LABEL } from "./program-action-dialog"

/** Lo que devuelve `loadProgramWorkspaceAction`: la lectura del panel en un viaje. */
type ProgramLoadData = {
  workspace: ProgramWorkspace
  processes: Array<{ id: string; name: string }>
  controlEntryIds: Record<string, string>
  actionProcessIds: Record<string, string>
}

type OccurrenceRecordData = {
  occurrenceId: string
  currentRecordId: string | null
  records: Array<{
    id: string
    outcome: string
    effectiveOn: string | null
    late: boolean
    reason: string | null
    notes: string | null
    recordedAt: string
    recordedByName: string | null
    voidedAt: string | null
    voidReason: string | null
    voidedByName: string | null
    evidence: OccurrenceEvidenceView[]
  }>
}

const ESTADO_OPTIONS = [
  { value: "todas", label: "Todas las actividades" },
  { value: "activas", label: "Sólo activas" },
  { value: "retiradas", label: "Sólo retiradas" },
  { value: "vencidas", label: "Con ocurrencias vencidas" },
  { value: "incumplidas", label: "Con ocurrencias incumplidas" },
]

const FRECUENCIA_OPTIONS = [{ value: "todas", label: "Todas las frecuencias" }, ...PROGRAM_SCHEDULE_OPTIONS]

/** Rótulo del resultado vigente de una ocurrencia: el enum nunca se muestra. */
function occurrenceBadge(occurrence: ProgramOccurrenceView, today: string): StateMetaInput {
  if (occurrence.outcome === "done") return occurrence.late
    ? { label: "Fuera de plazo", variant: "warning" }
    : { label: "Realizada", variant: "success" }
  if (occurrence.outcome === "not_done") return { label: "No realizada", variant: "danger" }
  if (occurrence.outcome === "superseded") return { label: "Reemplazada", variant: "outline" }
  return occurrence.dueOn < today ? { label: "Vencida", variant: "danger" } : { label: "Pendiente", variant: "default" }
}

/** Rótulo del registro: vigente, anulado, o el resultado que quedó en historial. */
function recordBadge(record: { outcome: string; voidedAt: string | null }): StateMetaInput {
  if (record.voidedAt) return { label: "Anulado", variant: "outline" }
  return record.outcome === "done" ? { label: "Se hizo", variant: "success" } : { label: "No se hizo", variant: "danger" }
}

const ratioLabel = (progress: ProgramProgress) =>
  progress.ratio === null ? "Sin ocurrencias planificadas" : `${Math.round(progress.ratio * 100)}% realizado`

/**
 * Pestaña «Programa» del espacio de trabajo MIPER: el Programa de Trabajo
 * Preventivo RE-04.1 (§7).
 *
 * El encabezado, las actividades, las ocurrencias y la evidencia se leen con
 * `getProgramWorkspace` en un solo viaje (Server Action), porque el armazón
 * del espacio de trabajo sólo trae el encabezado del programa. El avance no se
 * edita: se muestra el que deriva `programProgress` de las ocurrencias.
 */
export function ProgramPanel({
  matrixId,
  mode,
  userId,
  users,
  onOpenRiskEntry,
}: {
  matrixId: string
  mode: WorkspaceMode
  userId: string
  /** Personas de la faena: responsables y representantes de los formularios. */
  users: Array<{ id: string; name: string }>
  /** Abre la fila del MIPER (la pestaña del programa no navega sola). */
  onOpenRiskEntry: (entryId: string) => void
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [data, setData] = React.useState<ProgramLoadData | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [openActionId, setOpenActionId] = React.useState<string | null>(null)
  const [details, setDetails] = React.useState<Record<string, OccurrenceRecordData>>({})
  const [registerTarget, setRegisterTarget] = React.useState<ProgramOccurrenceView | null>(null)
  const [evidenceTarget, setEvidenceTarget] = React.useState<{ occurrence: ProgramOccurrenceView; recordId: string } | null>(null)
  const [retireTargetId, setRetireTargetId] = React.useState<string | null>(null)
  const [voidTarget, setVoidTarget] = React.useState<{ recordId: string; label: string } | null>(null)
  const [headerOpen, setHeaderOpen] = React.useState(false)
  const today = todayInChile()
  const voidOperation = useOperation({ feedback: "toast" })

  const load = React.useCallback(async () => {
    const result = await loadProgramWorkspaceAction({ matrixId })
    if (!result.ok) {
      setError(result.message ?? "No se pudo leer el Programa de Trabajo.")
      setLoading(false)
      return
    }
    setError(null)
    setData(result.data as unknown as ProgramLoadData)
    setLoading(false)
  }, [matrixId])

  React.useEffect(() => { void load() }, [load])

  const workspace = data?.workspace ?? null
  const program = workspace?.program ?? null
  const actions = React.useMemo(() => workspace?.actions ?? [], [workspace])
  const openAction = actions.find((action) => action.id === openActionId) ?? null

  // Los registros y la evidencia de las ocurrencias de la actividad abierta. La
  // vista del panel trae el resultado vigente; los identificadores —que anular y
  // retirar necesitan— viven en el detalle.
  React.useEffect(() => {
    if (!openAction || openAction.occurrences.length === 0) return
    let cancelled = false
    void (async () => {
      const entries = await Promise.all(openAction.occurrences.map(async (occurrence) => {
        const result = await loadOccurrenceDetailAction({ occurrenceId: occurrence.id })
        return [occurrence.id, result.ok ? (result.data as unknown as OccurrenceRecordData) : null] as const
      }))
      if (cancelled) return
      setDetails((current) => {
        const next = { ...current }
        for (const [occurrenceId, detail] of entries) if (detail) next[occurrenceId] = detail
        return next
      })
    })()
    return () => { cancelled = true }
  }, [openAction])

  const updateParam = React.useCallback((key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (value && value !== "todas") params.set(key, value)
    else params.delete(key)
    router.replace(`?${params.toString()}`, { scroll: false })
  }, [router, searchParams])

  const query = (searchParams.get("q") ?? "").trim().toLowerCase()
  const estado = searchParams.get("estado") ?? "todas"
  const frecuencia = searchParams.get("frecuencia") ?? "todas"
  const filtered = actions.filter((action) => {
    if (estado === "activas" && action.status !== "active") return false
    if (estado === "retiradas" && action.status !== "retired") return false
    if (estado === "vencidas" && action.progress.overdue === 0) return false
    if (estado === "incumplidas" && action.progress.failed === 0) return false
    if (frecuencia !== "todas" && action.scheduleKind !== frecuencia) return false
    if (!query) return true
    return [
      action.description, action.processName, action.responsibleName, action.locationLabel,
      `actividad ${action.actionNumber}`, String(action.actionNumber),
      ...action.controls.map((control) => `fila ${control.rowNumber} ${control.description}`),
    ].filter(Boolean).join(" ").toLowerCase().includes(query)
  })
  const filtersActive = filtered.length !== actions.length
  const anyFilter = Boolean(query) || estado !== "todas" || frecuencia !== "todas"

  if (loading) {
    return <div className="space-y-3"><Skeleton className="h-28 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-72 w-full" /></div>
  }
  if (error) return <Callout tone="danger" role="alert" title="No se pudo abrir el Programa de Trabajo">{error}</Callout>
  if (!workspace) return null

  const retireTarget = actions.find((action) => action.id === retireTargetId) ?? null
  const evidenceRecord = evidenceTarget ? details[evidenceTarget.occurrence.id]?.records.find((record) => record.id === evidenceTarget.recordId) ?? null : null

  return (
    <div className="space-y-4">
      {mode.readOnlyReason && <Callout tone="info" title="Programa de sólo lectura">{mode.readOnlyReason}</Callout>}

      {program ? (
        <ProgramHeader program={program} progress={workspace.progress} canEdit={mode.canEdit} onEdit={() => setHeaderOpen(true)} />
      ) : (
        <EmptyState
          compact
          icon={<ClipboardText size={24} />}
          title="Esta MIPER todavía no tiene Programa de Trabajo"
          description="El Programa de Trabajo toma las medidas del MIPER y las convierte en actividades con responsable y fecha. Se crea al generar las actividades o al agregar la primera."
          action={mode.canEdit ? (
            <GenerateActionsDialog
              matrixId={matrixId}
              users={users}
              actions={actions.filter((action) => action.status === "active")}
              trigger={<Button size="sm">Generar actividades</Button>}
              onApplied={() => void load()}
            />
          ) : undefined}
          secondaryAction={mode.canEdit ? <Button size="sm" variant="secondary" onClick={() => setHeaderOpen(true)}>Completar antecedentes</Button> : undefined}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <FilterSearchInput
            param="q"
            ariaLabel="Buscar actividad del programa"
            placeholder="Buscar actividad, proceso o responsable…"
          />
          <Select value={estado} onValueChange={(value) => updateParam("estado", value)}>
            <SelectTrigger aria-label="Filtrar por estado de la actividad" className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>{ESTADO_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={frecuencia} onValueChange={(value) => updateParam("frecuencia", value)}>
            <SelectTrigger aria-label="Filtrar por frecuencia de la actividad" className="w-52"><SelectValue /></SelectTrigger>
            <SelectContent>{FRECUENCIA_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
          </Select>
          {anyFilter && (
            <Button type="button" variant="ghost" size="sm" onClick={() => {
              const params = new URLSearchParams(searchParams.toString())
              params.delete("q"); params.delete("estado"); params.delete("frecuencia")
              router.replace(`?${params.toString()}`, { scroll: false })
            }}>
              Limpiar filtros
            </Button>
          )}
        </div>
        {mode.canEdit && program && (
          <div className="flex flex-wrap items-center gap-2">
            <GenerateActionsDialog
              matrixId={matrixId}
              users={users}
              actions={actions.filter((action) => action.status === "active")}
              trigger={<Button size="sm" variant="secondary">Generar actividades</Button>}
              onApplied={() => void load()}
            />
            <ProgramActionDialog
              matrixId={matrixId}
              processes={data?.processes ?? []}
              users={users}
              actionProcessIds={data?.actionProcessIds ?? {}}
              defaultLocationLabel={program.worksiteName}
              trigger={<Button size="sm"><Plus size={14} className="mr-1.5" />Nueva actividad</Button>}
              onSaved={() => void load()}
            />
          </div>
        )}
      </div>

      {actions.length === 0 ? null : filtered.length === 0 ? (
        <EmptyState
          compact
          title="No hay actividades en este filtro"
          description={filtersActive ? "Prueba con otro estado, otra frecuencia o sin buscador." : "El programa no tiene actividades con estos criterios."}
          action={<Button size="sm" variant="secondary" onClick={() => {
            const params = new URLSearchParams(searchParams.toString())
            params.delete("q"); params.delete("estado"); params.delete("frecuencia")
            router.replace(`?${params.toString()}`, { scroll: false })
          }}>Ver todas las actividades</Button>}
        />
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-border)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>N°</TableHead>
                <TableHead>Proceso</TableHead>
                <TableHead>Actividad</TableHead>
                <TableHead>Responsable</TableHead>
                <TableHead>Centro de trabajo</TableHead>
                <TableHead>Programada</TableHead>
                <TableHead>Fecha efectiva</TableHead>
                <TableHead>Avance</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((action) => (
                <TableRow key={action.id}>
                  <TableCell className="font-mono text-xs tabular-nums">{action.actionNumber}</TableCell>
                  <TableCell className="text-sm">{action.processName ?? <span className="text-[var(--color-text-subtle)]">Sin proceso</span>}</TableCell>
                  <TableCell>
                    <span className="text-sm font-medium">{action.description}</span>
                    <span className="mt-0.5 block text-xs text-[var(--color-text-subtle)]">
                      {action.controls.length === 0
                        ? "Sin medidas del MIPER vinculadas"
                        : `Filas ${action.controls.map((control) => control.rowNumber).join(", ")} del MIPER`}
                    </span>
                    {action.status === "retired" && (
                      <span className="mt-1 block text-xs text-[var(--color-text-subtle)]">Retirada: {action.retiredReason}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{action.responsibleName ?? <span className="text-[var(--color-text-subtle)]">Sin responsable</span>}</TableCell>
                  <TableCell className="text-sm">{action.locationLabel ?? <span className="text-[var(--color-text-subtle)]">Sin centro</span>}</TableCell>
                  <TableCell className="text-sm">
                    <span className="block">{formatDate(action.startsOn)}</span>
                    <span className="block text-xs text-[var(--color-text-subtle)]">{SCHEDULE_KIND_LABEL[action.scheduleKind]}</span>
                  </TableCell>
                  <TableCell className="text-sm">{lastEffectiveOn(action) ? formatDate(lastEffectiveOn(action)!) : <span className="text-[var(--color-text-subtle)]">Sin registro</span>}</TableCell>
                  <TableCell><ActionProgress progress={action.progress} /></TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-wrap justify-end gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        aria-label={`Abrir el detalle de la actividad N° ${action.actionNumber}`}
                        onClick={() => setOpenActionId(action.id)}
                      >
                        Detalle
                      </Button>
                      {mode.canEdit && action.status === "active" && (
                        <ProgramActionDialog
                          matrixId={matrixId}
                          processes={data?.processes ?? []}
                          users={users}
                          action={action}
                          actionProcessIds={data?.actionProcessIds ?? {}}
                          defaultLocationLabel={program?.worksiteName ?? null}
                          trigger={<Button type="button" size="sm" variant="ghost" aria-label={`Editar la actividad N° ${action.actionNumber}`}>Editar</Button>}
                          onSaved={() => void load()}
                        />
                      )}
                      {mode.canEdit && action.status === "active" && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          aria-label={`Retirar la actividad N° ${action.actionNumber}`}
                          onClick={() => setRetireTargetId(action.id)}
                        >
                          Retirar
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Detalle de la actividad: medidas vinculadas, ocurrencias y su historial. */}
      <Sheet open={openAction !== null} onOpenChange={(value) => { if (!value) setOpenActionId(null) }}>
        <SheetContent className="sm:max-w-2xl">
          {openAction && (
            <>
              <SheetHeader>
                <div>
                  <SheetTitle>Actividad N° {openAction.actionNumber}</SheetTitle>
                  <SheetDescription>
                    {openAction.description} · {SCHEDULE_KIND_LABEL[openAction.scheduleKind]} · programada {formatDate(openAction.startsOn)}
                  </SheetDescription>
                </div>
                <SheetCloseButton />
              </SheetHeader>
              <SheetBody className="space-y-5">
                <section className="space-y-2">
                  <h3 className="text-eyebrow">Ficha</h3>
                  <dl className="grid gap-2 sm:grid-cols-2">
                    <Detail label="Responsable" value={openAction.responsibleName} />
                    <Detail label="Centro de trabajo" value={openAction.locationLabel} />
                    <Detail label="Proceso" value={openAction.processName} />
                    <Detail label="Estado" value={openAction.status === "active" ? "Activa" : `Retirada: ${openAction.retiredReason ?? ""}`} />
                  </dl>
                  <ActionProgress progress={openAction.progress} />
                </section>

                <section className="space-y-2">
                  <h3 className="text-eyebrow">Medidas del MIPER que ejecuta</h3>
                  {openAction.controls.length === 0 ? (
                    <p className="text-sm text-[var(--color-text-subtle)]">Esta actividad no está vinculada a ninguna medida del MIPER.</p>
                  ) : (
                    <ul className="space-y-1">
                      {openAction.controls.map((control) => {
                        const entryId = data?.controlEntryIds[control.id]
                        return (
                          <li key={control.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2">
                            <span className="text-sm">
                              <span className="font-mono text-xs tabular-nums">Fila {control.rowNumber}</span> · {control.description}
                            </span>
                            {entryId && (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                aria-label={`Ver la fila ${control.rowNumber} en la MIPER`}
                                onClick={() => onOpenRiskEntry(entryId)}
                              >
                                Ver en la MIPER
                              </Button>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </section>

                <section className="space-y-2">
                  <h3 className="text-eyebrow">Ocurrencias</h3>
                  {openAction.occurrences.length === 0 ? (
                    <p className="text-sm text-[var(--color-text-subtle)]">
                      Sin ocurrencias: se generan al sellar la versión sellada del MIPER.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {openAction.occurrences.map((occurrence) => {
                        const badge = occurrenceBadge(occurrence, today)
                        const detail = details[occurrence.id]
                        const canExecute = canExecuteProgramAction(mode, { userId, responsibleUserId: openAction.responsibleUserId })
                        const currentRecord = detail?.records.find((record) => record.id === detail.currentRecordId) ?? null
                        return (
                          <li key={occurrence.id} className="space-y-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <p className="text-sm font-medium">Vence el {formatDate(occurrence.dueOn)}</p>
                                <p className="text-xs text-[var(--color-text-subtle)]">
                                  {occurrence.effectiveOn ? `Efectiva el ${formatDate(occurrence.effectiveOn)}` : "Sin fecha efectiva"}
                                  {occurrence.reason ? ` · ${occurrence.reason}` : ""}
                                  {` · ${occurrence.evidenceCount} evidencia(s)`}
                                </p>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <MetaBadge meta={badge} />
                                {canExecute && openAction.status === "active" && occurrence.outcome !== "superseded" && (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="secondary"
                                    aria-label={`Registrar la ocurrencia del ${formatDate(occurrence.dueOn)}`}
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
                                    aria-label={`Ver la evidencia de la ocurrencia del ${formatDate(occurrence.dueOn)}`}
                                    onClick={() => setEvidenceTarget({ occurrence, recordId: currentRecord.id })}
                                  >
                                    Evidencia
                                  </Button>
                                )}
                              </div>
                            </div>

                            {detail === undefined ? (
                              <p className="text-xs text-[var(--color-text-subtle)]">Cargando registros…</p>
                            ) : detail.records.length === 0 ? (
                              <p className="text-xs text-[var(--color-text-subtle)]">Sin registros todavía.</p>
                            ) : (
                              <ol className="space-y-2 border-t border-[var(--color-border)] pt-2">
                                {detail.records.map((record) => (
                                  <li key={record.id} className="space-y-1">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <p className="text-xs">
                                        <MetaBadge meta={recordBadge(record)} />
                                        <span className="ml-2 text-[var(--color-text-subtle)]">
                                          {record.effectiveOn ? `Efectiva ${formatDate(record.effectiveOn)}` : formatDate(record.recordedAt)}
                                          {record.late && !record.voidedAt ? " · fuera de plazo" : ""}
                                          {record.recordedByName ? ` · ${record.recordedByName}` : ""}
                                        </span>
                                      </p>
                                      {canExecute && !record.voidedAt && (
                                        <Button
                                          type="button"
                                          size="sm"
                                          variant="ghost"
                                          aria-label={`Anular el registro del ${record.effectiveOn ? formatDate(record.effectiveOn) : formatDate(record.recordedAt)}`}
                                          onClick={() => setVoidTarget({
                                            recordId: record.id,
                                            label: record.effectiveOn ? formatDate(record.effectiveOn) : formatDate(record.recordedAt),
                                          })}
                                        >
                                          Anular
                                        </Button>
                                      )}
                                    </div>
                                    {record.reason && <p className="text-xs text-[var(--color-text-subtle)]">Motivo: {record.reason}</p>}
                                    {record.notes && <p className="text-xs text-[var(--color-text-subtle)]">{record.notes}</p>}
                                    {record.voidedAt && <p className="text-xs text-[var(--color-warning-ink)]">Anulado: {record.voidReason}{record.voidedByName ? ` · ${record.voidedByName}` : ""}</p>}
                                    {record.evidence.length > 0 && (
                                      <ul className="text-xs text-[var(--color-text-subtle)]">
                                        {record.evidence.map((item) => (
                                          /* El nombre que subió la persona vive en la
                                           * descripción; `fileName` es el del almacenamiento,
                                           * así que va como dato secundario (H2-02). */
                                          <li key={item.id} title={item.fileName}>
                                            {item.description?.trim() || item.fileName}{item.withdrawnAt ? " (retirada)" : ""}
                                          </li>
                                        ))}
                                      </ul>
                                    )}
                                  </li>
                                ))}
                              </ol>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </section>
              </SheetBody>
            </>
          )}
        </SheetContent>
      </Sheet>

      {openAction && registerTarget && (
        <OccurrenceDialog
          open
          onOpenChange={(value) => { if (!value) setRegisterTarget(null) }}
          occurrence={{ id: registerTarget.id, dueOn: registerTarget.dueOn }}
          alreadyRecorded={registerTarget.outcome !== "pending"}
          onRecorded={() => { setRegisterTarget(null); void load() }}
        />
      )}

      {openAction && evidenceTarget && (
        <EvidenceSheet
          open
          onOpenChange={(value) => { if (!value) setEvidenceTarget(null) }}
          record={evidenceRecord ? {
            id: evidenceRecord.id,
            outcome: evidenceRecord.outcome,
            effectiveOn: evidenceRecord.effectiveOn,
            voidedAt: evidenceRecord.voidedAt,
            evidence: evidenceRecord.evidence,
          } : null}
          occurrenceLabel={`Ocurrencia del ${formatDate(evidenceTarget.occurrence.dueOn)}`}
          canExecute={canExecuteProgramAction(mode, { userId, responsibleUserId: openAction.responsibleUserId })}
          onChanged={() => void load()}
        />
      )}

      <ConfirmDialog
        open={voidTarget !== null}
        onOpenChange={(value) => { if (!value) setVoidTarget(null) }}
        title="Anular el registro de la ocurrencia"
        description={voidTarget ? `El registro del ${voidTarget.label} deja de estar vigente y la ocurrencia vuelve al resultado anterior. Nada se borra: queda en el historial.` : ""}
        confirmLabel="Anular registro"
        variant="warning"
        loading={voidOperation.pending}
        reasonLabel="Motivo de la anulación"
        reasonPlaceholder="Por qué se anula el registro (al menos 10 caracteres)"
        onConfirm={(reason) => voidOperation.run(
          () => voidOccurrenceRecordAction({ recordId: voidTarget!.recordId, reason }),
          () => { setVoidTarget(null); void load() },
        )}
      />

      {retireTarget && (
        <RetireActionDialog
          action={retireTarget}
          open
          onOpenChange={(value) => { if (!value) setRetireTargetId(null) }}
          onRetired={() => { setRetireTargetId(null); void load() }}
        />
      )}

      {program && (
        <ProgramHeaderDialog
          open={headerOpen}
          onOpenChange={setHeaderOpen}
          matrixId={matrixId}
          program={program}
          users={users}
          onSaved={() => void load()}
        />
      )}
    </div>
  )
}

function lastEffectiveOn(action: ProgramActionView): string | null {
  for (let index = action.occurrences.length - 1; index >= 0; index--) {
    const occurrence = action.occurrences[index]!
    if (occurrence.effectiveOn) return occurrence.effectiveOn
  }
  return null
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-eyebrow">{label}</dt>
      <dd className="text-sm">{value ?? <span className="text-[var(--color-text-subtle)]">Sin dato</span>}</dd>
    </div>
  )
}

/** Avance derivado: realizadas, pendientes, incumplidas, vencidas y el cociente. Nada editable. */
function ActionProgress({ progress }: { progress: ProgramProgress }) {
  return (
    <div className="min-w-40 space-y-1">
      <Progress
        value={progress.done}
        max={progress.planned === 0 ? 1 : progress.planned}
        size="sm"
        label={`Avance: ${progress.done} de ${progress.planned} ocurrencias realizadas`}
      />
      <p className="text-xs tabular-nums">
        {progress.done}/{progress.planned} · {ratioLabel(progress)}
      </p>
      <p className="text-xs text-[var(--color-text-subtle)]">
        {progress.pending} pendiente(s) · {progress.failed} incumplida(s) · {progress.overdue} vencida(s)
      </p>
    </div>
  )
}

/** Encabezado RE-04.1 (§7.1), con los dos campos que se calculan y no se guardan. */
function ProgramHeader({ program, progress, canEdit, onEdit }: {
  program: ProgramHeaderView
  progress: ProgramProgress
  canEdit: boolean
  onEdit: () => void
}) {
  const headcount = [program.headcountMale, program.headcountFemale, program.headcountOther]
    .filter((value) => value !== null).join(" / ") || "Sin dotación declarada"
  return (
    <section className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-h3">Programa de Trabajo Preventivo RE-04.1</h2>
          <p className="text-sm text-[var(--color-text-subtle)]">
            {program.companyName ?? "Empresa sin nombre"} · {program.worksiteName ?? "Centro sin nombre"} · período {program.period}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{`${progress.done}/${progress.planned} realizadas`}</Badge>
          {canEdit && <Button type="button" size="sm" variant="secondary" onClick={onEdit}>Editar antecedentes</Button>}
        </div>
      </div>
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Detail label="RUT" value={program.companyRut} />
        <Detail label="Dirección" value={program.companyAddress} />
        <Detail label="Comuna" value={program.companyCommune} />
        <Detail label="Actividad económica" value={program.economicActivity} />
        <Detail label="N° de adherente" value={program.adherentNumber} />
        <Detail label="Fecha de elaboración" value={program.elaboratedOn ? formatDate(program.elaboratedOn) : null} />
        <Detail label="Representante de la empresa" value={program.siteRepresentativeName} />
        <Detail label="Encargado del programa" value={program.programManagerName} />
        <Detail label="N° de centros de trabajo" value={String(program.worksiteCount)} />
        <Detail label="Fecha última revisión" value={program.lastReviewedOn ? formatDate(program.lastReviewedOn) : "Sin versión sellada"} />
        <Detail label="Dotación (H / M / O)" value={headcount} />
        <Detail label="Avance del programa" value={`${progress.done}/${progress.planned} · ${ratioLabel(progress)}`} />
      </dl>
    </section>
  )
}

const numberOrNull = (value: FormDataEntryValue | null) => {
  const trimmed = String(value ?? "").trim()
  return trimmed === "" ? null : Number(trimmed)
}
const textOrNull = (value: FormDataEntryValue | null) => {
  const trimmed = String(value ?? "").trim()
  return trimmed === "" ? null : trimmed
}

/**
 * Edición del encabezado RE-04.1: los antecedentes de empresa y la dotación.
 * «N° de centros de trabajo» y «Fecha última revisión» no se editan —se
 * calculan— y por eso se muestran, no se piden.
 */
function ProgramHeaderDialog({ open, onOpenChange, matrixId, program, users, onSaved }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  matrixId: string
  program: ProgramHeaderView
  users: Array<{ id: string; name: string }>
  onSaved: () => void
}) {
  const [representativeId, setRepresentativeId] = React.useState(program.siteRepresentativeUserId ?? "")
  const [managerId, setManagerId] = React.useState(program.programManagerUserId ?? "")
  const [elaboratedOn, setElaboratedOn] = React.useState(program.elaboratedOn ?? todayInChile())
  const operation = useOperation()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const nameOf = (id: string) => users.find((user) => user.id === id)?.name ?? null
    operation.run(() => saveProgramHeaderAction({
      matrixId,
      expectedVersion: program.version,
      elaboratedOn,
      companyName: textOrNull(form.get("companyName")),
      companyRut: textOrNull(form.get("companyRut")),
      companyAddress: textOrNull(form.get("companyAddress")),
      companyCommune: textOrNull(form.get("companyCommune")),
      economicActivity: textOrNull(form.get("economicActivity")),
      adherentNumber: textOrNull(form.get("adherentNumber")),
      worksiteName: textOrNull(form.get("worksiteName")),
      siteRepresentativeUserId: representativeId || null,
      siteRepresentativeName: representativeId ? nameOf(representativeId) : textOrNull(form.get("siteRepresentativeName")),
      programManagerUserId: managerId || null,
      headcountTotal: numberOrNull(form.get("headcountTotal")),
      headcountMale: numberOrNull(form.get("headcountMale")),
      headcountFemale: numberOrNull(form.get("headcountFemale")),
      headcountOther: numberOrNull(form.get("headcountOther")),
    }), () => { onOpenChange(false); onSaved() })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Antecedentes del Programa de Trabajo</DialogTitle>
            <DialogDescription>
              El encabezado RE-04.1 se sella junto a la versión del MIPER. El N° de centros de trabajo y la fecha de la última revisión se calculan solos.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Empresa"><Input name="companyName" maxLength={300} defaultValue={program.companyName ?? ""} /></Field>
            <Field label="RUT"><Input name="companyRut" maxLength={30} defaultValue={program.companyRut ?? ""} /></Field>
            <Field label="Dirección"><Input name="companyAddress" maxLength={300} defaultValue={program.companyAddress ?? ""} /></Field>
            <Field label="Comuna"><Input name="companyCommune" maxLength={120} defaultValue={program.companyCommune ?? ""} /></Field>
            <Field label="Actividad económica"><Input name="economicActivity" maxLength={300} defaultValue={program.economicActivity ?? ""} /></Field>
            <Field label="N° de adherente"><Input name="adherentNumber" maxLength={60} defaultValue={program.adherentNumber ?? ""} /></Field>
            <Field label="Centro de trabajo"><Input name="worksiteName" maxLength={300} defaultValue={program.worksiteName ?? ""} /></Field>
            <Field label="Fecha de elaboración"><DatePicker value={elaboratedOn} onChange={setElaboratedOn} ariaLabel="Fecha de elaboración del programa" /></Field>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Representante de la empresa" hint="Administrador de contrato de la faena.">
              <OptionSelect
                aria-label="Representante de la empresa en la faena"
                value={representativeId}
                onValueChange={setRepresentativeId}
                emptyLabel="Sin representante"
                placeholder="Sin representante"
                options={users.map((user) => ({ value: user.id, label: user.name }))}
              />
            </Field>
            <Field label="Encargado del programa"><Input name="siteRepresentativeName" maxLength={300} defaultValue={program.siteRepresentativeName ?? ""} placeholder="Nombre del representante, si no es usuario" disabled={representativeId !== ""} /></Field>
            <Field label="Encargado del programa (usuario)">
              <OptionSelect
                aria-label="Encargado del programa"
                value={managerId}
                onValueChange={setManagerId}
                emptyLabel="Sin encargado"
                placeholder="Sin encargado"
                options={users.map((user) => ({ value: user.id, label: user.name }))}
              />
            </Field>
            <Field label="Trabajadores"><Input name="headcountTotal" type="number" min={0} max={100000} defaultValue={program.headcountTotal ?? ""} /></Field>
            <Field label="Hombres"><Input name="headcountMale" type="number" min={0} max={100000} defaultValue={program.headcountMale ?? ""} /></Field>
            <Field label="Mujeres"><Input name="headcountFemale" type="number" min={0} max={100000} defaultValue={program.headcountFemale ?? ""} /></Field>
            <Field label="Otro"><Input name="headcountOther" type="number" min={0} max={100000} defaultValue={program.headcountOther ?? ""} /></Field>
          </div>
          <dl className="grid gap-3 sm:grid-cols-2 rounded-[var(--radius-md)] bg-[var(--color-surface-2)] p-3">
            <Detail label="N° de centros de trabajo" value={String(program.worksiteCount)} />
            <Detail label="Fecha última revisión" value={program.lastReviewedOn ? formatDate(program.lastReviewedOn) : "Sin versión sellada"} />
          </dl>
          {operation.message && <p role="status" className="text-sm text-[var(--color-text-muted)]">{operation.message}</p>}
          <DialogFooter>
            <Button type="submit" disabled={operation.pending}>Guardar antecedentes</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
