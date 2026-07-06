"use client"

import { useState } from "react"
import { NotePencil } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { DatePicker } from "@/components/ui/date-picker"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import type { ChecklistItem, FieldKind, StatusValue } from "@/lib/sst/types"
import { cn } from "@/lib/utils"
import type { ItemResponse } from "./checklist-section"

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
  const base = "h-8 px-3 text-xs font-semibold rounded-(--radius) border transition-[background-color,border-color,color,transform,box-shadow] duration-150 ease-[var(--ease-out)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-primary) focus-visible:ring-offset-1 "
  const colors = {
    positive: active
      ? "bg-(--color-success) text-white border-(--color-success) shadow-[inset_0_1px_0_rgba(255,255,255,0.24)]"
      : "bg-(--color-surface) border-(--color-border) text-text-subtle hover:border-(--color-success-line) hover:text-(--color-success)",
    negative: active
      ? "bg-(--color-danger) text-white border-(--color-danger) shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]"
      : "bg-(--color-surface) border-(--color-border) text-text-subtle hover:border-(--color-danger-line) hover:text-(--color-danger)",
    neutral: active
      ? "bg-(--color-surface-3) text-(--color-text) border-(--color-border-strong) shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]"
      : "bg-(--color-surface) border-(--color-border) text-text-subtle hover:border-(--color-border-strong)",
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

export function ItemField({
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
  const [notesOpen, setNotesOpen] = useState(false)
  const [noteDraft, setNoteDraft] = useState(resp.observacion)
  const hasObservation = Boolean(resp.observacion.trim())
  const needsCorrectiveAction = ["cumple_nocumple_obs", "cumple_nocumple_na_obs"].includes(item.kind) && resp.estado === "no_cumple"

  function setEstado(estado: StatusValue) {
    onChange({ estado: resp.estado === estado ? null : estado })
  }

  function handleNoteOpenChange(open: boolean) {
    setNotesOpen(open)
    if (open) setNoteDraft(resp.observacion)
  }

  function saveNote() {
    onChange({ observacion: noteDraft.trim() })
    setNotesOpen(false)
  }

  function removeNote() {
    setNoteDraft("")
    onChange({ observacion: "" })
    setNotesOpen(false)
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
      <div className="space-y-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          <div
            role="group"
            aria-label={item.label}
            className="flex flex-wrap items-center gap-1.5"
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
          {!readOnly && (
            <Dialog open={notesOpen} onOpenChange={handleNoteOpenChange}>
              <DialogTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "inline-flex h-8 w-fit items-center gap-1.5 rounded-(--radius) border px-2.5 text-xs font-semibold",
                    "transition-[background-color,border-color,color,transform] duration-150 ease-[var(--ease-out)] ",
                    hasObservation
                      ? "border-(--color-primary-line) bg-(--color-primary-tint) text-(--color-primary)"
                      : "border-(--color-border) bg-(--color-surface) text-text-subtle hover:border-(--color-border-strong) hover:text-(--color-text)"
                  )}
                >
                  <NotePencil size={14} weight="bold" aria-hidden="true" />
                  {hasObservation ? "Editar nota" : "Agregar nota"}
                </button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-xl">
                <DialogHeader>
                  <DialogTitle>{hasObservation ? "Editar nota" : "Agregar nota"}</DialogTitle>
                  <DialogDescription>
                    Registra una observación breve para este punto de la evaluación.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface-2) px-3 py-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-text-subtle">Ítem</p>
                    <p className="mt-1 text-sm font-medium leading-5 text-(--color-text)">{item.label}</p>
                  </div>
                  <div className="grid gap-1.5">
                    <label className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
                      Observación
                    </label>
                    <Textarea
                      autoFocus
                      placeholder="Agrega una nota breve..."
                      value={noteDraft}
                      onChange={(e) => setNoteDraft(e.target.value)}
                      rows={5}
                      className="min-h-32 text-sm"
                      maxLength={500}
                    />
                    <p className="text-right text-[11px] text-text-subtle">{noteDraft.length}/500</p>
                  </div>
                </div>
                <DialogFooter className="flex-col-reverse sm:flex-row sm:items-center sm:justify-between">
                  {hasObservation ? (
                    <Button type="button" variant="ghost" onClick={removeNote} className="sm:mr-auto">
                      Quitar nota
                    </Button>
                  ) : (
                    <span />
                  )}
                  <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <Button type="button" variant="secondary" onClick={() => setNotesOpen(false)}>
                      Cancelar
                    </Button>
                    <Button type="button" onClick={saveNote}>
                      Guardar nota
                    </Button>
                  </div>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
        {hasObservation && (
          <p className="rounded-(--radius) border border-(--color-border) bg-(--color-surface-2) px-2.5 py-1.5 text-left text-xs leading-5 text-(--color-text-muted)">
            {resp.observacion}
          </p>
        )}
        {needsCorrectiveAction && (
          <div className="grid gap-1.5 rounded-(--radius-lg) border border-(--color-danger-line) bg-(--color-danger-tint) p-3">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-(--color-danger)">
              Acción correctiva requerida
            </label>
            <Textarea
              placeholder="Define responsable, acción y plazo..."
              value={resp.accionCorrectiva}
              onChange={(e) => onChange({ accionCorrectiva: e.target.value })}
              disabled={readOnly}
              rows={2}
              className="min-h-16 bg-(--color-surface) text-xs"
              maxLength={500}
            />
          </div>
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
      <DatePicker
        value={resp.observacion}
        onChange={(iso) => onChange({ observacion: iso })}
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
              "h-8 px-3 rounded-(--radius) border text-xs font-medium transition-[background-color,border-color,color,transform] duration-150 ease-[var(--ease-out)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-primary) focus-visible:ring-offset-1 ",
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
