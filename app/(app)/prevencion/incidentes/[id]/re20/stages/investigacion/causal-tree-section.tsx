"use client"

import * as React from "react"
import { ArrowRight, CheckCircle, Plus, Trash, WarningCircle } from "@phosphor-icons/react"
import { MetaBadge } from "@/components/states/state-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { Checkbox } from "@/components/ui/checkbox"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Field } from "@/components/ui/field"
import { OptionSelect } from "@/components/ui/option-select"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { RE20_VARIATION_ASPECTS } from "@/lib/services/prevention-incident-re20-schema"
import { cn } from "@/lib/utils"
import { Re20Block, Re20Text, Re20TextArea } from "../../fields"
import type { Re20WorkspaceApi } from "../../use-re20-workspace"
import { CausalDiagram } from "./causal-diagram"
import {
  FACT_ROLE_LABELS,
  FINAL_EVENT_ID,
  MAX_EVENTS,
  RELATION_EXPLANATIONS,
  RELATION_LABELS,
  TREE_FIELD,
  VALID_FACT_HELP,
  addAntecedent,
  causalIndex,
  createFinalEvent,
  derivedRelationType,
  factRole,
  linkEvents,
  nextEventId,
  removeEvent,
  rootCauses,
  trajectories,
  treeIssues,
  unlinkEvents,
  wouldCreateCycle,
  withEventPatch,
  type FactRole,
  type Re20Tree,
} from "./model"

export const TREE_ID = (field: string) => `re20-investigacion-${field}`

const VARIATION_LABELS: Record<(typeof RE20_VARIATION_ASPECTS)[number], string> = {
  person: "Persona / dotación",
  task: "Tarea / método",
  equipment: "Equipo / herramienta",
  material: "Material / energía",
  environment: "Entorno / lugar",
  organization: "Organización / supervisión",
  information: "Información / capacitación",
  emergency: "Emergencia / respuesta",
}

const ROLE_BADGE: Record<FactRole, "signal" | "primary" | "default" | "outline" | "warning"> = {
  final: "primary", root: "signal", link: "default", context: "outline", loose: "warning",
}

const factLabel = (tree: Re20Tree, id: string) => {
  const text = tree.events.find((event) => event.id === id)?.description.trim()
  return text ? `${id} · ${text.length > 70 ? `${text.slice(0, 69)}…` : text}` : id
}

/** Ejecuta un cambio de estructura sobre el árbol guardado en el expediente. */
function useTreeMutation(ws: Re20WorkspaceApi) {
  return React.useCallback((fn: (tree: Re20Tree) => Re20Tree) => {
    ws.update((data) => ({ ...data, causalTree: fn(data.causalTree) }))
  }, [ws])
}

/* ── Sección completa: constructor + diagrama + listado + 7.1 + 8.2 ──────── */

export function CausalTreeSection({ ws, required }: { ws: Re20WorkspaceApi; required: boolean }) {
  const tree = ws.data.causalTree
  const [selectedId, setSelectedId] = React.useState<string>(FINAL_EVENT_ID)
  const selected = tree.events.find((event) => event.id === selectedId) ?? tree.events.find((event) => event.id === FINAL_EVENT_ID) ?? tree.events[0] ?? null
  const issues = treeIssues(tree)
  const roots = rootCauses(tree)
  const paths = trajectories(tree)

  return (
    <div className="space-y-5">
      {!required && (
        <Callout tone="info" title="Para este evento el árbol es optativo">
          <p>Es un cuasi accidente sin potencial grave o fatal. Si decides construirlo, debe quedar coherente.</p>
        </Callout>
      )}

      <div className="space-y-6">
        <div className="min-w-0 space-y-2">
          <h4 className="text-sm font-semibold text-[var(--color-text)]">
            Así va el árbol
            <span className="ml-1.5 font-normal tabular-nums text-[var(--color-text-subtle)]">
              ({tree.events.length} {tree.events.length === 1 ? "hecho" : "hechos"} · {roots.length} {roots.length === 1 ? "causa raíz" : "causas raíz"})
            </span>
          </h4>
          <CausalDiagram tree={tree} selectedId={selected?.id} />
        </div>
        <Builder ws={ws} selected={selected?.id ?? null} onSelect={setSelectedId} />
      </div>

      <TreeIssues ws={ws} issues={issues} required={required} hasEvents={tree.events.length > 0} />

      <Re20Block
        id={TREE_ID("block-trayectorias")}
        title="Trayectorias (8.2)"
        summary={paths.length === 0 ? "Aparecen solas al conectar una causa raíz con H1" : `${paths.length} ${paths.length === 1 ? "trayectoria" : "trayectorias"}`}
        complete={paths.length > 0}
      >
        <Trajectories tree={tree} paths={paths} />
      </Re20Block>

      <Re20Block
        id={TREE_ID("block-hechos")}
        title="Listado de hechos (7)"
        summary={tree.events.length === 0 ? "Aún sin hechos" : `${tree.events.length} de ${MAX_EVENTS} · ${tree.events.filter((e) => !e.source?.trim()).length} sin fuente`}
        complete={tree.events.length > 0 && tree.events.every((e) => e.description.trim() && e.source?.trim())}
      >
        <FactList ws={ws} onBuild={(id) => { setSelectedId(id); ws.focusField(TREE_FIELD.builder) }} />
      </Re20Block>

      <Re20Block id={TREE_ID("block-variaciones")} title="Variaciones y barreras (7.1)" summary={variationsSummary(ws)} complete={ws.data.definitive.variations.length > 0}>
        <Variations ws={ws} />
      </Re20Block>
    </div>
  )
}

/* ── Constructor guiado ──────────────────────────────────────────────────── */

function Builder({ ws, selected, onSelect }: { ws: Re20WorkspaceApi; selected: string | null; onSelect: (id: string) => void }) {
  const tree = ws.data.causalTree
  const mutate = useTreeMutation(ws)
  const hasFinal = tree.events.some((event) => event.id === FINAL_EVENT_ID)

  if (!hasFinal) return <FinalFactForm ws={ws} />
  const event = tree.events.find((item) => item.id === selected)!
  const index = causalIndex(tree)
  const antecedents = index.into.get(event.id) ?? []
  const consequences = index.out.get(event.id) ?? []
  const role = factRole(tree, event.id)
  const eligibleAntecedents = tree.events.filter((other) => other.id !== event.id && !antecedents.includes(other.id) && !wouldCreateCycle(tree, other.id, event.id))
  const eligibleConsequences = tree.events.filter((other) => other.id !== event.id && !consequences.includes(other.id) && !wouldCreateCycle(tree, event.id, other.id))
  const factsFull = tree.events.length >= MAX_EVENTS
  const nextId = nextEventId(tree.events)
  const typeOfIncoming = antecedents.length > 0 ? derivedRelationType(index, antecedents[0]!, event.id) : null
  const hasText = event.description.trim().length > 0

  return (
    <section id={TREE_FIELD.builder} aria-labelledby={`${TREE_FIELD.builder}-title`} className="min-w-0 space-y-4">
      <div>
        <h4 id={`${TREE_FIELD.builder}-title`} className="text-sm font-semibold text-[var(--color-text)]">Construye el árbol desde el hecho final</h4>
        <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">Elige un hecho y responde la pregunta. Cada respuesta crea un hecho nuevo ya conectado.</p>
      </div>

      <SegmentedControl
        ariaLabel="Hecho en el que trabajas"
        variant="pills"
        items={tree.events.map((item) => ({ key: item.id, label: item.id, active: item.id === event.id, onClick: () => onSelect(item.id) }))}
      />

      <div className="space-y-1">
        <p id={TREE_ID("arbol-pregunta")} tabIndex={-1} className="text-base font-semibold leading-snug text-[var(--color-text)] outline-none">
          ¿Qué fue necesario para que ocurriera {event.id}? ¿Fue suficiente por sí solo?
        </p>
        <p className="flex flex-wrap items-center gap-2 text-sm text-[var(--color-text)]">
          <MetaBadge meta={{ label: FACT_ROLE_LABELS[role], variant: ROLE_BADGE[role] }} size="sm" />
          <span className={cn(!hasText && "text-[var(--color-text-subtle)]")}>{hasText ? event.description : "Este hecho aún no tiene descripción."}</span>
        </p>
      </div>

      {antecedents.length > 0 ? (
        <div className="space-y-2">
          <ul className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
            {antecedents.map((id) => {
              const relation = tree.relations.find((r) => r.from === id && r.to === event.id)
              return (
                <li key={id} className="space-y-2 py-3">
                  <div className="flex items-start gap-2">
                    <button
                      type="button"
                      onClick={() => onSelect(id)}
                      className="min-h-11 min-w-11 shrink-0 rounded-[var(--radius-md)] px-2 text-left font-mono text-sm font-semibold text-[var(--color-primary-ink)] underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                      aria-label={`Trabajar en ${id}`}
                    >
                      {id}
                    </button>
                    <p className="min-w-0 flex-1 pt-3 text-sm text-[var(--color-text)] sm:pt-1.5">{tree.events.find((item) => item.id === id)?.description || "Sin descripción"}</p>
                    <Button type="button" variant="ghost-danger" size="icon-sm" aria-label={`Quitar la relación ${id} → ${event.id}`} onClick={() => mutate((t) => unlinkEvents(t, id, event.id))}>
                      <Trash aria-hidden className="size-4" />
                    </Button>
                  </div>
                  <Re20Text
                    id={TREE_ID(`relacion-${id}-${event.id}-justification`)}
                    label={`Por qué ${id} fue necesario para ${event.id}`}
                    value={relation?.justification}
                    maxLength={2000}
                    onChange={(value) => mutate((t) => ({ ...t, relations: t.relations.map((r) => r.from === id && r.to === event.id ? { ...r, justification: value || null } : r) }))}
                    placeholder="El hecho que lo respalda"
                  />
                </li>
              )
            })}
          </ul>
          {typeOfIncoming && (
            <p className="text-sm text-[var(--color-text)]" data-testid="relation-type">
              <span className="font-semibold">{RELATION_LABELS[typeOfIncoming]}.</span>{" "}
              <span className="text-[var(--color-text-muted)]">{RELATION_EXPLANATIONS[typeOfIncoming]} Se calcula sola según cómo conectas los hechos.</span>
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-[var(--color-text-muted)]">
          {role === "final" || consequences.length === 0
            ? `Todavía nada explica ${event.id}. Escribe abajo lo que fue necesario para que ocurriera.`
            : `${event.id} no tiene antecedentes. Si ya no hay nada más que verificar, queda como causa raíz.`}
        </p>
      )}

      <AddAntecedent
        key={event.id}
        ws={ws}
        eventId={event.id}
        nextId={nextId}
        disabled={factsFull}
        disabledReason={factsFull ? `El formato admite hasta ${MAX_EVENTS} hechos.` : null}
      />

      {(eligibleAntecedents.length > 0 || eligibleConsequences.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
          {eligibleAntecedents.length > 0 && (
            <Field label={`¿Ya está en el listado? Vincúlalo como antecedente de ${event.id}`} htmlFor={TREE_ID("vincular-antecedente")}>
              <OptionSelect
                id={TREE_ID("vincular-antecedente")}
                options={eligibleAntecedents.map((other) => ({ value: other.id, label: factLabel(tree, other.id), textValue: factLabel(tree, other.id) }))}
                value=""
                onValueChange={(value) => value && mutate((t) => linkEvents(t, value, event.id))}
                placeholder="Elige un hecho"
              />
            </Field>
          )}
          {eligibleConsequences.length > 0 && (
            <Field label={`${event.id} también provocó otro hecho`} htmlFor={TREE_ID("vincular-consecuencia")} helper="Un mismo hecho con varias consecuencias se marca como independiente.">
              <OptionSelect
                id={TREE_ID("vincular-consecuencia")}
                options={eligibleConsequences.map((other) => ({ value: other.id, label: factLabel(tree, other.id), textValue: factLabel(tree, other.id) }))}
                value=""
                onValueChange={(value) => value && mutate((t) => linkEvents(t, event.id, value))}
                placeholder="Elige la consecuencia"
              />
            </Field>
          )}
        </div>
      )}

      {consequences.length > 0 && (
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
          {event.id} provocó:
          {consequences.map((id) => (
            <button key={id} type="button" onClick={() => onSelect(id)} className="inline-flex min-h-11 items-center rounded-[var(--radius-md)] px-2 font-mono font-semibold text-[var(--color-primary-ink)] underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] sm:min-h-0 sm:px-1" aria-label={`Trabajar en ${id}`}>
              {id}
            </button>
          ))}
          ({RELATION_LABELS[derivedRelationType(index, event.id, consequences[0]!)].toLowerCase()})
        </p>
      )}
    </section>
  )
}

function FinalFactForm({ ws }: { ws: Re20WorkspaceApi }) {
  const mutate = useTreeMutation(ws)
  const [text, setText] = React.useState("")
  const injury = ws.data.preliminary.injuryDescription?.trim()
  return (
    <section id={TREE_FIELD.builder} aria-labelledby={`${TREE_FIELD.builder}-title`} className="min-w-0 space-y-3">
      <div>
        <h4 id={`${TREE_FIELD.builder}-title`} className="text-sm font-semibold text-[var(--color-text)]">Empieza por el hecho final</h4>
        <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">H1 es la lesión o el daño con que termina el evento. Desde ahí se pregunta qué fue necesario para que ocurriera.</p>
      </div>
      <Re20TextArea
        id={TREE_FIELD.finalFact}
        label="Hecho final (H1)"
        required
        rows={3}
        value={text}
        onChange={setText}
        maxLength={2000}
        helper={VALID_FACT_HELP}
        placeholder="Por ejemplo: El operador sufrió un corte en la mano derecha"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" disabled={!text.trim()} onClick={() => mutate((t) => createFinalEvent(t, text))}>
          <Plus aria-hidden className="size-4" />Crear el hecho final
        </Button>
        {injury && (
          <Button type="button" variant="secondary" onClick={() => setText(injury)}>Usar la lesión del preliminar</Button>
        )}
      </div>
    </section>
  )
}

function AddAntecedent({ ws, eventId, nextId, disabled, disabledReason }: { ws: Re20WorkspaceApi; eventId: string; nextId: string | null; disabled: boolean; disabledReason: string | null }) {
  const mutate = useTreeMutation(ws)
  const [description, setDescription] = React.useState("")
  const [justification, setJustification] = React.useState("")
  const fieldId = TREE_ID("nuevo-antecedente")

  function add() {
    if (!description.trim() || disabled) return
    mutate((tree) => addAntecedent(tree, eventId, { description, justification }).tree)
    setDescription("")
    setJustification("")
    // El siguiente antecedente se escribe sin volver a buscar el campo.
    ws.focusField(fieldId)
  }

  return (
    <div className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
      <Re20TextArea
        id={fieldId}
        label={`Antecedente de ${eventId}${nextId ? ` (será ${nextId})` : ""}`}
        rows={2}
        value={description}
        onChange={setDescription}
        maxLength={2000}
        helper="Un solo hecho, breve, verificable y afirmativo. Sin juicios sobre las personas."
        disabled={disabled}
      />
      <Re20Text id={TREE_ID("nuevo-antecedente-justificacion")} label="Justificación factual" value={justification} onChange={setJustification} maxLength={2000} placeholder="Qué evidencia o hecho lo respalda" disabled={disabled} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={add} disabled={disabled || !description.trim()}>
          <Plus aria-hidden className="size-4" />Agregar como antecedente de {eventId}
        </Button>
        {disabledReason && <p className="text-xs text-[var(--color-text-muted)]">{disabledReason}</p>}
      </div>
    </div>
  )
}

/* ── Pendientes ──────────────────────────────────────────────────────────── */

function TreeIssues({ ws, issues, required, hasEvents }: { ws: Re20WorkspaceApi; issues: Array<{ text: string; fieldId: string }>; required: boolean; hasEvents: boolean }) {
  if (!required && !hasEvents) return null
  if (issues.length === 0) {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-[var(--color-success-ink)]">
        <CheckCircle aria-hidden weight="fill" className="size-4 shrink-0" />El árbol está completo y es coherente.
      </p>
    )
  }
  return (
    <div className="space-y-1" data-testid="tree-issues">
      <h4 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
        <WarningCircle aria-hidden weight="fill" className="size-4 text-[var(--color-warning-ink)]" />
        {required ? "Falta para completar el árbol" : "Para dejar el árbol coherente"}
        <span className="font-normal tabular-nums text-[var(--color-text-subtle)]">({issues.length})</span>
      </h4>
      <ul className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
        {issues.map((issue) => (
          <li key={issue.text}>
            <button
              type="button"
              onClick={() => ws.focusField(issue.fieldId)}
              className="flex min-h-11 w-full items-center gap-2 py-2 text-left text-sm text-[var(--color-text)] outline-none hover:bg-[var(--color-surface-2)] focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
            >
              <span className="flex-1">{issue.text}</span>
              <ArrowRight aria-hidden className="size-4 shrink-0 text-[var(--color-text-subtle)]" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ── Trayectorias ────────────────────────────────────────────────────────── */

function Trajectories({ tree, paths }: { tree: Re20Tree; paths: string[][] }) {
  if (paths.length === 0) {
    return <p className="text-sm text-[var(--color-text-muted)]">Cada camino de una causa raíz hasta H1 aparece aquí, sin que lo escribas. Conecta al menos un hecho con H1 para verlo.</p>
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-[var(--color-text-muted)]">Se leen de izquierda a derecha, desde la causa raíz hasta el hecho final.</p>
      <ol className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]" aria-label="Trayectorias desde cada causa raíz hasta H1">
        {paths.map((path) => (
          <li key={path.join(">")} className="space-y-0.5 py-2.5">
            <p className="flex flex-wrap items-center gap-1.5 font-mono text-sm font-semibold text-[var(--color-text)]">
              {path.map((id, i) => (
                <React.Fragment key={id}>
                  {i > 0 && <><ArrowRight aria-hidden className="size-3.5 text-[var(--color-text-subtle)]" /><span className="sr-only">luego</span></>}
                  <span>{id}</span>
                </React.Fragment>
              ))}
            </p>
            <p className="text-xs text-[var(--color-text-muted)]">Causa raíz: {tree.events.find((event) => event.id === path[0])?.description || "sin descripción"}</p>
          </li>
        ))}
      </ol>
    </div>
  )
}

/* ── Listado de hechos ───────────────────────────────────────────────────── */

function FactList({ ws, onBuild }: { ws: Re20WorkspaceApi; onBuild: (id: string) => void }) {
  const tree = ws.data.causalTree
  const mutate = useTreeMutation(ws)
  const [removing, setRemoving] = React.useState<string | null>(null)

  if (tree.events.length === 0) {
    return <p className="text-sm text-[var(--color-text-muted)]">Los hechos se crean desde el constructor de arriba: empieza por el hecho final H1.</p>
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--color-text-muted)]">{VALID_FACT_HELP}</p>
      <ol className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
        {tree.events.map((event) => {
          const role = factRole(tree, event.id)
          const isFinal = event.id === FINAL_EVENT_ID
          return (
            <li key={event.id} aria-label={`Hecho ${event.id}`} className="space-y-3 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-semibold text-[var(--color-text)]">{event.id}</span>
                <MetaBadge meta={{ label: FACT_ROLE_LABELS[role], variant: ROLE_BADGE[role] }} size="sm" />
                {!event.source?.trim() && <Badge variant="outline" size="sm">Sin fuente</Badge>}
                <span className="flex-1" />
                <Button type="button" variant="ghost" size="sm" onClick={() => onBuild(event.id)}>Construir desde aquí</Button>
                {!isFinal && (
                  <Button type="button" variant="ghost-danger" size="icon-sm" aria-label={`Quitar el hecho ${event.id}`} onClick={() => (event.description.trim() || tree.relations.some((r) => r.from === event.id || r.to === event.id) ? setRemoving(event.id) : mutate((t) => removeEvent(t, event.id)))}>
                    <Trash aria-hidden className="size-4" />
                  </Button>
                )}
              </div>
              <Re20TextArea
                id={isFinal ? TREE_FIELD.finalFact : TREE_FIELD.fact(event.id)}
                label={`Hecho objetivo ${event.id}`}
                rows={2}
                value={event.description}
                maxLength={2000}
                onChange={(value) => mutate((t) => withEventPatch(t, event.id, { description: value }))}
              />
              <Re20Text
                id={TREE_ID(`hecho-${event.id}-source`)}
                label={`Fuente que respalda ${event.id}`}
                value={event.source}
                maxLength={1000}
                onChange={(value) => mutate((t) => withEventPatch(t, event.id, { source: value || null }))}
                placeholder="Declaración, foto, registro…"
              />
              <div className="flex flex-wrap gap-x-6 gap-y-1">
                <Checkbox
                  id={TREE_ID(`hecho-${event.id}-causal`)}
                  label="¿Causal?"
                  className="size-5"
                  checked={event.causal !== false}
                  onChange={(e) => mutate((t) => withEventPatch(t, event.id, { causal: e.target.checked }))}
                />
                <Checkbox
                  id={TREE_ID(`hecho-${event.id}-verify`)}
                  label="¿Requiere verificación?"
                  className="size-5"
                  checked={event.requiresVerification === true}
                  onChange={(e) => mutate((t) => withEventPatch(t, event.id, { requiresVerification: e.target.checked }))}
                />
              </div>
            </li>
          )
        })}
      </ol>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => { if (!open) setRemoving(null) }}
        title={`Quitar el hecho ${removing ?? ""}`}
        description="Se borran el hecho y sus relaciones con otros hechos. Los demás hechos no se renumeran."
        confirmLabel="Quitar hecho"
        variant="destructive"
        onConfirm={() => { if (removing) mutate((t) => removeEvent(t, removing)); setRemoving(null) }}
      />
    </div>
  )
}

/* ── 7.1 Variaciones y barreras ──────────────────────────────────────────── */

type VariationAspect = (typeof RE20_VARIATION_ASPECTS)[number]
type VariationField = "expected" | "actual" | "existingControl" | "controlFailure"
const VARIATION_FIELDS: Array<{ key: VariationField; label: string }> = [
  { key: "expected", label: "Condición esperada" },
  { key: "actual", label: "Condición real" },
  { key: "existingControl", label: "Control existente" },
  { key: "controlFailure", label: "Falla o ausencia del control" },
]

function variationsSummary(ws: Re20WorkspaceApi) {
  const filled = ws.data.definitive.variations.filter((row) => VARIATION_FIELDS.some((f) => row[f.key]?.trim())).length
  return filled === 0 ? "Sin aspectos registrados" : `${filled} de ${RE20_VARIATION_ASPECTS.length} aspectos con datos`
}

function Variations({ ws }: { ws: Re20WorkspaceApi }) {
  function set(aspect: VariationAspect, field: VariationField, value: string) {
    ws.update((data) => {
      const rows = data.definitive.variations
      const current = rows.find((row) => row.aspect === aspect) ?? { aspect }
      const next = { ...current, [field]: value }
      const empty = VARIATION_FIELDS.every((f) => !(next as Record<string, string | null | undefined>)[f.key]?.trim())
      const others = rows.filter((row) => row.aspect !== aspect)
      const merged = empty ? others : [...others, next as (typeof rows)[number]]
      const ordered = merged.sort((a, b) => RE20_VARIATION_ASPECTS.indexOf(a.aspect) - RE20_VARIATION_ASPECTS.indexOf(b.aspect))
      return { ...data, definitive: { ...data.definitive, variations: ordered } }
    })
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-[var(--color-text-muted)]">Qué se esperaba, qué ocurrió y qué barrera falló, por aspecto. Completa sólo los que aportan al análisis.</p>
      <div aria-hidden className="hidden grid-cols-[10rem_repeat(4,minmax(0,1fr))] gap-3 px-1 text-xs font-medium text-[var(--color-text-subtle)] md:grid">
        <span>Aspecto</span>{VARIATION_FIELDS.map((f) => <span key={f.key}>{f.label}</span>)}
      </div>
      <ul className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
        {RE20_VARIATION_ASPECTS.map((aspect) => {
          const row = ws.data.definitive.variations.find((item) => item.aspect === aspect)
          return (
            <li key={aspect} className="grid gap-3 py-3 md:grid-cols-[10rem_repeat(4,minmax(0,1fr))]">
              <p className="text-sm font-medium text-[var(--color-text)] md:pt-2">{VARIATION_LABELS[aspect]}</p>
              {VARIATION_FIELDS.map((field) => (
                <Re20TextArea
                  key={field.key}
                  id={TREE_ID(`variation-${aspect}-${field.key}`)}
                  label={`${field.label}: ${VARIATION_LABELS[aspect]}`}
                  rows={2}
                  maxLength={1500}
                  value={row?.[field.key]}
                  onChange={(value) => set(aspect, field.key, value)}
                  className="md:[&_label]:sr-only"
                />
              ))}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
