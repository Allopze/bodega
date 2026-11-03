import Link from "next/link"
import { ArrowSquareOut } from "@phosphor-icons/react/dist/ssr"
import { MiniSparkline } from "@/components/ui/mini-sparkline"
import { cn, formatDateTime, formatQty } from "@/lib/utils"
import type { FuelInboxEvidence } from "@/lib/combustibles/inbox/types"

const fmt = (value: number, digits = 1) => formatQty(value, undefined, { maximumFractionDigits: digits })

/**
 * El dato que explica por qué algo está en la bandeja: las últimas lecturas, el
 * par de cargas duplicadas, la capacidad del estanque, el rango normal del equipo.
 * Sin hooks: sirve igual en el servidor y dentro de la hoja de decisión.
 */
export function InboxEvidence({ evidence, loadHref }: { evidence: FuelInboxEvidence[]; loadHref?: string | null }) {
  if (evidence.length === 0) return null
  return (
    <div className="space-y-4">
      {evidence.map((item, index) => <EvidenceBlock key={`${item.type}-${index}`} item={item} loadHref={loadHref} />)}
    </div>
  )
}

function EvidenceBlock({ item, loadHref }: { item: FuelInboxEvidence; loadHref?: string | null }) {
  switch (item.type) {
    case "readings": {
      const current = item.points.find((point) => point.current)
      const before = item.points.filter((point) => !point.current && current && point.at < current.at).at(-1)
      const drop = current && before ? before.reading - current.reading : 0
      const currentIndex = item.points.findIndex((point) => point.current)
      return (
        <section aria-label="Últimas lecturas del medidor" className="space-y-2">
          <p className="text-sm text-[var(--color-text-muted)]">Últimas lecturas del equipo:</p>
          {/* La forma de la serie, con la lectura de esta carga marcada. Es decoración: las tarjetas de abajo son su texto. */}
          {item.points.length >= 2 ? (
            <div aria-hidden className="max-w-sm space-y-1">
              <MiniSparkline data={item.points.map((point) => point.reading)} markedIndex={currentIndex >= 0 ? currentIndex : undefined} className="h-14 w-full" />
              {currentIndex >= 0 ? <p className="text-xs text-[var(--color-text-muted)]">El punto es la lectura de esta carga.</p> : null}
            </div>
          ) : null}
          <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {item.points.map((point) => (
              <li
                key={`${point.at}-${point.reading}`}
                className={cn(
                  "rounded-[var(--radius-lg)] border px-3 py-2",
                  point.current ? "border-[var(--color-signal-line)] bg-[var(--color-signal-tint)]" : "border-[var(--color-border)] bg-[var(--color-surface-2)]",
                )}
              >
                <p className="text-xs text-[var(--color-text-muted)]">{point.current ? "Esta carga" : formatDateTime(point.at).slice(0, 10)}</p>
                <p className="font-mono text-sm font-semibold tabular-nums text-[var(--color-text)]">{fmt(point.reading)} {item.unit}</p>
              </li>
            ))}
          </ol>
          {drop > 0 ? (
            <p className="text-sm text-[var(--color-text)]">
              Bajó <span className="font-mono tabular-nums">{fmt(drop)} {item.unit}</span>.
              {loadHref ? <> Si la lectura está mal, conviene <Link href={loadHref} className="font-medium text-[var(--color-primary)] hover:underline">corregirla en la carga</Link> antes de decidir.</> : null}
            </p>
          ) : null}
        </section>
      )
    }
    case "duplicate":
      return (
        <section aria-label="Las dos cargas" className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            {item.loads.map((load, index) => (
              <div key={`${load.at}-${index}`} className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
                <p className="text-sm font-semibold text-[var(--color-text)]">{load.originLabel}</p>
                <p className="text-xs text-[var(--color-text-muted)]">{formatDateTime(load.at)}</p>
                <p className="mt-1.5 font-mono text-sm tabular-nums text-[var(--color-text)]">
                  {fmt(load.liters)} L{load.reading !== null ? ` · ${fmt(load.reading)}` : ""}
                </p>
                {load.href ? (
                  <Link href={load.href} className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-[var(--color-primary)] hover:underline">
                    Abrir la carga <ArrowSquareOut size={12} aria-hidden />
                  </Link>
                ) : null}
              </div>
            ))}
          </div>
          <p className="text-sm text-[var(--color-text)]">
            Mismo equipo, <span className="font-mono tabular-nums">{minutesBetween(item.loads[0]?.at, item.loads[1]?.at)}</span> minutos y{" "}
            <span className="font-mono tabular-nums">{fmt(Math.abs((item.loads[0]?.liters ?? 0) - (item.loads[1]?.liters ?? 0)))} L</span> de diferencia.
            Se considera duplicada si están a menos de <span className="font-mono tabular-nums">{item.windowMinutes}</span> minutos y{" "}
            <span className="font-mono tabular-nums">{fmt(item.litersTolerance)} L</span>.
          </p>
        </section>
      )
    case "capacity": {
      const max = Math.max(item.liters, item.capacity)
      return (
        <section aria-label="Litros contra capacidad del estanque" className="space-y-2">
          <p className="text-sm text-[var(--color-text)]">
            Se registraron <span className="font-mono font-semibold tabular-nums">{fmt(item.liters)} L</span> y el estanque del equipo tiene{" "}
            <span className="font-mono font-semibold tabular-nums">{fmt(item.capacity)} L</span>.
          </p>
          <div className="space-y-1.5">
            <CapacityBar label="Capacidad" value={item.capacity} max={max} tone="primary" />
            <CapacityBar label="Esta carga" value={item.liters} max={max} tone="signal" />
          </div>
          <p className="text-xs text-[var(--color-text-muted)]">Si la capacidad de la ficha está mal, corrígela en Catálogos de flota.</p>
        </section>
      )
    }
    case "range":
      return (
        <section aria-label="Rendimiento contra el rango normal" className="space-y-2">
          <p className="text-sm text-[var(--color-text)]">
            Esta carga da <span className="font-mono font-semibold tabular-nums">{fmt(item.value, 2)} {item.unit}</span>. Lo normal para este equipo es entre{" "}
            <span className="font-mono tabular-nums">{fmt(item.low, 2)}</span> y <span className="font-mono tabular-nums">{fmt(item.high, 2)} {item.unit}</span>
            {item.lowerIsBetter ? " (en este equipo, menos es mejor)" : ""}.
          </p>
          <details className="text-sm text-[var(--color-text-muted)]">
            <summary className="cursor-pointer font-medium text-[var(--color-primary)]">Ver datos estadísticos</summary>
            <p className="mt-1.5">
              El rango sale de las <span className="font-mono tabular-nums">{item.samples}</span> cargas válidas del equipo: su promedio, más y menos el
              múltiplo de la desviación estándar que fijan los umbrales de Ajustes.
            </p>
          </details>
        </section>
      )
    case "late_entry":
      return (
        <section aria-label="Fecha declarada" className="space-y-1">
          <p className="text-sm text-[var(--color-text)]">
            Se cargó el <span className="font-medium">{formatDateTime(item.loadedAt)}</span> y se anotó en la plataforma el{" "}
            <span className="font-medium">{formatDateTime(item.registeredAt)}</span>.
          </p>
          {item.reason ? <p className="text-sm text-[var(--color-text-muted)]">Motivo de la persona que la anotó: «{item.reason}».</p> : null}
        </section>
      )
    case "text":
      return <p className="text-sm text-[var(--color-text)]">{item.text}</p>
  }
}

function minutesBetween(a: string | undefined, b: string | undefined): number {
  if (!a || !b) return 0
  return Math.round(Math.abs(Date.parse(a) - Date.parse(b)) / 60_000)
}

function CapacityBar({ label, value, max, tone }: { label: string; value: number; max: number; tone: "primary" | "signal" }) {
  const width = max > 0 ? Math.max(4, Math.round((value / max) * 100)) : 0
  return (
    <div className="grid grid-cols-[6rem_minmax(0,1fr)_4.5rem] items-center gap-2 text-sm">
      <span className="text-[var(--color-text-muted)]">{label}</span>
      <span className="h-2 rounded-full bg-[var(--color-surface-3)]" aria-hidden>
        <span
          className={cn("block h-full rounded-full", tone === "signal" ? "bg-[var(--color-signal)]" : "bg-[var(--color-primary)]")}
          style={{ width: `${width}%` }}
        />
      </span>
      <span className="text-right font-mono tabular-nums text-[var(--color-text)]">{fmt(value)} L</span>
    </div>
  )
}
