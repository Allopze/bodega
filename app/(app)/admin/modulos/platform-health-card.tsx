import { formatFileSize } from "@/lib/utils"
import type { PlatformHealth } from "@/lib/services/platform-health"

/**
 * Salud demostrada de la plataforma sobre la lista de módulos (TASK-UI-011).
 *
 * Un interruptor encendido decía únicamente "aparece en el menú": un módulo
 * activo con la base caída o el volumen sin escritura se veía idéntico a uno
 * sano. Esta banda antepone la única salud que **se mide ejecutando algo** —
 * consulta a PostgreSQL, escritura en el volumen y espacio en disco— y dice en
 * voz alta lo que el interruptor no cubre, en vez de dejar que el verde de los
 * switches se lea como salud.
 *
 * No hay sonda por módulo, así que tampoco hay verde por módulo: la tarea pide
 * "verde sólo con evidencia positiva", y esa evidencia hoy es de plataforma.
 */
const TONE = {
  ok: {
    className: "border-[var(--color-success)] bg-[var(--color-success-tint)] text-[var(--color-success-ink)]",
    title: "Plataforma operativa",
  },
  degraded: {
    className: "border-[var(--color-warning)] bg-[var(--color-warning-tint)] text-[var(--color-warning-ink)]",
    title: "Plataforma degradada",
  },
  error: {
    className: "border-[var(--color-danger)] bg-[var(--color-danger-tint)] text-[var(--color-danger-ink)]",
    title: "Plataforma con fallo",
  },
} as const

function signals(health: PlatformHealth): string[] {
  const disk = health.disk.status === "unknown"
    ? "Disco: sin medir en esta plataforma"
    : `Disco: ${health.disk.status === "ok" ? "espacio suficiente" : "espacio bajo"}`
      + (health.disk.freePercent !== undefined
        ? ` (${health.disk.freePercent} % libre${health.disk.freeBytes !== undefined ? `, ${formatFileSize(health.disk.freeBytes)}` : ""})`
        : "")

  return [
    `Base de datos: ${health.db === "connected" ? "responde" : "no responde"}`,
    `Almacenamiento: ${health.storage === "writable" ? "escribible" : health.storage === "unreachable" ? "sin escritura" : "sin medir"}`,
    disk,
  ]
}

export function PlatformHealthCard({ health }: { health: PlatformHealth }) {
  const tone = TONE[health.status]

  return (
    <section role="status" className={`mb-4 rounded-[var(--radius-2xl)] border p-4 ${tone.className}`}>
      <h2 className="font-semibold">{tone.title}</h2>
      <ul className="mt-2 space-y-0.5 text-sm">
        {signals(health).map((line) => <li key={line}>{line}</li>)}
      </ul>
      <p className="mt-2 text-xs opacity-90">
        Medido al abrir esta pantalla. Los interruptores de abajo no miden salud: sólo deciden qué se muestra en la navegación.
      </p>
    </section>
  )
}
