import { SectionNav } from "@/components/ui/section-nav"
import { FUEL_CARRY_PARAMS, consumoNavItems, type ConsumoTab } from "@/lib/combustibles/section-nav"

/**
 * La barra de «Consumo y rendimiento»: Rendimiento, Consumo y Motor en vacío.
 * Las tres pantallas pintan la misma barra con el mismo contexto arrastrado
 * (período y faena: `FUEL_CARRY_PARAMS`); cada una sólo dice cuál es la suya.
 * Va inmediatamente después del `PageHeader` (y del banner de datos
 * degradados), antes de los filtros.
 *
 * `hrefs` deja a una pantalla reemplazar el destino de una pestaña.
 */
export function ConsumoNav({ activeKey, hrefs }: { activeKey: ConsumoTab; hrefs?: Partial<Record<ConsumoTab, string>> }) {
  const items = consumoNavItems().map((item) => {
    const href = hrefs?.[item.key as ConsumoTab]
    return href ? { ...item, href } : item
  })
  return (
    <SectionNav
      items={items}
      activeKey={activeKey}
      ariaLabel="Vistas de consumo y rendimiento"
      carryParams={FUEL_CARRY_PARAMS}
    />
  )
}
