"use client"

import dynamic from "next/dynamic"
import type { ComponentType } from "react"
import type { IndicatorCounters } from "@/lib/prevention/safety-indicators-calc"

type IndicadoresChartsType = ComponentType<{ monthlyCounters: IndicatorCounters[] }>

export const IndicadoresCharts = dynamic(
  () => import("./indicadores-charts").then((m) => m.IndicadoresCharts),
  { ssr: false },
) as IndicadoresChartsType
