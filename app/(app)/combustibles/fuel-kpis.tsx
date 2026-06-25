"use client"

import { Card, CardContent } from "@/components/ui/card"
import { GasPump, CurrencyCircleDollar, Hash, CalendarBlank } from "@phosphor-icons/react"

interface FuelDashboardKpisProps {
  totalLiters: number
  totalAmount: number
  loadCount: number
  currentMonth: string
}

export function FuelDashboardKpis({ totalLiters, totalAmount, loadCount, currentMonth }: FuelDashboardKpisProps) {
  const formatCLP = (n: number) => new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(n)
  const formatLiters = (n: number) => new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 }).format(n)

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg dark:bg-blue-900/30">
              <CalendarBlank className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Mes</p>
              <p className="text-lg font-semibold">{currentMonth}</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-100 rounded-lg dark:bg-amber-900/30">
              <GasPump className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Litros totales</p>
              <p className="text-lg font-semibold">{formatLiters(totalLiters)}</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 rounded-lg dark:bg-green-900/30">
              <CurrencyCircleDollar className="h-5 w-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total gastado</p>
              <p className="text-lg font-semibold">{formatCLP(totalAmount)}</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 rounded-lg dark:bg-purple-900/30">
              <Hash className="h-5 w-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Cargas</p>
              <p className="text-lg font-semibold">{loadCount}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
