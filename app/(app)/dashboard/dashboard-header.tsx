import { formatDateTime } from "@/lib/utils"
import { DashboardScopeControls } from "./dashboard-scope-controls"
import type { DashboardScope } from "./dashboard-scope"

/**
 * Saludo + alcance global. Vive **sobre** las pestañas porque la faena y el
 * período reencuadran todas las vistas, no sólo la activa: bajarlos dentro de
 * una vista sugeriría que sólo aplican ahí.
 */
export function DashboardHeader({
  firstName,
  summary,
  contextLabel,
  refreshedAt,
  scope,
  worksiteOptions,
}: {
  firstName: string
  /** Frase del saludo, ya construida en el servidor. */
  summary: string
  contextLabel: string
  refreshedAt: string
  scope: DashboardScope
  worksiteOptions: Array<{ id: string; name: string }>
}) {
  return (
    <header className="border-b border-[var(--color-border)] pb-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          {/* Saludo, no encabezado: el `<h1>` de la página lo emite PageHeader y
              tener dos competía en el árbol de accesibilidad (L-01). */}
          <p className="text-3xl font-bold tracking-tight text-[var(--color-text)]">Hola, {firstName}</p>
          <p className="mt-1.5 max-w-[70ch] text-sm text-[var(--color-text-muted)]">{summary}</p>
        </div>
        <div className="flex flex-col items-start gap-2 lg:items-end">
          <DashboardScopeControls scope={scope} worksites={worksiteOptions} />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--color-text-subtle)]">
            <span className="font-medium text-[var(--color-text-muted)]">{contextLabel}</span>
            <span aria-hidden>·</span>
            <time dateTime={refreshedAt}>Actualizado {formatDateTime(refreshedAt)}</time>
          </div>
        </div>
      </div>
    </header>
  )
}

/**
 * El saludo declara **una** cifra: el total de la cola.
 *
 * Antes enumeraba total, críticas, vencidas y entregas — y cada una de esas tres
 * ya vivía en su chip de atajo y en su tarjeta de alerta. "Críticas" aparecía
 * cuatro veces en la misma pantalla contando el tile. La regla A5 lo prohíbe y
 * el detalle sigue a un clic en los atajos, que además navegan.
 */
export function buildOperationalSummary(total: number, worksiteName: string | null) {
  const where = worksiteName ? ` en ${worksiteName}` : ""
  if (total === 0) return `No tienes acciones pendientes${where}.`
  return `Tienes ${total} tarea${total === 1 ? "" : "s"} pendiente${total === 1 ? "" : "s"}${where}.`
}
