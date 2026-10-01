"use client"

import * as React from "react"
import { ArrowRight } from "@phosphor-icons/react"
import { RiskClassificationBadge } from "@/components/prevention/risk-classification-badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { DatePicker } from "@/components/ui/date-picker"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/ui/option-select"
import { Skeleton } from "@/components/ui/skeleton"
import { useOperation } from "@/lib/hooks/use-operation"
import { CLASSIFICATION_LABEL, type RiskClassification } from "@/lib/prevention/miper/methodology"
import type { ProgramActionView } from "@/lib/services/miper/program-queries"
import { todayInChile } from "@/lib/utils"
import { applyProgramGenerationAction, proposeProgramActionsAction } from "../actions"
import { PROGRAM_SCHEDULE_OPTIONS } from "./program-action-dialog"

type ProposedMeasure = {
  controlId: string
  entryId: string
  rowNumber: number
  description: string
  classification: RiskClassification | null
  suggestedGroupKey: string | null
  linkedActionId: string | null
}

type ProposalCard = { key: string; description: string; measures: ProposedMeasure[] }

type Draft = {
  checked: string[]
  decision: "create" | "link" | "leave"
  description: string
  responsibleUserId: string
  scheduleKind: string
  startsOn: string
  actionId: string
  locationLabel: string
}

const DECISION_OPTIONS = [
  { value: "create", label: "Crear una actividad" },
  { value: "link", label: "Asociar a una actividad existente" },
  { value: "leave", label: "Dejar sin actividad" },
]

/** Una decisión de la persona sobre un grupo de medidas (`programGenerationSchema`). */
type GenerationDecision = {
  controlIds: string[]
  decision: "create" | "link" | "leave"
  actionId?: string
  description?: string
  responsibleUserId?: string | null
  scheduleKind?: string
  startsOn?: string
  locationLabel?: string | null
}

/** La banda que no puede quedar sin programa (§7.3): Intolerable o Importante. */
const bandsWithoutProgram = (measures: ProposedMeasure[], checked: string[]) =>
  measures.filter((measure) => checked.includes(measure.controlId)
    && (measure.classification === "intolerable" || measure.classification === "important"))

/**
 * Generación del programa desde el MIPER (§7.3).
 *
 * El sistema **propone** agrupaciones —medidas que se parecen entre sí— y la
 * persona decide, grupo por grupo: crear una actividad nueva, asociarlas a una
 * que ya existe, o dejarlas fuera del programa. Dejarlas fuera sólo se puede con
 * una fila Tolerable o Moderado: una medida de una fila Intolerable o Importante
 * no puede quedarse sin actividad —el servicio lo vuelve a rechazar—.
 */
export function GenerateActionsDialog({
  matrixId,
  users,
  actions,
  trigger,
  onApplied,
}: {
  matrixId: string
  users: Array<{ id: string; name: string }>
  /** Actividades activas del programa, para asociar medidas a una existente. */
  actions: ProgramActionView[]
  trigger: React.ReactNode
  onApplied: () => void
}) {
  const [open, setOpen] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [proposals, setProposals] = React.useState<{ measures: ProposedMeasure[]; groups: Array<{ key: string; description: string }> } | null>(null)
  const [drafts, setDrafts] = React.useState<Record<string, Draft>>({})
  const [error, setError] = React.useState<string | null>(null)
  const operation = useOperation()

  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      const result = await proposeProgramActionsAction({ matrixId })
      if (cancelled) return
      setLoading(false)
      if (!result.ok) { setError(result.message ?? "No se pudieron calcular las propuestas."); return }
      const data = result.data as unknown as { measures: ProposedMeasure[]; groups: Array<{ key: string; description: string }> }
      setProposals({ measures: data.measures, groups: data.groups })
      const cards = buildCards({ measures: data.measures, groups: data.groups })
      setDrafts(Object.fromEntries(cards.map((card) => [card.key, {
        checked: card.measures.map((measure) => measure.controlId),
        decision: "create" as const,
        description: card.description,
        responsibleUserId: "",
        scheduleKind: "monthly",
        startsOn: todayInChile(),
        actionId: "",
        locationLabel: "",
      }])))
    })()
    return () => { cancelled = true }
  }, [open, matrixId])

  const cards = proposals ? buildCards(proposals) : []

  function patch(key: string, changes: Partial<Draft>) {
    setDrafts((current) => ({ ...current, [key]: { ...current[key]!, ...changes } }))
  }

  function apply() {
    const decisions: GenerationDecision[] = []
    for (const card of cards) {
      const draft = drafts[card.key]
      if (!draft || draft.checked.length === 0) continue
      if (draft.decision === "leave") {
        decisions.push({ controlIds: draft.checked, decision: "leave" })
      } else if (draft.decision === "link") {
        if (draft.actionId) decisions.push({ controlIds: draft.checked, decision: "link", actionId: draft.actionId })
      } else {
        decisions.push({
          controlIds: draft.checked,
          decision: "create",
          description: draft.description,
          responsibleUserId: draft.responsibleUserId || null,
          scheduleKind: draft.scheduleKind,
          startsOn: draft.startsOn,
          locationLabel: draft.locationLabel || null,
        })
      }
    }
    if (decisions.length === 0) {
      operation.setMessage("Indica qué hacer con al menos una medida, o asóciala a una actividad existente.")
      return
    }
    operation.run(() => applyProgramGenerationAction({ matrixId, decisions }), () => { setOpen(false); onApplied() })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[min(90dvh,60rem)] max-w-3xl">
        <DialogHeader>
          <DialogTitle>Generar actividades desde el MIPER</DialogTitle>
          <DialogDescription>
            Estas son las medidas del MIPER que todavía no tienen una actividad que las ejecute. Elige, grupo por grupo, si se crea una actividad nueva, se asocian a una existente o quedan fuera del programa.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="space-y-2"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>
        ) : error ? (
          <p role="alert" className="text-sm text-[var(--color-danger-ink)]">{error}</p>
        ) : cards.length === 0 ? (
          <EmptyState
            compact
            title="Todas las medidas del MIPER ya tienen actividad"
            description="Cada medida de control está cubierta por una actividad del Programa de Trabajo. No hay nada que generar."
            action={<Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cerrar</Button>}
          />
        ) : (
          <div className="space-y-3">
            {cards.map((card) => {
              const draft = drafts[card.key]
              if (!draft) return null
              const blocked = bandsWithoutProgram(card.measures, draft.checked)
              const rowNumbers = card.measures.map((measure) => measure.rowNumber).join(", ")
              return (
                <section key={card.key} className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3">
                  <header className="space-y-2">
                    <p className="text-sm font-medium">Medidas de la fila {rowNumbers}</p>
                    <ul className="space-y-1">
                      {card.measures.map((measure) => (
                        <li key={measure.controlId} className="flex flex-wrap items-center gap-2">
                          <Checkbox
                            label={measure.description}
                            checked={draft.checked.includes(measure.controlId)}
                            onChange={(event) => {
                              const checked = event.target.checked
                                ? [...draft.checked, measure.controlId]
                                : draft.checked.filter((id) => id !== measure.controlId)
                              const stillBlocked = bandsWithoutProgram(card.measures, checked).length > 0
                              patch(card.key, { checked, decision: stillBlocked && draft.decision === "leave" ? "create" : draft.decision })
                            }}
                          />
                          <RiskClassificationBadge classification={measure.classification} size="sm" />
                          <span className="text-xs text-[var(--color-text-subtle)]">Fila {measure.rowNumber}</span>
                        </li>
                      ))}
                    </ul>
                  </header>

                  {blocked.length > 0 && (
                    <p role="alert" className="text-xs text-[var(--color-danger-ink)]">
                      La fila {blocked[0]!.rowNumber} tiene un riesgo {CLASSIFICATION_LABEL[blocked[0]!.classification as RiskClassification]}:
                      {" "}«{blocked[0]!.description}» no puede quedar sin una actividad del Programa de Trabajo.
                    </p>
                  )}

                  <Field label="Qué hacer con estas medidas">
                    <OptionSelect
                      aria-label={`Decisión para las medidas de la fila ${rowNumbers}`}
                      value={draft.decision}
                      onValueChange={(value) => patch(card.key, { decision: value as Draft["decision"] })}
                      options={DECISION_OPTIONS.map((option) => ({
                        ...option,
                        disabled: option.value === "leave" && blocked.length > 0,
                      }))}
                    />
                  </Field>

                  {draft.decision === "create" && (
                    <div className="grid gap-3 md:grid-cols-2">
                      <Field label="Actividad" hint="Qué se hará.">
                        <Input value={draft.description} onChange={(event) => patch(card.key, { description: event.target.value })} maxLength={3000} />
                      </Field>
                      <Field label="Responsable" hint="Quien la ejecuta.">
                        <OptionSelect
                          aria-label={`Responsable de la actividad de la fila ${rowNumbers}`}
                          value={draft.responsibleUserId}
                          onValueChange={(value) => patch(card.key, { responsibleUserId: value })}
                          emptyLabel="Sin responsable"
                          placeholder="Sin responsable"
                          options={users.map((user) => ({ value: user.id, label: user.name }))}
                        />
                      </Field>
                      <Field label="Frecuencia">
                        <OptionSelect
                          aria-label={`Frecuencia de la actividad de la fila ${rowNumbers}`}
                          value={draft.scheduleKind}
                          onValueChange={(value) => patch(card.key, { scheduleKind: value })}
                          options={PROGRAM_SCHEDULE_OPTIONS}
                        />
                      </Field>
                      <Field label="Fecha programada">
                        <DatePicker
                          ariaLabel={`Fecha programada de la actividad de la fila ${rowNumbers}`}
                          value={draft.startsOn}
                          onChange={(value) => patch(card.key, { startsOn: value })}
                        />
                      </Field>
                      <Field label="Centro de trabajo" hint="Opcional.">
                        <Input value={draft.locationLabel} onChange={(event) => patch(card.key, { locationLabel: event.target.value })} maxLength={300} />
                      </Field>
                    </div>
                  )}

                  {draft.decision === "link" && (
                    <Field label="Actividad existente" hint={actions.length === 0 ? "Todavía no hay actividades en el programa." : "Se reutiliza: la medida queda vinculada sin crear otra actividad."}>
                      <OptionSelect
                        aria-label={`Actividad existente para la fila ${rowNumbers}`}
                        value={draft.actionId}
                        onValueChange={(value) => patch(card.key, { actionId: value })}
                        placeholder="Selecciona la actividad"
                        options={actions.map((action) => ({ value: action.id, label: `N° ${action.actionNumber} · ${action.description}` }))}
                      />
                    </Field>
                  )}
                </section>
              )
            })}
          </div>
        )}

        {operation.message && <p role="status" className="text-sm text-[var(--color-text-muted)]">{operation.message}</p>}
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button type="button" disabled={operation.pending || cards.length === 0} onClick={apply}>
            Aplicar decisiones
            <ArrowRight size={14} className="ml-1.5" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function buildCards(proposals: { measures: ProposedMeasure[]; groups: Array<{ key: string; description: string }> }): ProposalCard[] {
  const byGroup = new Map<string, ProposedMeasure[]>()
  const singles: ProposedMeasure[] = []
  for (const measure of proposals.measures) {
    if (!measure.suggestedGroupKey) { singles.push(measure); continue }
    byGroup.set(measure.suggestedGroupKey, [...(byGroup.get(measure.suggestedGroupKey) ?? []), measure])
  }
  return [
    ...[...byGroup.entries()].map(([key, measures]) => ({
      key,
      description: proposals.groups.find((group) => group.key === key)?.description ?? measures[0]!.description,
      measures,
    })),
    ...singles.map((measure) => ({ key: measure.controlId, description: measure.description, measures: [measure] })),
  ]
}
