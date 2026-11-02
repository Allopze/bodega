import { OT_STATE_META, equipmentText } from "@/components/mantencion/jefatura/ot/ot-labels"
import { formatTimeOnly } from "@/components/mantencion/jefatura/ot/ot-format"
import { formatNumber } from "@/lib/mantencion/format"
import type { OtItemKind } from "@/lib/mantencion/work-order-states"
import type { WorkOrderLinkedWork } from "@/lib/services/mantencion/work-orders/linked-work"
import type { WorkOrderDetail } from "@/lib/services/mantencion/work-orders/types"
import { formatDate, formatDateTime, todayInChile } from "@/lib/utils"

/**
 * Talonario de la OT para imprimir. Replica el papel: Nº, equipo, REPARACIÓN /
 * MANTENCIÓN, fecha y solicitante; la descripción; las dos listas numeradas con
 * SÍ / NO; observaciones; y los cuatro recuadros de INGRESO, SALIDA, RECEPCIÓN y
 * RECEPCIÓN EN FAENA. Se genera al vuelo, nunca se archiva: la OT cambia.
 *
 * A diferencia del papel, abre con «Resultado» (estado, conformidad,
 * devoluciones y plazo) y lista los trabajos que el mecánico firmó contra la
 * OT: quien la lee sin contexto tiene que saber cómo terminó y qué se hizo sin
 * reconstruirlo campo por campo.
 */
export function OtDocument({ detail, linkedWork, logoSrc }: { detail: WorkOrderDetail; linkedWork: WorkOrderLinkedWork[]; logoSrc: string }) {
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
        </div>
      </header>

      <Outcome detail={detail} />

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
          {detail.requestedByName !== detail.requesterName && <Item label="Creada por" value={detail.requestedByName} />}
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

      <LinkedWork rows={linkedWork} />

      <section>
        <h2>Ingreso a taller</h2>
        <dl className="grid">
          <Item label="Fecha ingreso" value={entry ? formatDate(entry.entryAt) : "—"} mono />
          <Item label="Hora ingreso" value={entry ? formatTimeOnly(entry.entryAt) : "—"} mono />
          <Item label="Fec. estimada entrega" value={entry ? formatDate(entry.estimatedDeliveryDate) : "—"} mono />
          <Item label="Taller" value={entry ? entry.workshopName ?? (entry.workshopKind === "interno" ? "Interno" : "Externo") : "—"} />
          <Item label="Encargado" value={entry?.workshopManagerName ?? "—"} />
          <Item label="Operador" value={entry?.operatorName ?? "—"} />
          <Item label="Kilometraje" value={entry?.odometer != null ? `${formatNumber(entry.odometer)} km` : "—"} mono />
          <Item label="Horómetro" value={entry?.hourmeter != null ? `${formatNumber(entry.hourmeter)} h` : "—"} mono />
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
          <Item label="Recibido por" value={detail.reception?.receiverName ?? "—"} />
        </dl>
      </section>

      <section>
        <h2>Recepción en faena</h2>
        <dl className="grid">
          <Item label="Fecha" value={detail.faenaReception ? formatDate(detail.faenaReception.receivedAt) : "—"} mono />
          <Item label="Hora" value={detail.faenaReception ? formatTimeOnly(detail.faenaReception.receivedAt) : "—"} mono />
          <Item label="Recibido por" value={detail.faenaReception?.receiverName ?? "—"} />
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

/** Líneas numeradas con SÍ / NO. Sólo las pedidas: las líneas vacías del papel, impresas, parecían datos que faltaban. */
function ItemTable({ detail, kind, title }: { detail: WorkOrderDetail; kind: OtItemKind; title: string }) {
  const items = detail.items.filter((item) => item.kind === kind).sort((a, b) => a.sortOrder - b.sortOrder)
  return (
    <section>
      <h2>{title}</h2>
      {items.length === 0 ? <p className="pending">No se pidieron.</p> : (
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
                <td className={`yn ${item.done === "no" ? "no" : ""}`}>{item.done === "si" ? "SÍ" : item.done === "no" ? "NO" : <span className="blank">Sin marcar</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

/** Días calendario entre dos fechas `aaaa-mm-dd`. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`
}

/** Plazo: la salida real (o hoy, si sigue en taller) contra la entrega estimada. */
function deadlineText(detail: WorkOrderDetail): string | null {
  const estimate = detail.entry?.estimatedDeliveryDate
  if (!estimate) return null
  const days = detail.daysInWorkshop
  const inWorkshop = days == null ? ""
    : days === 0 ? (detail.exit ? " · ingresó y salió el mismo día" : " · ingresó hoy")
    : ` · ${plural(days, "día", "días")} en taller`
  if (detail.exit) {
    const delta = daysBetween(estimate, todayInChile(detail.exit.exitAt))
    const when = delta === 0 ? "el día estimado" : delta < 0 ? `${plural(-delta, "día", "días")} antes de lo estimado` : `con ${plural(delta, "día", "días")} de atraso`
    return `Salió de taller ${when} (${formatDate(estimate)})${inWorkshop}.`
  }
  if (detail.status === "en_ejecucion") {
    const late = daysBetween(estimate, todayInChile())
    return late > 0
      ? `Sigue en taller: la entrega estimada (${formatDate(estimate)}) venció hace ${plural(late, "día", "días")}${inWorkshop}.`
      : `En taller; entrega estimada el ${formatDate(estimate)}${inWorkshop}.`
  }
  return null
}

/** Lo que falta en cada etapa, dicho como el siguiente paso. */
const NEXT_STEP: Partial<Record<WorkOrderDetail["status"], string>> = {
  solicitada: "Falta asignar un mecánico.",
  asignada: "Falta registrar el ingreso a taller.",
  trabajo_terminado: "Salió de taller; falta registrar la recepción.",
  recepcionada: "Recibido; falta la recepción en faena (conformidad).",
}

function Outcome({ detail }: { detail: WorkOrderDetail }) {
  const rejections = detail.events.filter((event) => event.type === "rejected").sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const lastRejection = rejections.at(-1)
  const deadline = deadlineText(detail)
  const tone = detail.status === "cerrada" ? "ok" : detail.status === "anulada" ? "bad" : "open"
  return (
    <section className={`outcome ${tone}`} aria-label="Resultado">
      <div className="outcome-state">{OT_STATE_META[detail.status].label}</div>
      <ul>
        {detail.faenaReception ? (
          <li><strong>Conforme.</strong> Recepción en faena de {detail.faenaReception.receiverName}, el {formatDateTime(detail.faenaReception.receivedAt)}.</li>
        ) : NEXT_STEP[detail.status] ? <li>{NEXT_STEP[detail.status]}</li> : null}
        {lastRejection && (
          <li>
            <strong>Devuelta {plural(detail.rejectionCount || rejections.length, "vez", "veces")}.</strong>
            {" "}Último motivo ({formatDateTime(lastRejection.createdAt)}): «{lastRejection.reason ?? "sin motivo"}».
          </li>
        )}
        {deadline && <li>{deadline}</li>}
      </ul>
    </section>
  )
}

function LinkedWork({ rows }: { rows: WorkOrderLinkedWork[] }) {
  return (
    <section>
      <h2>Trabajos registrados</h2>
      {rows.length === 0 ? <p className="pending">Todavía no hay trabajos firmados contra esta orden.</p> : (
        <table>
          <thead>
            <tr><th>Folio</th><th>Fecha</th><th>Mecánico</th><th>Trabajo</th><th className="num">Horas</th><th>Repuestos</th></tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={row.voided ? "voided" : undefined}>
                <td className="mono nw">{row.folio ?? "Sin folio"}{row.voided && <div className="note">Anulado</div>}</td>
                <td className="mono nw">{formatDate(row.workDate)}</td>
                <td>{row.executorName}</td>
                <td>{row.kind === "P" ? "Preventiva · " : "Correctiva · "}{row.work}</td>
                <td className="num mono">{row.hours != null ? formatNumber(row.hours) : "—"}</td>
                <td>{row.parts.length ? row.parts.map((part) => `${formatNumber(part.quantity)} × ${part.description}`).join("; ") : "Sin repuestos"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
