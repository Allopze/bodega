"use client"

import dynamic from "next/dynamic"
import { createElement, type ComponentType } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import type { EquipmentFileLitersMonth } from "@/lib/combustibles/equipment/types"

/** Recharts no viaja con el primer envío de la ficha: el esqueleto reserva el alto del gráfico. */
function ChartSkeleton() {
  return createElement(Skeleton, { className: "h-60 w-full", role: "status", "aria-label": "Cargando gráfico" })
}

export const EquipmentLitersChart = dynamic(
  () => import("./equipment-liters-chart").then((module) => module.EquipmentLitersChart),
  { ssr: false, loading: ChartSkeleton },
) as ComponentType<{ months: EquipmentFileLitersMonth[]; periodMonths: string[]; vehicleLabel: string }>
