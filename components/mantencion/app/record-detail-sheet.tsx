"use client"

import type { ReactNode } from "react"
import { formatHours, formatReading, ITEM_VALUE_LABEL, PHOTO_KIND_LABEL, plural, recordKindText } from "@/lib/mantencion/format"
import { equipmentLabel } from "@/lib/mantencion/client/fleet-view"
import type { AppHistoryPhoto, AppHistoryRecord } from "@/lib/mantencion/contracts"
import { formatDate } from "@/lib/utils"
import { useAppData } from "./app-context"
import { Sheet } from "./dialog"
import { useHistoryPhoto } from "./use-history"
import { FieldError } from "./ui"

/** «Taller externo» va con su nombre; quien ejecutó es siempre alguien, nunca un valor crudo. */
function executorLabel(record: AppHistoryRecord): string {
  return record.executorKind === "externo" ? `${record.executorName} (taller externo)` : record.executorName
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd><span>{children}</span></dd>
    </>
  )
}

/** Una foto del registro: se pide cuando se muestra y, sin señal, avisa en vez de quedar en blanco. */
function HistoryPhoto({ photo, label }: { photo: AppHistoryPhoto; label: string }) {
  const state = useHistoryPhoto(photo.id)
  const kind = PHOTO_KIND_LABEL[photo.kind]
  const box = { aspectRatio: `${photo.width} / ${photo.height}`, maxHeight: "min(62vh, 480px)", width: "100%" }
  return (
    <figure style={{ margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
      <figcaption className="cap">{kind}</figcaption>
      {state.status === "ready" ? (
        // eslint-disable-next-line @next/next/no-img-element -- Blob local (blob:) de una foto ya bajada, no pasa por el optimizador
        <img className="ph" src={state.url} alt={`${kind} del ${label}`} width={photo.width} height={photo.height} />
      ) : (
        <div className="ph" style={{ ...box, display: "flex", alignItems: "center", justifyContent: "center", padding: 12, textAlign: "center", minHeight: 96 }} role={state.status === "loading" ? "status" : undefined}>
          {state.status === "loading" ? <span className="hint" style={{ margin: 0 }}>Cargando foto…</span> : null}
          {state.status === "offline" ? <span className="hint" style={{ margin: 0 }}>La foto se carga cuando haya señal.</span> : null}
          {state.status === "error" ? <FieldError message="No pudimos cargar esta foto." /> : null}
        </div>
      )}
    </figure>
  )
}

function PreventiveBody({ record }: { record: AppHistoryRecord }) {
  const groups = new Map<string, AppHistoryRecord["itemsFlagged"]>()
  for (const item of record.itemsFlagged) groups.set(item.group, [...(groups.get(item.group) ?? []), item])
  return (
    <div className="card">
      <div className="cap">Resultado de la pauta{record.schedule ? ` · ${record.schedule.name}` : ""}</div>
      <p style={{ margin: "8px 0 0", fontSize: 17, fontWeight: 600 }}>{plural(record.itemsDone, "ítem realizado", "ítems realizados")}</p>
      {groups.size > 0 ? (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="hint" style={{ margin: 0 }}>Lo que no se hizo:</div>
          {[...groups].map(([group, items]) => (
            <div key={group}>
              <div className="cap" style={{ marginBottom: 4 }}>{group}</div>
              <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                {items.map((item) => (
                  <li key={`${group}-${item.name}`} style={{ padding: "4px 0", fontSize: 16, lineHeight: 1.35 }}>
                    <strong>{item.name}</strong> · {ITEM_VALUE_LABEL[item.value]}
                    {item.reason ? <div className="hint" style={{ margin: "2px 0 0" }}>{item.reason}</div> : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : <p className="hint">No quedó ningún ítem sin hacer.</p>}
    </div>
  )
}

function CorrectiveBody({ corrective }: { corrective: NonNullable<AppHistoryRecord["corrective"]> }) {
  return (
    <>
      <div className="card">
        <div className="cap">Qué se hizo</div>
        <p style={{ margin: "8px 0 0", fontSize: 16, lineHeight: 1.4, overflowWrap: "anywhere" }}>{corrective.description}</p>
        <p className="hint">{formatHours(corrective.hours)} en total</p>
      </div>
      {corrective.jobs.length > 0 ? (
        <div className="card">
          <div className="cap" style={{ marginBottom: 8 }}>Trabajos</div>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
            {corrective.jobs.map((job, index) => (
              <li key={`${job.workTypeName}-${index}`} style={{ fontSize: 16, lineHeight: 1.35 }}>
                <strong>{job.workTypeName}</strong> · {formatHours(job.hours)}
                {job.parts.length > 0 ? (
                  <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                    {job.parts.map((part, partIndex) => <li key={`${part.description}-${partIndex}`} style={{ display: "list-item", listStyle: "disc" }}>{part.quantity} × {part.description}</li>)}
                  </ul>
                ) : <div className="hint" style={{ margin: "2px 0 0" }}>Sin repuestos</div>}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {corrective.stillInWorkshop || corrective.workshopEntryDate ? (
        <div className="card">
          <div className="cap">Taller</div>
          <p style={{ margin: "8px 0 0", fontSize: 16, lineHeight: 1.4 }}>
            {corrective.workshopEntryDate ? <>Entró el {formatDate(corrective.workshopEntryDate)}. </> : null}
            {corrective.stillInWorkshop ? <strong>Sigue en taller.</strong> : corrective.workshopExitDate ? <>Salió el {formatDate(corrective.workshopExitDate)}.</> : null}
          </p>
        </div>
      ) : null}
    </>
  )
}

/** Contenido del detalle (de sólo lectura), para usarlo dentro de una hoja propia o dentro de otra. */
export function RecordDetailBody({ record }: { record: AppHistoryRecord }) {
  const { rows } = useAppData()
  const eq = rows.find((row) => row.eq.id === record.vehicleId)?.eq
  const label = eq ? equipmentLabel(eq) : null
  const photoLabel = `registro ${record.folio ?? formatDate(record.workDate)}${label ? ` de ${label}` : ""}`
  return (
    <>
      <dl className="dl">
        <Row label="Trabajo">{recordKindText(record.kind, record.schedule?.intervalValue ?? null, record.unit)}</Row>
        {label ? <Row label="Equipo"><span className="mono" style={{ fontSize: 15 }}>{label}</span></Row> : null}
        <Row label="Folio"><span className="mono nw" style={{ fontSize: 15 }}>{record.folio ?? "Folio pendiente"}</span></Row>
        <Row label="Fecha">{formatDate(record.workDate)}</Row>
        <Row label="Lectura"><span className="mono nw" style={{ fontSize: 15 }}>{formatReading(record.reading, record.unit)}</span></Row>
        <Row label="Faena">{record.worksiteName}</Row>
        <Row label="Ejecutó">{executorLabel(record)}</Row>
        {record.workOrderFolio ? <Row label="Orden de trabajo"><span className="mono nw" style={{ fontSize: 15 }}>{record.workOrderFolio}</span></Row> : null}
      </dl>
      {record.kind === "P" ? <PreventiveBody record={record} /> : null}
      {record.corrective ? <CorrectiveBody corrective={record.corrective} /> : null}
      {record.notes ? (
        <div className="card">
          <div className="cap">Notas</div>
          <p style={{ margin: "8px 0 0", fontSize: 16, lineHeight: 1.4, overflowWrap: "anywhere" }}>{record.notes}</p>
        </div>
      ) : null}
      {record.photos.length > 0 ? (
        <section className="phgrid" aria-label="Fotos del registro">
          {record.photos.map((photo) => <HistoryPhoto key={photo.id} photo={photo} label={photoLabel} />)}
        </section>
      ) : null}
    </>
  )
}

/** Detalle de un registro del historial, en su propia hoja (para abrirlo desde el inicio). */
export function RecordDetailSheet({ record, onClose }: { record: AppHistoryRecord; onClose: () => void }) {
  return (
    <Sheet title={record.folio ?? "Registro"} onClose={onClose}>
      <RecordDetailBody record={record} />
      <button type="button" className="btns wide" onClick={onClose}>Cerrar</button>
    </Sheet>
  )
}
