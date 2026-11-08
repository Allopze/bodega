import { MetaBadge } from "@/components/states/state-badge"
import type { TalanaOverview } from "@/lib/integrations/talana/talana-read"
import { formatDateRelative, formatDateTime } from "@/lib/utils"
import { RUN_MODE_LABELS, runStatusMeta } from "./talana-labels"

/**
 * Una línea de texto con el estado de la sincronización: cuándo corrió por
 * última vez y cuánto hay en la copia local. Sin tarjetas: ninguna de estas
 * cifras es una decisión, son contexto para leer las pestañas de abajo.
 *
 * Componente de servidor: la distancia relativa («hoy», «ayer») se calcula al
 * renderizar y no puede discrepar con una hidratación.
 */
export function TalanaStatusLine({ overview, differencesCount }: { overview: TalanaOverview; differencesCount: number }) {
  const { lastRun, lastGoodSyncAt, activeContracts, currentAbsences } = overview

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-[var(--color-text-muted)]">
      <span className="inline-flex flex-wrap items-center gap-2">
        {lastRun ? (
          <>
            <span>Última corrida</span>
            <MetaBadge meta={runStatusMeta(lastRun.status)} size="sm" />
            <span className="tabular-nums">
              {formatDateTime(lastRun.startedAt)} · {formatDateRelative(lastRun.startedAt)}
              {" · "}{RUN_MODE_LABELS[lastRun.mode]?.toLowerCase() ?? lastRun.mode}
            </span>
          </>
        ) : (
          <span>Sin corridas todavía</span>
        )}
      </span>
      {/* Sin ninguna descarga buena, «0 contratos activos» sería una cifra inventada. */}
      {lastGoodSyncAt && (
        <>
          <StatusFigure value={activeContracts} label={activeContracts === 1 ? "contrato activo" : "contratos activos"} />
          <StatusFigure value={currentAbsences} label={currentAbsences === 1 ? "ausencia vigente" : "ausencias vigentes"} />
          <StatusFigure value={differencesCount} label={differencesCount === 1 ? "diferencia" : "diferencias"} />
        </>
      )}
      <span className="text-[var(--color-text-subtle)]">
        {lastGoodSyncAt ? `Datos al ${formatDateTime(lastGoodSyncAt)}` : "Sin datos descargados de Talana"}
      </span>
    </div>
  )
}

function StatusFigure({ value, label }: { value: number; label: string }) {
  return (
    <span>
      <span className="font-semibold tabular-nums text-[var(--color-text)]">{value}</span> {label}
    </span>
  )
}
