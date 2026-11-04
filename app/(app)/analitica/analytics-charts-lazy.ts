"use client"

import dynamic from "next/dynamic"
import type { ComponentType } from "react"
import type { SpendByMonthRow } from "@/lib/services/analytics"
import type { ParetoChartRow } from "./analytics-charts"

type MonthlySpendChartType = ComponentType<{ data: SpendByMonthRow[]; showFuel: boolean }>
type SupplierParetoChartType = ComponentType<{ rows: ParetoChartRow[]; thresholdPct: number }>

export const MonthlySpendChart = dynamic(
  () => import("./analytics-charts").then((m) => m.MonthlySpendChart),
  { ssr: false },
) as MonthlySpendChartType

export const SupplierParetoChart = dynamic(
  () => import("./analytics-charts").then((m) => m.SupplierParetoChart),
  { ssr: false },
) as SupplierParetoChartType
