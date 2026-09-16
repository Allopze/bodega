import Link from "next/link"
import { Button } from "@/components/ui/button"
import { MetaBadge } from "@/components/states/state-badge"
import type { PdtpCoverageReport } from "@/lib/services/prevention-pdtp"
import { CreatePdtpRevisionButton } from "./create-pdtp-revision-button"

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
 * tres clasificaciones, no dos: además de `config_required` e
 * `instrument_required` —las que sí esperan un curso, una plantilla, un plan o
 * un mapa— está `decision_required` (falta declarar el padrón), que no tiene
 * ningún instrumento que crear. Nombrar sólo los instrumentos dejaba
 * el texto describiendo algo que no era. El motivo exacto de cada una va en su
 * propia línea, que es donde corresponde.
 *
 * Los dos textos valen igual con el programa en borrador y ya activo: el panel
 * se muestra en ambos casos, porque completar la cobertura es justamente el
 * trabajo que queda por delante cuando el programa ya está corriendo.
 */
export function CoverageReportPanel({
  report,
  programId,
  programStatus,
  canManageProgram,
  canManageRoles,
}: {
  report: PdtpCoverageReport
  programId: string
  programStatus: string
  canManageProgram: boolean
  canManageRoles: boolean
}) {
  if (report.total === 0) return null

  const blocking = report.groups.filter((group) => group.blocks)
  const nonBlocking = report.groups.filter((group) => !group.blocks)
  const executorIssues = report.groups.flatMap((group) => group.issues)
    .filter((issue) => issue.status === "executor_required" || issue.status === "executor_permission_gap")
  const onlyNonBlocking = blocking.length === 0 && nonBlocking.length > 0
  const permissionLabel = (permission: string | undefined) => {
    if (permission === "prevention:inspections:execute") return "registrar inspecciones"
    if (permission === "prevention:training:execute") return "registrar capacitaciones"
    if (permission === "prevention:pdtp:execute") return "registrar cumplimiento en PDTP"
    return "el permiso operativo del destino"
  }

  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--color-text)]">Cobertura de destinos por actividad</h2>
        <span className="font-mono text-xs tabular-nums text-[var(--color-text-subtle)]">
          {report.ready}/{report.total} listas
        </span>
      </div>

      {blocking.length === 0 && !onlyNonBlocking ? (
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">
          Todas las actividades activas tienen un destino y un ejecutor acreditador válido, o un flujo segregado definido por contrato.
        </p>
      ) : onlyNonBlocking ? (
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">
          No hay bloqueos de destino o ejecutor. Aun así, algunas actividades tienen configuración o instrumento pendiente y todavía no acreditan cumplimiento.
        </p>
      ) : (
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">
          Estas actividades no tienen un destino ejecutable o un ejecutor acreditador válido. Frenan el envío a revisión y la activación de una versión nueva.
        </p>
      )}
      {nonBlocking.length > 0 && (
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">
          Estas otras no frenan el ciclo de vida. Mientras no se resuelvan, esas actividades no acreditan cumplimiento y quedan en cero.
        </p>
      )}

      {executorIssues.length > 0 && canManageProgram && programStatus !== "active" && (
        <div className="mt-3">
          <Button asChild size="sm" variant="secondary">
            <Link href={`/prevencion/pdtp/${programId}/editar?seccion=revision`}>Configurar ejecutores en el borrador</Link>
          </Button>
        </div>
      )}
      {executorIssues.length > 0 && programStatus === "active" && canManageProgram && (
        <div className="mt-3">
          <CreatePdtpRevisionButton sourceProgramId={programId} />
        </div>
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
                  {(issue.status === "executor_required" || issue.status === "executor_permission_gap") && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {issue.status === "executor_permission_gap" && canManageRoles ? (
                        <Button asChild size="sm" variant="secondary"><Link href="/admin/roles">Administrar roles</Link></Button>
                      ) : issue.status === "executor_permission_gap" ? (
                        <span className="text-xs text-[var(--color-text-subtle)]">
                          Los roles {issue.executorRoleLabels?.join(", ") || "asignados"} requieren {permissionLabel(issue.requiredPermission)}; solicita el ajuste a quien administra roles.
                        </span>
                      ) : null}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}
