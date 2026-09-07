/**
 * GET /api/bodega/opciones?faena=<id>
 *
 * Opciones de los formularios de movimiento (conteo, ajuste, baja, devolución)
 * para UNA faena.
 *
 * Existe para sacarlas del render de `/bodega`: se calculaban en cada carga de
 * la página — incluido un producto cartesiano faenas × productos activos para
 * el conteo físico — y alimentaban un panel que puede no abrirse nunca. Además
 * corrían antes de evaluar el permiso que las gatea.
 */
import { type NextRequest, NextResponse } from "next/server"
import { and, asc, eq, isNull, sql } from "drizzle-orm"
import { db } from "@/db"
import { deliveries, deliveryItems, products, stockReturns, worksites, worksiteStock } from "@/db/schema"
import { auth } from "@/lib/auth/auth"
import { can, canAccessWorksite } from "@/lib/auth/can"
import { getOpenPhysicalInventoryCount } from "@/lib/services/physical-inventory"
import { logger } from "@/lib/logger"
import { getProductAttributesByIds } from "@/lib/services/product-sizes"
import { formatVariantProductName } from "@/lib/products/variant-grouping"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  }

  const canAdjust = can(session, "warehouse:adjust_stock")
  const canRegister = can(session, "warehouse:register_movement")
  if (!canAdjust && !canRegister) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  }

  const worksiteId = req.nextUrl.searchParams.get("faena") ?? ""
  if (!worksiteId) {
    return NextResponse.json({ error: "Falta la faena" }, { status: 400 })
  }
  if (!canAccessWorksite(session, worksiteId)) {
    return NextResponse.json({ error: "No tienes acceso a esta faena" }, { status: 403 })
  }

  try {
    const [worksite] = await db
      .select({ id: worksites.id, name: worksites.name })
      .from(worksites)
      .where(and(eq(worksites.id, worksiteId), eq(worksites.isActive, true)))
      .limit(1)

    if (!worksite) {
      return NextResponse.json({ error: "Faena no encontrada o inactiva" }, { status: 404 })
    }

    // Catálogo activo con el saldo de ESTA faena. Antes era un join constante
    // contra todas las faenas; acotado así devuelve exactamente lo que el panel
    // muestra. El saldo viaja siempre: ajustar o dar de baja a ciegas un número
    // que no ves es cómo se registran las correcciones equivocadas.
    const catalogRows = canAdjust
      ? await db
          .select({
            productId: products.id,
            productName: products.name,
            productSku: products.sku,
            unitOfMeasure: products.unitOfMeasure,
            quantity: sql<number>`coalesce(${worksiteStock.quantity}, 0)`,
            minStock: sql<number>`coalesce(${worksiteStock.minStock}, 0)`,
            stockId: worksiteStock.id,
          })
          .from(products)
          .leftJoin(worksiteStock, and(
            eq(worksiteStock.productId, products.id),
            eq(worksiteStock.worksiteId, worksiteId),
          ))
          .where(and(eq(products.isActive, true), eq(products.isService, false)))
          .orderBy(asc(products.name))
      : []

    const returnRows = canRegister
      ? await db
          .select({
            deliveryItemId: deliveryItems.id,
            deliveryCode: deliveries.code,
            productId: deliveryItems.productId,
            productName: products.name,
            productSku: products.sku,
            unitOfMeasure: products.unitOfMeasure,
            remainingQuantity: sql<number>`(${deliveryItems.quantity} - coalesce(sum(${stockReturns.quantity}), 0))`,
          })
          .from(deliveryItems)
          .innerJoin(deliveries, eq(deliveryItems.deliveryId, deliveries.id))
          .innerJoin(products, eq(deliveryItems.productId, products.id))
          .leftJoin(stockReturns, eq(stockReturns.deliveryItemId, deliveryItems.id))
          .where(and(
            eq(deliveries.destinationType, "faena"),
            eq(deliveries.worksiteId, worksiteId),
            // Su stock ya volvió por la anulación: ofrecerla para devolver lo
            // duplicaría.
            isNull(deliveries.voidedAt),
          ))
          .groupBy(
            deliveryItems.id,
            deliveryItems.quantity,
            deliveryItems.productId,
            deliveries.code,
            products.name,
            products.sku,
            products.unitOfMeasure,
          )
          .having(sql`${deliveryItems.quantity} > coalesce(sum(${stockReturns.quantity}), 0)`)
          .orderBy(asc(deliveries.code), asc(products.name))
      : []

    // Borrador de conteo abierto: el panel lo retoma donde quedó en vez de
    // obligar a recontar la faena entera.
    const openCount = canAdjust ? await getOpenPhysicalInventoryCount(worksiteId) : null

    // Ajustar, desechar o devolver una talla equivocada corrige el saldo de la
    // variante que no era. El nombre a secas no distingue las variantes.
    const attributesById = await getProductAttributesByIds([
      ...catalogRows.map((row) => row.productId),
      ...returnRows.map((row) => row.productId).filter((id): id is string => Boolean(id)),
    ])

    return NextResponse.json({
      openCount,
      worksiteId: worksite.id,
      worksiteName: worksite.name,
      products: catalogRows.map((row) => ({
        ...row,
        productName: formatVariantProductName(row.productName, attributesById.get(row.productId)),
        quantity: Number(row.quantity),
        minStock: Number(row.minStock),
      })),
      returns: returnRows.map((row) => ({
        ...row,
        productName: formatVariantProductName(
          row.productName,
          row.productId ? attributesById.get(row.productId) : undefined,
        ),
        remainingQuantity: Number(row.remainingQuantity),
      })),
    })
  } catch (err) {
    logger.error("[bodega/opciones]", err)
    return NextResponse.json({ error: "Error al cargar las opciones" }, { status: 500 })
  }
}
