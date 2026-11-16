"use client"

import dynamic from "next/dynamic"
import { createElement, type ComponentType } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import type { PerformanceUnit } from "@/lib/combustibles/control/contracts"
import type { EquipmentNormalRange, EquipmentSeriesPoint } from "@/lib/combustibles/equipment/types"

/** Recharts no viaja con el primer envío de la ficha: el esqueleto reserva el alto del gráfico. */
function ChartSkeleton() {
  return createElement(Skeleton, { className: "h-60 w-full", role: "status", "aria-label": "Cargando gráfico" })
}

export const EquipmentPerformanceChart = dynamic(
  () => import("./equipment-performance-chart").then((module) => module.EquipmentPerformanceChart),
  { ssr: false, loading: ChartSkeleton },
) as ComponentType<{ unit: PerformanceUnit; points: EquipmentSeriesPoint[]; range: EquipmentNormalRange | null; vehicleLabel: string }>
