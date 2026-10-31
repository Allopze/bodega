"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { CategoryBarChart } from "./fuel-charts-lazy"
import { buildLitrosHref } from "./consumption-url"

interface ChartDataPoint { group: string | null; totalLiters: number; totalAmount: number; count?: number }

/**
 * `CategoryBarChart` con selección cruzada por proveedor: clic en una barra fija
 * ese proveedor como filtro de «Consumo» y deja abierta la sección de la planilla
 * de cargas (mismo mecanismo que ya usa `PatenteRankingChart` — la sección entera,
 * no sólo este gráfico, se re-renderiza filtrada).
 *
 * No existe el equivalente para "por faena": esa agregación agrupa por el
 * nombre de faena tal como viene en el archivo importado (`faenaNombre`), que
 * no es el mismo valor que el filtro "Faena" del resto de la página espera
 * (un `worksiteId`) — cablearlo produciría un filtro que se ve aplicado pero
 * no filtra nada.
 */
export function OperationsProveedorChart({ data, metric = "amount" }: { data: ChartDataPoint[]; metric?: "amount" | "liters" }) {
  const router = useRouter()
  const searchParams = useSearchParams()

  function handleSelect(group: string) {
    router.replace(buildLitrosHref(searchParams.toString(), { proveedor: group }, { section: "planilla" }), { scroll: false })
  }

  return <CategoryBarChart data={data} title="Proveedores" onSelect={handleSelect} metric={metric} />
}
