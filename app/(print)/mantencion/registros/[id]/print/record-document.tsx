import { photoCaption } from "@/components/mantencion/jefatura/registros/photo-labels"
import { recordAlertTags } from "@/components/mantencion/jefatura/registros/record-alerts"
import { executorText, formatHours, formatNumber, formatReading, ITEM_VALUE_LABEL, recordKindText } from "@/lib/mantencion/format"
import type { RecordDetail } from "@/lib/services/mantencion/records-detail"
import { formatDate, formatDateTime } from "@/lib/utils"

/**
 * Hoja del registro firmado. Se imprime tal cual a A4 con Chromium: el encabezado
 * de empresa va sólo en la primera hoja y «Página X de Y» lo pone el pie del PDF.
 * Todo sale del registro y de su snapshot (`RecordDetail`): editar después la
 * ficha del equipo o la pauta no cambia este documento.
 */
export function RecordDocument({ detail, logoSrc }: { detail: RecordDetail; logoSrc: string }) {
  const folio = detail.folio ?? "Folio pendiente"
  const tags = recordAlertTags(detail)
  const equipment = detail.equipment
  const plate = equipment.noPlate || equipment.plate === equipment.code ? "Sin patente" : equipment.plate

  return (
    <main className="sheet" data-print-ready="" aria-label={`Registro de mantención ${folio}`}>
      <header className="head">
        <div>
          {/* El logo es decorativo: el nombre de la empresa ya está en el texto del pie. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoSrc} alt="" />
          <h1>Registro de mantención {detail.kind === "P" ? "preventiva" : "correctiva"}</h1>
          <p className="sub">{equipment.code} · {plate} · Faena {detail.worksiteName}</p>
        </div>
        <div className="folio">
          <div className="code">{folio}</div>
          <div className="kind">{recordKindText(detail.kind, detail.schedule?.intervalValue ?? null, detail.unit)}</div>
        </div>
      </header>

      {detail.voided && (
        <div className="void" role="note">
          <strong>ANULADO</strong>
          <p>Motivo: {detail.voided.reason}</p>
          <p>Anulado por {detail.voided.userName} el {formatDateTime(detail.voided.createdAt)}.</p>
        </div>
      )}

      <section>
        <h2>Equipo</h2>
        <dl className="grid">
          <Item label="Código" value={equipment.code} />
          <Item label="Patente" value={plate} />
          <Item label="Tipo" value={equipment.type} />
          <Item label="Marca y modelo" value={[equipment.brand, equipment.model].filter(Boolean).join(" ") || "—"} />
          <Item label="Año" value={equipment.year ? String(equipment.year) : "—"} />
          <Item label="Faena" value={detail.worksiteName} />
        </dl>
      </section>

      <section>
        <h2>Datos del registro</h2>
        <dl className="grid">
          <Item label="Fecha del trabajo" value={formatDate(detail.workDate)} />
          <Item label="Lectura" value={formatReading(detail.reading, detail.unit)} mono />
          <Item
            label="Lectura anterior"
            value={detail.previousReading ? `${formatReading(detail.previousReading.value, detail.unit)} · ${formatDate(detail.previousReading.date)}` : "—"}
            mono
          />
          <Item label="Hecho por" value={detail.executorName} />
          <Item label="Registrado por" value={detail.registeredByName} />
          <Item label="Autoría" value={executorText({ executorKind: detail.executorKind, registeredByName: detail.registeredByName, executorName: detail.executorName })} />
          <Item label="Firmado en el teléfono" value={formatDateTime(detail.signedAt)} />
          <Item label="Recibido en la plataforma" value={formatDateTime(detail.receivedAt)} />
          {detail.schedule && (
            <Item
              label="Pauta usada"
              value={`${detail.schedule.name} (versión ${detail.schedule.version}) · ${formatReading(detail.schedule.intervalValue, detail.unit)}`}
            />
          )}
          {detail.schedule && detail.schedule.intervalValue !== detail.schedule.suggestedIntervalValue && (
            <Item
              wide
              label={`Elegida a mano (la sugerida era ${formatReading(detail.schedule.suggestedIntervalValue, detail.unit)})`}
              value={detail.schedule.manualReason ?? "—"}
            />
          )}
        </dl>
        {tags.length > 0 && (
          <div className="tags" aria-label="Alertas">
            {tags.map((tag) => <span key={tag.key} className="tag">{tag.label}</span>)}
          </div>
        )}
      </section>

      {detail.kind === "P" ? <Preventive detail={detail} /> : <Corrective detail={detail} />}

      <section>
        <h2>Fotos de respaldo</h2>
        <div className="photos">
          {detail.photos.map((photo, index) => (
            <figure key={photo.id}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/mantencion/fotos/${photo.id}`} alt={`${photoCaption(detail.photos, index)} del equipo ${equipment.code}, sello del ${formatDateTime(photo.stampedAt)}`} />
              <figcaption>
                <strong>{photoCaption(detail.photos, index)}</strong>
                {" · "}sello {formatDateTime(photo.stampedAt)}
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      {detail.observations.length > 0 && (
        <section>
          <h2>Observaciones de la revisión</h2>
          <table>
            <tbody>
              {detail.observations.map((observation) => (
                <tr key={observation.id}>
                  <td>
                    <strong>{observation.userName}</strong> · {formatDateTime(observation.createdAt)}
                    <p className="note">{observation.text}</p>
                    {observation.response && (
                      <p className="note"><strong>Respuesta de {observation.respondedByName}</strong> · {observation.respondedAt ? formatDateTime(observation.respondedAt) : ""}: {observation.response}</p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section>
        <h2>Firmas</h2>
        <div className="sigs">
          <div className="sig">
            <div className="label">Mecánico</div>
            <div className="who">{detail.registeredByName}</div>
            <div>Firmado con su cuenta el {formatDateTime(detail.signedAt)}.</div>
            <div>Recibido en la plataforma el {formatDateTime(detail.receivedAt)}.</div>
          </div>
          <div className="sig pending">
            <div className="label">Firma jefatura (segunda etapa)</div>
          </div>
        </div>
      </section>

      <p className="foot">Documento generado desde el registro firmado {folio}. Plataforma Chome · Mantención de equipos.</p>
    </main>
  )
}

function Item({ label, value, wide, mono }: { label: string; value: string; wide?: boolean; mono?: boolean }) {
  return (
    <div className={wide ? "wide" : undefined}>
      <dt>{label}</dt>
      <dd className={mono ? "mono" : undefined}>{value}</dd>
    </div>
  )
}

function Preventive({ detail }: { detail: RecordDetail }) {
  const all = detail.groups.flatMap((group) => group.items)
  const done = all.filter((item) => item.value === "R").length
  const notDone = all.filter((item) => item.value === "NR").length
  const notApplicable = all.filter((item) => item.value === "NA").length
  return (
    <>
      <section>
        <h2>Resultado de la pauta</h2>
        <p style={{ margin: "0 0 6px" }}>
          <strong>{formatNumber(done)}</strong> realizados · <strong>{formatNumber(notDone)}</strong> no realizados · <strong>{formatNumber(notApplicable)}</strong> no aplica
        </p>
        <table>
          <thead>
            <tr><th>Ítem</th><th>Resultado</th><th>Motivo</th></tr>
          </thead>
          <tbody>
            {detail.groups.map((group) => (
              <GroupRows key={group.name} group={group} />
            ))}
          </tbody>
        </table>
      </section>
      <section>
        <h2>Observaciones del mecánico</h2>
        <p className="note">{detail.notes ?? "—"}</p>
      </section>
    </>
  )
}

function GroupRows({ group }: { group: RecordDetail["groups"][number] }) {
  return (
    <>
      <tr className="group"><td colSpan={3}>{group.name}</td></tr>
      {group.items.map((item) => (
        <tr key={item.key}>
          <td>
            {item.name}
            {item.manufacturerWarning && <div className="warn">Confirmar con pauta del fabricante</div>}
          </td>
          <td className={`res ${item.value === "NR" ? "nr" : ""}`}>{ITEM_VALUE_LABEL[item.value]}</td>
          <td>{item.reason ?? ""}</td>
        </tr>
      ))}
    </>
  )
}

function Corrective({ detail }: { detail: RecordDetail }) {
  const corrective = detail.corrective
  if (!corrective) return null
  return (
    <>
      <section>
        <h2>Trabajo realizado</h2>
        <dl className="grid">
          <Item label="Tipo de trabajo" value={corrective.workTypes.join(", ")} />
          <Item label="Cambio de aceite" value={corrective.oils.length ? corrective.oils.join(", ") : "No se cambió aceite"} />
          <Item label="Horas trabajadas" value={formatHours(corrective.hours)} mono />
          {corrective.workOrder && <Item label="Orden de trabajo" value={corrective.workOrder} />}
        </dl>
        <p className="note">{corrective.description}</p>
      </section>
      <section>
        <h2>Repuestos</h2>
        {corrective.parts.length === 0 ? (
          <p className="note">No se usaron repuestos.</p>
        ) : (
          <table>
            <thead><tr><th>Cantidad</th><th>Repuesto</th></tr></thead>
            <tbody>
              {corrective.parts.map((part, index) => (
                <tr key={index}><td className="num mono">{formatNumber(part.quantity)} ×</td><td>{part.description}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section>
        <h2>Taller</h2>
        <dl className="grid">
          <Item label="Entró a taller" value={corrective.workshopEntryDate ? formatDate(corrective.workshopEntryDate) : "No pasó por taller"} />
          <Item label="Estado" value={corrective.workshop ? (corrective.workshop.inWorkshop ? "Sigue en taller" : `Salió el ${corrective.workshop.exitDate ? formatDate(corrective.workshop.exitDate) : "—"}`) : "—"} />
          <Item label="Días detenido" value={corrective.workshop?.daysStopped != null ? String(corrective.workshop.daysStopped) : "—"} />
        </dl>
        {corrective.updates.length > 0 && (
          <table style={{ marginTop: 6 }}>
            <tbody>
              {corrective.updates.map((update) => (
                <tr key={update.id}>
                  <td>{update.kind === "salio" ? `Salió de taller el ${update.exitDate ? formatDate(update.exitDate) : "—"}` : `Sigue en taller: ${update.note ?? ""}`}</td>
                  <td className="num">{update.userName} · {formatDateTime(update.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section>
        <h2>Conductores de las últimas 24 h</h2>
        <p className="note">{corrective.drivers.join(" · ") || "—"}</p>
      </section>
    </>
  )
}
