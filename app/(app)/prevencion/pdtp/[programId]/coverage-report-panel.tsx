import { Badge } from "@/components/ui/badge"
import type { PdtpCoverageReport } from "@/lib/services/prevention-pdtp"

/**
 * El informe de la compuerta, actividad por actividad. `submitBlockers` dice
 * "12 actividades sin configuración" —lo que cabe en un mensaje de error— y
 * esto dice cuáles y por qué, que es lo que hay que resolver antes de firmar
 * el programa. Sin esta vista la clasificación existía en el tipo y había que
 * leer la base a mano para verla.
 */
export function CoverageReportPanel({ report }: { report: PdtpCoverageReport }) {
  if (report.total === 0) return null

  const blocking = report.groups.filter((group) => group.blocks)
  const informative = report.groups.filter((group) => !group.blocks)

  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--color-text)]">Cobertura de destinos por actividad</h2>
        <span className="font-mono text-xs tabular-nums text-[var(--color-text-subtle)]">
          {report.ready}/{report.total} listas
        </span>
      </div>

      {blocking.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">
          Todas las actividades activas declaran dónde se registra su cumplimiento y quién puede hacerlo.
        </p>
      ) : (
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">
          Estas actividades prometen trabajo sin ofrecer dónde realizarlo, así que frenan el envío a revisión.
        </p>
      )}

      <div className="mt-3 space-y-3">
        {[...blocking, ...informative].map((group) => (
          <div key={group.status}>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={group.blocks ? "danger" : "warning"} dot>
                {group.issues.length}
              </Badge>
              <h3 className="text-xs font-semibold uppercase text-[var(--color-text-subtle)]">{group.label}</h3>
              {!group.blocks && (
                <span className="text-xs text-[var(--color-text-subtle)]">(informativo, no frena el envío)</span>
              )}
            </div>
            <ul className="mt-1 divide-y divide-[var(--color-border)]">
              {group.issues.map((issue) => (
                <li key={`${group.status}:${issue.n}`} className="py-1.5 text-sm">
                  <span className="font-mono text-xs text-[var(--color-text-subtle)]">N°{issue.n}</span>
                  {" "}<span className="text-[var(--color-text)]">{issue.activity}</span>
                  <p className="text-xs text-[var(--color-text-muted)]">{issue.reason}</p>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}
