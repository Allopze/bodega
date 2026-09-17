import Link from "next/link"
import { Button } from "@/components/ui/button"
import { MetaBadge } from "@/components/states/state-badge"
import type { PdtpCoverageReport } from "@/lib/services/prevention-pdtp"
import { pdtpDestinationModuleLabel, pdtpPermissionLabel } from "./pdtp-destination-labels"

/**
 * El informe de la compuerta, actividad por actividad. `submitBlockers` dice
 * "12 actividades sin configuración" —lo que cabe en un mensaje de error— y
 * esto dice cuáles y por qué. Sin esta vista la clasificación existía en el
 * tipo y había que leer la base a mano para verla.
 *
 * Dos niveles: lo que frena —y frena por igual el envío y la activación— y lo
 * que no. Lo que no frena no es cosmético: las actividades con configuración o
 * instrumento pendiente no van a acreditar cumplimiento mientras siga así.
 * Un flujo segregado válido es la excepción positiva: sí tiene destino, pero
 * no exige un ejecutor del programa porque el contrato separa las funciones.
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
type CoverageGroup = PdtpCoverageReport["groups"][number]

function CoverageSummary({
  blocking,
  nonBlocking,
  segregated,
}: {
  blocking: CoverageGroup[]
  nonBlocking: CoverageGroup[]
  segregated: CoverageGroup[]
}) {
  const onlyNonBlocking = blocking.length === 0 && nonBlocking.length > 0
  const onlySegregated = blocking.length === 0 && nonBlocking.length === 0 && segregated.length > 0
  if (onlyNonBlocking) {
    return (
      <p className="mt-2 text-sm text-[var(--color-text-muted)]">
        No hay bloqueos de destino o ejecutor. Aun así, algunas actividades tienen configuración o instrumento pendiente y todavía no acreditan cumplimiento.
      </p>
    )
  }
  if (onlySegregated) {
    return (
      <p className="mt-2 text-sm text-[var(--color-text-muted)]">
        Los flujos segregados están cubiertos por contrato: el destino acredita el hecho con funciones separadas y no requiere un ejecutor adicional en este programa.
      </p>
    )
  }
  if (blocking.length > 0) {
    return (
      <p className="mt-2 text-sm text-[var(--color-text-muted)]">
        Estas actividades no tienen un destino ejecutable o un ejecutor acreditador válido. Frenan el envío a revisión y la activación de una versión nueva.
      </p>
    )
  }
  return (
    <p className="mt-2 text-sm text-[var(--color-text-muted)]">
      Todas las actividades activas tienen un destino y un ejecutor acreditador válido, o un flujo segregado definido por contrato.
    </p>
  )
}

function CoverageIssue({
  issue,
  canManageRoles,
}: {
  issue: CoverageGroup["issues"][number]
  canManageRoles: boolean
}) {
  const hasExecutorGap = issue.status === "executor_required" || issue.status === "executor_permission_gap"
  const hasPermissionGap = issue.status === "executor_permission_gap"
  return (
    <li className="py-1.5 text-sm">
      <span className="font-mono text-xs text-[var(--color-text-subtle)]">N°{issue.n}</span>
      {" "}<span className="text-[var(--color-text)]">{issue.activity}</span>
      <p className="text-xs text-[var(--color-text-muted)]">{issue.reason}</p>
      {hasExecutorGap && issue.destinationModule && (
        <p className="text-xs text-[var(--color-text-subtle)]">
          Destino: {pdtpDestinationModuleLabel(issue.destinationModule)}
          {issue.requiredPermission ? ` · permiso para ${pdtpPermissionLabel(issue.requiredPermission)}` : ""}
        </p>
      )}
      {hasExecutorGap && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {hasPermissionGap && canManageRoles ? (
            <Button asChild size="sm" variant="secondary"><Link href="/admin/roles">Administrar roles</Link></Button>
          ) : hasPermissionGap ? (
            <span className="text-xs text-[var(--color-text-subtle)]">
              Los roles {issue.executorRoleLabels?.join(", ") || "asignados"} requieren {pdtpPermissionLabel(issue.requiredPermission)}; solicita el ajuste a quien administra roles.
            </span>
          ) : null}
        </div>
      )}
    </li>
  )
}

function CoverageGroupList({ groups, canManageRoles }: { groups: CoverageGroup[]; canManageRoles: boolean }) {
  return (
    <div className="mt-3 space-y-3">
      {groups.map((group) => (
        <div key={group.status}>
          <div className="flex flex-wrap items-center gap-2">
            <MetaBadge meta={{ label: `${group.issues.length}`, variant: group.blocks ? "danger" : "outline" }} dot />
            <h3 className="text-xs font-semibold uppercase text-[var(--color-text-subtle)]">{group.label}</h3>
            {!group.blocks && group.status !== "segregated_valid" && (
              <span className="text-xs text-[var(--color-text-subtle)]">(no frena; no acredita hasta resolverse)</span>
            )}
            {group.status === "segregated_valid" && (
              <span className="text-xs text-[var(--color-text-subtle)]">(válido; no requiere ejecutor del programa)</span>
            )}
          </div>
          <ul className="mt-1 divide-y divide-[var(--color-border)]">
            {group.issues.map((issue) => (
              <CoverageIssue key={`${group.status}:${issue.n}`} issue={issue} canManageRoles={canManageRoles} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

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
  const segregated = report.groups.filter((group) => group.status === "segregated_valid")
  const nonBlocking = report.groups.filter((group) => !group.blocks && group.status !== "segregated_valid")
  const executorIssues = report.groups.flatMap((group) => group.issues)
    .filter((issue) => issue.status === "executor_required" || issue.status === "executor_permission_gap")
  const groups = [...blocking, ...nonBlocking, ...segregated]
  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--color-text)]">Cobertura de destinos por actividad</h2>
        <span className="font-mono text-xs tabular-nums text-[var(--color-text-subtle)]">
          {report.ready}/{report.total} listas
        </span>
      </div>

      <CoverageSummary blocking={blocking} nonBlocking={nonBlocking} segregated={segregated} />
      {nonBlocking.length > 0 && (
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">
          Estas otras no frenan el ciclo de vida. Mientras no se resuelvan, esas actividades no acreditan cumplimiento y quedan en cero.
        </p>
      )}

      {executorIssues.length > 0 && canManageProgram && programStatus === "draft" && (
        <div className="mt-3">
          <Button asChild size="sm" variant="secondary">
            <Link href={`/prevencion/pdtp/${programId}/editar?seccion=revision`}>Configurar ejecutores en el borrador</Link>
          </Button>
        </div>
      )}
      <CoverageGroupList groups={groups} canManageRoles={canManageRoles} />
    </section>
  )
}
