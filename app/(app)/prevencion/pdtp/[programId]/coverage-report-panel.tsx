import { MetaBadge } from "@/components/states/state-badge"
import type { PdtpCoverageReport } from "@/lib/services/prevention-pdtp"

/**
 * El informe de la compuerta, actividad por actividad. `submitBlockers` dice
 * "12 actividades sin configuración" —lo que cabe en un mensaje de error— y
 * esto dice cuáles y por qué, que es lo que hay que resolver antes de firmar
 * el programa. Sin esta vista la clasificación existía en el tipo y había que
 * leer la base a mano para verla.
 *
 * Tres niveles, no dos: `blocksSubmission` frena el envío a revisión hoy;
 * `blocks && !blocksSubmission` (el caso de `instrument_required`) no frena el
 * envío pero sí va a frenar la ACTIVACIÓN si sigue así —declarado no es
 * vigente—; el resto es puramente informativo. Colapsar los dos primeros bajo
 * un solo "bloquea" mentía sobre cuándo exactamente se frena algo.
 */
export function CoverageReportPanel({ report }: { report: PdtpCoverageReport }) {
  if (report.total === 0) return null

  const blockingSubmission = report.groups.filter((group) => group.blocksSubmission)
  const blocksActivationOnly = report.groups.filter((group) => group.blocks && !group.blocksSubmission)
  const informative = report.groups.filter((group) => !group.blocks)

  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--color-text)]">Cobertura de destinos por actividad</h2>
        <span className="font-mono text-xs tabular-nums text-[var(--color-text-subtle)]">
          {report.ready}/{report.total} listas
        </span>
      </div>

      {blockingSubmission.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">
          Todas las actividades activas declaran dónde se registra su cumplimiento y quién puede hacerlo.
        </p>
      ) : (
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">
          Estas actividades prometen trabajo sin ofrecer dónde realizarlo, así que frenan el envío a revisión.
        </p>
      )}
      {blocksActivationOnly.length > 0 && (
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">
          Estas actividades declaran su número, pero el instrumento que lo acredita no está vigente: no frenan el
          envío, pero van a frenar la activación si no se resuelven antes.
        </p>
      )}

      <div className="mt-3 space-y-3">
        {[...blockingSubmission, ...blocksActivationOnly, ...informative].map((group) => (
          <div key={group.status}>
            <div className="flex flex-wrap items-center gap-2">
              <MetaBadge meta={{ label: `${group.issues.length}`, variant: group.blocksSubmission ? "danger" : group.blocks ? "warning" : "outline" }} dot />
              <h3 className="text-xs font-semibold uppercase text-[var(--color-text-subtle)]">{group.label}</h3>
              {!group.blocksSubmission && group.blocks && (
                <span className="text-xs text-[var(--color-text-subtle)]">(no frena el envío, sí la activación)</span>
              )}
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
