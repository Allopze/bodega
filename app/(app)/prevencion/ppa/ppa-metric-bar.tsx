import type { ReactNode } from "react"
import {
  ClipboardText,
  HandPalm,
  Clock,
  CheckCircle,
  XCircle,
  ChartLineUp,
  Timer,
} from "@phosphor-icons/react/dist/ssr"
import { cn } from "@/lib/utils"
import type { PpaStats } from "@/lib/services/ppa"

interface Cell {
  key: string
  label: string
  value: string | number
  icon: ReactNode
  /** "signal" → naranja solo cuando value > 0 (alertas). */
  tone?: "signal"
  /** Texto secundario bajo el valor (p.ej. desglose). */
  secondary?: string
  /** Barra de progreso 0–100. */
  progress?: number
}

function formatResponseTime(minutes: number | null): string {
  if (minutes === null) return "—"
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h} h` : `${h} h ${m} m`
}

/**
 * Tira editorial de indicadores del PPA (mismo lenguaje que el tablero
 * principal): banda con reglas hairline, numerales mono, naranja-signal solo
 * para lo accionable. Reemplaza la grilla de tarjetas idénticas.
 */
export function PpaMetricBar({ stats }: { stats: PpaStats }) {
  const cells: Cell[] = [
    { key: "total",      label: "Total PPA",        value: stats.total,                          icon: <ClipboardText size={13} /> },
    { key: "detenidos",  label: "Detenidos",        value: stats.detenidos,                      icon: <HandPalm size={13} weight="bold" />, tone: "signal" },
    { key: "pendientes", label: "Por revisar",      value: stats.pendientes,                     icon: <Clock size={13} weight="bold" />,    tone: "signal" },
    {
      key: "aprobados",
      label: "Aprobados",
      value: stats.aprobadosAuto + stats.autorizados,
      icon: <CheckCircle size={13} />,
      secondary: `auto ${stats.aprobadosAuto} · revisor ${stats.autorizados}`,
    },
    { key: "rechazados", label: "Rechazados",       value: stats.rechazados,                     icon: <XCircle size={13} /> },
    { key: "desv",       label: "% desviaciones",   value: `${stats.porcentajeDesviaciones}%`,   icon: <ChartLineUp size={13} />, progress: stats.porcentajeDesviaciones },
    { key: "resp",       label: "Resp. promedio",   value: formatResponseTime(stats.avgResponseMinutes), icon: <Timer size={13} /> },
  ]

  return (
    <div className="overflow-hidden border-y border-[var(--color-border)]">
      <div className="-ml-px -mt-px flex flex-wrap">
        {cells.map((cell) => (
          <StatCell key={cell.key} cell={cell} />
        ))}
      </div>
    </div>
  )
}

function StatCell({ cell }: { cell: Cell }) {
  const numeric = typeof cell.value === "number" ? cell.value : Number.parseFloat(String(cell.value)) || 0
  // Un valor en cero —sea número (0) o cadena ("0%", "—")— se atenúa por igual.
  // Evita que "0%" pese visualmente más que los otros ceros de la tira.
  const isZero = numeric === 0
  const signalActive = cell.tone === "signal" && numeric > 0

  return (
    <div className="flex-1 min-w-[8.5rem] border-l border-t border-[var(--color-border)]">
      <div className="px-4 py-3">
        <div className="flex items-center gap-1.5">
          <span className={cn("shrink-0", signalActive ? "text-[var(--color-signal)]" : "text-[var(--color-text-faint)]")}>
            {cell.icon}
          </span>
          <span className="text-eyebrow truncate">{cell.label}</span>
        </div>
        <div className="mt-2 flex items-end gap-2">
          <span
            className={cn(
              "font-mono text-[1.375rem] font-semibold leading-none tabular-nums tracking-tight",
              signalActive
                ? "text-[var(--color-signal-ink)]"
                : isZero
                  ? "text-[var(--color-text-faint)]"
                  : "text-[var(--color-text)]",
            )}
          >
            {cell.value}
          </span>
          {typeof cell.progress === "number" && (
            <div className="mb-1.5 h-1 flex-1 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
              <div
                className="h-full rounded-full bg-[var(--color-primary)] transition-[width] duration-[var(--duration-slow)] ease-[var(--ease-out)]"
                style={{ width: `${Math.min(100, Math.max(0, cell.progress))}%` }}
              />
            </div>
          )}
        </div>
        {cell.secondary && (
          <p className="mt-1 text-[11px] text-[var(--color-text-subtle)]">{cell.secondary}</p>
        )}
      </div>
    </div>
  )
}
