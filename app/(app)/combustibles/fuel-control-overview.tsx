import type * as React from "react"
import Link from "next/link"
import { ArrowRight, Drop, FileText, GasPump } from "@phosphor-icons/react/dist/ssr"
import type { FuelControlOverview } from "@/lib/combustibles/fuel-control-overview"
import { formatCLP, formatQty } from "@/lib/utils"
import { Delta } from "@/components/ui/delta"
import { EmptyState } from "@/components/ui/empty-state"

export interface FuelOriginSummaryProps {
  data: FuelControlOverview
  /** Sin `combustibles:view_costs` no se muestra el monto ($) ni se enlaza a Pagos. */
  canViewCosts: boolean
  tct: {
    liters: number
    transactions: number
    vehicles: number
    /** Tarjetas activas. */
    cards?: number
    variationLitersPct: number | null
  }
  /**
   * El período elegido incluye hoy: la variación compararía días transcurridos contra un
   * período completo («↓98 %» el día 4 del mes) y se lee como un desplome. Sin variación.
   */
  inProgress?: boolean
  /** Destino del detalle de cada origen, ya con el período y la faena; `null` = sin enlace (sin permiso o sin destino). */
  hrefs: { terreno: string | null; tarjetas: string | null; facturas: string | null; cuadratura: string | null }
  /** Enlace que filtra la pantalla por una faena (un clic filtra esa faena). */
  worksiteHref: (worksiteId: string) => string
  /** Qué hacer cuando no hay actividad (agregar datos, registrar una carga), si la persona puede. */
  emptyAction?: React.ReactNode
  /** Aviso de que las tarjetas informan por mes completo, cuando el período no lo es. */
  tctNote?: string | null
}

const CHANNEL_BAR_COLORS = {
  neutral: "bg-[var(--color-text-faint)]",
  primary: "bg-[var(--color-primary)]",
  info: "bg-[var(--color-info-ink)]",
}

/**
 * «De dónde vino lo cargado»: lo registrado en terreno, lo informado por las
 * tarjetas y lo facturado, con su variación contra el período anterior y, por
 * faena, cuánto aportó cada origen. NO se suman ni se restan: cada origen mide
 * algo distinto (la cobertura se revisa por equipo, en «Cuadratura»). Cada
 * cifra enlaza a su detalle; cada faena, al filtro de esta pantalla.
 */
export function FuelOriginSummary({ data, canViewCosts, tct, hrefs, worksiteHref, emptyAction, tctNote, inProgress = false }: FuelOriginSummaryProps) {
  const maxWorksiteVolume = Math.max(1, ...data.byWorksite.flatMap((row) => [row.billedLiters, data.tae ? row.taeLiters : 0, row.tctLiters]))
  const worksites = data.byWorksite.slice(0, 6)

  return (
    <section aria-labelledby="origen-title" className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[var(--color-border)] px-4 py-3">
        <div>
          <h2 id="origen-title" className="text-h3 text-[var(--color-text)]">De dónde vino lo cargado</h2>
          <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">No se suman: cada origen mide algo distinto.</p>
        </div>
        {hrefs.cuadratura ? (
          <Link href={hrefs.cuadratura} className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-primary-ink)] underline-offset-2 hover:underline">
            Ver la cuadratura <ArrowRight size={14} aria-hidden />
          </Link>
        ) : null}
      </div>

      <div className="grid gap-px bg-[var(--color-border)] md:grid-cols-3">
        <OriginFigure
          icon={<GasPump size={16} aria-hidden />}
          label="Registrado en terreno"
          value={data.tae ? `${formatQty(Math.round(data.tae.liters))} L` : "Sin acceso"}
          detail={data.tae ? `${formatQty(data.tae.loads)} cargas · ${formatQty(data.tae.equipment)} equipos` : "Requiere el permiso de terreno"}
          trend={inProgress ? null : data.tae?.variationLitersPct ?? null}
          href={data.tae ? hrefs.terreno : null}
        />
        <OriginFigure
          icon={<Drop size={16} aria-hidden />}
          label="Informado por tarjetas"
          value={`${formatQty(Math.round(tct.liters))} L`}
          detail={`${formatQty(tct.vehicles)} patentes${tct.cards != null ? ` · ${formatQty(tct.cards)} tarjetas` : ""}`}
          trend={inProgress ? null : tct.variationLitersPct}
          href={hrefs.tarjetas}
        />
        <OriginFigure
          icon={<FileText size={16} aria-hidden />}
          label="Facturado"
          value={`${formatQty(Math.round(data.billed.liters))} L`}
          detail={canViewCosts && data.billed.amount !== null ? `${formatQty(data.billed.records)} facturas · ${formatCLP(data.billed.amount)}` : `${formatQty(data.billed.records)} facturas`}
          trend={inProgress ? null : data.billed.variationLitersPct}
          href={canViewCosts ? hrefs.facturas : null}
        />
      </div>

      {tctNote ? <p className="border-t border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-text-muted)]">{tctNote}</p> : null}

      <div className="border-t border-[var(--color-border)]">
        <h3 className="px-4 pt-3 text-sm font-semibold text-[var(--color-text)]">Litros por faena y origen</h3>
        <p className="px-4 text-xs text-[var(--color-text-muted)]">Una escala común para comparar actividad. Un clic filtra esa faena.</p>
        {worksites.length === 0 ? (
          <EmptyState
            compact
            align="start"
            as="p"
            title="Sin actividad en el período"
            description="Ninguno de los tres orígenes tiene cargas para este período y estos filtros. Amplía el período, quita la faena o agrega los datos del proveedor."
            action={emptyAction}
            className="px-4 py-6"
          />
        ) : (
          <ul className="mt-2 divide-y divide-[var(--color-border)]">
            {worksites.map((row) => (
              <li key={row.worksiteId}>
                <Link
                  href={worksiteHref(row.worksiteId)}
                  scroll={false}
                  className="group grid gap-2 px-4 py-3 transition-colors hover:bg-[var(--color-surface-2)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-primary)] md:grid-cols-[minmax(8rem,0.55fr)_minmax(0,1.45fr)] md:items-center"
                >
                  <span className="min-w-0 text-sm font-medium text-[var(--color-text)] group-hover:text-[var(--color-primary-ink)]">{row.worksiteName}</span>
                  <span className="grid gap-1.5" aria-label={`Orígenes de ${row.worksiteName}`}>
                    {data.tae ? <ChannelBar label="Terreno" value={row.taeLiters} max={maxWorksiteVolume} tone="primary" /> : null}
                    <ChannelBar label="Tarjetas" value={row.tctLiters} max={maxWorksiteVolume} tone="info" />
                    <ChannelBar label="Facturado" value={row.billedLiters} max={maxWorksiteVolume} tone="neutral" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {data.byWorksite.length > worksites.length ? (
          <p className="border-t border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-text-muted)]">Se muestran las {worksites.length} faenas con más actividad de {data.byWorksite.length}.</p>
        ) : null}
      </div>
    </section>
  )
}

function OriginFigure({ icon, label, value, detail, trend, href }: {
  icon: React.ReactNode
  label: string
  value: string
  detail: string
  trend: number | null
  href: string | null
}) {
  const body = (
    <div className="flex h-full flex-col bg-[var(--color-surface)] p-4 transition-colors group-hover:bg-[var(--color-surface-2)]">
      <div className="flex items-center gap-2 text-[var(--color-text-muted)]">{icon}<span className="text-xs font-medium">{label}</span></div>
      <span className="mt-3 font-mono text-xl font-semibold tabular-nums text-[var(--color-text)]">{value}</span>
      {/* En su propia línea y con quiebre: en una tarjeta de un tercio de ancho «vs. período anterior» se cortaba. */}
      {trend !== null && <Delta value={trend} format="percent" polarity="up-bad" comparisonLabel="vs. período anterior" className="mt-1.5 flex-wrap whitespace-normal" />}
      <span className="mt-1 text-xs text-[var(--color-text-muted)]">{detail}</span>
    </div>
  )
  return href
    ? <Link href={href} className="group focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-primary)]">{body}</Link>
    : <div>{body}</div>
}

function ChannelBar({ label, value, max, tone }: { label: string; value: number; max: number; tone: "neutral" | "primary" | "info" }) {
  const width = value <= 0 ? 0 : Math.max(2, (value / max) * 100)
  return (
    <span className="grid grid-cols-[4.5rem_minmax(0,1fr)_5.5rem] items-center gap-2 text-[11px] text-[var(--color-text-muted)]">
      <span>{label}</span>
      <span className="h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-3)]"><span className={`block h-full rounded-full ${CHANNEL_BAR_COLORS[tone]}`} style={{ width: `${width}%` }} /></span>
      <span className="text-right font-mono tabular-nums">{formatQty(Math.round(value), "L")}</span>
    </span>
  )
}
