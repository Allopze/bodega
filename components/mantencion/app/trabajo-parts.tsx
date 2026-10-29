"use client"

import type { Dispatch } from "react"
import type { FlowAction } from "@/lib/mantencion/client/flow"
import type { FlowDraft } from "@/lib/mantencion/client/flow-types"
import { IconClose, IconSearch } from "./icons"
import { FieldError } from "./ui"

/** Repuestos usados (cantidad + nombre) o «No se usaron repuestos». */
export function PartsField({ draft, dispatch }: { draft: FlowDraft; dispatch: Dispatch<FlowAction> }) {
  return (
    <div>
      <div className="lbl">Repuestos usados <small>· cantidad y repuesto</small></div>
      {draft.noParts ? null : (
        <>
          <div className="list" style={{ gap: 6 }}>
            {draft.parts.map((part, index) => (
              <div className="rep" key={index}>
                <input className="inp q" aria-label={`Cantidad del repuesto ${index + 1}`} inputMode="decimal" value={part.quantity} onChange={(event) => dispatch({ type: "part", index, field: "quantity", text: event.target.value })} />
                <input className="inp" id={`rep-${index}`} aria-label={`Repuesto ${index + 1}`} value={part.description} placeholder="Ej: Filtro de aceite" onChange={(event) => dispatch({ type: "part", index, field: "description", text: event.target.value })} />
                <button type="button" className="ibtn sm" aria-label={`Quitar repuesto ${index + 1}`} onClick={() => dispatch({ type: "partRemove", index })}><IconClose /></button>
              </div>
            ))}
          </div>
          <button type="button" className="btns wide" style={{ marginTop: 8, borderStyle: "dashed" }}
            onClick={() => { dispatch({ type: "partAdd" }); requestAnimationFrame(() => document.getElementById(`rep-${draft.parts.length}`)?.focus()) }}>+ Agregar repuesto</button>
        </>
      )}
      <label className="check" style={{ marginTop: 12 }}>
        <input type="checkbox" checked={draft.noParts} onChange={(event) => dispatch({ type: "patch", patch: { noParts: event.target.checked } })} />
        No se usaron repuestos
      </label>
      <FieldError message={draft.errors.parts} />
    </div>
  )
}

/** Conductores de las últimas 24 h: se busca por apellido y se agregan los que usaron el equipo. */
export function DriversField({ draft, dispatch, drivers }: { draft: FlowDraft; dispatch: Dispatch<FlowAction>; drivers: Array<{ id: string; name: string }> }) {
  const key = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim()
  const query = key(draft.driverQuery)
  const results = query ? drivers.filter((driver) => !draft.driverIds.includes(driver.id) && key(driver.name).includes(query)).slice(0, 6) : []
  const chosen = draft.driverIds.map((id) => drivers.find((driver) => driver.id === id)).filter((driver): driver is { id: string; name: string } => Boolean(driver))

  return (
    <div>
      <label className="lbl" htmlFor="cq">Conductores de las últimas 24 h <small>· todos los que lo usaron</small></label>
      <div className="search">
        <IconSearch />
        <input id="cq" type="search" value={draft.driverQuery} placeholder="Busca por apellido" autoComplete="off" onChange={(event) => dispatch({ type: "patch", patch: { driverQuery: event.target.value } })} />
      </div>
      <div role="status">
        {query ? (results.length > 0 ? (
          <div className="condres" role="group" aria-label="Conductores encontrados">
            {results.map((driver) => (
              <button key={driver.id} type="button" onClick={() => { dispatch({ type: "toggleId", field: "driverIds", id: driver.id }); dispatch({ type: "patch", patch: { driverQuery: "" } }); requestAnimationFrame(() => document.getElementById("cq")?.focus()) }}>{driver.name}</button>
            ))}
          </div>
        ) : <p className="hint">No hay conductores con ese apellido.</p>) : null}
      </div>
      {chosen.length > 0 ? (
        <div className="chips" style={{ marginTop: 10 }}>
          {chosen.map((driver) => (
            <button key={driver.id} type="button" className="tag" aria-label={`Quitar a ${driver.name}`} onClick={() => dispatch({ type: "toggleId", field: "driverIds", id: driver.id })}>
              {driver.name} <span aria-hidden="true">×</span>
            </button>
          ))}
        </div>
      ) : null}
      <FieldError message={draft.errors.drivers} />
    </div>
  )
}
