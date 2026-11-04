"use client"

import dynamic from "next/dynamic"
import { Skeleton } from "@/components/ui/skeleton"
import type { TankLevelView } from "@/lib/combustibles/tank-level"

/**
 * Recharts pesa y sólo corre en el navegador: el import dinámico lo saca del paquete inicial de
 * Estanques (mismo patrón que el saldo de Bodega y los casos de «Por revisar»). El esqueleto reserva
 * el alto de un panel para que la tabla de abajo no salte al llegar el gráfico.
 */
export const TankLevelChart = dynamic<{ view: TankLevelView }>(
  () => import("./tank-level-chart").then((module) => module.TankLevelChart),
  { ssr: false, loading: () => <Skeleton className="h-72 w-full" aria-hidden /> },
)
