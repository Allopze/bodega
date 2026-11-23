"use client"

import type { Dispatch } from "react"
import type { FlowAction } from "@/lib/mantencion/client/flow"
import type { FlowDraft } from "@/lib/mantencion/client/flow-types"
import { staleIds } from "@/lib/mantencion/client/flow-validate"
import { IconSearch } from "./icons"
import { FieldError } from "./ui"

/**
 * Lo elegido que jefatura desactivó después: no está en el catálogo, así que ya no se dibuja como chip normal, pero sigue
 * en el borrador y el servidor lo rechaza. Este chip lo deja a la vista y lo saca con un toque.
 */
export function StaleChip({ name, noun, onRemove }: { name: string | null; noun: string; onRemove: () => void }) {
  return (
    <button type="button" className="tag" style={{ borderStyle: "dashed" }} aria-label={`Quitar ${name ? `“${name}”` : noun}: ya no está disponible`} onClick={onRemove}>
      {name ? `${name} · ` : ""}Ya no disponible · quitar <span aria-hidden="true">×</span>
    </button>
  )
}

/** Conductores de las últimas 24 h: se busca por apellido y se agregan los que usaron el equipo. */
export function DriversField({ draft, dispatch, drivers, ready = true }: { draft: FlowDraft; dispatch: Dispatch<FlowAction>; drivers: Array<{ id: string; name: string }>; ready?: boolean }) {
  const key = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim()
  const query = key(draft.driverQuery)
  const results = query ? drivers.filter((driver) => !draft.driverIds.includes(driver.id) && key(driver.name).includes(query)).slice(0, 6) : []
  const chosen = draft.driverIds.map((id) => drivers.find((driver) => driver.id === id)).filter((driver): driver is { id: string; name: string } => Boolean(driver))
  // Sin catálogo bajado no se puede decir que alguien «ya no está»: no se juzga.
  const gone = staleIds(draft.driverIds, ready ? drivers : null)

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
              <button key={driver.id} type="button" onClick={() => { dispatch({ type: "toggleId", field: "driverIds", id: driver.id, name: driver.name }); dispatch({ type: "patch", patch: { driverQuery: "" } }); requestAnimationFrame(() => document.getElementById("cq")?.focus()) }}>{driver.name}</button>
            ))}
          </div>
        ) : <p className="hint">No hay conductores con ese apellido.</p>) : null}
      </div>
      {chosen.length > 0 || gone.length > 0 ? (
        <div className="chips" style={{ marginTop: 10 }}>
          {gone.map((id) => <StaleChip key={id} name={draft.idNames?.[id] ?? null} noun="un conductor" onRemove={() => dispatch({ type: "toggleId", field: "driverIds", id })} />)}
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
