import type { ReactNode } from "react"
import Link from "next/link"
import { ArrowRight } from "@phosphor-icons/react/dist/ssr"
import { REQUEST_STATE_META, ITEM_STATE_META, OC_STATE_META } from "@/components/states/state-badge"

export type ReportMetric = {
  label: string
  value: string | number
  detail: string
  href: string
}

export function BreakdownPanel({
  title, subtitle, icon, total, rows, cta, emptyLabel, tone,
}: {
  title: string
  subtitle: string
  icon: ReactNode
  total: number
  rows: { label: string; value: number }[]
  cta: { label: string; href: string }
  emptyLabel: string
  tone?: "signal"
}) {
  const signalActive = tone === "signal" && total > 0
  return (
    <section className="flex flex-col rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={signalActive ? "text-[var(--color-signal)]" : "text-[var(--color-text-subtle)]"}>{icon}</span>
          <div>
            <h2 className="text-sm font-medium text-[var(--color-text)]">{title}</h2>
            <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">{subtitle}</p>
          </div>
        </div>
        <span className={`font-mono text-2xl font-semibold leading-none tabular-nums ${signalActive ? "text-[var(--color-signal-ink)]" : "text-[var(--color-text)]"}`}>
          {total}
        </span>
      </div>

      <div className="mt-4 flex-1 divide-y divide-[var(--color-border)]">
        {rows.length === 0 ? (
          <p className="py-2 text-sm text-[var(--color-text-muted)]">{emptyLabel}</p>
        ) : rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3 py-2">
            <span className="text-sm text-[var(--color-text-muted)] truncate">{row.label}</span>
            <span className="font-mono text-sm tabular-nums text-[var(--color-text)]">{row.value}</span>
          </div>
        ))}
      </div>

      {total > 0 && (
        <Link
          href={cta.href}
          className="mt-4 inline-flex items-center gap-1.5 self-start text-xs font-medium text-[var(--color-primary)] transition-transform duration-[var(--duration-fast)]"
        >
          {cta.label}
          <ArrowRight size={13} />
        </Link>
      )}
    </section>
  )
}

export function statusRows(rows: { status: string; total: number }[]) {
  return rows.map((row) => [row.status, Number(row.total)] as [string, number]).sort((a, b) => b[1] - a[1])
}

/** Map a raw DB status to its Spanish label, falling back to the raw value. */
export function stateLabel(entity: "request" | "item" | "oc", status: string): string {
  const map = entity === "request" ? REQUEST_STATE_META
    : entity === "oc" ? OC_STATE_META
    : ITEM_STATE_META
  return (map as Record<string, { label: string }>)[status]?.label ?? status
}

export function StatusGroup({ title, entity, rows }: { title: string; entity: "request" | "item" | "oc"; rows: [string, number][] }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--color-text-subtle)]">{title}</p>
      <div className="mt-2 divide-y divide-[var(--color-border)]">
        {rows.length === 0 ? (
          <p className="py-2 text-sm text-[var(--color-text-muted)]">Sin datos</p>
        ) : rows.map(([status, count]) => (
          <div key={status} className="flex items-center justify-between gap-3 py-2">
            <span className="text-sm text-[var(--color-text-muted)]">{stateLabel(entity, status)}</span>
            <span className="font-mono text-sm text-[var(--color-text)]">{count}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
