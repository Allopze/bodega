"use client"

/**
 * Editor visual MVP de `ChecklistDefinition` (plan §Gap 1 — complementa el
 * editor JSON de `checklist-tab.tsx`, no lo reemplaza). Cubre secciones/ítems
 * — el resto de campos de la definición (code/version/legalFramework/
 * closingAct) se mantienen vía el editor JSON, ya cubiertos por
 * `pdtpChecklistDefinitionSchema` con defaults razonables.
 */
import * as React from "react"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field } from "@/components/ui/field"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { ArrowUp, ArrowDown, DotsSixVertical, Trash, Plus, Copy } from "@phosphor-icons/react"
import type { ChecklistDefinition, ChecklistItem, ChecklistSection, FieldKind, ClosingActDefinition } from "@/lib/sst/types"
import { nanoid } from "@/lib/id"
import { PDTP_BUILDER_ROLE_LABELS } from "@/lib/services/pdtp/checklist-domain"

const FIELD_KIND_OPTIONS: Array<{ value: FieldKind; label: string }> = [
  { value: "cumple_nocumple_obs", label: "Cumple / No cumple + observación" },
  { value: "cumple_nocumple_na_obs", label: "Cumple / No cumple / N/A + observación" },
  { value: "entregado_obs", label: "Entregado / No entregado + observación" },
  { value: "apto_obs", label: "Apto / No apto + observación" },
  { value: "si_no_obs", label: "Sí / No + observación" },
  { value: "bueno_regular_malo_obs", label: "Bueno / Regular / Malo" },
  { value: "bueno_regular_malo_na_obs", label: "Bueno / Regular / Malo / N/A" },
  { value: "bueno_regular_malo_na_nt_obs", label: "Bueno / Regular / Malo / N/A / No tiene" },
  { value: "text", label: "Texto libre" },
  { value: "textarea", label: "Texto libre (párrafo)" },
  { value: "date", label: "Fecha" },
  { value: "select", label: "Selección única" },
  { value: "multiselect", label: "Selección múltiple" },
  { value: "signature", label: "Firma" },
  { value: "readonly", label: "Solo lectura" },
]

// Radix Select no permite SelectItem value="" — el "sin clasificar" se maneja
// con un placeholder cuando item.danoPotencial es undefined (mismo patrón que
// NewActionDraft en execution-action-plan-panel.tsx).
const DANO_POTENCIAL_OPTIONS = [
  { value: "leve", label: "Leve · baja · 15 días" },
  { value: "moderado", label: "Moderado · media · 7 días" },
  { value: "grave", label: "Grave · alta · 48 h" },
  { value: "fatal", label: "Fatal · alta · inmediato" },
] as const

// F5: labels en español derivados de la fuente única PDTP_BUILDER_ROLE_LABELS
// (regla A6 — nunca mostrar slugs crudos en la UI). El orden del mapa es el deseado.
const ROLE_OPTIONS: Array<{ value: string; label: string }> =
  Object.entries(PDTP_BUILDER_ROLE_LABELS).map(([value, label]) => ({ value, label }))

/**
 * Esqueleto mínimo de `ChecklistDefinition` para empezar a editar en modo
 * visual sin escribir JSON (F1). Empieza con `sections: []` — no pasa
 * `pdtpChecklistDefinitionSchema` hasta que haya ≥1 sección con ≥1 ítem, pero
 * sí el check loose del editor (`Array.isArray(sections)`), así el toggle
 * visual/JSON aparece desde el inicio y "Guardar" queda deshabilitado hasta
 * que la definición sea válida. Misma forma que `ensureDefaultChecklist`.
 */
export function buildSkeletonDefinition(activityId: string, title: string): ChecklistDefinition {
  return {
    code: `pdtp_${activityId}`,
    version: "01",
    revisionDate: new Date().toISOString().slice(0, 10),
    title,
    tipo: "nuevo",
    legalFramework: [],
    applicableTo: "",
    sections: [],
    closingAct: {
      title: "Cierre de verificación",
      resultOptions: [
        { value: "conforme", label: "Conforme" },
        { value: "observacion", label: "Con observaciones" },
        { value: "no_conforme", label: "No conforme" },
      ],
      signatureRoles: ["prevencionista_faena"],
    },
  }
}

export function reorder<T>(list: T[], index: number, dir: -1 | 1): T[] {
  const target = index + dir
  if (target < 0 || target >= list.length) return list
  const next = [...list]
  ;[next[index], next[target]] = [next[target]!, next[index]!]
  return next
}

/** Mueve el elemento en `from` a la posición `to` (drag&drop, no solo adyacente). */
export function moveTo<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length || to < 0 || to >= list.length) return list
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item!)
  return next
}

/**
 * Reordenar por drag&drop nativo (HTML5 DnD, sin dependencias). El handle
 * inicia el drag (`draggable`); soltar sobre cualquier fila dispara `onReorder`.
 * Los botones subir/bajar siguen disponibles como alternativa accesible por
 * teclado — el drag&drop es un atajo, no reemplaza el control por botones.
 */
function useDragReorder(onReorder: (from: number, to: number) => void) {
  const dragIndex = React.useRef<number | null>(null)
  return {
    handleDragStart: (index: number) => () => { dragIndex.current = index },
    handleDragOver: (e: React.DragEvent) => e.preventDefault(),
    handleDrop: (index: number) => (e: React.DragEvent) => {
      e.preventDefault()
      if (dragIndex.current !== null && dragIndex.current !== index) onReorder(dragIndex.current, index)
      dragIndex.current = null
    },
  }
}

/** Convierte las opciones (select/multiselect) desde/hacia un textarea "valor: etiqueta" por línea. */
export function optionsToText(options?: ChecklistItem["options"]): string {
  return (options ?? []).map((o) => `${o.value}: ${o.label}`).join("\n")
}
export function textToOptions(text: string): ChecklistItem["options"] {
  return text.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const [value, ...rest] = line.split(":")
    return { value: (value ?? "").trim(), label: rest.join(":").trim() || (value ?? "").trim() }
  })
}

/**
 * Valida el texto "valor: etiqueta" de las opciones (F11). Avisos NO
 * bloqueantes: el schema acepta opciones con label repetido o "value: value",
 * pero eso suele ser un error de tipeo que conviene señalar antes de guardar.
 */
export function validateOptionsText(text: string): { valid: boolean; issues: string[] } {
  const issues: string[] = []
  const seen = new Set<string>()
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim()
    if (!line) continue
    const [value, ...rest] = line.split(":")
    const v = (value ?? "").trim()
    const label = rest.join(":").trim()
    if (!v) {
      issues.push(`La línea «${line}» no tiene valor.`)
    } else if (!label) {
      issues.push(`La línea «${line}» no tiene etiqueta.`)
    }
    if (v && seen.has(v)) {
      issues.push(`El valor «${v}» está repetido.`)
    }
    if (v) seen.add(v)
  }
  return { valid: issues.length === 0, issues }
}

/** Duplica un ítem con id nuevo y sufijo "(copia)" para distinguirlo del original (F8). */
export function duplicateItem(item: ChecklistItem): ChecklistItem {
  return { ...item, id: nanoid(), label: `${item.label} (copia)` }
}

/** Duplica una sección completa: id nuevo, ítems duplicados con ids nuevos (F8). */
export function duplicateSection(section: ChecklistSection): ChecklistSection {
  return { ...section, id: nanoid(), title: `${section.title} (copia)`, items: section.items.map(duplicateItem) }
}

/**
 * Clona la plantilla de otra actividad como punto de partida (F12): code
 * apuntando a la actividad destino, revisionDate hoy e ids de secciones/ítems
 * regenerados para no colisionar con la fuente.
 */
export function cloneDefinitionForActivity(source: ChecklistDefinition, activityId: string): ChecklistDefinition {
  return {
    ...source,
    code: `pdtp_${activityId}`,
    revisionDate: new Date().toISOString().slice(0, 10),
    sections: source.sections.map((s) => ({ ...s, id: nanoid(), items: s.items.map((i) => ({ ...i, id: nanoid() })) })),
  }
}

export function ChecklistBuilder({ definition, onChange }: {
  definition: ChecklistDefinition
  onChange: (next: ChecklistDefinition) => void
}) {
  function updateSection(index: number, patch: Partial<ChecklistSection>) {
    const sections = [...definition.sections]
    sections[index] = { ...sections[index]!, ...patch }
    onChange({ ...definition, sections })
  }
  function moveSection(index: number, dir: -1 | 1) {
    onChange({ ...definition, sections: reorder(definition.sections, index, dir) })
  }
  function duplicateSectionAt(index: number) {
    const sections = [...definition.sections]
    sections.splice(index + 1, 0, duplicateSection(definition.sections[index]!))
    onChange({ ...definition, sections })
  }
  const addSectionRef = React.useRef<HTMLButtonElement | null>(null)
  function removeSection(index: number) {
    onChange({ ...definition, sections: definition.sections.filter((_, i) => i !== index) })
    // Deferido: si el borrado vino del ConfirmDialog, hay que dejar que Radix
    // haga su focus-restore (que apunta al botón ya desmontado) y luego
    // reenfocar de forma determinista al CTA de agregar.
    setTimeout(() => addSectionRef.current?.focus(), 0)
  }
  function addSection() {
    const section: ChecklistSection = { id: nanoid(), title: "Nueva sección", items: [] }
    onChange({ ...definition, sections: [...definition.sections, section] })
  }

  const sectionDrag = useDragReorder((from, to) => onChange({ ...definition, sections: moveTo(definition.sections, from, to) }))

  const itemCount = definition.sections.reduce((sum, sec) => sum + sec.items.length, 0)
  const emptySections = definition.sections.filter((sec) => sec.items.length === 0)

  return (
    <div className="space-y-3">
      {/* F4 — panel de configuración visual: título, tipo, frecuencia, marco
          legal, cierre y firmas (antes solo editables en JSON). */}
      <ConfigPanel definition={definition} onChange={onChange} />
      {/* F9 — resumen del builder para orientarse en checklists largos. */}
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
        <span>
          {definition.sections.length} {definition.sections.length === 1 ? "sección" : "secciones"} · {itemCount} {itemCount === 1 ? "ítem" : "ítems"}
        </span>
        {emptySections.length > 0 && (
          <span className="rounded-full border border-[var(--color-warning-line)] bg-[var(--color-warning-tint)] px-2 py-0.5 font-medium text-[var(--color-warning-ink)]">
            {emptySections.length} {emptySections.length === 1 ? "sección sin ítems" : "secciones sin ítems"} — bloquea el guardado
          </span>
        )}
      </div>
      {definition.sections.length === 0 && (
        <p className="text-xs text-[var(--color-text-muted)]">Sin secciones. Agrega al menos una.</p>
      )}
      {definition.sections.map((section, index) => (
        <div key={section.id} onDragOver={sectionDrag.handleDragOver} onDrop={sectionDrag.handleDrop(index)}>
          <SectionEditor
            section={section}
            onChange={(patch) => updateSection(index, patch)}
            onMoveUp={index > 0 ? () => moveSection(index, -1) : undefined}
            onMoveDown={index < definition.sections.length - 1 ? () => moveSection(index, 1) : undefined}
            onRemove={() => removeSection(index)}
            onDuplicate={() => duplicateSectionAt(index)}
            onDragHandleStart={sectionDrag.handleDragStart(index)}
          />
        </div>
      ))}
      <Button ref={addSectionRef} type="button" variant="secondary" size="sm" onClick={addSection}>
        <Plus size={14} weight="bold" className="mr-1" />
        Agregar sección
      </Button>
    </div>
  )
}

/** Cierre por defecto si la definición viene sin closingAct (defensivo). */
const DEFAULT_CLOSING_ACT: ClosingActDefinition = {
  title: "Cierre de verificación",
  resultOptions: [{ value: "conforme", label: "Conforme" }],
  signatureRoles: ["prevencionista_faena"],
}

/**
 * Panel de configuración de la definición (F4): campos de checklist que antes
 * solo se podían editar en JSON (título, tipo, frecuencia, marco legal, cierre
 * y firmas). Se renderiza plegado para no robar espacio a las secciones.
 */
function ConfigPanel({ definition, onChange }: {
  definition: ChecklistDefinition
  onChange: (next: ChecklistDefinition) => void
}) {
  const closingAct = definition.closingAct ?? DEFAULT_CLOSING_ACT
  const closingOptionsText = optionsToText(closingAct.resultOptions)
  const closingOptionsValidation = validateOptionsText(closingOptionsText)
  // useId para que los labels del panel no colisionen entre filas de actividades.
  const baseId = React.useId()

  function patch(p: Partial<ChecklistDefinition>) {
    onChange({ ...definition, ...p })
  }
  function patchClosing(p: Partial<ClosingActDefinition>) {
    onChange({ ...definition, closingAct: { ...closingAct, ...p } })
  }

  return (
    <details className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-2)]">
      <summary className="cursor-pointer px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-subtle)] select-none">
        Configuración del checklist
      </summary>
      <div className="space-y-3 border-t border-[var(--color-border)] p-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Título" htmlFor={`${baseId}-title`}>
            <Input id={`${baseId}-title`} value={definition.title} onChange={(e) => patch({ title: e.target.value })} />
          </Field>
          <Field label="Tipo" htmlFor={`${baseId}-tipo`}>
            <Select value={definition.tipo} onValueChange={(v) => patch({ tipo: v as ChecklistDefinition["tipo"] })}>
              <SelectTrigger id={`${baseId}-tipo`} className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="nuevo">Nuevo</SelectItem>
                <SelectItem value="seguimiento">Seguimiento</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
        <Field label="Subtítulo" htmlFor={`${baseId}-subtitle`} helper="Opcional.">
          <Input id={`${baseId}-subtitle`} value={definition.subtitle ?? ""} onChange={(e) => patch({ subtitle: e.target.value || undefined })} />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Frecuencia sugerida" htmlFor={`${baseId}-freq`}>
            <Input id={`${baseId}-freq`} value={definition.frequencySuggested ?? ""} onChange={(e) => patch({ frequencySuggested: e.target.value || undefined })} />
          </Field>
          <Field label="Aplica a" htmlFor={`${baseId}-applies`}>
            <Input id={`${baseId}-applies`} value={definition.applicableTo ?? ""} onChange={(e) => patch({ applicableTo: e.target.value })} />
          </Field>
        </div>
        <Field label="Objetivo" htmlFor={`${baseId}-objective`}>
          <Textarea id={`${baseId}-objective`} value={definition.objective ?? ""} onChange={(e) => patch({ objective: e.target.value || undefined })} rows={2} />
        </Field>
        <Field label="Criterios de evaluación" htmlFor={`${baseId}-criteria`}>
          <Textarea id={`${baseId}-criteria`} value={definition.evaluationCriteria ?? ""} onChange={(e) => patch({ evaluationCriteria: e.target.value || undefined })} rows={2} />
        </Field>
        <Field label="Marco legal" htmlFor={`${baseId}-legal`} helper="Uno por línea.">
          <Textarea
            id={`${baseId}-legal`}
            value={(definition.legalFramework ?? []).join("\n")}
            onChange={(e) => patch({ legalFramework: e.target.value.split("\n").map((l) => l.trim()).filter(Boolean) })}
            rows={2}
            className="font-mono text-xs"
          />
        </Field>
        <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-subtle)]">Cierre de verificación</p>
          <div className="mt-2 space-y-3">
            <Field label="Título del cierre" htmlFor={`${baseId}-closing-title`}>
              <Input id={`${baseId}-closing-title`} value={closingAct.title} onChange={(e) => patchClosing({ title: e.target.value })} />
            </Field>
            <Field label="Opciones de resultado" htmlFor={`${baseId}-closing-options`} helper="Una por línea, formato 'valor: etiqueta'.">
              <Textarea
                id={`${baseId}-closing-options`}
                value={closingOptionsText}
                onChange={(e) => patchClosing({ resultOptions: textToOptions(e.target.value) })}
                rows={3}
                className="font-mono text-xs"
              />
              {closingOptionsText.trim() !== "" && !closingOptionsValidation.valid && (
                <p className="mt-1 text-xs text-[var(--color-warning-ink)]">{closingOptionsValidation.issues.join(" · ")}</p>
              )}
            </Field>
            <Field label="Roles que firman" helper="Vacío = no se exige firma.">
              <div className="flex flex-wrap gap-3">
                {ROLE_OPTIONS.map((role) => (
                  <Checkbox
                    key={role.value}
                    label={role.label}
                    checked={(closingAct.signatureRoles ?? []).includes(role.value)}
                    onChange={(e) => {
                      const current = closingAct.signatureRoles ?? []
                      const next = e.target.checked ? [...current, role.value] : current.filter((r) => r !== role.value)
                      patchClosing({ signatureRoles: next })
                    }}
                  />
                ))}
              </div>
            </Field>
          </div>
        </div>
      </div>
    </details>
  )
}

function SectionEditor({ section, onChange, onMoveUp, onMoveDown, onRemove, onDuplicate, onDragHandleStart }: {
  section: ChecklistSection
  onChange: (patch: Partial<ChecklistSection>) => void
  onMoveUp?: () => void
  onMoveDown?: () => void
  onRemove: () => void
  onDuplicate: () => void
  onDragHandleStart: () => void
}) {
  const [confirmingRemove, setConfirmingRemove] = React.useState(false)
  const addItemRef = React.useRef<HTMLButtonElement | null>(null)

  function updateItem(index: number, patch: Partial<ChecklistItem>) {
    const items = [...section.items]
    items[index] = { ...items[index]!, ...patch }
    onChange({ items })
  }
  function moveItem(index: number, dir: -1 | 1) {
    onChange({ items: reorder(section.items, index, dir) })
  }
  function duplicateItemAt(index: number) {
    const items = [...section.items]
    items.splice(index + 1, 0, duplicateItem(items[index]!))
    onChange({ items })
  }
  function removeItem(index: number) {
    onChange({ items: section.items.filter((_, i) => i !== index) })
    // Deferido por la misma razón que removeSection (F10): dejar que Radix
    // cierre el diálogo antes de reenfocar el CTA de agregar ítem.
    setTimeout(() => addItemRef.current?.focus(), 0)
  }
  function addItem() {
    const item: ChecklistItem = { id: nanoid(), label: "Nuevo ítem", kind: "cumple_nocumple_obs" }
    onChange({ items: [...section.items, item] })
  }

  const itemDrag = useDragReorder((from, to) => onChange({ items: moveTo(section.items, from, to) }))

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
      <div className="flex items-start gap-2">
        {/* Handle de drag (F7): span aria-hidden, no un botón sin acción. La
            vía accesible de reordenar son los botones subir/bajar. */}
        <span
          draggable
          onDragStart={onDragHandleStart}
          aria-hidden="true"
          className="mt-1 cursor-grab text-[var(--color-text-muted)] active:cursor-grabbing"
        >
          <DotsSixVertical size={16} weight="bold" />
        </span>
        <div className="flex flex-1 flex-col gap-2">
          <Input
            value={section.title}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder="Título de la sección"
            className="font-medium"
          />
          <div className="flex flex-wrap items-center gap-3">
            {/* `undefined` cuenta para el motor (getApplicableItems trata
                `countsForCompliance ?? true`), así que la casilla debe verse
                marcada. Antes mostraba `?? false`: toda sección nueva aparecía
                desmarcada mientras sí puntuaba, y marcar+desmarcar escribía un
                `false` explícito que la sacaba del denominador en silencio. */}
            <Checkbox
              label="Cuenta para el % de cumplimiento"
              checked={section.countsForCompliance ?? true}
              onChange={(e) => onChange({ countsForCompliance: e.target.checked })}
            />
          </div>
          <Field label="Aplica solo a estos roles" helper="Vacío = aplica a todos.">
            <div className="flex flex-wrap gap-3">
              {ROLE_OPTIONS.map((role) => (
                <Checkbox
                  key={role.value}
                  label={role.label}
                  checked={(section.appliesWhen ?? []).includes(role.value)}
                  onChange={(e) => {
                    const current = section.appliesWhen ?? []
                    const next = e.target.checked ? [...current, role.value] : current.filter((r) => r !== role.value)
                    onChange({ appliesWhen: next.length > 0 ? next : undefined })
                  }}
                />
              ))}
            </div>
          </Field>
        </div>
        <div className="flex shrink-0 flex-col gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={onMoveUp} disabled={!onMoveUp} aria-label="Subir sección">
            <ArrowUp size={14} />
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onMoveDown} disabled={!onMoveDown} aria-label="Bajar sección">
            <ArrowDown size={14} />
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onDuplicate} aria-label="Duplicar sección">
            <Copy size={14} />
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmingRemove(true)} aria-label="Eliminar sección">
            <Trash size={14} className="text-[var(--color-danger)]" />
          </Button>
        </div>
      </div>

      <div className="mt-3 space-y-2 border-t border-[var(--color-border)] pt-3">
        {section.items.length === 0 && (
          <p className="text-xs text-[var(--color-text-muted)]">Sin ítems. Agrega al menos uno.</p>
        )}
        {section.items.map((item, index) => (
          <div key={item.id} onDragOver={itemDrag.handleDragOver} onDrop={itemDrag.handleDrop(index)}>
            <ItemEditor
              item={item}
              onChange={(patch) => updateItem(index, patch)}
              onMoveUp={index > 0 ? () => moveItem(index, -1) : undefined}
              onMoveDown={index < section.items.length - 1 ? () => moveItem(index, 1) : undefined}
              onRemove={() => removeItem(index)}
              onDuplicate={() => duplicateItemAt(index)}
              onDragHandleStart={itemDrag.handleDragStart(index)}
            />
          </div>
        ))}
        <Button ref={addItemRef} type="button" variant="ghost" size="sm" onClick={addItem}>
          <Plus size={14} weight="bold" className="mr-1" />
          Agregar ítem
        </Button>
      </div>

      <ConfirmDialog
        open={confirmingRemove}
        onOpenChange={setConfirmingRemove}
        title="Eliminar sección"
        description={`Se eliminará la sección «${section.title || "sin título"}» y sus ${section.items.length} ítems. Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar"
        variant="destructive"
        onConfirm={() => { setConfirmingRemove(false); onRemove() }}
      />
    </div>
  )
}

function ItemEditor({ item, onChange, onMoveUp, onMoveDown, onRemove, onDuplicate, onDragHandleStart }: {
  item: ChecklistItem
  onChange: (patch: Partial<ChecklistItem>) => void
  onMoveUp?: () => void
  onMoveDown?: () => void
  onRemove: () => void
  onDuplicate: () => void
  onDragHandleStart: () => void
}) {
  const [confirmingRemove, setConfirmingRemove] = React.useState(false)
  const needsOptions = item.kind === "select" || item.kind === "multiselect"
  const optionsText = optionsToText(item.options)
  const optionsValidation = validateOptionsText(optionsText)

  return (
    <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
      <div className="flex items-start gap-2">
        {/* Handle de drag (F7): span aria-hidden, no un botón sin acción. */}
        <span
          draggable
          onDragStart={onDragHandleStart}
          aria-hidden="true"
          className="mt-1 cursor-grab text-[var(--color-text-muted)] active:cursor-grabbing"
        >
          <DotsSixVertical size={14} weight="bold" />
        </span>
        <div className="flex flex-1 flex-col gap-2">
          <Input
            value={item.label}
            onChange={(e) => onChange({ label: e.target.value })}
            placeholder="Etiqueta del ítem"
          />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Select value={item.kind} onValueChange={(v) => onChange({ kind: v as FieldKind })}>
              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {FIELD_KIND_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={item.danoPotencial ?? ""}
              onValueChange={(v) => onChange({ danoPotencial: (v || undefined) as ChecklistItem["danoPotencial"] })}
            >
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Daño potencial: sin clasificar" /></SelectTrigger>
              <SelectContent>
                {DANO_POTENCIAL_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {needsOptions && (
            <Field label="Opciones" helper="Una por línea, formato 'valor: etiqueta'.">
              <Textarea
                value={optionsText}
                onChange={(e) => onChange({ options: textToOptions(e.target.value) })}
                rows={3}
                className="font-mono text-xs"
              />
              {optionsText.trim() !== "" && !optionsValidation.valid && (
                <p className="mt-1 text-xs text-[var(--color-warning-ink)]">{optionsValidation.issues.join(" · ")}</p>
              )}
            </Field>
          )}
          <Checkbox
            label="Requerido"
            checked={item.required ?? false}
            onChange={(e) => onChange({ required: e.target.checked })}
          />
        </div>
        <div className="flex shrink-0 flex-col gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={onMoveUp} disabled={!onMoveUp} aria-label="Subir ítem">
            <ArrowUp size={12} />
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onMoveDown} disabled={!onMoveDown} aria-label="Bajar ítem">
            <ArrowDown size={12} />
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onDuplicate} aria-label="Duplicar ítem">
            <Copy size={12} />
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmingRemove(true)} aria-label="Eliminar ítem">
            <Trash size={12} className="text-[var(--color-danger)]" />
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmingRemove}
        onOpenChange={setConfirmingRemove}
        title="Eliminar ítem"
        description={`Se eliminará el ítem «${item.label || "sin título"}». Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar"
        variant="destructive"
        onConfirm={() => { setConfirmingRemove(false); onRemove() }}
      />
    </div>
  )
}
