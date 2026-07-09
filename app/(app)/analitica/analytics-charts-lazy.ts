"use client"

import dynamic from "next/dynamic"
import type { ComponentType } from "react"
import type { SpendByMonthRow, SpendByModuleRow, VehicleCostRow, WorksiteSpendRow } from "@/lib/services/analytics"

type MonthlySpendChartType = ComponentType<{ data: SpendByMonthRow[] }>
type ModuleSpendChartType = ComponentType<{ data: SpendByModuleRow[] }>
type RankingBarChartType = ComponentType<{
  data: Array<WorksiteSpendRow | VehicleCostRow>
  labelKey: "name" | "plate"
  valueKey: "totalAmount" | "totalOperationalCost"
  emptyLabel: string
}>

export const MonthlySpendChart = dynamic(
  () => import("./analytics-charts").then((m) => m.MonthlySpendChart),
  { ssr: false },
) as MonthlySpendChartType

export const ModuleSpendChart = dynamic(
  () => import("./analytics-charts").then((m) => m.ModuleSpendChart),
  { ssr: false },
) as ModuleSpendChartType

export const RankingBarChart = dynamic(
  () => import("./analytics-charts").then((m) => m.RankingBarChart),
  { ssr: false },
) as RankingBarChartType
