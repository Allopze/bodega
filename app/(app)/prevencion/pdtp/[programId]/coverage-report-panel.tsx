import { MetaBadge } from "@/components/states/state-badge"
import type { PdtpCoverageReport } from "@/lib/services/prevention-pdtp"

/**
 * El informe de la compuerta, actividad por actividad. `submitBlockers` dice
 * "12 actividades sin configuración" —lo que cabe en un mensaje de error— y
 * esto dice cuáles y por qué. Sin esta vista la clasificación existía en el
 * tipo y había que leer la base a mano para verla.
 *
 * Dos niveles: lo que frena —y frena por igual el envío y la activación— y lo
 * que no. Lo que no frena no es cosmético: ninguna de esas actividades va a
 * acreditar cumplimiento mientras siga así, y el programa se activa igual, con
 * esas líneas en cero.
 *
 * El resumen del segundo bucket se mantiene genérico a propósito. Ahí caen
 * cuatro clasificaciones, no dos: además de `config_required` e
 * `instrument_required` —las que sí esperan un curso, una plantilla, un plan o
 * un mapa—, están `decision_required` (falta declarar el padrón) y
 * `destination_review` (el responsable no tiene permiso donde se acredita), que
 * no tienen ningún instrumento que crear. Nombrar sólo los instrumentos dejaba
 * el texto describiendo algo que no era. El motivo exacto de cada una va en su
 * propia línea, que es donde corresponde.
 *
 * Los dos textos valen igual con el programa en borrador y ya activo: el panel
 * se muestra en ambos casos, porque completar la cobertura es justamente el
 * trabajo que queda por delante cuando el programa ya está corriendo.
 */
export function CoverageReportPanel({ report }: { report: PdtpCoverageReport }) {
  if (report.total === 0) return null

  const blocking = report.groups.filter((group) => group.blocks)
  const nonBlocking = report.groups.filter((group) => !group.blocks)

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
          Estas actividades no tienen mecanismo de acreditación clasificado o no tienen quién pueda registrarlas: frenan
          el envío a revisión y la activación, y mientras sigan así no acreditan cumplimiento.
        </p>
      )}
      {nonBlocking.length > 0 && (
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">
          Estas otras no frenan el ciclo de vida: el programa se firma y se activa igual. Mientras no se resuelvan, esas
          actividades no acreditan cumplimiento y quedan en cero.
        </p>
      )}

      <div className="mt-3 space-y-3">
        {[...blocking, ...nonBlocking].map((group) => (
          <div key={group.status}>
            <div className="flex flex-wrap items-center gap-2">
              <MetaBadge meta={{ label: `${group.issues.length}`, variant: group.blocks ? "danger" : "outline" }} dot />
              <h3 className="text-xs font-semibold uppercase text-[var(--color-text-subtle)]">{group.label}</h3>
              {!group.blocks && (
                <span className="text-xs text-[var(--color-text-subtle)]">(no frena; no acredita hasta resolverse)</span>
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
