import Link from "next/link"
import { ArrowRight, CheckCircle } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import type { PdtpCoverageReport } from "@/lib/services/prevention-pdtp"

/**
 * Cuántas actividades del programa están listas para ejecutarse, y un camino
 * hacia las que no.
 *
 * Reemplaza a `CoverageReportPanel`, que listaba aquí mismo las 20 actividades
 * con problema, cada una con su motivo y ninguna con una acción. En prueba de
 * usabilidad un prevencionista no pudo resolver ninguna: el panel era un
 * informe en una página que ya apila seis secciones, y el trabajo de resolverlo
 * no cabía ahí. El detalle se mudó a `./habilitacion`, que es una bandeja con
 * filtros y acciones; acá queda la medida y la puerta.
 *
 * El `67/81` tampoco se lee igual: estaba en `font-mono text-xs` alineado a la
 * derecha, a un ancho de pantalla del título. En este repo `font-mono` es para
 * código; un dato de cabecera es un número y va en la escala tipográfica.
 */
export function CoverageSummaryCard({
  report,
  programId,
}: {
  report: PdtpCoverageReport
  programId: string
}) {
  // Un programa sin actividades activas no tiene nada que medir; la página ya
  // muestra su propio estado vacío.
  if (report.total === 0) return null

  const blocking = report.groups.filter((group) => group.blocks)
  const segregated = report.groups.filter((group) => group.status === "segregated_valid")
  const pending = report.groups.filter((group) => !group.blocks && group.status !== "segregated_valid")

  const countOfIssues = (groups: typeof report.groups) =>
    new Set(groups.flatMap((group) => group.issues.map((issue) => issue.n))).size
  const blockingCount = countOfIssues(blocking)
  const pendingCount = countOfIssues(pending)
  const segregatedCount = countOfIssues(segregated)

  /* Nada pendiente: una tarjeta completa con barra llena y un CTA que no lleva
   * a ningún trabajo es ruido. Una línea dice lo mismo. */
  if (blockingCount === 0 && pendingCount === 0) {
    return (
      <section className="flex items-center gap-2 rounded-xl border border-[var(--color-success-line)] bg-[var(--color-success-tint)] px-4 py-3">
        <CheckCircle size={18} weight="fill" className="shrink-0 text-[var(--color-success-ink)]" />
        <p className="text-sm text-[var(--color-success-ink)]">
          Las {report.total} actividades tienen dónde ejecutarse y quién las acredita.
        </p>
      </section>
    )
  }

  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <h2 className="text-sm font-semibold text-[var(--color-text)]">Actividades listas para ejecutar</h2>

      <p className="mt-2 flex items-baseline gap-2">
        <span className="text-3xl font-semibold leading-none tabular-nums text-[var(--color-text)]">{report.ready}</span>
        <span className="text-sm text-[var(--color-text-muted)]">de {report.total} actividades del programa</span>
      </p>

      <Progress
        className="mt-3"
        value={report.ready}
        max={report.total}
        label={`${report.ready} de ${report.total} actividades listas para ejecutar`}
        tone={blockingCount > 0 ? "danger" : "primary"}
        minVisible={2}
      />

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {blockingCount > 0 && (
          <li className="text-[var(--color-danger-ink)]">
            <strong className="font-semibold tabular-nums">{blockingCount}</strong> frenan la firma del programa
          </li>
        )}
        {pendingCount > 0 && (
          <li className="text-[var(--color-warning-ink)]">
            <strong className="font-semibold tabular-nums">{pendingCount}</strong> no acreditan todavía
          </li>
        )}
        {/* Sin badge: es una confirmación positiva del contrato, no una brecha.
            Pintarla con el mismo peso que las otras dos la convertía en un
            problema que nadie tiene que resolver. */}
        {segregatedCount > 0 && (
          <li className="text-[var(--color-text-muted)]">
            <span className="tabular-nums">{segregatedCount}</span> las acredita un tercero
          </li>
        )}
      </ul>

      <div className="mt-4">
        <Button asChild size="sm">
          <Link href={`/prevencion/pdtp/${programId}/habilitacion`}>
            Resolver lo que falta
            <ArrowRight size={14} />
          </Link>
        </Button>
        <p className="mt-2 text-xs text-[var(--color-text-subtle)]">
          Revisa qué le falta a cada una y ábrela donde se arregla.
        </p>
      </div>
    </section>
  )
}
