"use client"

import { ItemField } from "./checklist-section-item"
import type { ChecklistSection, StatusValue } from "@/lib/sst/types"
import { cn } from "@/lib/utils"

export interface ItemResponse {
  estado: StatusValue
  observacion: string
  accionCorrectiva: string
}

interface Props {
  section: ChecklistSection
  responses: Record<string, ItemResponse>  // key: itemId
  readOnly: boolean
  onChange: (seccionId: string, itemId: string, patch: Partial<ItemResponse>) => void
}

export function ChecklistSectionPanel({ section, responses, readOnly, onChange }: Props) {
  return (
    <section className="space-y-4">
      {section.description && (
        <p className="text-sm text-(--color-text-muted)">{section.description}</p>
      )}
      <div className="overflow-hidden rounded-(--radius-xl) border border-(--color-border) bg-(--color-surface)">
        {section.items.map((item) => {
          const resp = responses[item.id] ?? { estado: null, observacion: "", accionCorrectiva: "" }
          const answered = resp.estado !== null || Boolean(resp.observacion)
          return (
            <div
              key={item.id}
              className="grid gap-3 border-b border-(--color-border) px-4 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_minmax(280px,auto)] sm:items-start"
            >
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-medium leading-5 text-(--color-text)">{item.label}</p>
                <p className={cn(
                  "text-xs font-medium",
                  answered ? "text-text-subtle" : "text-(--color-warning)"
                )}>
                  {answered ? "Registrado" : "Pendiente de respuesta"}
                </p>
              </div>
              <div className="min-w-0 sm:justify-self-end sm:text-right">
                <ItemField
                  item={item}
                  resp={resp}
                  readOnly={readOnly}
                  onChange={(patch) => onChange(section.id, item.id, patch)}
                />
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
