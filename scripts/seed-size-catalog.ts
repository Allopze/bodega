/**
 * Deja `size_catalog` al día en la base apuntada.
 *
 * La tabla existía vacía desde su migración y sin ningún lector; las tallas
 * reales vivían en una constante del cliente. Este script la puebla desde la
 * semilla compartida (`lib/products/size-catalog.ts`) para que el asistente de
 * variantes y el padrón de trabajadores lean de la base.
 *
 * Es idempotente y no destructivo: agrega lo que falta y no reactiva una talla
 * dada de baja a mano, así que correrlo en cada despliegue es seguro — y por
 * eso `db:migrate` lo corre. Sí renumera el `display_order` de cada familia,
 * que es un derivado del comparador y no una opinión guardada.
 */
import { syncSizeCatalog } from "@/lib/services/sizes"
import { sizeCatalogRows } from "@/lib/products/size-catalog"

async function main() {
  const { created, existing, reordered } = await syncSizeCatalog()
  console.log(JSON.stringify({
    tallasEnSemilla: sizeCatalogRows().length,
    yaPresentes: existing,
    creadas: created,
    reordenadas: reordered,
  }, null, 2))
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  },
)
