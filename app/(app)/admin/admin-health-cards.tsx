import { EnvelopeSimple, HardDrives, LockKey, Receipt, Stack } from "@phosphor-icons/react/dist/ssr"
import { KpiCard } from "@/components/ui/kpi-card"
import type { AdminSignal, AdminSignalTone } from "@/lib/services/admin-health"

/**
 * Fila de señales operativas del panel. Cada tile navega al área donde el
 * problema se arregla, que es lo que A1 exige de un KPI: si no cambia ninguna
 * decisión, no va arriba.
 *
 * Se resuelve el icono con un mapa propio y la variante `/ssr` de Phosphor, no
 * con `NAV_ICONS`: ése carga los iconos interactivos y habría obligado a un
 * `"use client"` sólo para pintar cuatro tarjetas estáticas.
 */

const SIGNAL_ICONS = { HardDrives, EnvelopeSimple, Receipt, LockKey, Stack } as const

const KPI_TONE: Record<AdminSignalTone, "neutral" | "signal" | "danger"> = {
  ok:       "neutral",
  warn:     "signal",
  critical: "danger",
}

export function AdminHealthCards({ signals }: { signals: AdminSignal[] }) {
  if (signals.length === 0) return null

  return (
    // "Señales operativas" y no "Estado de la plataforma": ese nombre ya lo
    // ocupa `lib/services/platform-health.ts` para otra cosa (conectividad de
    // la base, disco, escritura en almacenamiento) en /admin/modulos.
    <section aria-label="Señales operativas" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {signals.map((signal) => {
        const Icon = SIGNAL_ICONS[signal.iconName as keyof typeof SIGNAL_ICONS]
        return (
          <KpiCard
            key={signal.id}
            icon={Icon ? <Icon size={15} /> : null}
            label={signal.label}
            value={signal.value}
            detail={signal.detail}
            tone={KPI_TONE[signal.tone]}
            href={signal.href}
          />
        )
      })}
    </section>
  )
}
