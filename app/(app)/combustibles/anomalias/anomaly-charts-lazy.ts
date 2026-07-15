"use client"

import dynamic from "next/dynamic"
import type { ComponentType } from "react"

export interface DistributionData {
  byStatus: Array<{ status: string; count: number }>
  bySeverity: Array<{ severity: string; count: number }>
  byRuleCode: Array<{ ruleCode: string; ruleName: string | null; count: number }>
  total: number
}

type AnomalyDistributionChartType = ComponentType<{ distribution: DistributionData }>

/** Lazy-loaded AnomalyDistributionChart. Recharts se carga sólo en el cliente. */
export const AnomalyDistributionChart = dynamic(
  () => import("./anomaly-distribution-chart").then((m) => m.AnomalyDistributionChart),
  { ssr: false },
) as AnomalyDistributionChartType
