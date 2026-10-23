import { SectionNav } from "@/components/ui/section-nav"
import { CONSUMO_CARRY_PARAMS, consumoNavItems, type ConsumoTab } from "@/lib/combustibles/section-nav"

/**
 * La barra de «Consumo y rendimiento». Las seis pantallas de la sección
 * (resumen, TCT, cargas por equipo, rendimiento, ralentí y ciclo físico) pintan
 * la misma barra con el mismo contexto arrastrado; cada una sólo dice cuál es
 * la suya. Va inmediatamente después del `PageHeader` (y del banner de datos
 * degradados), antes de los filtros.
 *
 * `hrefs` deja a una pantalla reemplazar el destino de una pestaña: el resumen
 * y el consumo TCT comparten más filtros (fechas, fuente, patente, asociación,
 * proveedor) de los que la barra arrastra, y cambiar entre ellos no debe
 * obligar a volver a filtrar.
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
      carryParams={CONSUMO_CARRY_PARAMS}
    />
  )
}
