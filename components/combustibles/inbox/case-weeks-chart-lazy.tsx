"use client"

import dynamic from "next/dynamic"
import { Skeleton } from "@/components/ui/skeleton"
import type { AnomalyRuleChange, AnomalyWeek } from "@/lib/combustibles/inbox/case-weeks"

/**
 * Recharts pesa y sólo corre en el navegador: el import dinámico real lo saca del
 * paquete inicial de «Por revisar» (mismo patrón que el gráfico semanal de Mantención).
 */
export const CaseWeeksChart = dynamic<{ weeks: AnomalyWeek[]; ruleChanges?: AnomalyRuleChange[] }>(
  () => import("./case-weeks-chart").then((module) => module.CaseWeeksChart),
  { ssr: false, loading: () => <Skeleton className="h-56 w-full" aria-hidden /> },
)
