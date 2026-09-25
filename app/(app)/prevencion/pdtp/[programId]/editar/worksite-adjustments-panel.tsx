"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { applyPdtpCphsHeadcountRuleAction, setPdtpActivityWorksiteAdjustmentAction } from "../../actions"
import { useOperation } from "@/lib/hooks/use-operation"
import { MONTH_LABELS } from "@/lib/utils"
import type { PdtpActivityRow, PdtpScheduleRow } from "./tabs/types"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"

type Worksite = { id: string; name: string; code: string }
type Responsible = { slug: string; displayName: string }
type Exclusion = { activityId: string; worksiteId: string; reason: string }
type WorksiteParam = {
  activityId: string
  worksiteId: string
  expectedSubjectCount: number | null
  targetCoveragePercent: string | number | null
  responsibleSlugs: unknown
  responsibleDisplay: string | null
}
type ScheduleOverride = {
  activityId: string
  worksiteId: string
  month: number
  week: number
  plannedQuantity: number
}

/** Mes del período PDTP (1–12); etiqueta en `MONTH_LABELS[mes - 1]`. */
const PDTP_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const
const INHERIT = "__inherit__"

export function WorksiteAdjustmentsPanel({
  programId,
  activities,
  schedule,
  visibleWorksites,
  memberWorksiteIds,
  appliesToAllWorksites,
  exclusions,
  params,
  overrides,
  responsibleCatalog,
}: {
  programId: string
  activities: PdtpActivityRow[]
  schedule: PdtpScheduleRow[]
  visibleWorksites: Worksite[]
  memberWorksiteIds: string[]
  appliesToAllWorksites: boolean
  exclusions: Exclusion[]
  params: WorksiteParam[]
  overrides: ScheduleOverride[]
  responsibleCatalog: Responsible[]
}) {
  const eligibleWorksites = appliesToAllWorksites
    ? visibleWorksites
    : visibleWorksites.filter((worksite) => memberWorksiteIds.includes(worksite.id))
  const [worksiteId, setWorksiteId] = React.useState(eligibleWorksites[0]?.id ?? "")
  // El alcance se edita en esta misma pestaña (WorksiteScopePanel) y este panel
  // sigue montado: la faena elegida puede salir del alcance, o no haber ninguna
  // al montar. Se cae a la primera elegible en vez de quedar en una inexistente.
  const selectedWorksiteId = eligibleWorksites.some((worksite) => worksite.id === worksiteId)
    ? worksiteId
    : (eligibleWorksites[0]?.id ?? "")
  const [editing, setEditing] = React.useState<PdtpActivityRow | null>(null)
  const router = useRouter()
  // No hay `<form action={…}>`: el barrido se dispara desde un `onClick`, que
  // es el caso de `useOperation` (ver AGENTS.md, patrón de formularios).
  // `feedback: "toast"` porque el mensaje que importa es el del servidor
  // —cuántas faenas cambiaron— y el modo "message" lo reemplaza por un
  // "Guardado correctamente." que no dice nada.
  const sweep = useOperation({ feedback: "toast", onSuccess: () => router.refresh() })

  if (eligibleWorksites.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <p className="text-sm font-medium text-[var(--color-text)]">No hay faenas disponibles</p>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">Define primero el alcance del programa (faenas específicas o alcance corporativo) para poder configurar ajustes.</p>
      </div>
    )
  }

  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <Field label="Faena a ajustar" htmlFor="pdtp-adjustment-worksite">
          <Select value={selectedWorksiteId} onValueChange={setWorksiteId}>
            <SelectTrigger id="pdtp-adjustment-worksite" className="max-w-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {eligibleWorksites.map((worksite) => (
                <SelectItem key={worksite.id} value={worksite.id}>{worksite.name} · {worksite.code}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <p className="mt-2 text-xs text-[var(--color-text-muted)]">
          Los valores no ajustados heredan la definición global. Una exclusión desactiva completamente la actividad en esta faena.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--color-border)] pt-3">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={sweep.pending}
            onClick={() => sweep.run(() => applyPdtpCphsHeadcountRuleAction({ programId }))}
          >
            {sweep.pending ? "Aplicando…" : "Aplicar regla de dotación (DS 44)"}
          </Button>
          <p className="text-xs text-[var(--color-text-muted)]">
            Excluye las actividades del Comité Paritario en las faenas que no superan los 25 trabajadores propios, y las reincorpora donde sí. Recorre todas las faenas del programa.
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="grid grid-cols-[4rem_minmax(0,1fr)_8rem_7rem] gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-subtle)]">
          <span>N°</span><span>Actividad</span><span>Estado</span><span className="text-right">Acción</span>
        </div>
        <div className="divide-y divide-[var(--color-border)]">
          {activities.map((activity) => {
            const exclusion = exclusions.find((item) => item.activityId === activity.id && item.worksiteId === selectedWorksiteId)
            const param = params.find((item) => item.activityId === activity.id && item.worksiteId === selectedWorksiteId)
            const hasOverrides = overrides.some((item) => item.activityId === activity.id && item.worksiteId === selectedWorksiteId)
            const adjusted = Boolean(
              param && (
                param.expectedSubjectCount !== null
                || param.targetCoveragePercent !== null
                || Array.isArray(param.responsibleSlugs)
              ),
            ) || hasOverrides
            const state = activity.status === "retired"
              ? "Retirado"
              : exclusion
                ? "Excluido"
                : adjusted
                  ? "Ajustado"
                  : "Heredado"
            return (
              <div key={activity.id} className="grid grid-cols-[4rem_minmax(0,1fr)_8rem_7rem] items-center gap-3 px-4 py-3 text-sm">
                <span className="font-mono text-xs text-[var(--color-text-subtle)]">{activity.n}</span>
                <div className="min-w-0">
                  <p className="truncate font-medium text-[var(--color-text)]">{activity.activity}</p>
                  <p className="mt-0.5 truncate text-xs text-[var(--color-text-muted)]">
                    {param?.responsibleDisplay || activity.responsibleDisplay || "Sin responsable global"}
                  </p>
                </div>
                <MetaBadge meta={{ label: `${state}`, variant: state === "Retirado" ? "outline" : state === "Excluido" ? "danger" : state === "Ajustado" ? "warning" : "default" }} />
                <div className="text-right">
                  <Button type="button" size="sm" variant="ghost" disabled={activity.status === "retired"} onClick={() => setEditing(activity)}>
                    Configurar
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {editing && (
        <AdjustmentDialog
          key={`${editing.id}:${selectedWorksiteId}`}
          activity={editing}
          worksiteId={selectedWorksiteId}
          globalSchedule={schedule.filter((row) => row.activityId === editing.id)}
          exclusion={exclusions.find((item) => item.activityId === editing.id && item.worksiteId === selectedWorksiteId)}
          params={params.find((item) => item.activityId === editing.id && item.worksiteId === selectedWorksiteId)}
          overrides={overrides.filter((item) => item.activityId === editing.id && item.worksiteId === selectedWorksiteId)}
          responsibleCatalog={responsibleCatalog}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  )
}

function AdjustmentDialog({
  activity,
  worksiteId,
  globalSchedule,
  exclusion,
  params,
  overrides,
  responsibleCatalog,
  onClose,
}: {
  activity: PdtpActivityRow
  worksiteId: string
  globalSchedule: PdtpScheduleRow[]
  exclusion?: Exclusion
  params?: WorksiteParam
  overrides: ScheduleOverride[]
  responsibleCatalog: Responsible[]
  onClose: () => void
}) {
  const router = useRouter()
  const hasScheduleOverride = overrides.length > 0
  const [excluded, setExcluded] = React.useState(Boolean(exclusion))
  const [responsibleSlug, setResponsibleSlug] = React.useState(
    Array.isArray(params?.responsibleSlugs) ? String(params.responsibleSlugs[0] ?? INHERIT) : INHERIT,
  )
  const [expected, setExpected] = React.useState(params?.expectedSubjectCount === null || params?.expectedSubjectCount === undefined ? "" : String(params.expectedSubjectCount))
  const [coverage, setCoverage] = React.useState(params?.targetCoveragePercent === null || params?.targetCoveragePercent === undefined ? "" : String(params.targetCoveragePercent))
  const [planMode, setPlanMode] = React.useState<"inherit" | "adjust">(
    hasScheduleOverride ? "adjust" : "inherit",
  )
  const effectiveRows = hasScheduleOverride ? overrides : globalSchedule
  const [cells, setCells] = React.useState<Record<string, number>>(() => Object.fromEntries(
    Array.from({ length: 12 }, (_, monthIndex) => Array.from({ length: 4 }, (_, weekIndex) => {
      const month = monthIndex + 1
      const week = weekIndex + 1
      const row = effectiveRows.find((item) => item.month === month && item.week === week)
      return [`${month}:${week}`, Number(row?.plannedQuantity ?? 0)]
    })).flat(),
  ))
  const [reason, setReason] = React.useState(exclusion?.reason ?? "")
  const { pending, message, run } = useOperation()

  function save() {
    const responsible = responsibleCatalog.find((item) => item.slug === responsibleSlug)
    run(
      () => setPdtpActivityWorksiteAdjustmentAction({
        activityId: activity.id,
        worksiteId,
        excluded,
        reason,
        expectedSubjectCount: expected === "" ? null : Number(expected),
        targetCoveragePercent: coverage === "" ? null : Number(coverage),
        responsibleSlugs: responsible ? [responsible.slug] : null,
        responsibleDisplay: responsible?.displayName ?? null,
        schedule: planMode === "inherit"
          ? null
          : Array.from({ length: 12 }, (_, monthIndex) => Array.from({ length: 4 }, (_, weekIndex) => ({
              month: monthIndex + 1,
              week: weekIndex + 1,
              plannedQuantity: cells[`${monthIndex + 1}:${weekIndex + 1}`] ?? 0,
            }))).flat(),
      }),
      () => {
        onClose()
        router.refresh()
      },
    )
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Ajuste por faena · actividad N°{activity.n}</DialogTitle>
        </DialogHeader>
        <FieldGroup className="gap-4">
          <Field
            label="Excluir de esta faena"
            htmlFor="worksite-excluded"
            helper="No generará planificación ni obligaciones mientras esté excluida."
            className="rounded-lg border border-[var(--color-border)] p-3"
          >
            {/* Sin envolver en <Checkbox>: el Field de arriba ya aporta la
                etiqueta y el htmlFor; un segundo <label> la duplicaría. */}
            <input
              id="worksite-excluded"
              type="checkbox"
              className="h-4 w-4 accent-[var(--color-primary)]"
              checked={excluded}
              onChange={(event) => setExcluded(event.target.checked)}
            />
          </Field>

          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Responsable" htmlFor="worksite-responsible">
              <Select value={responsibleSlug} onValueChange={setResponsibleSlug}>
                <SelectTrigger id="worksite-responsible"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={INHERIT}>Heredar responsable global</SelectItem>
                  {responsibleCatalog.map((item) => <SelectItem key={item.slug} value={item.slug}>{item.displayName}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Sujetos esperados" htmlFor="worksite-expected" helper="Vacío = heredar.">
              <Input id="worksite-expected" type="number" min={0} value={expected} onChange={(event) => setExpected(event.target.value)} />
            </Field>
            <Field label="Meta de cobertura (%)" htmlFor="worksite-coverage" helper="Vacío = heredar.">
              <Input id="worksite-coverage" type="number" min={0} max={100} step="0.01" value={coverage} onChange={(event) => setCoverage(event.target.value)} />
            </Field>
          </div>

          <div className="rounded-lg border border-[var(--color-border)] p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-[var(--color-text)]">Planificación semanal</p>
                <p className="text-xs text-[var(--color-text-muted)]">Hereda el calendario global o define las 48 celdas de esta faena.</p>
              </div>
              <Select value={planMode} onValueChange={(value) => setPlanMode(value as "inherit" | "adjust")}>
                <SelectTrigger className="w-48" aria-label="Modo de planificación"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="inherit">Heredar planificación</SelectItem>
                  <SelectItem value="adjust">Ajustar planificación</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {planMode === "adjust" && (
              <div className="mt-3 overflow-x-auto">
                <TableRoot className="rounded-none border-0">
                <Table className="text-xs">
                  <caption className="sr-only">Ajustes de programación por faena</caption>
                  <TableHeader>
                    <TableRow className="text-left text-[var(--color-text-subtle)]">
                      <TableHead>Mes</TableHead>
                      {[1, 2, 3, 4].map((week) => <TableHead key={week}>S{week}</TableHead>)}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {PDTP_MONTHS.map((month) => (
                      <TableRow key={month}>
                        <TableHead scope="row" className="font-medium">{MONTH_LABELS[month - 1]}</TableHead>
                        {[1, 2, 3, 4].map((week) => {
                          const key = `${month}:${week}`
                          return (
                            <TableCell key={week}>
                              <Input
                                /* El nombre accesible repite lo que se ve: la fila
                                   se rotula "Ene" y la columna "S1", así que un
                                   `${month}` crudo anunciaba "1 semana 1" —un
                                   número sin mes— y no coincidía con la etiqueta
                                   visible. */
                                aria-label={`${MONTH_LABELS[month - 1]} semana ${week}`}
                                className="h-8 min-w-20"
                                type="number"
                                min={0}
                                step="0.25"
                                value={cells[key] ?? 0}
                                onChange={(event) => setCells((current) => ({ ...current, [key]: Number(event.target.value) }))}
                              />
                            </TableCell>
                          )
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                </TableRoot>
              </div>
            )}
          </div>

          <Field label="Motivo del ajuste" htmlFor="worksite-adjustment-reason" required helper="También se exige al volver a la herencia.">
            <Textarea id="worksite-adjustment-reason" value={reason} onChange={(event) => setReason(event.target.value)} minLength={10} maxLength={3000} required />
          </Field>
          {message && <p role="status" className="text-sm text-[var(--color-danger)]">{message}</p>}
        </FieldGroup>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>Cancelar</Button>
          <Button type="button" onClick={save} disabled={pending || reason.trim().length < 10}>{pending ? "Guardando..." : "Guardar ajuste"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
