"use client"

import dynamic from "next/dynamic"
import { createElement, type ComponentType } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import type { PerformanceUnit } from "@/lib/combustibles/control/contracts"
import type { DispersionPoint } from "./performance-dispersion-chart"

function DispersionSkeleton() {
  return createElement(Skeleton, { className: "h-72 w-full", role: "status", "aria-label": "Cargando gráfico" })
}

export const PerformanceDispersionChart = dynamic(
  () => import("./performance-dispersion-chart").then((module) => module.PerformanceDispersionChart),
  { ssr: false, loading: DispersionSkeleton },
) as ComponentType<{ unit: PerformanceUnit; points: DispersionPoint[] }>
