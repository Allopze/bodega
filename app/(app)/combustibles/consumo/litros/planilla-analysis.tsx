import Link from "next/link"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { CategoryBarChart } from "../../fuel-charts-lazy"
import { PatenteRankingChart, RendimientoChart } from "../../consumption-charts-lazy"
import { OperationsProveedorChart } from "../../operations-category-chart"
import type { OperationsSummary } from "@/lib/combustibles/operations-dashboard"
import { formatCLP, formatQty } from "@/lib/utils"
import { Disclosure } from "../_components/disclosure"

/** Unidad del rendimiento tal como la guarda la planilla de cargas. */
const RENDIMIENTO_UNIT_LABEL: Record<string, string> = { km_lt: "km/L", lt_hr: "L/h" }

/**
 * «Planilla de cargas»: los gráficos de la planilla con una fila por carga
 * (antes «Log operacional»): equipos con mayor gasto, el rendimiento que
 * declara la planilla por unidad, y el consumo por faena y por proveedor. Un
 * clic en un proveedor lo fija como filtro. Sin permiso de costos no hay
 * gráficos de gasto: tres de cuatro están enteramente enmarcados en monto y no
 * tienen una variante honesta «sólo litros», así que se ocultan en vez de
 * graficar «gasto» sin el monto.
 */
export function PlanillaAnalysis({ summary, canViewCosts, emptyAction }: { summary: OperationsSummary | null; canViewCosts: boolean; emptyAction?: { label: string; href: string } }) {
  if (!summary) {
    return (
      <EmptyState
        compact
        title="Sin cargas de la planilla en el período"
        description="Amplía el período, quita la faena o los filtros, o agrega una planilla de cargas para ver estos gráficos."
        action={emptyAction ? <Button asChild variant="secondary" size="sm"><Link href={emptyAction.href}>{emptyAction.label}</Link></Button> : undefined}
      />
    )
  }
  const units = [...new Set(summary.rendimientoPorEquipo.map((row) => row.unidad))]
  return (
    <div>
      <p className="mb-5 font-mono text-sm text-[var(--color-text-muted)]">
        {formatQty(Math.round(summary.totalLitros), "L")} · {formatQty(summary.totalRegistros)} cargas · {formatQty(summary.totalEquipos)} equipos
        {canViewCosts && summary.totalMonto != null ? <> · {formatCLP(summary.totalMonto)}</> : null}
      </p>
      <div className="grid gap-8 lg:grid-cols-2">
        {canViewCosts ? (
          <section aria-labelledby="planilla-gasto-title">
            <h3 id="planilla-gasto-title" className="mb-1 text-h3 text-[var(--color-text)]">Equipos con mayor gasto</h3>
            <p className="mb-2 text-sm text-[var(--color-text-muted)]">{summary.totalEquipos} equipos, {summary.totalRegistros} cargas registradas. Un clic abre la ficha del equipo.</p>
            <PatenteRankingChart data={summary.topEquiposPorGasto} metric="monto" />
          </section>
        ) : null}
        {/* Un gráfico por unidad (A5b): km/L y L/h no comparten eje; más km/L es mejor y más L/h es peor. */}
        <section aria-labelledby="planilla-rend-title">
          <h3 id="planilla-rend-title" className="mb-1 text-h3 text-[var(--color-text)]">Rendimiento declarado en la planilla</h3>
          <p className="mb-2 text-sm text-[var(--color-text-muted)]">La comparación pondera cada lectura por litros cargados y separa km/L de L/h.</p>
          <div className="space-y-5">
            {units.map((unidad) => (
              <div key={unidad ?? "sin-unidad"}>
                <p className="mb-1 text-eyebrow">{RENDIMIENTO_UNIT_LABEL[unidad ?? ""] ?? "Unidad no informada"}</p>
                <RendimientoChart data={summary.rendimientoPorEquipo.filter((row) => row.unidad === unidad)} unitLabel={RENDIMIENTO_UNIT_LABEL[unidad ?? ""]} />
              </div>
            ))}
          </div>
        </section>
      </div>
      {/* A la vista, a lo más tres gráficos (gasto y rendimiento por unidad); el reparto por faena y por proveedor se abre a demanda. */}
      <div className="mt-6">
        <Disclosure title={canViewCosts ? "Gasto por faena y por proveedor" : "Consumo por faena y por proveedor"} description="Dónde se concentra el combustible de la planilla; un clic en un proveedor lo fija como filtro.">
          <div className="grid gap-8 lg:grid-cols-2">
            <section aria-labelledby="planilla-faena-title">
              <h3 id="planilla-faena-title" className="mb-1 text-h3 text-[var(--color-text)]">{canViewCosts ? "Gasto por faena" : "Consumo por faena"}</h3>
              <p className="mb-2 text-sm text-[var(--color-text-muted)]">{canViewCosts ? "¿Qué faena concentra el gasto de combustible de la planilla?" : "¿Qué faena concentra el volumen de combustible de la planilla?"}</p>
              <CategoryBarChart data={summary.porFaena.map((row) => ({ group: row.faena, totalLiters: row.litros, totalAmount: row.monto ?? 0, count: row.equipos }))} title="Faenas" metric={canViewCosts ? "amount" : "liters"} />
            </section>
            <section aria-labelledby="planilla-prov-title">
              <h3 id="planilla-prov-title" className="mb-1 text-h3 text-[var(--color-text)]">{canViewCosts ? "Gasto por proveedor" : "Consumo por proveedor"}</h3>
              <p className="mb-2 text-sm text-[var(--color-text-muted)]">{canViewCosts ? "¿Con qué proveedor se concentra el volumen y el gasto?" : "¿Con qué proveedor se concentra el volumen cargado?"} Un clic fija el proveedor como filtro.</p>
              <OperationsProveedorChart data={summary.porProveedor.map((row) => ({ group: row.proveedor, totalLiters: row.litros, totalAmount: row.monto ?? 0, count: row.transacciones }))} metric={canViewCosts ? "amount" : "liters"} />
            </section>
          </div>
        </Disclosure>
      </div>
    </div>
  )
}
