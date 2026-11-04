"use client"

import dynamic from "next/dynamic"
import { Skeleton } from "@/components/ui/skeleton"
import type { DteCoverageShape, ReconciliationShape } from "@/lib/purchasing/reconciliation-charts"

/**
 * Recharts pesa y sólo corre en el navegador: el import dinámico real lo saca del
 * paquete inicial de la ruta (mismo patrón que el gráfico semanal de «Por revisar»).
 */
const loading = () => <Skeleton className="h-56 w-full" aria-hidden />

export const ReconciliationChart = dynamic<{ shape: ReconciliationShape }>(
  () => import("./reconciliation-chart").then((module) => module.ReconciliationChart),
  { ssr: false, loading },
)

export const DteCoverageChart = dynamic<{ shape: DteCoverageShape }>(
  () => import("./dte-coverage-chart").then((module) => module.DteCoverageChart),
  { ssr: false, loading },
)
