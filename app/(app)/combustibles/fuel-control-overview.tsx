import Link from "next/link"
import {
  ArrowRight,
  CheckCircle,
  ClipboardText,
  Drop,
  FileText,
  GasPump,
  Images,
  SealWarning,
  WarningDiamond,
} from "@phosphor-icons/react/dist/ssr"
import type { FuelControlOverview } from "@/lib/combustibles/fuel-control-overview"
import { formatCLP, formatQty } from "@/lib/utils"

interface FuelControlOverviewProps {
  data: FuelControlOverview
  /** Sin `combustibles:view_costs`: se omite el monto ($) y el link a /combustibles/facturas (que ahora exige ese permiso). */
  canViewCosts: boolean
  tct: {
    liters: number
    transactions: number
    vehicles: number
    variationLitersPct: number | null
  }
  period: { fromDate: string; toDate: string; worksiteId?: string; source?: string; plate?: string; associated?: "yes" | "no" }
}

export function FuelControlOverviewPanel({ data, canViewCosts, tct, period }: FuelControlOverviewProps) {
  const taeHref = buildHref("/combustibles/tae", period)
  const reconciliationHref = buildHref("/combustibles/tae/conciliacion", period)
  const maxWorksiteVolume = Math.max(
    1,
    ...data.byWorksite.flatMap((row) => [row.billedLiters, row.taeLiters, row.tctLiters]),
  )

  return (
    <section className="mb-8" aria-labelledby="fuel-control-overview-title">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-eyebrow">Control integrado</p>
          <h2 id="fuel-control-overview-title" className="text-lg font-semibold tracking-tight text-[var(--color-text)]">
            Estado del combustible
          </h2>
          <p className="mt-1 max-w-[72ch] text-sm text-[var(--color-text-muted)]">
            Facturación, carga física TAE y consumo TCT se mantienen como canales independientes. La cobertura se revisa por equipo, no restando totales incompatibles.
          </p>
        </div>
        {data.tae && (
          <Link href={reconciliationHref} className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-primary)] hover:underline">
            Abrir conciliación <ArrowRight size={15} aria-hidden />
          </Link>
        )}
      </div>

      <div className="grid gap-px border border-[var(--color-border)] bg-[var(--color-border)] md:grid-cols-3">
        <ChannelSummary
          icon={<FileText size={18} aria-hidden />}
          label="Facturado / registrado"
          value={formatQty(Math.round(data.billed.liters), "L")}
          detail={canViewCosts ? `${formatQty(data.billed.records)} registros · ${formatCLP(data.billed.amount)}` : `${formatQty(data.billed.records)} registros`}
          trend={data.billed.variationLitersPct}
          href={canViewCosts ? "/combustibles/facturas" : undefined}
        />
        <ChannelSummary
          icon={<GasPump size={18} aria-hidden />}
          label="Entregado en terreno TAE"
          value={data.tae ? formatQty(Math.round(data.tae.liters), "L") : "Acceso restringido"}
          detail={data.tae ? `${formatQty(data.tae.loads)} cargas · ${formatQty(data.tae.equipment)} equipos` : "Requiere permiso de control TAE"}
          trend={data.tae?.variationLitersPct ?? null}
          href={data.tae ? taeHref : undefined}
        />
        <ChannelSummary
          icon={<Drop size={18} aria-hidden />}
          label="Consumo reportado TCT"
          value={formatQty(Math.round(tct.liters), "L")}
          detail={`${formatQty(tct.transactions)} transacciones · ${formatQty(tct.vehicles)} equipos`}
          trend={tct.variationLitersPct}
          href="#analisis-tct"
        />
      </div>

      {data.tae && (
        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(19rem,0.75fr)]">
          <div className="border border-[var(--color-border)] bg-[var(--color-surface)]">
            <div className="border-b border-[var(--color-border)] px-4 py-3 md:px-5">
              <h3 className="text-sm font-semibold text-[var(--color-text)]">Volumen por faena y canal</h3>
              <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">Escala común para comparar actividad. Los canales no se suman como una cadena contable.</p>
            </div>
            {data.byWorksite.length === 0 ? (
              <p className="p-6 text-sm text-[var(--color-text-muted)]">No hay actividad para el período y alcance seleccionados.</p>
            ) : (
              <div className="divide-y divide-[var(--color-border)]">
                {data.byWorksite.slice(0, 8).map((row) => (
                  <Link
                    key={row.worksiteId}
                    href={buildHref("/combustibles", { ...period, worksiteId: row.worksiteId })}
                    className="group grid gap-2 px-4 py-3 transition-colors hover:bg-[var(--color-surface-2)] md:grid-cols-[minmax(8rem,0.55fr)_minmax(0,1.45fr)] md:items-center md:px-5"
                  >
                    <span className="min-w-0 text-sm font-medium text-[var(--color-text)] group-hover:text-[var(--color-primary)]">{row.worksiteName}</span>
                    <span className="grid gap-1.5" aria-label={`Canales de ${row.worksiteName}`}>
                      <ChannelBar label="Facturado" value={row.billedLiters} max={maxWorksiteVolume} tone="neutral" />
                      <ChannelBar label="TAE" value={row.taeLiters} max={maxWorksiteVolume} tone="primary" />
                      <ChannelBar label="TCT" value={row.tctLiters} max={maxWorksiteVolume} tone="info" />
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="border border-[var(--color-border)] bg-[var(--color-surface)]">
            <div className="border-b border-[var(--color-border)] px-4 py-3">
              <h3 className="text-sm font-semibold text-[var(--color-text)]">Calidad y revisión TAE</h3>
              <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">Señales que requieren abrir cargas individuales.</p>
            </div>
            <div className="divide-y divide-[var(--color-border)]">
              <QualitySignal icon={<ClipboardText size={17} />} label="Pendientes de validar" value={data.tae.pendingReview} href={`${taeHref}${taeHref.includes("?") ? "&" : "?"}estado=submitted`} />
              <QualitySignal icon={<WarningDiamond size={17} />} label="Cargas observadas" value={data.tae.observed} href={`${taeHref}${taeHref.includes("?") ? "&" : "?"}estado=observed`} tone={data.tae.observed > 0 ? "warning" : "neutral"} />
              <QualitySignal icon={<SealWarning size={17} />} label="Sin sello completo" value={data.tae.missingSeals} href={`${taeHref}${taeHref.includes("?") ? "&" : "?"}sello=faltante`} tone={data.tae.missingSeals > 0 ? "warning" : "neutral"} />
              <QualitySignal icon={<Images size={17} />} label="Sin 4 evidencias" value={data.tae.missingEvidence} href={`${taeHref}${taeHref.includes("?") ? "&" : "?"}evidencia=faltante`} tone={data.tae.missingEvidence > 0 ? "warning" : "neutral"} />
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function ChannelSummary({ icon, label, value, detail, trend, href }: {
  icon: React.ReactNode
  label: string
  value: string
  detail: string
  trend: number | null
  href?: string
}) {
  const body = (
    <div className="flex h-full flex-col bg-[var(--color-surface)] p-4 transition-colors group-hover:bg-[var(--color-surface-2)] md:p-5">
      <div className="flex items-center gap-2 text-[var(--color-text-muted)]">{icon}<span className="text-xs font-medium uppercase tracking-[0.08em]">{label}</span></div>
      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-mono text-xl font-semibold tabular-nums text-[var(--color-text)]">{value}</span>
        {trend != null && <span className={trend > 0 ? "text-xs font-medium text-[var(--color-warning-ink)]" : "text-xs font-medium text-[var(--color-success-ink)]"}>{trend > 0 ? "+" : ""}{trend}%</span>}
      </div>
      <span className="mt-1 text-xs text-[var(--color-text-muted)]">{detail}</span>
    </div>
  )
  return href ? <Link href={href} className="group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]">{body}</Link> : <div>{body}</div>
}

function ChannelBar({ label, value, max, tone }: { label: string; value: number; max: number; tone: "neutral" | "primary" | "info" }) {
  const colors = {
    neutral: "bg-[var(--color-text-faint)]",
    primary: "bg-[var(--color-primary)]",
    info: "bg-[var(--color-info-ink)]",
  }
  const width = value <= 0 ? 0 : Math.max(2, (value / max) * 100)
  return (
    <span className="grid grid-cols-[4.5rem_minmax(0,1fr)_5.5rem] items-center gap-2 text-[11px] text-[var(--color-text-muted)]">
      <span>{label}</span>
      <span className="h-1.5 overflow-hidden bg-[var(--color-surface-3)]"><span className={`block h-full ${colors[tone]}`} style={{ width: `${width}%` }} /></span>
      <span className="text-right font-mono tabular-nums">{formatQty(Math.round(value), "L")}</span>
    </span>
  )
}

function QualitySignal({ icon, label, value, href, tone = "neutral" }: { icon: React.ReactNode; label: string; value: number; href: string; tone?: "neutral" | "warning" }) {
  const isClear = value === 0
  return (
    <Link href={href} className="flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-[var(--color-surface-2)]">
      <span className={tone === "warning" && !isClear ? "text-[var(--color-warning-ink)]" : "text-[var(--color-text-muted)]"}>{isClear ? <CheckCircle size={17} /> : icon}</span>
      <span className="min-w-0 flex-1 text-[var(--color-text)]">{label}</span>
      <span className="font-mono font-semibold tabular-nums text-[var(--color-text)]">{formatQty(value)}</span>
      <ArrowRight size={14} className="text-[var(--color-text-faint)]" aria-hidden />
    </Link>
  )
}

function buildHref(pathname: string, period: { fromDate: string; toDate: string; worksiteId?: string; source?: string; plate?: string; associated?: "yes" | "no" }) {
  const params = new URLSearchParams()
  if (pathname === "/combustibles/tae") {
    params.set("from", period.fromDate)
    params.set("to", period.toDate)
  } else if (pathname.includes("/tae")) {
    params.set("desde", period.fromDate)
    params.set("hasta", period.toDate)
  } else {
    params.set("desde", period.fromDate)
    params.set("hasta", period.toDate)
  }
  if (period.worksiteId) params.set("faena", period.worksiteId)
  if (pathname === "/combustibles/tae" && period.plate) params.set("q", period.plate)
  if (pathname === "/combustibles") {
    if (period.source) params.set("fuente", period.source)
    if (period.plate) params.set("patente", period.plate)
    if (period.associated) params.set("asociacion", period.associated)
  }
  return `${pathname}?${params.toString()}`
}
