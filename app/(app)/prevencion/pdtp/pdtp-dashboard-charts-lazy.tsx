"use client"

import dynamic from "next/dynamic"
import { Skeleton } from "@/components/ui/skeleton"
import type { CategoryBreakdownData, MonthlyTrendData, WorksiteComplianceData } from "./pdtp-dashboard-charts"

const PdtpDashboardCharts = dynamic(
  () => import("./pdtp-dashboard-charts").then((module) => module.PdtpDashboardCharts),
  { ssr: false, loading: () => <Skeleton className="h-[34rem] w-full" /> },
)

export function PdtpDashboardChartsLazy(props: {
  monthlyTrend: MonthlyTrendData[]
  worksiteCompliance: WorksiteComplianceData[]
  categoryBreakdown: CategoryBreakdownData[]
  operationalHref: string
}) {
  return <PdtpDashboardCharts {...props} />
}
