"use client"

import type { Dispatch } from "react"
import { formatHours } from "@/lib/mantencion/format"
import type { FleetRow } from "@/lib/mantencion/client/fleet-view"
import type { FlowAction } from "@/lib/mantencion/client/flow"
import type { FlowDraft } from "@/lib/mantencion/client/flow-types"
import { HOURS_MAX, HOURS_MIN, HOURS_WARNING } from "@/lib/mantencion/client/flow-validate"
import { todayInChile } from "@/lib/utils"
import { useAppData } from "./app-context"
import { PhotoGrid } from "./photo-slot"
import { photoContext } from "./step-fotos"
import { EquipmentSummary } from "./step-lectura"
import { DriversField, PartsField } from "./trabajo-parts"
import { CheckBox, FieldError } from "./ui"

/** Paso 3 (correctiva): qué se hizo, quién, con qué, cuánto tardó y en qué quedó el equipo. */
export function StepTrabajo({ draft, dispatch, row }: { draft: FlowDraft; dispatch: Dispatch<FlowAction>; row: FleetRow }) {
  const { stored, account, deviceId } = useAppData()
  const catalog = stored?.catalog
  const { errors } = draft
  const mechanics = (catalog?.mechanics ?? []).filter((mechanic) => mechanic.id !== account.userId)
  const today = todayInChile()

  return (
    <>
      <EquipmentSummary row={row} />
      <div>
        <div className="lbl">Tipo de trabajo <small>· puedes marcar varios</small></div>
        <div className="seg multi" role="group" aria-label="Tipo de trabajo" style={{ gridTemplateColumns: "1fr 1fr" }}>
          {(catalog?.workTypes ?? []).map((type) => {
            const on = draft.workTypeIds.includes(type.id)
            return <button key={type.id} type="button" aria-pressed={on} onClick={() => dispatch({ type: "toggleId", field: "workTypeIds", id: type.id })}><CheckBox on={on} />{type.name}</button>
          })}
        </div>
        <FieldError message={errors.workTypes} />
      </div>

      <div>
        <div className="lbl">¿Quién hizo el trabajo?</div>
        <div className="seg" role="group" aria-label="Quién hizo el trabajo" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
          {([["yo", "Yo"], ["otro_mecanico", "Otro mecánico"], ["externo", "Taller externo"]] as const).map(([kind, label]) => (
            <button key={kind} type="button" aria-pressed={draft.executorKind === kind} onClick={() => dispatch({ type: "patch", patch: { executorKind: kind } })}>{label}</button>
          ))}
        </div>
        {draft.executorKind === "otro_mecanico" ? (
          <div style={{ marginTop: 12 }}>
            <label className="lbl" htmlFor="otroMec">Mecánico</label>
            <select id="otroMec" className="inp" value={draft.executorUserId} onChange={(event) => dispatch({ type: "patch", patch: { executorUserId: event.target.value } })}>
              <option value="">Elige…</option>
              {mechanics.map((mechanic) => <option key={mechanic.id} value={mechanic.id}>{mechanic.name}</option>)}
            </select>
          </div>
        ) : null}
        {draft.executorKind === "externo" ? (
          <div style={{ marginTop: 12 }}>
            <label className="lbl" htmlFor="taller">Taller externo</label>
            <select id="taller" className="inp" value={draft.executorWorkshopId} onChange={(event) => dispatch({ type: "patch", patch: { executorWorkshopId: event.target.value } })}>
              <option value="">Elige…</option>
              {(catalog?.workshops ?? []).map((workshop) => <option key={workshop.id} value={workshop.id}>{workshop.name}</option>)}
            </select>
          </div>
        ) : null}
        <FieldError message={errors.executor} />
      </div>

      <div>
        <div className="lbl">Cambio de aceite <small>· puedes marcar varios</small></div>
        <div className="chips" role="group" aria-label="Aceites cambiados">
          {(catalog?.oils ?? []).map((oil) => {
            const on = draft.oilIds.includes(oil.id)
            return <button key={oil.id} type="button" className="chip" aria-pressed={on} onClick={() => dispatch({ type: "toggleId", field: "oilIds", id: oil.id })}><CheckBox on={on} />{oil.name}</button>
          })}
        </div>
        <div className="orl"><span>o</span></div>
        <button type="button" className="chip" aria-pressed={draft.noOilChange} onClick={() => dispatch({ type: "noOilChange" })}>No se cambió aceite</button>
        <FieldError message={errors.oil} />
      </div>

      <div>
        <label className="lbl" htmlFor="trab">Trabajo realizado</label>
        <textarea id="trab" className={errors.description ? "inp bad" : "inp"} rows={3} value={draft.description} placeholder="Qué se hizo y por qué" aria-invalid={Boolean(errors.description)}
          onChange={(event) => dispatch({ type: "patch", patch: { description: event.target.value } })} />
        <FieldError message={errors.description} />
      </div>

      <div>
        <label className="lbl" htmlFor="orden">Orden de trabajo <small>· si tiene</small></label>
        <input id="orden" className="inp" value={draft.workOrder} maxLength={60} autoComplete="off" onChange={(event) => dispatch({ type: "patch", patch: { workOrder: event.target.value } })} />
      </div>

      <PartsField draft={draft} dispatch={dispatch} />

      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div className="lbl" style={{ margin: 0 }} id="horas-lbl">Horas trabajadas</div>
          <div className="stepper" role="group" aria-labelledby="horas-lbl">
            <button type="button" aria-label="Restar media hora" disabled={draft.hours <= HOURS_MIN} onClick={() => dispatch({ type: "hours", hours: draft.hours - 0.5 })}>−</button>
            <output aria-live="polite">{formatHours(draft.hours)}</output>
            <button type="button" aria-label="Sumar media hora" disabled={draft.hours >= HOURS_MAX} onClick={() => dispatch({ type: "hours", hours: draft.hours + 0.5 })}>+</button>
          </div>
        </div>
        {draft.hours > HOURS_WARNING ? <p className="hint">Son más de {HOURS_WARNING} horas. Si está bien, sigue.</p> : null}
        <FieldError message={errors.hours} />
      </div>

      <div className="card">
        <div className="lbl" id="taller-lbl">¿El equipo sigue en taller?</div>
        <div className="seg" role="group" aria-labelledby="taller-lbl" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <button type="button" aria-pressed={draft.inWorkshop === true} onClick={() => dispatch({ type: "patch", patch: { inWorkshop: true } })}>Sí, sigue</button>
          <button type="button" aria-pressed={draft.inWorkshop === false} onClick={() => dispatch({ type: "patch", patch: { inWorkshop: false } })}>No, ya salió</button>
        </div>
        {draft.inWorkshop ? (
          <>
            <label className="lbl" htmlFor="ingreso" style={{ marginTop: 12 }}>Entró a taller el</label>
            <input id="ingreso" type="date" className="inp" value={draft.workshopEntryDate} max={today} onChange={(event) => dispatch({ type: "patch", patch: { workshopEntryDate: event.target.value } })} />
            <p className="hint">Si pasa más de 1 día, la app te pedirá actualizar el estado cada 2 días.</p>
          </>
        ) : null}
        <FieldError message={errors.workshop} />
      </div>

      <DriversField draft={draft} dispatch={dispatch} drivers={catalog?.drivers ?? []} />

      <div>
        <div className="lbl">Fotos del repuesto o la reparación <small>· de 1 a 3</small></div>
        <PhotoGrid photoIds={draft.photos.correctiva} context={photoContext(draft, row, deviceId, "correctiva")} error={errors.photos}
          onAdd={(id) => dispatch({ type: "photoAdd", id })} onRemove={(id) => dispatch({ type: "photoRemove", id })} />
      </div>
    </>
  )
}
