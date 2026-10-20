"use client"

import * as React from "react"
import { CaretDown, CheckCircle, FileText, Paperclip, Plus, Trash } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Combobox } from "@/components/ui/combobox"
import { DatePicker } from "@/components/ui/date-picker"
import { DateTimePicker } from "@/components/ui/date-time-picker"
import { EmptyState } from "@/components/ui/empty-state"
import { Field, Label } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/ui/option-select"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { Textarea } from "@/components/ui/textarea"
import { RE20_ATTACHMENT_ACCEPT_MESSAGE, RE20_ATTACHMENT_LIMITS } from "@/lib/prevention/re20-attachment-limits"
import { cn, toLocalInputValue } from "@/lib/utils"
import { useRe20 } from "./use-re20-workspace"
import type { Re20CatalogOption } from "./types"
import { formatBytes } from "./workspace-data"

/* Primitivas de campo del expediente RE-20, sobre los componentes del sistema
 * (Field, Input, DatePicker, OptionSelect, Combobox, SegmentedControl,
 * EmptyState). Toda etapa las usa; ninguna arma su propio input.
 *
 * Contrato común:
 * - `id` es estable y único en el expediente (convención `re20-<etapa>-<campo>`):
 *   es el destino de los enlaces «Falta…» (`ws.focusField(id)`).
 * - `onChange` recibe el valor ya en la forma del esquema (cadena, ISO, booleano
 *   o `null` para «sin dato»).
 * - `disabled` es opcional: el `<fieldset disabled>` del modo sólo lectura ya
 *   deshabilita todo lo que está dentro.
 */

interface BaseFieldProps {
  id: string
  label: string
  helper?: string
  error?: string
  required?: boolean
  disabled?: boolean
  className?: string
}

/* ── Texto ───────────────────────────────────────────────────────────────── */

export function Re20Text({ id, label, helper, error, required, disabled, className, value, onChange, type = "text", placeholder, maxLength, inputMode, autoComplete }: BaseFieldProps & {
  value: string | null | undefined
  onChange: (value: string) => void
  type?: "text" | "time" | "email" | "tel" | "number"
  placeholder?: string
  maxLength?: number
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"]
  autoComplete?: string
}) {
  return (
    <Field label={label} htmlFor={id} helper={helper} error={error} required={required} className={className}>
      <Input
        id={id}
        type={type}
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        error={Boolean(error)}
        placeholder={placeholder}
        maxLength={maxLength}
        inputMode={inputMode}
        autoComplete={autoComplete ?? "off"}
        className={type === "time" ? "font-mono tabular-nums" : undefined}
      />
    </Field>
  )
}

export function Re20TextArea({ id, label, helper, error, required, disabled, className, value, onChange, rows = 3, placeholder, maxLength }: BaseFieldProps & {
  value: string | null | undefined
  onChange: (value: string) => void
  rows?: number
  placeholder?: string
  maxLength?: number
}) {
  return (
    <Field label={label} htmlFor={id} helper={helper} error={error} required={required} className={className}>
      <Textarea
        id={id}
        rows={rows}
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        error={Boolean(error)}
        placeholder={placeholder}
        maxLength={maxLength}
      />
    </Field>
  )
}

/* ── Fechas ──────────────────────────────────────────────────────────────── */

/** ISO con zona → `YYYY-MM-DDTHH:mm` local del navegador (no el corte en UTC que desplazaba la hora). */
export function isoToLocalInput(value: string | null | undefined): string {
  if (!value) return ""
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "" : toLocalInputValue(date)
}

/** `YYYY-MM-DDTHH:mm` local → ISO con zona, o `null` si quedó vacío. */
export function localInputToIso(value: string): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** Fecha y hora. Guarda ISO con zona (`dateTime` del esquema). */
export function Re20DateTime({ id, label, helper, error, required, disabled, className, value, onChange, min, max }: BaseFieldProps & {
  value: string | null | undefined
  onChange: (value: string | null) => void
  /** ISO con zona. */
  min?: string | null
  max?: string | null
}) {
  const describedBy = error || helper ? `${id}-${error ? "error" : "helper"}` : undefined
  return (
    <div id={id} role="group" aria-labelledby={`${id}-label`} className={cn("flex flex-col", className)}>
      <Label id={`${id}-label`} htmlFor={`${id}-date`} required={required}>{label}</Label>
      <DateTimePicker
        id={id}
        value={isoToLocalInput(value)}
        onChange={(next) => onChange(localInputToIso(next))}
        disabled={disabled}
        error={Boolean(error)}
        min={isoToLocalInput(min) || undefined}
        max={isoToLocalInput(max) || undefined}
        aria-describedby={describedBy}
      />
      <FieldMessage id={describedBy} error={error} helper={helper} />
    </div>
  )
}

/** Fecha calendario (`YYYY-MM-DD`, `plainDate` del esquema). */
export function Re20Date({ id, label, helper, error, required, disabled, className, value, onChange, min, max }: BaseFieldProps & {
  value: string | null | undefined
  onChange: (value: string | null) => void
  min?: string
  max?: string
}) {
  return (
    <Field label={label} htmlFor={id} helper={helper} error={error} required={required} className={className}>
      <DatePicker
        id={id}
        value={value ?? ""}
        onChange={(next) => onChange(next || null)}
        disabled={disabled}
        error={Boolean(error)}
        min={min}
        max={max}
        ariaLabel={label}
      />
    </Field>
  )
}

/* ── Catálogo ────────────────────────────────────────────────────────────── */

/** Con más opciones que esto la lista se busca (Combobox) en vez de recorrerse. */
const SEARCHABLE_FROM = 12

function catalogOptions(options: Re20CatalogOption[], category: string) {
  return options
    .filter((option) => option.category === category && option.isActive)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
}

/**
 * Lista del catálogo RE-20 (`category` = «temperature», «body_zone»…), en el
 * orden configurado. Guarda el NOMBRE de la opción, como el libro. Un valor que
 * ya no está activo se sigue mostrando, marcado como anterior.
 */
export function Re20CatalogSelect({ id, label, helper, error, required, disabled, className, category, value, onChange, emptyLabel = "Sin indicar", placeholder }: BaseFieldProps & {
  category: string
  value: string | null | undefined
  onChange: (value: string | null) => void
  emptyLabel?: string
  placeholder?: string
}) {
  const ws = useRe20()
  const items = React.useMemo(() => catalogOptions(ws.options, category), [ws.options, category])
  const current = value ?? ""
  const known = items.some((option) => option.name === current)
  const choices = [
    ...items.map((option) => ({ value: option.name, label: option.name })),
    ...(current && !known ? [{ value: current, label: `${current} (valor anterior)` }] : []),
  ]
  return (
    <Field label={label} htmlFor={id} helper={helper} error={error} required={required} className={className}>
      {choices.length > SEARCHABLE_FROM ? (
        <Combobox
          id={id}
          options={choices}
          value={current}
          onChange={(next) => onChange(next || null)}
          clearLabel={emptyLabel}
          placeholder={placeholder ?? "Busca o elige…"}
          disabled={disabled}
        />
      ) : (
        <OptionSelect
          id={id}
          options={choices}
          value={current}
          onValueChange={(next) => onChange(next || null)}
          emptyLabel={emptyLabel}
          placeholder={placeholder ?? "Elige una opción"}
          disabled={disabled}
          error={Boolean(error)}
        />
      )}
    </Field>
  )
}

/* ── Sí / No ─────────────────────────────────────────────────────────────── */

type YesNoProps = BaseFieldProps & (
  | {
    /** Sí / No guardado como booleano (`yesNo` del esquema). */
    variant?: "boolean"
    value: boolean | null | undefined
    onChange: (value: boolean | null) => void
  }
  | {
    /** Sí / No / No verificable (L_SNV) o Sí / No / No aplica (L_SNNA), guardado como texto. */
    variant: "unverified" | "not_applicable"
    value: string | null | undefined
    onChange: (value: string | null) => void
  }
)

const THIRD_OPTION = { unverified: "No verificable", not_applicable: "No aplica" } as const

/**
 * Respuesta cerrada con `SegmentedControl`. Volver a pulsar la opción elegida la
 * borra (sin dato). El `id` queda en el grupo: `focusField` enfoca su primer botón.
 */
export function Re20YesNo(props: YesNoProps) {
  const { id, label, helper, error, required, className } = props
  const messageId = error || helper ? `${id}-${error ? "error" : "helper"}` : undefined
  let items: Array<{ key: string; label: string; active: boolean; onClick: () => void }>
  if (props.variant === "unverified" || props.variant === "not_applicable") {
    const { value, onChange } = props
    items = ["Sí", "No", THIRD_OPTION[props.variant]].map((option) => ({
      key: option,
      label: option,
      active: value === option,
      onClick: () => onChange(value === option ? null : option),
    }))
  } else {
    const { value, onChange } = props as Extract<YesNoProps, { variant?: "boolean" }>
    items = [
      { key: "yes", label: "Sí", active: value === true, onClick: () => onChange(value === true ? null : true) },
      { key: "no", label: "No", active: value === false, onClick: () => onChange(value === false ? null : false) },
    ]
  }
  return (
    <div id={id} className={cn("flex flex-col", className)} aria-describedby={messageId}>
      <Label id={`${id}-label`} required={required}>{label}</Label>
      <SegmentedControl ariaLabel={label} variant="segmented" items={items} className="[&_button]:min-h-11 [&_button]:min-w-14 [&_button]:justify-center" />
      <FieldMessage id={messageId} error={error} helper={helper} />
    </div>
  )
}

/* ── Personas ────────────────────────────────────────────────────────────── */

/**
 * Persona de la plataforma (integrante, responsable, verificador): se elige por
 * nombre y se ve su cargo; jamás se escribe ni se muestra un ID. Las personas
 * vienen de `ws.people` (las que pueden ver incidentes de la faena).
 */
export function Re20PersonPicker({ id, label, helper, error, required, disabled, className, value, onChange, excludeIds, clearLabel = "Sin asignar" }: BaseFieldProps & {
  value: string | null | undefined
  onChange: (userId: string | null) => void
  /** Personas que no pueden elegirse aquí (p. ej. el responsable, al elegir verificador). */
  excludeIds?: ReadonlyArray<string | null | undefined>
  clearLabel?: string
}) {
  const ws = useRe20()
  const excluded = new Set((excludeIds ?? []).filter(Boolean) as string[])
  const current = value ?? ""
  const selected = ws.people.find((person) => person.id === current)
  const options = [
    ...ws.people.filter((person) => !excluded.has(person.id) || person.id === current).map((person) => ({
      value: person.id,
      label: person.name,
      hint: person.position ?? undefined,
    })),
    ...(current && !selected ? [{ value: current, label: current === ws.currentUser.id ? ws.currentUser.name : "Persona sin acceso a esta faena" }] : []),
  ]
  const positionHelper = selected?.position ? `Cargo: ${selected.position}` : undefined
  return (
    <Field label={label} htmlFor={id} helper={helper ?? positionHelper} error={error} required={required} className={className}>
      <Combobox
        id={id}
        options={options}
        value={current}
        onChange={(next) => onChange(next || null)}
        clearLabel={clearLabel}
        placeholder="Busca por nombre o cargo…"
        disabled={disabled}
      />
    </Field>
  )
}

/* ── Filas repetibles ────────────────────────────────────────────────────── */

/**
 * Lista de filas con «Agregar» y «Quitar». Vacía, explica qué falta y ofrece la
 * acción. Las filas se separan con divisores, no con tarjetas: la lista ya vive
 * dentro de un bloque.
 */
export function Re20RepeatableList<T>({ id, title, description, items, renderItem, itemLabel, onAdd, onRemove, addLabel, emptyTitle, emptyDescription, max, readOnly, getKey }: {
  id: string
  title: string
  description?: string
  items: readonly T[]
  renderItem: (item: T, index: number) => React.ReactNode
  /** Nombre corto de la fila para lectores de pantalla y para «Quitar …». */
  itemLabel: (item: T, index: number) => string
  onAdd: () => void
  onRemove: (index: number) => void
  addLabel: string
  emptyTitle: string
  emptyDescription: string
  max?: number
  readOnly?: boolean
  getKey?: (item: T, index: number) => string
}) {
  const ws = useRe20()
  const locked = readOnly ?? ws.readOnly
  const full = max !== undefined && items.length >= max
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h4 id={`${id}-title`} className="text-sm font-semibold text-[var(--color-text)]">
            {title}
            {items.length > 0 && <span className="ml-1.5 font-normal tabular-nums text-[var(--color-text-subtle)]">({items.length})</span>}
          </h4>
          {description && <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{description}</p>}
        </div>
        {!locked && items.length > 0 && (
          <Button type="button" variant="secondary" size="sm" onClick={onAdd} disabled={full}>
            <Plus aria-hidden className="size-4" />{addLabel}
          </Button>
        )}
      </div>
      {items.length === 0 ? (
        <EmptyState
          compact
          align="start"
          as="p"
          title={emptyTitle}
          description={emptyDescription}
          className="rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border-strong)] py-5"
          action={locked ? undefined : <Button type="button" variant="secondary" size="sm" onClick={onAdd}><Plus aria-hidden className="size-4" />{addLabel}</Button>}
        />
      ) : (
        <ol className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
          {items.map((item, index) => (
            <li key={getKey?.(item, index) ?? index} aria-label={itemLabel(item, index)} className="py-4">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1 space-y-3">{renderItem(item, index)}</div>
                {!locked && (
                  <Button type="button" variant="ghost-danger" size="icon-sm" aria-label={`Quitar ${itemLabel(item, index)}`} onClick={() => onRemove(index)}>
                    <Trash aria-hidden className="size-4" />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
      {full && !locked && <p className="text-xs text-[var(--color-text-muted)]">Llegaste al máximo de {max}.</p>}
    </section>
  )
}

/* ── Bloque plegable ─────────────────────────────────────────────────────── */

/**
 * Agrupa los campos de una parte de la etapa. Cerrado muestra su resumen
 * («3 de 4 · falta la hora de salida»), así la etapa no es un formulario
 * gigante siempre abierto. `focusField` abre el bloque que contiene el campo.
 */
export function Re20Block({ id, title, summary, complete = false, defaultOpen = false, children }: {
  id: string
  title: string
  summary?: React.ReactNode
  complete?: boolean
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  // `defaultOpen` depende del avance del bloque: atarlo a `open` lo plegaba al
  // primer carácter tecleado. Solo decide la apertura inicial; después manda
  // quien usa la pantalla (y `focusField`, que abre el <details> en el DOM).
  const [open, setOpen] = React.useState(defaultOpen)
  return (
    <details id={id} open={open} onToggle={(event) => setOpen(event.currentTarget.open)} className="group border-b border-[var(--color-border)] last:border-b-0">
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 rounded-[var(--radius-md)] py-3 outline-none transition-colors duration-150 hover:bg-[var(--color-surface-2)] focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 font-medium text-[var(--color-text)]">
            {title}
            {complete && <CheckCircle aria-label="Completo" weight="fill" className="size-4 shrink-0 text-[var(--color-success)]" />}
          </span>
          {summary && <span className="mt-0.5 block truncate text-xs text-[var(--color-text-muted)]">{summary}</span>}
        </span>
        <CaretDown aria-hidden className="size-4 shrink-0 text-[var(--color-text-subtle)] transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className="space-y-4 pb-5 pt-1">{children}</div>
    </details>
  )
}

/* ── Anexos ──────────────────────────────────────────────────────────────── */

/**
 * Botón que elige archivos y los deja en el expediente: `ws.addAttachments`
 * comprueba tipo real y tamaño antes de aceptarlos y se suben al guardar.
 * `onAdded` recibe los anexos aceptados para enlazarlos (evidencia, declaración…).
 */
export function Re20AttachmentPicker({ id, label, helper, onAdded, multiple = true, capture, accept }: {
  id: string
  label: string
  helper?: string
  onAdded: (items: Re20PendingAttachmentInfo[]) => void
  multiple?: boolean
  /** Tipos aceptados por este selector (por defecto, todos los permitidos para anexos RE-20). */
  accept?: readonly string[]
  /** «environment» abre la cámara trasera en el teléfono. */
  capture?: "environment" | "user"
}) {
  const ws = useRe20()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [busy, setBusy] = React.useState(false)
  return (
    <div id={id} className="flex flex-col gap-1.5">
      <div>
        <Button type="button" variant="secondary" loading={busy} disabled={ws.readOnly} onClick={() => inputRef.current?.click()}>
          <Paperclip aria-hidden className="size-4" />{label}
        </Button>
      </div>
      <p className="text-xs text-[var(--color-text-subtle)]">{helper ?? RE20_ATTACHMENT_ACCEPT_MESSAGE}</p>
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        multiple={multiple}
        capture={capture}
        accept={(accept ?? RE20_ATTACHMENT_LIMITS.allowedMimeTypes).join(",")}
        onChange={async (event) => {
          const files = Array.from(event.target.files ?? [])
          event.target.value = ""
          if (files.length === 0) return
          setBusy(true)
          try {
            const added = await ws.addAttachments(files)
            if (added.length > 0) onAdded(added)
          } finally {
            setBusy(false)
          }
        }}
      />
    </div>
  )
}

export type Re20PendingAttachmentInfo = { id: string; fileName: string; mimeType: string; size: number }

/**
 * Anexos enlazados: los que esperan subirse muestran nombre y peso; los ya
 * guardados se abren con el propósito de acceso vigente (sin él no se ven).
 */
export function Re20AttachmentList({ ids, onRemove, emptyText }: {
  ids: readonly string[]
  onRemove?: (id: string) => void
  emptyText?: string
}) {
  const ws = useRe20()
  if (ids.length === 0) return emptyText ? <p className="text-sm text-[var(--color-text-muted)]">{emptyText}</p> : null
  return (
    <ul className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
      {ids.map((attachmentId, index) => {
        const pending = ws.pendingAttachments.find((item) => item.id === attachmentId)
        const href = ws.attachmentHref(attachmentId)
        const name = pending?.fileName ?? `Anexo ${index + 1}`
        return (
          <li key={attachmentId} className="flex min-h-11 items-center gap-3 py-2 text-sm">
            <FileText aria-hidden className="size-4 shrink-0 text-[var(--color-text-subtle)]" />
            <span className="min-w-0 flex-1">
              {href
                ? <a href={href} target="_blank" rel="noreferrer" className="font-medium text-[var(--color-primary-ink)] underline underline-offset-2">{name}</a>
                : <span className="font-medium text-[var(--color-text)]">{name}</span>}
              <span className="block text-xs text-[var(--color-text-subtle)]">
                {pending ? `${formatBytes(pending.size)} · se sube al guardar` : href ? "Guardado" : "Guardado · ábrelo con acceso reservado"}
              </span>
            </span>
            {onRemove && !ws.readOnly && (
              <Button type="button" variant="ghost-danger" size="icon-sm" aria-label={`Quitar ${name}`} onClick={() => onRemove(attachmentId)}>
                <Trash aria-hidden className="size-4" />
              </Button>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** Dato del caso que no se edita aquí (viene del reporte inicial). */
export function Re20Fact({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-[var(--color-text-subtle)]">{label}</dt>
      <dd className={cn("mt-0.5 text-sm text-[var(--color-text)]", mono && "font-mono tabular-nums")}>{value ?? "—"}</dd>
    </div>
  )
}

function FieldMessage({ id, error, helper }: { id?: string; error?: string; helper?: string }) {
  if (error) return <p id={id} role="alert" className="mt-1.5 text-xs leading-tight text-[var(--color-danger)]">{error}</p>
  if (helper) return <p id={id} className="mt-1.5 text-xs leading-tight text-[var(--color-text-subtle)]">{helper}</p>
  return null
}
