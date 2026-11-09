import { and, eq, inArray } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { products } from "@/db/schema"

/**
 * Por qué una solicitud no puede enviarse a aprobación: alguno de sus productos
 * fue dado de baja. `null` si todos siguen activos.
 *
 * Un repuesto de catálogo desactivado puede quedar guardado en un borrador (el
 * autoguardado no lo rechaza si el ítem ya lo tenía), pero no se envía: el
 * mensaje nombra el repuesto y su SKU y dice qué hacer, igual que la marca del
 * ítem en el formulario.
 */
export async function inactiveRequestProductsMessage(
  productIds: ReadonlyArray<string | null | undefined>,
  client: typeof db | Tx = db,
): Promise<string | null> {
  const ids = [...new Set(productIds.filter((id): id is string => !!id))]
  if (ids.length === 0) return null

  const inactive = await client
    .select({ name: products.name, sku: products.sku, isSparePart: products.isSparePart })
    .from(products)
    .where(and(inArray(products.id, ids), eq(products.isActive, false)))
  if (inactive.length === 0) return null

  const spareParts = inactive.filter((product) => product.isSparePart)
  if (spareParts.length > 0) {
    const named = spareParts.map((part) => `«${part.name}» (${part.sku})`).join(", ")
    return spareParts.length === 1
      ? `El repuesto ${named} fue desactivado del catálogo: cámbialo antes de enviar`
      : `Los repuestos ${named} fueron desactivados del catálogo: cámbialos antes de enviar`
  }
  const names = inactive.map((product) => product.name).join(", ")
  return `Los siguientes productos están inactivos y no pueden solicitarse: ${names}`
}
