"use client"

import * as React from "react"
import { usePathname, useRouter } from "next/navigation"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"

/**
 * Contenedor de pestañas del detalle de OC. Recibe los nodos ya renderizados en
 * el servidor (composición RSC) y sincroniza la pestaña activa con la URL
 * (`?tab=`), de modo que sea compartible/marcable y el SSR renderice la pestaña
 * correcta directamente. Mueve facturación/avance/historial fuera del rail
 * lateral estrecho a la columna principal ancha.
 */
export function OcDetailTabs({
  defaultTab = "items",
  itemsCount,
  invoicesCount,
  items,
  facturacion,
  avance,
  historial,
}: {
  defaultTab?:   string
  itemsCount:    number
  invoicesCount: number
  items:         React.ReactNode
  facturacion?:  React.ReactNode
  avance?:       React.ReactNode
  historial:     React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [tab, setTab] = React.useState(defaultTab)

  function handleChange(value: string) {
    setTab(value)
    router.replace(value === "items" ? pathname : `${pathname}?tab=${value}`, { scroll: false })
  }

  return (
    <Tabs value={tab} onValueChange={handleChange}>
      <TabsList className="flex-wrap">
        <TabsTrigger value="items">
          Ítems
          <Count>{itemsCount}</Count>
        </TabsTrigger>
        {facturacion != null && (
          <TabsTrigger value="facturacion">
            Facturación
            {invoicesCount > 0 && <Count>{invoicesCount}</Count>}
          </TabsTrigger>
        )}
        {avance != null && <TabsTrigger value="avance">Avance</TabsTrigger>}
        <TabsTrigger value="historial">Historial</TabsTrigger>
      </TabsList>

      <TabsContent value="items">{items}</TabsContent>
      {facturacion != null && <TabsContent value="facturacion">{facturacion}</TabsContent>}
      {avance != null && <TabsContent value="avance">{avance}</TabsContent>}
      <TabsContent value="historial">{historial}</TabsContent>
    </Tabs>
  )
}

function Count({ children }: { children: React.ReactNode }) {
  return (
    <span className="ml-2 inline-flex items-center justify-center rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-xs font-medium tabular-nums text-[var(--color-text-muted)]">
      {children}
    </span>
  )
}
