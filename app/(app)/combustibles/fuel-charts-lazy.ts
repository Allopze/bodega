"use client"

import dynamic from "next/dynamic"
import type { ComponentType } from "react"

interface ChartDataPoint {
  group: string | null
  totalLiters: number
  totalAmount: number
  count?: number
}

type MonthlyEvolutionChartType = ComponentType<{ data: ChartDataPoint[] }>
type CategoryBarChartType = ComponentType<{ data: ChartDataPoint[]; title: string }>
type ProductPieChartType = ComponentType<{ data: ChartDataPoint[] }>

export const MonthlyEvolutionChart = dynamic(
  () => import("./fuel-charts").then((m) => m.MonthlyEvolutionChart),
  { ssr: false },
) as MonthlyEvolutionChartType

export const CategoryBarChart = dynamic(
  () => import("./fuel-charts").then((m) => m.CategoryBarChart),
  { ssr: false },
) as CategoryBarChartType

export const ProductPieChart = dynamic(
  () => import("./fuel-charts").then((m) => m.ProductPieChart),
  { ssr: false },
) as ProductPieChartType
