"use client"

import * as React from "react"
import { ImageSquare, X } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { MANT_WEB_PHOTO_TYPES } from "@/lib/mantencion/contracts"
import type { FleetRow } from "@/lib/mantencion/client/fleet-view"
import type { FlowAction } from "@/lib/mantencion/client/flow"
import { stepsFor, totalHours, type FlowDraft, type FlowStep } from "@/lib/mantencion/client/flow-types"
import { parseQuantity, partsFilled } from "@/lib/mantencion/client/flow-validate"
import { formatHours, formatReading, parseReadingInput } from "@/lib/mantencion/format"
import type { MantPhotoKind } from "@/lib/mantencion/types"
import { formatDate } from "@/lib/utils"
import { RecordEquipment } from "./record-step-lectura"
import type { TrabajoCatalogs } from "./record-step-trabajo"

/** Foto cargada en el formulario: el archivo ya timbrado y comprimido, y la URL para la miniatura. */
export interface LoadedPhoto {
  url: string
}

export interface PhotoHandlers {
  photos: Record<string, LoadedPhoto>
  /** Foto que se está preparando (por casilla); mientras tanto no se carga otra en ella. */
  busy: string | null
  /** Error de la última carga, por casilla (`correctiva`, `filtros`, `sticker`). */
  loadError: Partial<Record<MantPhotoKind, string>>
  onFile: (kind: MantPhotoKind, file: File) => void
  onRemove: (id: string) => void
}

const ACCEPT = MANT_WEB_PHOTO_TYPES.join(",")
const ERROR = "text-xs text-[var(--color-danger-ink)]"

/** Lo que dice «Sin novedad»: el atajo de las notas obligatorias. */
export const NO_NEWS = "Sin novedad"

function Thumb({ photo, label, onRemove }: { photo: LoadedPhoto; label: string; onRemove: () => void }) {
  return (
    <figure className="relative overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)]">
      {/* eslint-disable-next-line @next/next/no-img-element -- URL local (blob:) recién generada: next/image no aplica. */}
      <img src={photo.url} alt={label} className="aspect-[4/3] w-full object-cover" />
      <Button type="button" size="sm" variant="secondary" className="absolute right-2 top-2" aria-label={`Quitar ${label.toLowerCase()}`} onClick={onRemove}>
        <X className="h-4 w-4" aria-hidden />
      </Button>
    </figure>
  )
}

/** Botón de carga: un `<input type=file>` rotulado; sólo JPG o PNG (Chrome de escritorio no lee HEIC). */
function PhotoInput({ id, label, kind, handlers, disabled }: { id: string; label: string; kind: MantPhotoKind; handlers: PhotoHandlers; disabled?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <input
        id={id}
        type="file"
        accept={ACCEPT}
        aria-label={label}
        className="peer sr-only"
        disabled={disabled || handlers.busy === kind}
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ""
          if (file) handlers.onFile(kind, file)
        }}
      />
      <label
        htmlFor={id}
        aria-hidden
        className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border-strong)] px-4 py-3 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-2)] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--color-primary)] peer-disabled:cursor-not-allowed peer-disabled:opacity-60"
      >
        <ImageSquare className="h-5 w-5" aria-hidden />
        {handlers.busy === kind ? "Preparando la foto…" : label}
      </label>
      {handlers.loadError[kind] && <p role="alert" className={ERROR}>{handlers.loadError[kind]}</p>}
    </div>
  )
}

/**
 * Fotos. Correctiva: de 1 a 3 del repuesto o de la reparación. Preventiva: la de
 * los filtros usados, la del sticker y las notas obligatorias. Al cargarlas se
 * achican y se timbran con la fecha, la hora y el equipo, igual que en la app.
 */
export function RecordStepFotos({ draft, dispatch, handlers }: { draft: FlowDraft; dispatch: React.Dispatch<FlowAction>; handlers: PhotoHandlers }) {
  if (draft.kind === "C") {
    const ids = draft.photos.correctiva
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-[var(--color-text-muted)]">Carga de 1 a 3 fotos del repuesto o de la reparación, en JPG o PNG. Se les agrega la fecha, la hora y el equipo.</p>
        {ids.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {ids.map((id, index) => {
              const photo = handlers.photos[id]
              return photo ? <Thumb key={id} photo={photo} label={`Foto ${index + 1} del trabajo`} onRemove={() => handlers.onRemove(id)} /> : null
            })}
          </div>
        )}
        {ids.length < 3 && <PhotoInput id="ot-rec-photo-c" label="Agregar foto del trabajo" kind="correctiva" handlers={handlers} />}
        {draft.errors.photos && <p role="alert" className={ERROR}>{draft.errors.photos}</p>}
      </div>
    )
  }

  const typed = draft.notes.trim()
  const slots: Array<{ slot: "filtros" | "sticker"; title: string; error: string | undefined }> = [
    { slot: "filtros", title: "Filtros usados", error: draft.errors.photo_filtros },
    { slot: "sticker", title: "Sticker de mantención realizada", error: draft.errors.photo_sticker },
  ]
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-[var(--color-text-muted)]">Las 2 fotos son obligatorias, en JPG o PNG. Se les agrega la fecha, la hora y el equipo.</p>
      {slots.map(({ slot, title, error }) => {
        const id = draft.photos[slot]
        const photo = id ? handlers.photos[id] : undefined
        return (
          <section key={slot} aria-label={title} className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">{title}</h3>
            {id && photo
              ? <div className="max-w-xs"><Thumb photo={photo} label={`Foto de ${title.toLowerCase()}`} onRemove={() => handlers.onRemove(id)} /></div>
              : <PhotoInput id={`ot-rec-photo-${slot}`} label={`Cargar foto: ${title.toLowerCase()}`} kind={slot} handlers={handlers} />}
            {error && <p role="alert" className={ERROR}>{error}</p>}
          </section>
        )
      })}
      <div className="flex flex-col gap-2">
        <Field label="Notas" htmlFor="ot-rec-notes" required error={draft.errors.notes}>
          <Textarea id="ot-rec-notes" rows={3} value={draft.notes} placeholder="Qué encontraste, qué queda pendiente" maxLength={2000}
            onChange={(event) => dispatch({ type: "patch", patch: { notes: event.target.value } })} />
        </Field>
        {(typed === "" || typed === NO_NEWS) && (
          <Button type="button" size="sm" variant={typed === NO_NEWS ? "primary" : "secondary"} className="self-start" aria-pressed={typed === NO_NEWS}
            onClick={() => dispatch({ type: "patch", patch: { notes: typed === NO_NEWS ? "" : NO_NEWS } })}>{NO_NEWS}</Button>
        )}
      </div>
    </div>
  )
}

const names = (ids: readonly string[], list: ReadonlyArray<{ id: string; name: string }>) => ids.map((id) => list.find((item) => item.id === id)?.name ?? id)

function Row({ label, children, onChange }: { label: string; children: React.ReactNode; onChange?: () => void }) {
  return (
    <div className="grid grid-cols-[8rem_minmax(0,1fr)_auto] items-baseline gap-2 border-t border-[var(--color-border)] py-2 first:border-t-0">
      <dt className="text-sm text-[var(--color-text-muted)]">{label}</dt>
      <dd className="min-w-0 text-sm text-[var(--color-text)]">{children}</dd>
      {onChange
        ? <Button type="button" size="sm" variant="link" aria-label={`Cambiar ${label.toLowerCase()}`} onClick={onChange}>Cambiar</Button>
        : <span />}
    </div>
  )
}

/**
 * Revisar: todo lo ingresado; cada dato lleva «Cambiar», que va a su paso y
 * vuelve directo aquí (salvo que el cambio deje inválido un paso intermedio).
 */
export function RecordStepRevisar({ draft, dispatch, row, catalogs, folio, userName }: {
  draft: FlowDraft
  dispatch: React.Dispatch<FlowAction>
  row: FleetRow
  catalogs: TrabajoCatalogs
  folio: string
  userName: string
}) {
  const unit = row.eq.unit
  const reading = parseReadingInput(draft.readingText).value ?? 0
  const go = (step: FlowStep) => () => dispatch({ type: "goStep", step: Math.max(1, stepsFor(draft.kind).indexOf(step)), backToReview: true })

  if (draft.kind === "P") {
    const marks = draft.checklist.map((item) => draft.marks[item.key])
    const count = (value: string) => marks.filter((mark) => mark === value).length
    const manual = draft.intervalValue !== null && draft.intervalValue !== draft.suggestedIntervalValue
    const notDone = draft.checklist.filter((item) => draft.marks[item.key] === "NR")
    return (
      <div className="flex flex-col gap-4">
        <RecordEquipment row={row} />
        <dl>
          <Row label="Tipo">Preventiva · <span className="font-mono">{folio}</span></Row>
          <Row label="Pauta" onChange={go("lectura")}>{draft.intervalValue ? formatReading(draft.intervalValue, unit) : "—"}{manual ? " (elegida a mano)" : ""}</Row>
          <Row label="Lectura" onChange={go("lectura")}><span className="font-mono tabular-nums">{formatReading(reading, unit)}</span></Row>
          <Row label="Fecha" onChange={go("lectura")}>{formatDate(draft.workDate)}</Row>
          <Row label="Ítems" onChange={go("pauta")}>{count("R")} realizados · {count("NR")} no realizados · {count("NA")} no aplican</Row>
          {notDone.length > 0 && <Row label="No realizados">{notDone.map((item) => `${item.name} (${draft.reasons[item.key] ?? ""})`).join("; ")}</Row>}
          <Row label="Fotos" onChange={go("fotos")}>{[draft.photos.filtros, draft.photos.sticker].filter(Boolean).length} de 2</Row>
          <Row label="Notas" onChange={go("fotos")}>{draft.notes}</Row>
        </dl>
      </div>
    )
  }

  const who = draft.executorKind === "yo"
    ? userName
    : draft.executorKind === "otro_mecanico"
      ? names([draft.executorUserId], catalogs.mechanics).join("")
      : `${names([draft.executorWorkshopId], catalogs.workshops).join("")} (externo)`
  return (
    <div className="flex flex-col gap-4">
      <RecordEquipment row={row} />
      <dl>
        <Row label="Tipo">Correctiva · <span className="font-mono">{folio}</span></Row>
        <Row label="Lectura" onChange={go("lectura")}><span className="font-mono tabular-nums">{formatReading(reading, unit)}</span></Row>
        <Row label="Fecha" onChange={go("lectura")}>{formatDate(draft.workDate)}</Row>
        <Row label="Trabajos" onChange={go("trabajo")}>
          {draft.jobs.map((job) => {
            const parts = job.noParts ? "sin repuestos" : partsFilled(job).map((part) => `${parseQuantity(part.quantity)} × ${part.description.trim()}`).join(", ")
            return <span key={job.workTypeId} className="block">{names([job.workTypeId], catalogs.workTypes).join("")} · {formatHours(job.hours)} · {parts}</span>
          })}
        </Row>
        <Row label="Horas" onChange={go("trabajo")}>{formatHours(totalHours(draft.jobs))} en total</Row>
        <Row label="Hecho por" onChange={go("trabajo")}>{who}</Row>
        <Row label="Aceite" onChange={go("trabajo")}>{draft.noOilChange ? "No se cambió" : names(draft.oilIds, catalogs.oils).join(", ")}</Row>
        <Row label="Detalle" onChange={go("trabajo")}>{draft.description}</Row>
        <Row label="Conductores" onChange={go("trabajo")}>{names(draft.driverIds, catalogs.drivers).join(", ")}</Row>
        <Row label="Fotos" onChange={go("fotos")}>{draft.photos.correctiva.length}</Row>
      </dl>
    </div>
  )
}
