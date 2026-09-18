import { CheckCircle, Target, ChartBar } from "@phosphor-icons/react/dist/ssr"
import { cn, MONTH_LABELS, QUARTER_LABELS } from "@/lib/utils"
import { Table, TableBody, TableCell, TableCellNum, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { PersistedDetails } from "./persisted-details"
import { buildPdtpActivitiesHref } from "./pdtp-context"
import type { PdtpComplianceIndicators, PdtpIntegralCompliance } from "@/lib/services/prevention-pdtp"

/** Título exacto acordado para la columna "En cero": explica qué mide y por
 * qué el % mensual puede seguir en 100 % aunque existan actividades en cero
 * (el techo de sobrecumplimiento sigue siendo por mes, no cambia por esto). */
const ZERO_ACTIVITIES_COLUMN_TITLE =
  "Actividades con planificación en el mes y ninguna ejecución aprobada. El % mensual puede llegar a 100 % por compensación entre actividades."

function fmtPct(ratio: number | null): string {
  if (ratio === null) return "—"
  return `${Math.round(ratio * 100)}%`
}

function ComplianceBar({ value, target }: { value: number | null; target: number }) {
  const pct = value === null ? 0 : Math.min(1, value)
  const isOk = value !== null && value >= target
  return (
    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
      <div
        className={cn("h-full rounded-full transition-[width] duration-300", isOk ? "bg-[var(--color-success)]" : "bg-[var(--color-primary)]")}
        style={{ width: `${Math.round(pct * 100)}%` }}
      />
    </div>
  )
}

const DATE_TIME_FORMAT = new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Santiago" })

function fmtDateTime(iso: string): string {
  return DATE_TIME_FORMAT.format(new Date(iso))
}

export function PdtpIndicatorsPanel({ data, integral, asOf, worksiteId }: {
  data: PdtpComplianceIndicators
  integral?: PdtpIntegralCompliance | null
  asOf?: string
  /** Faena elegida en la vista que llama a este panel (no viaja en `data`:
   * el indicador agregado por alcance no tiene una sola faena). Se usa solo
   * para conservar el filtro al enlazar al visor de actividades. */
  worksiteId?: string
}) {
  const { monthly, quarterly, annual, target, lastExecutionUpdatedAt, programId, year } = data
  // `estado=en_cero` es el filtro del visor que corresponde exactamente a lo
  // que esta columna cuenta (`pending ∪ overdue`, sin `coverage`/
  // `closed_on_time` — ver `isPdtpActivityZeroThisMonth` en `period.ts`).
  // `estado=overdue` a secas escondía el caso más común: una actividad en
  // cero sin un mes *anterior* también en cero es "pending", no "overdue".
  //
  // `vista=anual`, no `semana`: la vista semanal filtra candidatas por la
  // semana de HOY (si no se pasa `?semana=`), que no tiene por qué coincidir
  // con la semana en que se planificó la actividad en el mes `M` que se está
  // mirando — para cualquier mes que no sea el actual, esa combinación deja
  // la lista vacía aunque el filtro de estado esté bien. "En cero" es un
  // concepto mensual, y la vista anual sí filtra por mes sin esa segunda
  // restricción de semana.
  const zeroActivitiesHref = (month: number) => buildPdtpActivitiesHref({
    programa: programId,
    anio: String(year),
    faena: worksiteId,
    vista: "anual",
    estado: "en_cero",
    mes: month,
  })

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-[var(--color-text-muted)]">
        <p>El cumplimiento formal considera únicamente ejecuciones aprobadas.</p>
        <p>
          {asOf && <span>Datos al {fmtDateTime(asOf)}</span>}
          {lastExecutionUpdatedAt && <span className="ml-2">· Última ejecución aprobada: {fmtDateTime(lastExecutionUpdatedAt)}</span>}
        </p>
      </div>

      {/* Cabecera compacta: gestión preventiva (con desglose de ejes en una línea) + anual + meta.
          Los trimestres viven en el desglose plegable para no saturar la entrada. */}
      <div className="overflow-hidden border-y border-[var(--color-border)]">
        <div className="-ml-px -mt-px flex flex-wrap">
          {integral && <IntegralTile integral={integral} />}

          {/* Cumplimiento anual: navega a los registros que lo componen. */}
          <a href="#registros-pdtp" className="flex-1 min-w-[10rem] border-l border-t border-[var(--color-border)] transition-colors hover:bg-[var(--color-surface-2)]">
            <div className="px-4 py-3">
              <div className="flex items-center gap-1.5">
                <ChartBar size={13} className="shrink-0 text-[var(--color-text-faint)]" />
                <span className="text-eyebrow">Cumplimiento anual</span>
              </div>
              <div className="mt-2 flex items-end gap-2">
                <span className={cn(
                  "font-mono text-[1.375rem] font-semibold leading-none tabular-nums tracking-tight",
                  annual.percent !== null && annual.percent >= target
                    ? "text-[var(--color-success-ink)]"
                    : "text-[var(--color-text)]"
                )}>
                  {fmtPct(annual.percent)}
                </span>
                <span className="mb-1 text-xs text-[var(--color-text-subtle)]">Plan {annual.planned} · ejecutado {annual.executed}</span>
              </div>
              <ComplianceBar value={annual.percent} target={target} />
            </div>
          </a>

          {/* Meta */}
          <div className="flex-1 min-w-[8rem] border-l border-t border-[var(--color-border)]">
            <div className="px-4 py-3">
              <div className="flex items-center gap-1.5">
                <Target size={13} className="shrink-0 text-[var(--color-text-faint)]" />
                <span className="text-eyebrow">Meta anual</span>
              </div>
              <div className="mt-2">
                <span className="font-mono text-[1.375rem] font-semibold leading-none tabular-nums tracking-tight text-[var(--color-text)]">
                  {Math.round(target * 100)}%
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Desglose mensual + trimestral — colapsable con estado persistido */}
      <PersistedDetails storageKey="indicators-monthly"
        summary={<>
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            className="shrink-0 rotate-0 transition-transform duration-200 group-open:rotate-90"
            aria-hidden
          >
            <path d="M4 2.5L8.5 6L4 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
          Ver desglose mensual y trimestral
        </>}
      >

        {/* Resumen trimestral */}
        <div className="mt-3 flex flex-wrap gap-2">
          {quarterly.map((q) => {
            const meetsTarget = q.percent !== null && q.percent >= target
            return (
              <div key={q.quarter} className="min-w-[6rem] flex-1 rounded-(--radius) border border-[var(--color-border)] px-3 py-2">
                <span className="text-eyebrow">{QUARTER_LABELS[q.quarter - 1]}</span>
                <div className="mt-1 font-mono text-base font-semibold tabular-nums">
                  <span className={meetsTarget ? "text-[var(--color-success-ink)]" : "text-[var(--color-text)]"}>{fmtPct(q.percent)}</span>
                </div>
                <ComplianceBar value={q.percent} target={target} />
              </div>
            )
          })}
        </div>

        <div className="mt-3">
          <TableRoot>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-1 pr-3">Mes</TableHead>
                  <TableHead className="text-right">Plan</TableHead>
                  <TableHead className="text-right">Ejecutado</TableHead>
                  <TableHead className="text-right">%</TableHead>
                  <TableHead className="text-right" title={ZERO_ACTIVITIES_COLUMN_TITLE}>En cero</TableHead>
                  <TableHead>Meta</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {monthly.map((m) => {
                  const meetsTarget = m.percent !== null && m.percent >= target
                  return (
                    <TableRow key={m.month}>
                      <TableCell className="py-1.5 pl-1 pr-3 text-xs font-medium text-[var(--color-text-subtle)]">
                        <a href="#registros-pdtp" className="hover:text-[var(--color-primary)] hover:underline" title="Ver los registros de este mes">
                          {MONTH_LABELS[m.month - 1]}
                        </a>
                      </TableCell>
                      <TableCellNum className="px-2 py-1.5 text-xs">{m.planned}</TableCellNum>
                      <TableCellNum className="px-2 py-1.5 text-xs">{m.executed}</TableCellNum>
                      <TableCellNum className={cn("px-2 py-1.5 text-xs font-semibold", meetsTarget ? "text-[var(--color-success-ink)]" : m.executed > 0 ? "text-[var(--color-signal-ink)]" : "text-[var(--color-text-faint)]")}>
                        {fmtPct(m.percent)}
                      </TableCellNum>
                      <TableCellNum className="px-2 py-1.5 text-xs">
                        {m.zeroActivities > 0 ? (
                          <a
                            href={zeroActivitiesHref(m.month)}
                            className="font-semibold text-[var(--color-signal-ink)] hover:text-[var(--color-primary)] hover:underline"
                            title="Ver las actividades en cero de este mes"
                          >
                            {m.zeroActivities}
                          </a>
                        ) : (
                          <span className="text-[var(--color-text-faint)]">0</span>
                        )}
                        {/* Un "no realizada" declarado no baja el planificado
                            (por diseño: la celda se sigue exigiendo), así que
                            la actividad sigue contando en "En cero". Esta
                            anotación separa el cero con motivo registrado del
                            cero en silencio, que es la distinción que importa
                            al revisar el mes. */}
                        {m.declaredNotPerformed > 0 && (
                          <span
                            className="ml-1 whitespace-nowrap text-[10px] font-normal text-[var(--color-text-faint)]"
                            title="Semanas del mes con un desvío «no realizada» declarado. Queda el motivo registrado; lo planificado no cambia."
                          >
                            ({m.declaredNotPerformed} con motivo)
                          </span>
                        )}
                      </TableCellNum>
                      <TableCell className="px-2 py-1.5">
                        {meetsTarget && <CheckCircle size={13} className="text-[var(--color-success-ink)]" />}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableRoot>
        </div>
      </PersistedDetails>
    </div>
  )
}

/**
 * Índice de gestión preventiva en un solo tile: combina ejecución, verificación
 * y cierre sin reemplazar el cumplimiento formal, que depende sólo de realizar
 * las actividades programadas. Los tres ejes se muestran en una línea compacta.
 * El peso de cada eje va en el `title` para no cargar la vista con "peso 50%".
 */
function IntegralTile({ integral }: { integral: PdtpIntegralCompliance }) {
  const axes: Array<{ label: string; value: number | null; weight: number }> = [
    { label: "Ejecución", value: integral.ejecucion !== null ? integral.ejecucion * 100 : null, weight: integral.pesos.ejecucion },
    { label: "Verificación", value: integral.verificacion, weight: integral.pesos.verificacion },
    { label: "Cierre", value: integral.cierre, weight: integral.pesos.cierre },
  ]

  return (
    <div className="flex-1 min-w-[16rem] border-l border-t border-[var(--color-border)]">
      <div className="px-4 py-3">
        <div className="flex items-center gap-1.5">
          <ChartBar size={13} className="shrink-0 text-[var(--color-text-faint)]" />
          <span
            className="text-eyebrow"
            title="Indicador de gestión: 50% ejecución + 30% verificación + 20% cierre. No modifica el cumplimiento formal del programa."
          >
            Índice de gestión preventiva
          </span>
        </div>
        <div className="mt-2 flex items-end gap-2">
          <span className="font-mono text-[1.375rem] font-semibold leading-none tabular-nums tracking-tight text-[var(--color-text)]">
            {integral.integral !== null ? `${integral.integral}%` : "—"}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[var(--color-text-muted)]">
          {axes.map((axis) => (
            <span key={axis.label} title={`Peso ${Math.round(axis.weight * 100)}% en el índice de gestión preventiva`}>
              {axis.label} <span className="font-mono font-semibold text-[var(--color-text)]">{axis.value !== null ? `${Math.round(axis.value)}%` : "—"}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
