"use client"

import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import type { ChecklistSection, ChecklistItem, FieldKind, StatusValue } from "@/lib/sst/types"
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

function StatusButton({
  active,
  onClick,
  disabled,
  variant,
  children,
}: {
  active: boolean
  onClick: () => void
  disabled: boolean
  variant: "positive" | "negative" | "neutral"
  children: React.ReactNode
}) {
  const base = "px-3 py-1.5 text-xs font-semibold rounded-(--radius) border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-primary) focus-visible:ring-offset-1"
  const colors = {
    positive: active
      ? "bg-(--color-success) text-(--color-success-ink) border-(--color-success) font-bold"
      : "border-(--color-border) text-text-subtle hover:border-(--color-success-line) hover:text-(--color-success)",
    negative: active
      ? "bg-(--color-danger) text-(--color-danger-ink) border-(--color-danger) font-bold"
      : "border-(--color-border) text-text-subtle hover:border-(--color-danger-line) hover:text-(--color-danger)",
    neutral: active
      ? "bg-(--color-surface-3) text-(--color-text) border-(--color-border-strong) font-bold"
      : "border-(--color-border) text-text-subtle hover:border-(--color-border-strong)",
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={active}
      className={cn(base, colors[variant], disabled && "opacity-50 cursor-not-allowed")}
    >
      {children}
    </button>
  )
}

function ItemField({
  item,
  resp,
  readOnly,
  onChange,
}: {
  item: ChecklistItem
  resp: ItemResponse
  readOnly: boolean
  onChange: (patch: Partial<ItemResponse>) => void
}) {
  const kind: FieldKind = item.kind

  function setEstado(estado: StatusValue) {
    onChange({ estado: resp.estado === estado ? null : estado })
  }

  const renderStatusButtons = () => {
    const pairs: { value: StatusValue; label: string; variant: "positive" | "negative" | "neutral" }[] = []

    if (kind === "cumple_nocumple_obs" || kind === "cumple_nocumple_na_obs") {
      pairs.push({ value: "cumple",    label: "Cumple",    variant: "positive" })
      pairs.push({ value: "no_cumple", label: "No cumple", variant: "negative" })
      if (kind === "cumple_nocumple_na_obs") {
        pairs.push({ value: "na", label: "N/A", variant: "neutral" })
      }
    } else if (kind === "entregado_obs") {
      pairs.push({ value: "entregado",    label: "Entregado",    variant: "positive" })
      pairs.push({ value: "no_entregado", label: "No entregado", variant: "negative" })
    } else if (kind === "apto_obs") {
      pairs.push({ value: "apto",    label: "Apto",    variant: "positive" })
      pairs.push({ value: "no_apto", label: "No apto", variant: "negative" })
    } else if (kind === "si_no_obs") {
      pairs.push({ value: "si", label: "Sí", variant: "positive" })
      pairs.push({ value: "no", label: "No", variant: "negative" })
    }

    return (
      <div className="flex flex-col gap-2">
        <div
          role="group"
          aria-label={item.label}
          className="flex items-center gap-2 flex-wrap"
        >
          {pairs.map((p) => (
            <StatusButton
              key={p.value}
              active={resp.estado === p.value}
              onClick={() => setEstado(p.value)}
              disabled={readOnly}
              variant={p.variant}
            >
              {p.label}
            </StatusButton>
          ))}
        </div>
        {(resp.estado !== null || resp.observacion) && (
          <Textarea
            placeholder="Observación (opcional)…"
            value={resp.observacion}
            onChange={(e) => onChange({ observacion: e.target.value })}
            disabled={readOnly}
            rows={2}
            className="text-xs"
            maxLength={500}
          />
        )}
        {item.kind === "cumple_nocumple_obs" && resp.estado === "no_cumple" && (
          <Textarea
            placeholder="Acción correctiva…"
            value={resp.accionCorrectiva}
            onChange={(e) => onChange({ accionCorrectiva: e.target.value })}
            disabled={readOnly}
            rows={2}
            className="text-xs"
            maxLength={500}
          />
        )}
      </div>
    )
  }

  if (["cumple_nocumple_obs", "cumple_nocumple_na_obs", "entregado_obs", "apto_obs", "si_no_obs"].includes(kind)) {
    return renderStatusButtons()
  }

  if (kind === "text") {
    return (
      <Input
        placeholder={item.placeholder ?? "Ingresa texto…"}
        value={resp.observacion}
        onChange={(e) => onChange({ observacion: e.target.value })}
        disabled={readOnly}
        maxLength={500}
      />
    )
  }

  if (kind === "date") {
    return (
      <Input
        type="date"
        value={resp.observacion}
        onChange={(e) => onChange({ observacion: e.target.value })}
        disabled={readOnly}
      />
    )
  }

  if (kind === "select" && item.options) {
    return (
      <Select
        value={resp.observacion}
        onValueChange={(val) => onChange({ observacion: val })}
        disabled={readOnly}
      >
        <SelectTrigger>
          <SelectValue placeholder="Selecciona…" />
        </SelectTrigger>
        <SelectContent>
          {item.options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  if (kind === "multiselect" && item.options) {
    const selected = resp.observacion ? resp.observacion.split(",") : []
    function toggleOption(val: string) {
      const next = selected.includes(val)
        ? selected.filter((v) => v !== val)
        : [...selected, val]
      onChange({ observacion: next.join(",") })
    }
    return (
      <div
        role="group"
        aria-label={item.label}
        className="flex flex-wrap gap-2"
      >
        {item.options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            disabled={readOnly}
            onClick={() => toggleOption(opt.value)}
            aria-pressed={selected.includes(opt.value)}
            className={cn(
              "px-3 py-1.5 rounded-(--radius) border text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-primary) focus-visible:ring-offset-1",
              selected.includes(opt.value)
                ? "bg-(--color-primary) text-(--color-primary-ink) border-(--color-primary)"
                : "border-(--color-border) text-text-subtle hover:border-border-strong",
              readOnly && "opacity-50 cursor-not-allowed"
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    )
  }

  if (kind === "readonly") {
    return (
      <p className="text-sm text-text-subtle italic">{item.label}</p>
    )
  }

  if (kind === "signature") {
    return (
      <div className="h-16 rounded-(--radius) border-2 border-dashed border-(--color-border) flex items-center justify-center">
        <span className="text-xs text-text-subtle">Firma manual en acta impresa</span>
      </div>
    )
  }

  return null
}

export function ChecklistSectionPanel({ section, responses, readOnly, onChange }: Props) {
  return (
    <div className="space-y-4">
      {section.description && (
        <p className="text-sm text-(--color-text-muted)">{section.description}</p>
      )}
      <div className="divide-y divide-(--color-border)">
        {section.items.map((item) => {
          const resp = responses[item.id] ?? { estado: null, observacion: "", accionCorrectiva: "" }
          return (
            <div key={item.id} className="py-3 space-y-2">
              <p className="text-sm font-medium text-(--color-text)">{item.label}</p>
              <ItemField
                item={item}
                resp={resp}
                readOnly={readOnly}
                onChange={(patch) => onChange(section.id, item.id, patch)}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
