import { and, eq, inArray } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { products } from "@/db/schema"

/**
 * Por qué una solicitud no puede enviarse a aprobación: alguno de sus productos
 * fue dado de baja. `null` si todos siguen activos.
 *
 * Un repuesto de catálogo desactivado puede quedar guardado en un borrador (el
 * autoguardado no lo rechaza si el ítem ya lo tenía), pero no se envía: el
 * mensaje nombra cada producto inactivo (repuesto o no) con su SKU y dice qué
 * hacer, igual que la marca del ítem en el formulario.
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

  // Todos se nombran: un repuesto y un producto común desactivados a la vez no
  // pueden dejar al segundo fuera del mensaje.
  const spareParts = inactive.filter((product) => product.isSparePart)
  const others = inactive.filter((product) => !product.isSparePart)
  const parts: string[] = []
  if (spareParts.length > 0) {
    const named = spareParts.map((part) => `«${part.name}» (${part.sku})`).join(", ")
    parts.push(spareParts.length === 1
      ? `El repuesto ${named} fue desactivado del catálogo`
      : `Los repuestos ${named} fueron desactivados del catálogo`)
  }
  if (others.length > 0) {
    const named = others.map((product) => `«${product.name}» (${product.sku})`).join(", ")
    parts.push(others.length === 1
      ? `${spareParts.length > 0 ? "el producto" : "El producto"} ${named} está inactivo`
      : `${spareParts.length > 0 ? "los productos" : "Los productos"} ${named} están inactivos`)
  }
  return `${parts.join(" y ")}: ${inactive.length === 1 ? "cámbialo" : "cámbialos"} antes de enviar`
}
