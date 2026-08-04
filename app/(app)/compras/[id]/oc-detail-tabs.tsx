"use client"

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
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
  invoicesPending = false,
  historyCount,
  items,
  facturacion,
  avance,
  historial,
}: {
  defaultTab?:   string
  itemsCount:    number
  invoicesCount: number
  /** Sin facturas el contador no se muestra, así que la pestaña no delataba lo
   *  que falta: el punto marca el pendiente donde iría el número. */
  invoicesPending?: boolean
  /** A-35: Historial no tenía contador y las otras pestañas sí. */
  historyCount:  number
  items:         React.ReactNode
  facturacion?:  React.ReactNode
  avance?:       React.ReactNode
  historial:     React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [tab, setTab] = React.useState(defaultTab)

  // Estado local para que el clic sea instantáneo, pero sincronizado con `?tab=`:
  // un enlace a `?tab=facturacion` desde esta misma página es una navegación
  // suave, y `useState` ignora el nuevo `defaultTab` del servidor. Sin esto, el
  // CTA "Adjuntar factura" del rail cambiaba la URL y dejaba "Ítems" a la vista.
  // Las dependencias son booleanos y no los nodos: éstos cambian de identidad en
  // cada render del servidor y reejecutarían el efecto durante la propia
  // navegación, devolviendo la pestaña recién elegida a la de la URL anterior.
  const urlTab = searchParams.get("tab")
  const hasFacturacion = facturacion != null
  const hasAvance = avance != null
  React.useEffect(() => {
    const available = ["items", ...(hasFacturacion ? ["facturacion"] : []), ...(hasAvance ? ["avance"] : []), "historial"]
    setTab(urlTab && available.includes(urlTab) ? urlTab : "items")
  }, [urlTab, hasFacturacion, hasAvance])

  function handleChange(value: string) {
    setTab(value)
    router.replace(value === "items" ? pathname : `${pathname}?tab=${value}`, { scroll: false })
  }

  return (
    <Tabs value={tab} onValueChange={handleChange}>
      <TabsList className="flex-nowrap">
        <TabsTrigger value="items">
          Ítems
          <Count>{itemsCount}</Count>
        </TabsTrigger>
        {facturacion != null && (
          <TabsTrigger value="facturacion">
            Facturación
            {invoicesCount > 0
              ? <Count>{invoicesCount}</Count>
              : invoicesPending && (
                  <span
                    aria-label="Sin facturas"
                    title="Sin facturas adjuntadas"
                    className="ml-2 inline-block size-1.5 rounded-full bg-[var(--color-signal-ink)]"
                  />
                )}
          </TabsTrigger>
        )}
        {/* A-35: "Avance" es la única sin contador a propósito — tiene una fila por
            ítem, así que su número sería el de "Ítems" repetido. */}
        {avance != null && <TabsTrigger value="avance">Avance</TabsTrigger>}
        <TabsTrigger value="historial">
          Historial
          {historyCount > 0 && <Count>{historyCount}</Count>}
        </TabsTrigger>
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
