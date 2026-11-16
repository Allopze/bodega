import { sql, type SQL } from "drizzle-orm"
import { fuelSupplyMedia } from "@/db/schema"
import { SERVICE_TYPE_LABELS } from "@/lib/combustibles/source-labels"

/**
 * Nombre en pantalla de un medio de suministro.
 *
 * El catálogo trae medios llamados con la sigla de su canal Copec («TAE»,
 * «TCT»), y la sigla llegaba tal cual a los gráficos: «40 % de los litros llegó
 * por TAE», con «TAE» y «Copec» como si fueran canales distintos (crítica
 * 2026-11-15; el brief de Combustible prohíbe esas siglas sin explicar). Cuando
 * el nombre ES la sigla de su propio canal, se muestra el nombre del canal
 * (`SERVICE_TYPE_LABELS`, la misma fuente de Pagos y Tarjetas). Un nombre que
 * escribió una persona se respeta: renombrarlo es tarea de Ajustes, que sigue
 * mostrando el nombre real porque es donde se edita.
 *
 * Se agrupa por `fuel_supply_media.id` (clave primaria), así que Postgres acepta
 * esta expresión en el `select` sin repetirla en el `group by`.
 */
export function supplyMediumNameSql(): SQL<string> {
  return sql<string>`case
    when ${fuelSupplyMedia.providerChannel} = 'TCT' and upper(trim(${fuelSupplyMedia.name})) = 'TCT' then ${SERVICE_TYPE_LABELS.TCT}
    when ${fuelSupplyMedia.providerChannel} = 'TAE' and upper(trim(${fuelSupplyMedia.name})) = 'TAE' then ${SERVICE_TYPE_LABELS.TAE}
    else ${fuelSupplyMedia.name}
  end`
}
