"use client"

import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { INSPECTION_KIND_LABELS } from "@/lib/prevention/inspections"

export interface InspectionTemplateSelectOption {
  id: string
  name: string
  versionLabel: string
  kind?: string | null
}

export interface InspectionTemplateGroup<T extends InspectionTemplateSelectOption> {
  kind: string
  label: string
  items: T[]
}

const KIND_ORDER = Object.keys(INSPECTION_KIND_LABELS)

/* El listado se leía "Inspección · Inspección de Carros · 03" una y otra vez y
 * en el orden en que llegaban de la base. Se agrupa por tipo (en el orden del
 * catálogo de tipos; uno desconocido va al final) y se ordena por nombre, así el
 * tipo se dice una vez y el nombre es lo primero que se lee. */
export function groupTemplatesByKind<T extends InspectionTemplateSelectOption>(templates: T[]): InspectionTemplateGroup<T>[] {
  const byKind = new Map<string, T[]>()
  for (const item of templates) {
    const kind = item.kind ?? ""
    byKind.set(kind, [...(byKind.get(kind) ?? []), item])
  }
  const rank = (kind: string) => {
    const index = KIND_ORDER.indexOf(kind)
    return index === -1 ? KIND_ORDER.length : index
  }
  return [...byKind.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b, "es"))
    .map(([kind, items]) => ({
      kind,
      label: INSPECTION_KIND_LABELS[kind] ?? kind,
      items: [...items].sort((a, b) =>
        a.name.localeCompare(b.name, "es", { sensitivity: "base" }) || a.versionLabel.localeCompare(b.versionLabel, "es")),
    }))
}

export function InspectionTemplateSelect({ templates, value, onValueChange }: {
  templates: InspectionTemplateSelectOption[]
  value: string
  onValueChange: (value: string) => void
}) {
  const groups = groupTemplatesByKind(templates)
  // Con un solo tipo el rótulo no distingue nada: sería ruido sobre la lista.
  const showLabels = groups.length > 1

  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger aria-label="Plantilla"><SelectValue placeholder="Selecciona una plantilla" /></SelectTrigger>
      <SelectContent>
        {groups.map((group) => (
          <SelectGroup key={group.kind}>
            {showLabels && group.label && <SelectLabel>{group.label}</SelectLabel>}
            {group.items.map((item) => (
              // La versión queda como dato secundario, pero dentro del texto de la
              // opción: " · versión" sigue en su nombre accesible y en la búsqueda.
              <SelectItem key={item.id} value={item.id} textValue={`${item.name} · ${item.versionLabel}`}>
                {item.name}<span className="text-xs text-[var(--color-text-muted)]"> · {item.versionLabel}</span>
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  )
}
