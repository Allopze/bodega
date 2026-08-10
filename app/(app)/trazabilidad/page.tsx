import type { Metadata } from "next"
import { redirect } from "next/navigation"
import Link from "next/link"
import { can, requirePermission } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { PageContainer } from "@/components/ui/page-container"
import { EmptyState } from "@/components/ui/empty-state"
import { Warning, DownloadSimple } from "@phosphor-icons/react/dist/ssr"
import { TrazabilidadFilters } from "./trazabilidad-filters"
import { getTrazabilidadMatrix } from "@/lib/services/trazabilidad-matrix"
import { TrazabilidadMatrixCard } from "./_components/trazabilidad-matrix-card"
import { TrazabilidadMatrixTable } from "./_components/trazabilidad-matrix-table"
import { TraceabilityIntegrityCases } from "./_components/traceability-integrity-cases"
import {
  listTraceabilityIntegrityAdjustmentOptions,
  listTraceabilityIntegrityCases,
} from "@/lib/services/traceability-integrity-cases"
import {
  TRACEABILITY_PAGE_SIZE as PAGE_SIZE,
  TRACEABILITY_ALERT_SCAN_LIMIT as ALERT_SCAN_LIMIT,
} from "@/lib/constants"

export const metadata: Metadata = { title: "Trazabilidad de ítems" }

export default async function TrazabilidadPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  let session
  try { session = await requirePermission("traceability:view") }
  catch { redirect("/forbidden") }

  const sp = await searchParams
  const {
    rows,
    paginated,
    totalFiltered,
    totalPages,
    safePage,
    alertCount,
    visibleWorksites,
    filterFaenaId,
    filterEstado,
    pageHref,
    totalRows,
    isAlertFilter,
  } = await getTrazabilidadMatrix(sp, session)
  const canReconcileIntegrity = can(session, "traceability:reconcile_integrity")
  const [integrityCases, integrityAdjustmentOptions] = canReconcileIntegrity
    ? await Promise.all([
      listTraceabilityIntegrityCases(session),
      listTraceabilityIntegrityAdjustmentOptions(session),
    ])
    : [[], []]
  const activeWorksite = visibleWorksites.find((worksite) => worksite.id === filterFaenaId)

  return (
    <PageContainer>
      <PageHeader
        title="Trazabilidad de ítems"
        description="Estado de cada ítem a lo largo del flujo: solicitud → aprobación → OC → recepción → entrega."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Trazabilidad" },
          ]} />
        }
      />

      <p className="mb-3 text-xs text-(--color-text-subtle)" aria-live="polite">
        Alcance de faena: <span className="font-medium text-(--color-text-muted)">{activeWorksite?.name ?? "todas las faenas permitidas"}</span>
      </p>

      <TraceabilityIntegrityCases
        cases={integrityCases}
        canReconcile={canReconcileIntegrity}
        adjustmentOptions={integrityAdjustmentOptions}
      />

      {/* ── Alert summary ─────────────────────────────────────────────── */}
      {alertCount > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-[var(--radius)] border border-[var(--color-signal-line)] bg-[var(--color-signal-tint)] px-4 py-3">
          <Warning weight="fill" className="h-4 w-4 shrink-0 text-[var(--color-signal-ink)]" aria-hidden />
          <p className="text-sm font-medium text-[var(--color-signal-ink)]">
            {alertCount} {alertCount === 1 ? "ítem aprobado sin orden de compra" : "ítems aprobados sin orden de compra"}
          </p>
          {filterEstado !== "alert" && (
            <a
              href={`/trazabilidad?estado=alert${filterFaenaId ? `&faena=${filterFaenaId}` : ""}`}
              className="ml-auto inline-flex min-h-11 items-center text-xs font-medium text-[var(--color-signal-ink)] underline underline-offset-2 sm:min-h-0"
            >
              Ver solo alertas
            </a>
          )}
        </div>
      )}

      {/* ── Filters ───────────────────────────────────────────────────── */}
      <TrazabilidadFilters
        worksites={visibleWorksites}
        current={{ faena: filterFaenaId, estado: filterEstado }}
      />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Button asChild variant="secondary" size="sm">
          <Link
            href={`/api/trazabilidad/export${filterFaenaId ? `?faena=${filterFaenaId}` : ""}`}
            prefetch={false}
            aria-label="Exportar trazabilidad a Excel"
          >
            <DownloadSimple className="h-3.5 w-3.5" aria-hidden />
            Exportar Excel
          </Link>
        </Button>
        {(filterFaenaId || filterEstado) && (
          <Link
            href="/trazabilidad"
            className="inline-flex min-h-11 items-center text-sm text-[var(--color-text-muted)] underline underline-offset-2 hover:text-[var(--color-text)] sm:min-h-0"
          >
            Quitar filtros
          </Link>
        )}
        <span className="ml-auto self-end text-xs text-[var(--color-text-subtle)]">
          {totalFiltered} de {totalRows} ítems
          {totalPages > 1 && ` · Pág. ${safePage} de ${totalPages}`}
          {isAlertFilter && totalRows > ALERT_SCAN_LIMIT && ` · primeras ${ALERT_SCAN_LIMIT} filas revisadas`}
        </span>
      </div>

      {/* ── Matrix table ──────────────────────────────────────────────── */}
      {paginated.length === 0 ? (
        // A-4: los dos vacíos no piden lo mismo. Sin datos → ir a crear una
        // solicitud. Vacío por filtro → quitar los filtros, que antes se pedía
        // en el texto ("intenta con otros filtros") sin dar forma de hacerlo.
        <EmptyState
          compact
          title={rows.length === 0 ? "Aún no hay ítems que trazar" : "Sin ítems para estos filtros"}
          description={rows.length === 0
            ? "La trazabilidad se construye desde los ítems de las solicitudes; en cuanto exista la primera, aparecerá aquí."
            : "Ningún ítem coincide con los filtros aplicados."}
          action={rows.length === 0 ? (
            <Button asChild size="sm">
              <Link href="/solicitudes/nueva">Nueva solicitud</Link>
            </Button>
          ) : (
            <Button asChild size="sm" variant="secondary">
              <Link href="/trazabilidad">Quitar filtros</Link>
            </Button>
          )}
        />
      ) : (
        <>
          <div className="grid gap-2 md:hidden">
            {paginated.map((row) => (
              <TrazabilidadMatrixCard key={row.itemId} row={row} />
            ))}
          </div>
          <TrazabilidadMatrixTable rows={paginated} />
        </>
      )}

      {/* ── Pagination ────────────────────────────────────────────────── */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between gap-4 border-t border-[var(--color-border)] px-4 py-3">
          <p className="text-xs text-[var(--color-text-subtle)]">
            <span className="font-mono tabular-nums">{(safePage - 1) * PAGE_SIZE + 1}</span>
            {" – "}
            <span className="font-mono tabular-nums">{Math.min(safePage * PAGE_SIZE, totalFiltered)}</span>
            {" de "}
            <span className="font-mono tabular-nums">{totalFiltered}</span>
          </p>
          <div className="flex items-center gap-1">
            {safePage > 1 && (
              <a
                href={pageHref(safePage - 1)}
                className="inline-flex h-11 w-11 sm:h-8 sm:w-8 items-center justify-center rounded-[var(--radius)] text-xs font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] transition-[color,background-color,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)]"
                aria-label="Página anterior"
              >
                ←
              </a>
            )}
            <span className="px-3 text-xs text-[var(--color-text-subtle)]">
              Pág. {safePage} de {totalPages}
            </span>
            {safePage < totalPages && (
              <a
                href={pageHref(safePage + 1)}
                className="inline-flex h-11 w-11 sm:h-8 sm:w-8 items-center justify-center rounded-[var(--radius)] text-xs font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] transition-[color,background-color,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)]"
                aria-label="Página siguiente"
              >
                →
              </a>
            )}
          </div>
        </div>
      )}

      {/* ── Legend ────────────────────────────────────────────────────── */}
      <p className="mt-4 text-xs text-[var(--color-text-subtle)]">
        Las filas resaltadas indican ítems aprobados cuya cantidad en órdenes de compra es inferior a la aprobada.
        La recepción en faena habilita la entrega trazable; la llegada a oficina es sólo un paso previo y no libera stock en faena.
      </p>
    </PageContainer>
  )
}
