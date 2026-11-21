import type { ReactNode } from "react"
import { bucketLabel } from "@/lib/indicators/period"
import { OT_STATUS_LABELS } from "@/lib/mantencion/work-order-states"
import { EQUIPMENT_STATE_LABEL } from "@/lib/mantencion/format"
import { MANT_EQUIPMENT_STATES } from "@/lib/mantencion/types"
import { pautaCompliance } from "@/lib/services/mantencion/indicators"
import { formatDate, formatPercent, formatQty } from "@/lib/utils"
import type { PanelReportData } from "./report-data"

/**
 * Informe del Panel de mantención para imprimir: portada con faena, período y fecha de emisión; las cifras y las
 * tablas del Panel (sin gráficos) y, al pie, de dónde sale cada dato. Mismas definiciones que la pantalla:
 * los «sin clasificar» van aparte del % de correctivas, «sin pauta definida» tiene su propia cifra y la
 * fuente (historial de formularios u órdenes de trabajo) va rotulada.
 */

const days = (value: number) => formatQty(value, undefined, { maximumFractionDigits: 1 })

function Figure({ label, value, aside }: { label: string; value: ReactNode; aside?: ReactNode }) {
  return (
    <div className="figure">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {aside ? <div className="aside">{aside}</div> : null}
    </div>
  )
}

function Unavailable({ what }: { what: string }) {
  return <p className="warn">{what}: no disponible. La consulta falló al emitir este informe; no se imprime un cero en su lugar.</p>
}

export function InformeDocument({ data, logoSrc }: { data: PanelReportData; logoSrc: string }) {
  const { work, pautas, compliance, findings, outOfService, orderStats, openOrders } = data
  const summary = work?.summary
  const source = work?.includesOrders === false
    ? "historial de formularios (sin filas de prueba); este perfil no ve todas las órdenes de trabajo de su alcance"
    : "historial de formularios y órdenes de trabajo no anuladas (sin filas de prueba)"
  const pautaCounts = pautas ? pautaCompliance(pautas.counts) : null

  return (
    <main className="sheet" data-print-ready="" aria-label="Informe del Panel de mantención">
      <header className="cover">
        {/* El logo es decorativo: el nombre de la empresa ya está en el texto. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoSrc} alt="" />
        <h1>Informe de mantención</h1>
        <p className="sub">Panel de mantención · Chome</p>
        <dl className="meta">
          <div><dt>Faena</dt><dd>{data.worksiteName}</dd></div>
          <div><dt>Período</dt><dd>{data.periodLabel}</dd></div>
          <div><dt>Fecha de emisión</dt><dd>{data.issuedOn}</dd></div>
          {data.equipment ? <div><dt>Equipo</dt><dd>{data.equipment.label}</dd></div> : null}
        </dl>
      </header>

      {data.degraded.length > 0 ? <p className="warn">No se pudieron calcular: {data.degraded.join(", ")}.</p> : null}

      <h2>Trabajos de mantención</h2>
      <p className="note">Fuente: {source}. Período medido: {formatDate(data.period.from)} al {formatDate(data.period.to)}.</p>
      {!summary ? <Unavailable what="Trabajos de mantención" /> : (
        <>
          <div className="figures">
            <Figure label="Trabajos del período" value={formatQty(summary.total)} aside={`${formatQty(summary.bySource.historial)} del historial · ${formatQty(summary.bySource.ot)} de OT`} />
            <Figure
              label="Correctivas"
              value={summary.correctivePercent === null ? "Sin dato" : formatPercent(summary.correctivePercent, 0)}
              aside={`${formatQty(summary.byType.correctiva)} de ${formatQty(summary.classified)} clasificados · ${formatQty(summary.byType.sin_clasificar)} sin clasificar aparte`}
            />
            <Figure
              label="Días en taller"
              value={summary.workshopDays.withData === 0 ? "Sin dato" : days(summary.workshopDays.total)}
              aside={`${formatQty(summary.workshopDays.withData)} trabajos con fechas · ${formatQty(summary.workshopDays.withoutData)} sin ellas`}
            />
            <Figure
              label="Horas hombre"
              value={summary.laborHours.withData === 0 ? "Sin dato" : days(summary.laborHours.total)}
              aside={`${formatQty(summary.laborHours.withData)} trabajos con horas · ${formatQty(summary.laborHours.withoutData)} sin ellas`}
            />
          </div>

          <h2>Trabajos por tipo y mes</h2>
          <p className="note">{data.chartCaption}</p>
          <table>
            <thead>
              <tr><th>Período</th><th className="num">Preventiva</th><th className="num">Correctiva</th><th className="num">Predictiva</th><th className="num">Sin clasificar</th></tr>
            </thead>
            <tbody>
              {summary.series.map((point) => (
                <tr key={point.key}>
                  <td>{bucketLabel(point.key, data.period.chart.granularity)}{point.partial ? " (parcial)" : ""}</td>
                  <td className="num">{point.preventiva}</td>
                  <td className="num">{point.correctiva}</td>
                  <td className="num">{point.predictiva}</td>
                  <td className="num">{point.sin_clasificar}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {!data.equipment && summary.byWorksite.length > 0 ? (
            <>
              <h2>Por faena</h2>
              <table>
                <thead>
                  <tr><th>Faena</th><th className="num">Trabajos</th><th className="num">Correctivas</th><th className="num">Días en taller</th><th className="num">Horas hombre</th></tr>
                </thead>
                <tbody>
                  {summary.byWorksite.map((site) => (
                    <tr key={site.key}>
                      <td>{site.name}</td>
                      <td className="num">{site.count}</td>
                      <td className="num">{site.correctives}</td>
                      <td className="num">{days(site.workshopDays)}</td>
                      <td className="num">{days(site.laborHours)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}

          {summary.topCorrective.length > 0 ? (
            <>
              <h2>Equipos con más correctivas</h2>
              <p className="note">Sólo equipos con 2 o más.</p>
              <table>
                <thead><tr><th>Equipo</th><th className="num">Correctivas</th></tr></thead>
                <tbody>
                  {summary.topCorrective.slice(0, 15).map((row) => (
                    <tr key={row.vehicleId}><td>{row.label}</td><td className="num">{row.count}</td></tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}
        </>
      )}

      <h2>Pautas y disponibilidad</h2>
      {!pautas ? <Unavailable what="Estado de las pautas" /> : (
        <>
          <p className="note">Estado de las pautas hoy ({data.issuedOn}), según las pautas y lecturas de los equipos activos de la plataforma.</p>
          <table>
            <thead><tr><th>Estado</th><th className="num">Equipos</th></tr></thead>
            <tbody>
              {MANT_EQUIPMENT_STATES.filter((state) => state !== "baja").map((state) => (
                <tr key={state}>
                  <td>{state === "sin_pauta" ? "Sin pauta definida" : EQUIPMENT_STATE_LABEL[state]}</td>
                  <td className="num">{pautas.counts[state]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {pautas.counts.sin_preventiva > 0 ? (
            <p className="note">
              {pautas.counts.sin_preventiva === 1 ? "1 equipo está" : `${pautas.counts.sin_preventiva} equipos están`} sin información de preventiva: tienen pauta y lectura, pero ninguna preventiva firmada ni declarada, así que no se puede calcular cuándo toca. No cuentan como al día.
            </p>
          ) : null}
          {pautas.declaredPreventives && pautas.declaredPreventives.length > 0 ? (
            <>
              <h3>Preventivas declaradas (anteriores a la plataforma)</h3>
              <p className="note">Estos equipos tienen como última preventiva una declarada por jefatura, no un registro firmado en la plataforma; cuentan en el estado de las pautas con ese respaldo.</p>
              <table>
                <thead><tr><th>Equipo</th><th>Fecha</th><th className="num">Lectura</th><th className="num">Servicio</th><th>Respaldo</th></tr></thead>
                <tbody>
                  {pautas.declaredPreventives.map((row) => (
                    <tr key={row.vehicleId}>
                      <td>{row.code === row.plate ? row.plate : `${row.code} · ${row.plate}`}</td>
                      <td>{formatDate(row.date)}</td>
                      <td className="num">{formatQty(row.reading)}</td>
                      <td className="num">{formatQty(row.intervalValue)}</td>
                      <td>{row.evidence}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}
          <p className="note">
            {pautaCounts && pautaCounts.percent !== null
              ? `${formatPercent(pautaCounts.percent, 0)} de los equipos con pauta está al día (${pautaCounts.onTime} de ${pautaCounts.withSchedule}); los equipos sin pauta definida no entran en ese porcentaje.`
              : "Aún no hay equipos con pauta: no hay porcentaje al día que informar."}
          </p>
        </>
      )}
      {outOfService ? (
        <p className="note">Días-equipo fuera de servicio en el período: <strong>{days(outOfService.total)}</strong> (período anterior: {days(outOfService.totalPrevious)}).</p>
      ) : <Unavailable what="Días fuera de servicio" />}

      <h2>Pautas y hallazgos de formularios</h2>
      {!compliance ? <Unavailable what="Checklist de pauta (formularios)" /> : (
        <p className="note">
          Checklist de pauta (formularios):{" "}
          <strong>{compliance.averagePercent === null ? "sin pautas importadas con cumplimiento en el período" : `${formatPercent(compliance.averagePercent, 0)} de promedio`}</strong>
          {compliance.averagePercent === null ? "" : ` sobre ${formatQty(compliance.withCompliance)} pautas importadas`}. No es el semáforo de la plataforma.
        </p>
      )}
      {!findings ? <Unavailable what="Hallazgos en mal estado sin trabajo" /> : (
        <>
          <p className="note">
            Hallazgos «mal estado» de inspecciones importadas: {formatQty(findings.total)} del período con equipo vinculado;{" "}
            <strong>{formatQty(findings.withoutWork)}</strong> sin trabajo ni OT registrados en los {findings.days} días siguientes
            {findings.inWindow > 0 ? `; ${formatQty(findings.inWindow)} aún dentro del plazo` : ""}
            {findings.unlinked > 0 ? `; ${formatQty(findings.unlinked)} sin equipo vinculado (no se puede saber si hubo trabajo)` : ""}.
          </p>
          {findings.byEquipment.length > 0 ? (
            <table>
              <thead><tr><th>Equipo</th><th>Faena</th><th className="num">Hallazgos</th><th>Desde</th><th>Ítems</th></tr></thead>
              <tbody>
                {findings.byEquipment.map((row) => (
                  <tr key={row.vehicleId}>
                    <td>{row.label}</td>
                    <td>{row.worksiteName ?? "Sin faena"}</td>
                    <td className="num">{row.count}</td>
                    <td>{formatDate(row.firstFoundOn)}</td>
                    <td>{row.items.join("; ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </>
      )}

      {data.canViewOrders ? (
        <>
          <h2>Órdenes de trabajo</h2>
          {!orderStats ? <Unavailable what="Órdenes de trabajo" /> : (
            <p className="note">
              OT cerradas en el período: <strong>{formatQty(orderStats.closed)}</strong> (período anterior: {formatQty(orderStats.closedPrevious)}).
              {orderStats.mttrHours === null ? " Aún no hay reparaciones cerradas con su paso por taller para medir el tiempo medio." : ` Tiempo medio de reparación: ${days(orderStats.mttrHours)} h.`}
            </p>
          )}
          {openOrders && openOrders.length > 0 ? (
            <table>
              <thead><tr><th>OT abiertas hoy, por estado</th><th className="num">OT</th></tr></thead>
              <tbody>
                {openOrders.map((item) => (<tr key={item.status}><td>{OT_STATUS_LABELS[item.status]}</td><td className="num">{item.count}</td></tr>))}
              </tbody>
            </table>
          ) : null}
        </>
      ) : null}

      <p className="note muted">
        Los trabajos, el checklist de pauta y los hallazgos incluyen el historial importado de formularios, que no son registros firmados en la plataforma; el estado de las pautas y las OT son datos nativos.
        Generado el {data.issuedOn}.
      </p>
    </main>
  )
}
