/**
 * GET /api/bodega/opciones?faena=<id>
 *
 * Opciones de los formularios de movimiento (conteo, ajuste, baja)
 * para UNA faena.
 *
 * Existe para sacarlas del render de `/bodega`: se calculaban en cada carga de
 * la página — incluido un producto cartesiano faenas × productos activos para
 * el conteo físico — y alimentaban un panel que puede no abrirse nunca. Además
 * corrían antes de evaluar el permiso que las gatea.
 */
import { type NextRequest, NextResponse } from "next/server"
import { and, asc, eq, sql } from "drizzle-orm"
import { db } from "@/db"
import { inventoryMovements, products, worksites, worksiteStock } from "@/db/schema"
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
  // Las tres hojas que cargan opciones (conteo, ajuste, baja) son de ajuste de
  // stock. La devolución, que era la única que pedía `register_movement`, ya no
  // se ofrece: exigía entregas "a faena", que el código dejó de crear.
  if (!canAdjust) {
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
            hasMovements: sql<boolean>`exists (
              select 1 from ${inventoryMovements}
              where ${inventoryMovements.productId} = ${products.id}
                and ${inventoryMovements.worksiteId} = ${worksiteId}
            )`,
          })
          .from(products)
          .leftJoin(worksiteStock, and(
            eq(worksiteStock.productId, products.id),
            eq(worksiteStock.worksiteId, worksiteId),
          ))
          .where(and(eq(products.isActive, true), eq(products.isService, false)))
          .orderBy(asc(products.name))
      : []

    // Borrador de conteo abierto: el panel lo retoma donde quedó en vez de
    // obligar a recontar la faena entera.
    const openCount = canAdjust ? await getOpenPhysicalInventoryCount(worksiteId) : null

    // Ajustar, desechar o contar una talla equivocada corrige el saldo de la
    // variante que no era. El nombre a secas no distingue las variantes.
    const attributesById = await getProductAttributesByIds([
      ...catalogRows.map((row) => row.productId),
    ])

    return NextResponse.json({
      openCount,
      worksiteId: worksite.id,
      worksiteName: worksite.name,
      products: catalogRows.map((row) => ({
        ...row,
        productName: formatVariantProductName(row.productName, attributesById.get(row.productId)),
        quantity: Number(row.quantity),
      })),
    })
  } catch (err) {
    logger.error("[bodega/opciones]", err)
    return NextResponse.json({ error: "Error al cargar las opciones" }, { status: 500 })
  }
}
