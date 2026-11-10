import Link from "next/link"

/** Lo que la lista de una compra o de una OT sabe del producto de una línea. */
export interface ProductReferenceData {
  productId: string | null
  sku: string | null
  /** N° de parte del fabricante; sólo los repuestos de catálogo lo tienen. */
  partNumber: string | null
  /** La ficha `/mantencion/repuestos/[id]` sólo existe para repuestos de catálogo. */
  isSparePart: boolean
}

const NAME_LINK = "text-[var(--color-primary-ink)] underline-offset-2 hover:underline focus-visible:underline"

/** «RPT-001 · N° de parte 1R-0750»: la identidad del producto, o vacío en texto libre. */
export function sparePartIdentity(product: ProductReferenceData): string {
  return [product.sku, product.partNumber ? `N° de parte ${product.partNumber}` : null].filter(Boolean).join(" · ")
}

/**
 * La identidad del producto como texto que sólo se corta ENTRE campos: el SKU y el N° de
 * parte van en su propio `whitespace-nowrap`. Chromium corta «QA-901» después del guion, y
 * en una tarjeta a 390 px quedaba «QA-» en un renglón y «901» en el siguiente (UX-9 del
 * segundo recorrido). El texto sigue siendo uno solo («RPT-001 · N° de parte 1R-0750»).
 */
export function SparePartIdentity({ product, className }: { product: ProductReferenceData; className?: string }) {
  if (!sparePartIdentity(product)) return null
  return (
    <span className={className}>
      {product.sku && <span className="whitespace-nowrap">{product.sku}</span>}
      {product.sku && product.partNumber && " · "}
      {product.partNumber && <>N° de parte <span className="whitespace-nowrap">{product.partNumber}</span></>}
    </span>
  )
}

/** El nombre de la línea, enlazado a la ficha del repuesto sólo si se puede abrir. */
export function SparePartName({ name, product, canOpen }: { name: string; product: ProductReferenceData; canOpen: boolean }) {
  const href = canOpen && product.isSparePart && product.productId ? `/mantencion/repuestos/${product.productId}` : null
  return href ? <Link href={href} className={NAME_LINK}>{name}</Link> : <>{name}</>
}

/**
 * Nombre de la línea con la identidad del producto debajo: el SKU y, si lo tiene,
 * el N° de parte (con el que el proveedor factura). Es una sola pieza para las dos
 * superficies que muestran lo comprado —la ficha del equipo/vehículo y «Repuestos
 * pedidos» de la OT— para que un repuesto se lea igual en todas.
 *
 * El nombre es enlace a la ficha del repuesto sólo con `canOpen` (`repuestos:catalog`)
 * y cuando el producto es un repuesto de catálogo: un enlace que da 403/404 es peor
 * que ninguno. Una línea en texto libre no trae identidad y se dibuja sólo con el
 * nombre.
 */
export function SparePartReference({
  name,
  product,
  canOpen,
}: {
  name: string
  product: ProductReferenceData
  canOpen: boolean
}) {
  return (
    <>
      <SparePartName name={name} product={product} canOpen={canOpen} />
      <SparePartIdentity product={product} className="block font-mono text-2xs text-[var(--color-text-muted)]" />
    </>
  )
}
