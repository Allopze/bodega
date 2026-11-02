"use client"

import * as React from "react"
import { Minus, Plus, X } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Combobox } from "@/components/ui/combobox"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/ui/option-select"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { Textarea } from "@/components/ui/textarea"
import type { FleetRow } from "@/lib/mantencion/client/fleet-view"
import type { FlowAction } from "@/lib/mantencion/client/flow"
import { totalHours, type FlowDraft, type FlowJob } from "@/lib/mantencion/client/flow-types"
import { checklistCounts, HOURS_MAX, HOURS_MIN, HOURS_WARNING } from "@/lib/mantencion/client/flow-validate"
import { formatHours, formatReading } from "@/lib/mantencion/format"
import { groupChecklist } from "@/lib/mantencion/schedule"
import type { MantItemValue } from "@/lib/mantencion/types"
import { RecordEquipment } from "./record-step-lectura"

type Named = { id: string; name: string }

export interface TrabajoCatalogs {
  workTypes: Named[]
  oils: Named[]
  drivers: Named[]
  workshops: Named[]
  mechanics: Named[]
}

const ERROR = "text-xs text-[var(--color-danger-ink)]"

function ErrorText({ message }: { message: string | undefined }) {
  return message ? <p role="alert" className={ERROR}>{message}</p> : null
}

function JobCard({ job, name, error, dispatch }: { job: FlowJob; name: string; error: string | undefined; dispatch: React.Dispatch<FlowAction> }) {
  const id = job.workTypeId
  return (
    <div role="group" aria-label={`Trabajo ${name}`} className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">{name}</p>
        <Button type="button" size="sm" variant="ghost" aria-label={`Quitar el trabajo ${name}`} onClick={() => dispatch({ type: "jobRemove", workTypeId: id })}>
          <X className="h-4 w-4" aria-hidden /> Quitar
        </Button>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-[var(--color-text-muted)]" id={`ot-rec-h-${id}`}>Horas</span>
        <div role="group" aria-labelledby={`ot-rec-h-${id}`} className="flex items-center gap-2">
          <Button type="button" size="sm" variant="secondary" aria-label={`Restar media hora a ${name}`} disabled={job.hours <= HOURS_MIN}
            onClick={() => dispatch({ type: "jobHours", workTypeId: id, hours: job.hours - 0.5 })}><Minus className="h-4 w-4" aria-hidden /></Button>
          <output aria-live="polite" className="min-w-14 text-center font-mono text-sm tabular-nums">{formatHours(job.hours)}</output>
          <Button type="button" size="sm" variant="secondary" aria-label={`Sumar media hora a ${name}`} disabled={job.hours >= HOURS_MAX}
            onClick={() => dispatch({ type: "jobHours", workTypeId: id, hours: job.hours + 0.5 })}><Plus className="h-4 w-4" aria-hidden /></Button>
        </div>
      </div>
      {!job.noParts && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-[var(--color-text-muted)]">Repuestos · cantidad y repuesto</p>
          {job.parts.map((part, index) => (
            <div key={index} className="grid grid-cols-[5rem_minmax(0,1fr)_auto] items-center gap-2">
              <Input aria-label={`Cantidad del repuesto ${index + 1} de ${name}`} inputMode="decimal" value={part.quantity}
                onChange={(event) => dispatch({ type: "jobPart", workTypeId: id, index, field: "quantity", text: event.target.value })} />
              <Input aria-label={`Repuesto ${index + 1} de ${name}`} value={part.description} placeholder="Ej: Filtro de aceite" maxLength={300}
                onChange={(event) => dispatch({ type: "jobPart", workTypeId: id, index, field: "description", text: event.target.value })} />
              <Button type="button" size="sm" variant="ghost" aria-label={`Quitar repuesto ${index + 1} de ${name}`}
                onClick={() => dispatch({ type: "jobPartRemove", workTypeId: id, index })}><X className="h-4 w-4" aria-hidden /></Button>
            </div>
          ))}
          <Button type="button" size="sm" variant="secondary" className="self-start" onClick={() => dispatch({ type: "jobPartAdd", workTypeId: id })}>
            <Plus className="h-4 w-4" aria-hidden /> Agregar repuesto
          </Button>
        </div>
      )}
      <Checkbox label="No se usaron repuestos" checked={job.noParts} onChange={(event) => dispatch({ type: "jobNoParts", workTypeId: id, noParts: event.target.checked })} />
      <ErrorText message={error} />
    </div>
  )
}

/**
 * Trabajo de la correctiva: trabajos (cada uno con sus horas y repuestos),
 * quién lo hizo, aceite, descripción y conductores. Con la OT no se pregunta si
 * el equipo queda en taller ni el Nº de OT en papel: el taller lo lleva la OT.
 */
export function RecordStepTrabajo({ draft, dispatch, row, catalogs, folio }: {
  draft: FlowDraft
  dispatch: React.Dispatch<FlowAction>
  row: FleetRow
  catalogs: TrabajoCatalogs
  folio: string
}) {
  const { errors } = draft
  const nameOf = (id: string) => catalogs.workTypes.find((type) => type.id === id)?.name ?? "Trabajo"
  const available = catalogs.workTypes.filter((type) => !draft.jobs.some((job) => job.workTypeId === type.id))
  const total = totalHours(draft.jobs)
  const chosenDrivers = draft.driverIds.map((id) => catalogs.drivers.find((driver) => driver.id === id)).filter((driver): driver is Named => !!driver)
  const driverOptions = catalogs.drivers.filter((driver) => !draft.driverIds.includes(driver.id)).map((driver) => ({ value: driver.id, label: driver.name }))

  return (
    <div className="flex flex-col gap-5">
      <RecordEquipment row={row} />

      <section aria-labelledby="ot-rec-jobs" className="flex flex-col gap-3">
        <h3 id="ot-rec-jobs" className="text-sm font-semibold">Trabajos realizados <span className="font-normal text-[var(--color-text-muted)]">· uno por tipo de trabajo</span></h3>
        {draft.jobs.map((job) => (
          <JobCard key={job.workTypeId} job={job} name={nameOf(job.workTypeId)} error={errors[`job:${job.workTypeId}`]} dispatch={dispatch} />
        ))}
        {available.length > 0 && (
          <div role="group" aria-label="Agregar trabajo" className="flex flex-wrap gap-2">
            {available.map((type) => (
              <Button key={type.id} type="button" size="sm" variant="secondary" onClick={() => dispatch({ type: "jobAdd", workTypeId: type.id })}>
                <Plus className="h-4 w-4" aria-hidden /> {type.name}
              </Button>
            ))}
          </div>
        )}
        <ErrorText message={errors.workTypes} />
        {draft.jobs.length > 0 && <p className="text-sm font-semibold" aria-live="polite">Total: {formatHours(total)}</p>}
        {total > HOURS_WARNING && <p className="text-xs text-[var(--color-text-muted)]">Son más de {HOURS_WARNING} horas en total. Si está bien, sigue.</p>}
        <ErrorText message={errors.hours} />
      </section>

      <div className="flex flex-col gap-2">
        <SegmentedControl
          eyebrow="¿Quién hizo el trabajo?"
          ariaLabel="Quién hizo el trabajo"
          items={([["yo", "Yo"], ["otro_mecanico", "Otro mecánico"], ["externo", "Taller externo"]] as const).map(([kind, label]) => ({
            key: kind, label, active: draft.executorKind === kind, onClick: () => dispatch({ type: "patch", patch: { executorKind: kind } }),
          }))}
        />
        {draft.executorKind === "otro_mecanico" && (
          <Field label="Mecánico" htmlFor="ot-rec-mechanic" required>
            <OptionSelect id="ot-rec-mechanic" placeholder="Elige…" value={draft.executorUserId} emptyLabel="No hay otros mecánicos con la app en estas faenas."
              options={catalogs.mechanics.map((mechanic) => ({ value: mechanic.id, label: mechanic.name }))}
              onValueChange={(value) => dispatch({ type: "patch", patch: { executorUserId: value } })} />
          </Field>
        )}
        {draft.executorKind === "externo" && (
          <Field label="Taller externo" htmlFor="ot-rec-workshop" required>
            <OptionSelect id="ot-rec-workshop" placeholder="Elige…" value={draft.executorWorkshopId}
              options={catalogs.workshops.map((workshop) => ({ value: workshop.id, label: workshop.name }))}
              onValueChange={(value) => dispatch({ type: "patch", patch: { executorWorkshopId: value } })} />
          </Field>
        )}
        <ErrorText message={errors.executor} />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold">Cambio de aceite <span className="font-normal text-[var(--color-text-muted)]">· puedes marcar varios</span></legend>
        {catalogs.oils.map((oil) => (
          <Checkbox key={oil.id} label={oil.name} checked={draft.oilIds.includes(oil.id)} onChange={() => dispatch({ type: "toggleId", field: "oilIds", id: oil.id })} />
        ))}
        <Checkbox label="No se cambió aceite" checked={draft.noOilChange} onChange={() => dispatch({ type: "noOilChange" })} />
        <ErrorText message={errors.oil} />
      </fieldset>

      <Field label="Trabajo realizado" htmlFor="ot-rec-description" required error={errors.description}>
        <Textarea id="ot-rec-description" rows={3} value={draft.description} placeholder="Qué se hizo y por qué" maxLength={4000}
          onChange={(event) => dispatch({ type: "patch", patch: { description: event.target.value } })} />
      </Field>

      <div className="flex flex-col gap-2">
        <Field label="Conductores de las últimas 24 h" htmlFor="ot-rec-drivers" helper="Todos los que usaron el equipo. Busca por apellido." error={errors.drivers}>
          <Combobox id="ot-rec-drivers" options={driverOptions} value="" placeholder="Busca por apellido"
            onChange={(value) => { if (value) dispatch({ type: "toggleId", field: "driverIds", id: value }) }} />
        </Field>
        {chosenDrivers.length > 0 && (
          <ul aria-label="Conductores elegidos" className="flex flex-wrap gap-2">
            {chosenDrivers.map((driver) => (
              <li key={driver.id}>
                <Button type="button" size="sm" variant="secondary" aria-label={`Quitar a ${driver.name}`}
                  onClick={() => dispatch({ type: "toggleId", field: "driverIds", id: driver.id })}>
                  {driver.name} <X className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-xs text-[var(--color-text-muted)]">
        Este trabajo queda enlazado a <span className="font-mono font-semibold text-[var(--color-text)]">{folio}</span>. El ingreso y la salida de taller se registran en la OT.
      </p>
    </div>
  )
}

const VALUE_LABELS: Array<[MantItemValue, string]> = [["R", "Realizado"], ["NR", "No realizado"], ["NA", "No aplica"]]

/**
 * Pauta de la preventiva: los ítems por sistema, con «Marcar todo como
 * realizado» por sistema para corregir después sólo las excepciones. Un «No
 * realizado» pide el motivo.
 */
export function RecordStepPauta({ draft, dispatch, row }: { draft: FlowDraft; dispatch: React.Dispatch<FlowAction>; row: FleetRow }) {
  const groups = groupChecklist(draft.checklist)
  const { total, done } = checklistCounts(draft)
  return (
    <div className="flex flex-col gap-4">
      <div role="status" className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-mono font-semibold">{row.eq.code} · {draft.intervalValue ? formatReading(draft.intervalValue, row.eq.unit) : ""}</span>
        <span><strong>{done}</strong> de {total} ítems</span>
      </div>
      <ErrorText message={draft.errors.pauta} />
      {groups.map((group, index) => {
        const left = group.items.filter((item) => !draft.marks[item.key]).length
        return (
          <section key={group.group} aria-labelledby={`ot-rec-g-${index}`} className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id={`ot-rec-g-${index}`} className="text-sm font-semibold">{group.group} <span className="font-normal text-[var(--color-text-muted)]">· {group.items.length - left}/{group.items.length}</span></h3>
              {left > 0 && (
                <Button type="button" size="sm" variant="secondary" onClick={() => dispatch({ type: "markGroup", group: index })}>
                  {left === group.items.length ? `Todo realizado en ${group.group}` : `Marcar los ${left} que faltan como realizados`}
                </Button>
              )}
            </div>
            {group.items.map((item) => {
              const value = draft.marks[item.key]
              return (
                <div key={item.key} className="flex flex-col gap-2 border-t border-[var(--color-border)] pt-2">
                  <p className="text-sm">
                    {item.name}
                    {item.manufacturerWarning && <span className="ml-2 text-xs text-[var(--color-warning-ink)]">Confirmar con pauta del fabricante</span>}
                  </p>
                  <div role="group" aria-label={item.name} className="flex flex-wrap gap-2">
                    {VALUE_LABELS.map(([mark, label]) => (
                      <Button key={mark} type="button" size="sm" variant={value === mark ? "primary" : "secondary"} aria-pressed={value === mark}
                        onClick={() => dispatch({ type: "mark", key: item.key, value: mark })}>{label}</Button>
                    ))}
                  </div>
                  {value === "NR" && (
                    <Field label={`¿Por qué no se realizó «${item.name}»?`} htmlFor={`ot-rec-nr-${item.key}`}>
                      <Input id={`ot-rec-nr-${item.key}`} value={draft.reasons[item.key] ?? ""} placeholder="Ej: Falta repuesto" maxLength={300}
                        onChange={(event) => dispatch({ type: "reason", key: item.key, text: event.target.value })} />
                    </Field>
                  )}
                </div>
              )
            })}
          </section>
        )
      })}
    </div>
  )
}
