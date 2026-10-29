"use client"

import type { Dispatch } from "react"
import type { FleetRow } from "@/lib/mantencion/client/fleet-view"
import type { FlowAction } from "@/lib/mantencion/client/flow"
import type { FlowDraft } from "@/lib/mantencion/client/flow-types"
import { PhotoSlot } from "./photo-slot"
import { FieldError } from "./ui"
import type { PhotoCaptureContext } from "./use-photo"

export function photoContext(draft: FlowDraft, row: FleetRow, deviceId: string, kind: PhotoCaptureContext["kind"]): PhotoCaptureContext {
  return { authorUserId: draft.userId, deviceId, kind, equipment: { code: row.eq.code, plate: row.eq.plate } }
}

/** Paso 4 (preventiva): foto de los filtros, foto del sticker y observaciones («sin novedad» también vale). */
export function StepFotos({ draft, dispatch, row, deviceId }: { draft: FlowDraft; dispatch: Dispatch<FlowAction>; row: FleetRow; deviceId: string }) {
  return (
    <>
      <p style={{ margin: 0, fontSize: 16, lineHeight: 1.35 }}>Las 2 fotos son obligatorias. La app les agrega la fecha, la hora y el equipo.</p>
      <PhotoSlot number={1} label="Filtros usados" photoId={draft.photos.filtros} context={photoContext(draft, row, deviceId, "filtros")} error={draft.errors.photo_filtros}
        onChange={(id) => dispatch({ type: "photo", slot: "filtros", id })} />
      <PhotoSlot number={2} label="Sticker de mantención realizada" photoId={draft.photos.sticker} context={photoContext(draft, row, deviceId, "sticker")} error={draft.errors.photo_sticker}
        onChange={(id) => dispatch({ type: "photo", slot: "sticker", id })} />
      <div>
        <label className="lbl" htmlFor="obs">Observaciones</label>
        <textarea id="obs" className={draft.errors.notes ? "inp bad" : "inp"} rows={3} value={draft.notes} placeholder="Qué encontraste, qué queda pendiente" aria-invalid={Boolean(draft.errors.notes)}
          onChange={(event) => dispatch({ type: "patch", patch: { notes: event.target.value } })} />
        <FieldError message={draft.errors.notes} />
      </div>
    </>
  )
}
