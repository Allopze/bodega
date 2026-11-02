import { OT_STATE_META, equipmentText } from "@/components/mantencion/jefatura/ot/ot-labels"
import { formatTimeOnly } from "@/components/mantencion/jefatura/ot/ot-format"
import { formatNumber } from "@/lib/mantencion/format"
import { OT_ITEM_MAX_PER_KIND, type OtItemKind } from "@/lib/mantencion/work-order-states"
import type { WorkOrderDetail } from "@/lib/services/mantencion/work-orders/types"
import { formatDate, formatDateTime } from "@/lib/utils"

/**
 * Talonario de la OT para imprimir. Replica el papel: Nº, equipo, REPARACIÓN /
 * MANTENCIÓN, fecha y solicitante; la descripción; las dos listas numeradas con
 * SÍ / NO; observaciones; y los cuatro recuadros de INGRESO, SALIDA, RECEPCIÓN y
 * RECEPCIÓN EN FAENA. Se genera al vuelo, nunca se archiva: la OT cambia.
 */
export function OtDocument({ detail, logoSrc }: { detail: WorkOrderDetail; logoSrc: string }) {
  const entry = detail.entry
  return (
    <main className="sheet" data-print-ready="" aria-label={`Orden de trabajo ${detail.folio}`}>
      <header className="head">
        <div>
          {/* El logo es decorativo: el nombre de la empresa ya está en el texto del pie. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoSrc} alt="" />
          <h1>Orden de trabajo reparación / mantención</h1>
          <p className="sub">Faena {detail.worksiteName}</p>
        </div>
        <div className="folio">
          <div className="label">Nº</div>
          <div className="code">{detail.folio}</div>
          <div className="state">{OT_STATE_META[detail.status].label}</div>
        </div>
      </header>

      {detail.voided && (
        <div className="void" role="note">
          <strong>ANULADA</strong>
          <p>Motivo: {detail.voided.reason}</p>
          <p>Anulada por {detail.voided.byName ?? "—"} el {formatDateTime(detail.voided.at)}.</p>
        </div>
      )}

      <section>
        <div className="types" role="group" aria-label="Tipo de trabajo">
          <span><span className="box">{detail.repair ? "X" : ""}</span>Reparación<span className="sr-only">{detail.repair ? ": marcada" : ""}</span></span>
          <span><span className="box">{detail.maintenance ? "X" : ""}</span>Mantención<span className="sr-only">{detail.maintenance ? ": marcada" : ""}</span></span>
        </div>
        <dl className="grid">
          <Item label="Equipo" value={equipmentText(detail)} mono />
          <Item label="Fecha OT" value={formatDate(detail.requestDate)} mono />
          <Item label="Solicitante" value={detail.requesterName} />
          <Item label="Tipo de equipo" value={detail.equipmentType} />
          <Item label="Mecánico" value={detail.assignedToName ?? "Sin asignar"} />
          <Item label="Creada por" value={detail.requestedByName} />
        </dl>
      </section>

      {detail.repair && (
        <section>
          <h2>Reparación</h2>
          <p className="note">{detail.repairDescription || "—"}</p>
        </section>
      )}

      {(detail.repair || detail.items.some((item) => item.kind === "anexo")) && (
        <ItemTable detail={detail} kind="anexo" title="Trabajos anexos (reparación)" />
      )}
      <ItemTable detail={detail} kind="mantencion" title="Registro de mantenciones solicitadas o asignadas en taller" />

      <section>
        <h2>Observaciones</h2>
        <p className="note">{detail.observations || "—"}</p>
      </section>

      <section>
        <h2>Ingreso a taller</h2>
        <dl className="grid">
          <Item label="Encargado" value={entry?.workshopManagerName ?? "—"} />
          <Item label="Taller" value={entry ? entry.workshopName ?? (entry.workshopKind === "interno" ? "Taller interno" : "Taller externo") : "—"} />
          <Item label="Hora ingreso" value={entry ? formatTimeOnly(entry.entryAt) : "—"} mono />
          <Item label="Kilómetro" value={entry?.odometer != null ? formatNumber(entry.odometer) : "—"} mono />
          <Item label="Operador" value={entry?.operatorName ?? "—"} />
          <Item label="Fecha ingreso" value={entry ? formatDate(entry.entryAt) : "—"} mono />
          <Item label="Horómetro" value={entry?.hourmeter != null ? formatNumber(entry.hourmeter) : "—"} mono />
          <Item label="Fec. estimada entrega" value={entry ? formatDate(entry.estimatedDeliveryDate) : "—"} mono />
        </dl>
      </section>

      <section>
        <h2>Salida taller</h2>
        <dl className="grid">
          <Item label="Fecha" value={detail.exit ? formatDate(detail.exit.exitAt) : "—"} mono />
          <Item label="Hora" value={detail.exit ? formatTimeOnly(detail.exit.exitAt) : "—"} mono />
        </dl>
      </section>

      <section>
        <h2>Recepción</h2>
        <dl className="grid">
          <Item label="Fecha" value={detail.reception ? formatDate(detail.reception.receivedAt) : "—"} mono />
          <Item label="Hora" value={detail.reception ? formatTimeOnly(detail.reception.receivedAt) : "—"} mono />
          <Item label="Sr." value={detail.reception?.receiverName ?? "—"} />
        </dl>
      </section>

      <section>
        <h2>Recepción en faena</h2>
        <dl className="grid">
          <Item label="Fecha" value={detail.faenaReception ? formatDate(detail.faenaReception.receivedAt) : "—"} mono />
          <Item label="Hora" value={detail.faenaReception ? formatTimeOnly(detail.faenaReception.receivedAt) : "—"} mono />
          <Item label="Sr." value={detail.faenaReception?.receiverName ?? "—"} />
        </dl>
      </section>

      <p className="foot">Documento generado el {formatDateTime(new Date())} desde la orden {detail.folio}; refleja su estado a esa hora. Plataforma Chome · Mantención de equipos.</p>
    </main>
  )
}

function Item({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={mono ? "mono" : undefined}>{value}</dd>
    </div>
  )
}

/** Líneas numeradas con SÍ / NO. Se completan hasta el mínimo de 4 líneas vacías como el papel, sin pasar de 12. */
function ItemTable({ detail, kind, title }: { detail: WorkOrderDetail; kind: OtItemKind; title: string }) {
  const items = detail.items.filter((item) => item.kind === kind).sort((a, b) => a.sortOrder - b.sortOrder)
  const blanks = Math.max(0, Math.min(OT_ITEM_MAX_PER_KIND, Math.max(4, items.length)) - items.length)
  return (
    <section>
      <h2>{title}</h2>
      <table>
        <thead>
          <tr><th className="n">N°</th><th>Trabajo</th><th>SÍ / NO</th></tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr key={item.id}>
              <td className="n">{index + 1}</td>
              <td>
                {item.description}
                {item.note && <div className="note">{item.note}</div>}
              </td>
              <td className={`yn ${item.done === "no" ? "no" : ""}`}>{item.done === "si" ? "SÍ" : item.done === "no" ? "NO" : <span className="blank">—</span>}</td>
            </tr>
          ))}
          {Array.from({ length: blanks }, (_, index) => (
            <tr key={`blank-${index}`} aria-hidden>
              <td className="n">{items.length + index + 1}</td>
              <td>&nbsp;</td>
              <td className="yn"></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
