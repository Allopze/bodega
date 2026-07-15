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
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field } from "@/components/ui/field"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { ArrowUp, ArrowDown, DotsSixVertical, Trash, Plus } from "@phosphor-icons/react"
import type { ChecklistDefinition, ChecklistItem, ChecklistSection, FieldKind } from "@/lib/sst/types"
import { nanoid } from "@/lib/id"

const FIELD_KIND_OPTIONS: Array<{ value: FieldKind; label: string }> = [
  { value: "cumple_nocumple_obs", label: "Cumple / No cumple + observación" },
  { value: "cumple_nocumple_na_obs", label: "Cumple / No cumple / N/A + observación" },
  { value: "entregado_obs", label: "Entregado / No entregado + observación" },
  { value: "apto_obs", label: "Apto / No apto + observación" },
  { value: "si_no_obs", label: "Sí / No + observación" },
  { value: "text", label: "Texto libre" },
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

const ROLE_OPTIONS = ["prevencionista_faena", "admin_contrato", "jefe_faena"]

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
  function removeSection(index: number) {
    onChange({ ...definition, sections: definition.sections.filter((_, i) => i !== index) })
  }
  function addSection() {
    const section: ChecklistSection = { id: nanoid(), title: "Nueva sección", items: [] }
    onChange({ ...definition, sections: [...definition.sections, section] })
  }

  const sectionDrag = useDragReorder((from, to) => onChange({ ...definition, sections: moveTo(definition.sections, from, to) }))

  return (
    <div className="space-y-3">
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
            onDragHandleStart={sectionDrag.handleDragStart(index)}
          />
        </div>
      ))}
      <Button type="button" variant="secondary" size="sm" onClick={addSection}>
        <Plus size={14} weight="bold" className="mr-1" />
        Agregar sección
      </Button>
    </div>
  )
}

function SectionEditor({ section, onChange, onMoveUp, onMoveDown, onRemove, onDragHandleStart }: {
  section: ChecklistSection
  onChange: (patch: Partial<ChecklistSection>) => void
  onMoveUp?: () => void
  onMoveDown?: () => void
  onRemove: () => void
  onDragHandleStart: () => void
}) {
  function updateItem(index: number, patch: Partial<ChecklistItem>) {
    const items = [...section.items]
    items[index] = { ...items[index]!, ...patch }
    onChange({ items })
  }
  function moveItem(index: number, dir: -1 | 1) {
    onChange({ items: reorder(section.items, index, dir) })
  }
  function removeItem(index: number) {
    onChange({ items: section.items.filter((_, i) => i !== index) })
  }
  function addItem() {
    const item: ChecklistItem = { id: nanoid(), label: "Nuevo ítem", kind: "cumple_nocumple_obs" }
    onChange({ items: [...section.items, item] })
  }

  const itemDrag = useDragReorder((from, to) => onChange({ items: moveTo(section.items, from, to) }))

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
      <div className="flex items-start gap-2">
        <button
          type="button"
          draggable
          onDragStart={onDragHandleStart}
          aria-label="Arrastrar para reordenar sección"
          title="Arrastrar para reordenar"
          className="mt-1 cursor-grab text-[var(--color-text-muted)] active:cursor-grabbing"
        >
          <DotsSixVertical size={16} weight="bold" />
        </button>
        <div className="flex flex-1 flex-col gap-2">
          <Input
            value={section.title}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder="Título de la sección"
            className="font-medium"
          />
          <div className="flex flex-wrap items-center gap-3">
            <Checkbox
              label="Cuenta para el % de cumplimiento"
              checked={section.countsForCompliance ?? false}
              onChange={(e) => onChange({ countsForCompliance: e.target.checked })}
            />
          </div>
          <Field label="Aplica solo a estos roles" helper="Vacío = aplica a todos.">
            <div className="flex flex-wrap gap-3">
              {ROLE_OPTIONS.map((role) => (
                <Checkbox
                  key={role}
                  label={role}
                  checked={(section.appliesWhen ?? []).includes(role)}
                  onChange={(e) => {
                    const current = section.appliesWhen ?? []
                    const next = e.target.checked ? [...current, role] : current.filter((r) => r !== role)
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
          <Button type="button" variant="ghost" size="sm" onClick={onRemove} aria-label="Eliminar sección">
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
              onDragHandleStart={itemDrag.handleDragStart(index)}
            />
          </div>
        ))}
        <Button type="button" variant="ghost" size="sm" onClick={addItem}>
          <Plus size={14} weight="bold" className="mr-1" />
          Agregar ítem
        </Button>
      </div>
    </div>
  )
}

function ItemEditor({ item, onChange, onMoveUp, onMoveDown, onRemove, onDragHandleStart }: {
  item: ChecklistItem
  onChange: (patch: Partial<ChecklistItem>) => void
  onMoveUp?: () => void
  onMoveDown?: () => void
  onRemove: () => void
  onDragHandleStart: () => void
}) {
  const needsOptions = item.kind === "select" || item.kind === "multiselect"

  return (
    <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
      <div className="flex items-start gap-2">
        <button
          type="button"
          draggable
          onDragStart={onDragHandleStart}
          aria-label="Arrastrar para reordenar ítem"
          title="Arrastrar para reordenar"
          className="mt-1 cursor-grab text-[var(--color-text-muted)] active:cursor-grabbing"
        >
          <DotsSixVertical size={14} weight="bold" />
        </button>
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
                value={optionsToText(item.options)}
                onChange={(e) => onChange({ options: textToOptions(e.target.value) })}
                rows={3}
                className="font-mono text-xs"
              />
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
          <Button type="button" variant="ghost" size="sm" onClick={onRemove} aria-label="Eliminar ítem">
            <Trash size={12} className="text-[var(--color-danger)]" />
          </Button>
        </div>
      </div>
    </div>
  )
}
