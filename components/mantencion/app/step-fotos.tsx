"use client"

import type { Dispatch } from "react"
import type { FleetRow } from "@/lib/mantencion/client/fleet-view"
import type { FlowAction } from "@/lib/mantencion/client/flow"
import type { FlowDraft } from "@/lib/mantencion/client/flow-types"
import { PhotoGrid, PhotoSlot } from "./photo-slot"
import { FieldError } from "./ui"
import type { PhotoCaptureContext } from "./use-photo"

export function photoContext(draft: FlowDraft, row: FleetRow, deviceId: string, kind: PhotoCaptureContext["kind"]): PhotoCaptureContext {
  return { authorUserId: draft.userId, deviceId, kind, equipment: { code: row.eq.code, plate: row.eq.plate } }
}

/** Lo que dice «Sin novedad»: el atajo de las notas obligatorias. Se puede editar después. */
export const NO_NEWS = "Sin novedad"

/**
 * Paso «Fotos». Preventiva: la foto de los filtros, la del sticker y las notas
 * («sin novedad» también vale, con un toque). Correctiva: de 1 a 3 fotos del repuesto
 * o la reparación, a todo el ancho como las de la preventiva.
 */
export function StepFotos({ draft, dispatch, row, deviceId }: { draft: FlowDraft; dispatch: Dispatch<FlowAction>; row: FleetRow; deviceId: string }) {
  if (draft.kind === "C") {
    return (
      <>
        <p style={{ margin: 0, fontSize: 16, lineHeight: 1.35 }}>Saca de 1 a 3 fotos del repuesto o de la reparación. La app les agrega la fecha, la hora y el equipo.</p>
        <PhotoGrid photoIds={draft.photos.correctiva} context={photoContext(draft, row, deviceId, "correctiva")} error={draft.errors.photos}
          onAdd={(id) => dispatch({ type: "photoAdd", id })} onRemove={(id) => dispatch({ type: "photoRemove", id })} />
      </>
    )
  }

  const typed = draft.notes.trim()
  // El atajo está mientras el campo esté vacío o sólo diga «Sin novedad»: no pisa lo que el mecánico escribió.
  const shortcut = typed === "" || typed === NO_NEWS
  return (
    <>
      <p style={{ margin: 0, fontSize: 16, lineHeight: 1.35 }}>Las 2 fotos son obligatorias. La app les agrega la fecha, la hora y el equipo.</p>
      <PhotoSlot number={1} label="Filtros usados" photoId={draft.photos.filtros} context={photoContext(draft, row, deviceId, "filtros")} error={draft.errors.photo_filtros}
        onChange={(id) => dispatch({ type: "photo", slot: "filtros", id })} />
      <PhotoSlot number={2} label="Sticker de mantención realizada" photoId={draft.photos.sticker} context={photoContext(draft, row, deviceId, "sticker")} error={draft.errors.photo_sticker}
        onChange={(id) => dispatch({ type: "photo", slot: "sticker", id })} />
      <div>
        <label className="lbl" htmlFor="obs">Notas <small>· obligatorias</small></label>
        <textarea id="obs" className={draft.errors.notes ? "inp bad" : "inp"} rows={3} value={draft.notes} placeholder="Qué encontraste, qué queda pendiente" aria-invalid={Boolean(draft.errors.notes)}
          onChange={(event) => dispatch({ type: "patch", patch: { notes: event.target.value } })} />
        {shortcut ? (
          <div className="chips" style={{ marginTop: 8 }}>
            <button type="button" className="chip" aria-pressed={typed === NO_NEWS} onClick={() => dispatch({ type: "patch", patch: { notes: typed === NO_NEWS ? "" : NO_NEWS } })}>{NO_NEWS}</button>
          </div>
        ) : null}
        <FieldError message={draft.errors.notes} />
      </div>
    </>
  )
}
