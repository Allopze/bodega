import { resolveProductSize } from "@/lib/products/product-size"
import { formatVariantProductName, resolveVariantAttributes } from "@/lib/products/variant-grouping"
import type { Metadata } from "next"
import { redirect } from "next/navigation"
import Link from "next/link"
import { db } from "@/db"
import {
  attachments,
  deliveries,
  deliveryItems,
  eppProductFamilies,
  products,
  purchaseRequestItems,
  purchaseRequests,
  workers,
  worksiteStock,
  worksites,
} from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { formatQty, todayInChile } from "@/lib/utils"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { ServerPagination } from "@/components/ui/server-pagination"
import { buildPaginationHref, resolvePagination } from "@/lib/pagination"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"
import { DownloadSimple, Package, User } from "@phosphor-icons/react/dist/ssr"
import { and, asc, count, desc, eq, gt, inArray } from "drizzle-orm"
import { DeliveriesTable, type DeliveryRow } from "./deliveries-table"
import type { DeliveryStockProductOption } from "./delivery-form.types"
import { DeliveryFormSheet } from "./delivery-form-sheet"
import { DeliveryFilters } from "./delivery-filters"
import { deliveryHistorySearchSql, readDeliverySearch } from "./history-search"
import { getProductAttributesByIds } from "@/lib/services/product-sizes"
import { getDeliverableEppItems } from "@/lib/services/epp-pending-delivery"
import { PendingEppStrip } from "./pending-epp-strip"

export const metadata: Metadata = { title: "Entregas" }

import { HISTORY_PAGE_SIZE } from "@/lib/constants"

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  let session
  try { session = await requirePermission("deliveries:view") }
  catch { redirect("/forbidden") }
  const canViewTraceability = session.user.permissions.includes("warehouse:view_traceability")
  const canCreateDelivery = session.user.permissions.includes("deliveries:create")
  const canVoidDelivery = session.user.permissions.includes("deliveries:void")

  const sp = await searchParams
  const requestedWorksiteId = typeof sp.faena === "string" ? sp.faena : ""
  const requestedItemId = typeof sp.item === "string" ? sp.item : ""
  // Enlaces desde Bodega y desde "EPP por entregar": `?nueva=1` abre el
  // formulario y `?producto=` preselecciona la línea si hay stock.
  const requestedProductId = typeof sp.producto === "string" ? sp.producto : ""
  const openFormRequested = sp.nueva === "1" || sp.nueva === "true"
  // BOD-01: la búsqueda de texto va en el servidor (`?q=`), no en el input de la
  // shell, que sólo veía las 25 filas de la página en pantalla.
  const q = readDeliverySearch(sp.q)

  // Las faenas visibles van antes que el historial: `?faena=` sólo filtra si
  // está dentro del alcance. Una faena ajena o cerrada se ignora en vez de
  // dejar la pantalla vacía y sin salida.
  const allWorksites = await db
    .select({ id: worksites.id, name: worksites.name })
    .from(worksites)
    .where(and(eq(worksites.isActive, true), worksiteScopeSql(session, worksites.id)))
    .orderBy(asc(worksites.name))
  const faena = allWorksites.some((worksite) => worksite.id === requestedWorksiteId) ? requestedWorksiteId : ""

  // El filtro va en el servidor: el historial está paginado y filtrarlo en
  // memoria sólo alcanzaría a la página en pantalla. Filtra por la faena del
  // trabajador (columna "Faena"), el mismo criterio que la exportación.
  const historyScope = and(
    eq(deliveries.destinationType, "worker"),
    worksiteScopeSql(session, deliveries.worksiteId),
    faena ? eq(deliveries.worksiteId, faena) : undefined,
    deliveryHistorySearchSql(q),
  )

  // History pagination
  const [historyTotalRow] = await db
    .select({ total: count() })
    .from(deliveries)
    .where(historyScope)

  const historyPagination = resolvePagination({
    pageParam: sp.page,
    totalItems: historyTotalRow?.total ?? 0,
    pageSize: HISTORY_PAGE_SIZE,
  })

  const pageHref = (page: number) => buildPaginationHref("/entregas", sp, page)

  const [allWorkers, stockRows, deliverableAll, historyRows] = await Promise.all([
    db
      .select({
        id: workers.id,
        rut: workers.rut,
        firstName: workers.firstName,
        lastName: workers.lastName,
        position: workers.position,
        worksiteId: workers.worksiteId,
        sizeTop: workers.sizeTop,
        sizeBottom: workers.sizeBottom,
        sizeShoe: workers.sizeShoe,
        sizeGloves: workers.sizeGloves,
        sizeHelmet: workers.sizeHelmet,
      })
      .from(workers)
      .where(and(eq(workers.isActive, true), worksiteScopeSql(session, workers.worksiteId)))
      .orderBy(asc(workers.lastName), asc(workers.firstName)),
    // Fuente de verdad de entregas: saldo físico de productos de catálogo. Los
    // servicios no producen ni consumen stock.
    db
      .select({
        worksiteId: worksiteStock.worksiteId,
        productId:  worksiteStock.productId,
        quantity:   worksiteStock.quantity,
        productName: products.name,
        productSku: products.sku,
        isEpp: products.isEpp,
        unitOfMeasure: products.unitOfMeasure,
        familyId: products.familyId,
        familyName: eppProductFamilies.canonicalName,
      })
      .from(worksiteStock)
      .innerJoin(products, eq(worksiteStock.productId, products.id))
      .leftJoin(eppProductFamilies, eq(products.familyId, eppProductFamilies.id))
      .where(and(
        worksiteScopeSql(session, worksiteStock.worksiteId),
        gt(worksiteStock.quantity, 0),
        eq(products.isActive, true),
        eq(products.isService, false),
      )),
    getDeliverableEppItems({ worksiteIds: allWorksites.map((worksite) => worksite.id) }),
    db
      .select({
        id: deliveries.id,
        code: deliveries.code,
        sourceWorksiteId: deliveries.sourceWorksiteId,
        worksiteId: deliveries.worksiteId,
        workerId: deliveries.workerId,
        receiverName: deliveries.receiverName,
        deliveredAt: deliveries.deliveredAt,
        voidedAt: deliveries.voidedAt,
        voidReason: deliveries.voidReason,
      })
      .from(deliveries)
      .where(historyScope)
      .orderBy(desc(deliveries.deliveredAt))
      .limit(historyPagination.limit)
      .offset(historyPagination.offset),
  ])

  const worksiteOptions = allWorksites.map((worksite) => ({ id: worksite.id, name: worksite.name }))
  const worksiteNameById = new Map(worksiteOptions.map((worksite) => [worksite.id, worksite.name]))

  const workerOptions = allWorkers
    .map((worker) => ({
      id: worker.id,
      worksiteId: worker.worksiteId,
      worksiteName: worksiteNameById.get(worker.worksiteId) ?? "Faena",
      name: `${worker.firstName} ${worker.lastName}`,
      rut: worker.rut,
      position: worker.position,
      sizeTop: worker.sizeTop,
      sizeBottom: worker.sizeBottom,
      sizeShoe: worker.sizeShoe,
      sizeGloves: worker.sizeGloves,
      sizeHelmet: worker.sizeHelmet,
    }))

  // La talla vive en `product_attributes` de la variante: una sola consulta por
  // el conjunto de productos con stock, no una por fila.
  const sizeById = await getProductAttributesByIds(stockRows.map((row) => row.productId))

  const stockProducts: DeliveryStockProductOption[] = stockRows.map((row) => {
    const attributes = sizeById.get(row.productId) ?? []
    const size = resolveProductSize(attributes)
    return {
      sourceWorksiteId: row.worksiteId,
      productId: row.productId,
      productName: row.productName,
      variantLabel: resolveVariantAttributes(attributes).map((a) => `${a.name}: ${a.value}`).join(" · "),
      displayName: formatVariantProductName(row.productName, attributes),
      productSku: row.productSku,
      isEpp: row.isEpp,
      unitOfMeasure: row.unitOfMeasure,
      stockQuantity: row.quantity,
      familyId: row.familyId,
      familyName: row.familyName,
      sizeLabel: size?.label ?? null,
      sizeAttributeName: size?.attributeName ?? null,
    }
  })

  // `?faena=` acota también la lista de EPP por entregar, igual que el historial.
  const deliverableItems = faena
    ? deliverableAll.filter((item) => item.worksiteId === faena)
    : deliverableAll

  const initialDeliverable = requestedItemId
    ? deliverableAll.find((item) => item.requestItemId === requestedItemId)
    : undefined
  // `?producto=` sólo preselecciona si hay stock del producto: en la bodega de
  // `?faena=` cuando viene, o en cualquiera del alcance si es la única.
  const productStockRows = requestedProductId
    ? stockProducts.filter((row) => row.productId === requestedProductId && (!faena || row.sourceWorksiteId === faena))
    : []
  const requestedProductWorksiteId = productStockRows.length === 1 ? productStockRows[0]?.sourceWorksiteId : undefined
  // Sólo la intención explícita del operador (item de solicitud, ?faena= o
  // ?producto=). El fallback lo decide el formulario, que es quien conoce la
  // dotación: caer en `stockProducts[0]` elegía una bodega arbitraria (la
  // consulta de stock no lleva ORDER BY) y en la práctica abría en la bodega de
  // oficina, que tiene stock pero no trabajadores de faena.
  const initialWorksiteId = initialDeliverable?.worksiteId ?? (faena || requestedProductWorksiteId || undefined)
  const initialProductId = initialDeliverable?.productId
    ?? (productStockRows.some((row) => row.sourceWorksiteId === initialWorksiteId) ? requestedProductId : undefined)
  const worksiteNameForPending = (id: string) => worksiteNameById.get(id) ?? "Faena"

  const visibleHistory = historyRows
  const historyDeliveryIds = visibleHistory.map((delivery) => delivery.id)
  const [historyItemRows, attachmentRows] = await Promise.all([
    historyDeliveryIds.length > 0
      ? db
          .select({
            deliveryId: deliveryItems.deliveryId,
            requestItemId: deliveryItems.requestItemId,
            productId: deliveryItems.productId,
            productNameFree: deliveryItems.productNameFree,
            quantity: deliveryItems.quantity,
            quantityOriginal: deliveryItems.quantityOriginal,
            unitOfMeasure: deliveryItems.unitOfMeasure,
            productName: products.name,
            requestCode: purchaseRequests.code,
          })
          .from(deliveryItems)
          .leftJoin(products, eq(deliveryItems.productId, products.id))
          .leftJoin(purchaseRequestItems, eq(deliveryItems.requestItemId, purchaseRequestItems.id))
          .leftJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
          .where(inArray(deliveryItems.deliveryId, historyDeliveryIds))
      : Promise.resolve([]),
    historyDeliveryIds.length > 0
      ? db
          .select({ id: attachments.id, entityId: attachments.entityId })
          .from(attachments)
          .where(
            and(
              eq(attachments.entityType, "delivery"),
              inArray(attachments.entityId, historyDeliveryIds),
            ),
          )
      : Promise.resolve([]),
  ])

  const historyAttributes = await getProductAttributesByIds(historyItemRows.flatMap((item) => item.productId ? [item.productId] : []))
  const historyItemsByDelivery = new Map<string, typeof historyItemRows>()
  for (const item of historyItemRows) {
    const list = historyItemsByDelivery.get(item.deliveryId) ?? []
    list.push(item)
    historyItemsByDelivery.set(item.deliveryId, list)
  }
  const attachmentByDeliveryId = new Map(attachmentRows.map((row) => [row.entityId, row.id]))
  const workerNameById = new Map(workerOptions.map((worker) => [worker.id, worker.name]))

  const deliveriesForTable: DeliveryRow[] = visibleHistory.map((delivery) => {
    const items = historyItemsByDelivery.get(delivery.id) ?? []
    const firstItem = items[0]
    const itemSummary = firstItem
      ? `${formatVariantProductName(firstItem.productName ?? firstItem.productNameFree ?? "EPP", firstItem.productId ? historyAttributes.get(firstItem.productId) : [])} · ${formatQty(firstItem.quantity, firstItem.unitOfMeasure)}`
      : "Sin ítems"
    return {
      id: delivery.id,
      code: delivery.code,
      sourceWorksiteName: delivery.sourceWorksiteId
        ? (worksiteNameById.get(delivery.sourceWorksiteId) ?? "Bodega")
        : (delivery.worksiteId ? (worksiteNameById.get(delivery.worksiteId) ?? "Faena") : "Sin registro"),
      worksiteName: delivery.worksiteId ? (worksiteNameById.get(delivery.worksiteId) ?? "Faena") : "Faena",
      workerId: delivery.workerId ?? null,
      workerName: delivery.workerId ? (workerNameById.get(delivery.workerId) ?? "Trabajador") : "Trabajador",
      receiverName: delivery.receiverName ?? null,
      itemSummary,
      quantityCorrected: items.some((item) => item.quantityOriginal !== null),
      requestCode: firstItem?.requestCode ?? null,
      deliveredAt: delivery.deliveredAt,
      voidedAt: delivery.voidedAt ?? null,
      voidReason: delivery.voidReason ?? null,
      attachmentId: attachmentByDeliveryId.get(delivery.id) ?? null,
    }
  })

  if (worksiteOptions.length === 0) {
    return (
      <PageContainer>
        <PageHeader
          title="Entregas"
          description="Entrega de productos físicos desde bodega a trabajadores."
          breadcrumb={<Breadcrumbs items={[{ label: "Inicio", href: "/dashboard" }, { label: "Entregas" }]} />}
        />
        <EmptyState
          icon={<User size={24} />}
          title="Sin faenas asignadas"
          // El CTA anterior enlazaba a /admin/usuarios: quien no tiene faenas
          // casi por definición tampoco es administrador, así que el botón
          // rebotaba en /forbidden. Sin acción posible, el texto dice a quién
          // acudir en vez de ofrecer una puerta cerrada.
          description="No tienes faenas activas disponibles para registrar entregas. Pide a un administrador que te asigne una faena."
        />
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title="Entregas"
        description="Entrega de productos físicos desde bodega a trabajadores."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Entregas" },
          ]} />
        }
        actions={
          <div className="flex items-center gap-2">
            {canCreateDelivery && (
              <DeliveryFormSheet
                // Un enlace "Entregar" cambia la URL pero no desmonta la página:
                // la clave remonta el panel para que tome la nueva intención.
                key={`${initialWorksiteId ?? ""}|${initialProductId ?? ""}|${initialDeliverable?.requestItemId ?? ""}|${openFormRequested ? 1 : 0}`}
                worksites={worksiteOptions}
                workers={workerOptions}
                stockProducts={stockProducts}
                today={todayInChile()}
                initialSourceWorksiteId={initialWorksiteId}
                initialProductId={initialProductId}
                initialRequestItemId={initialDeliverable?.requestItemId}
                initialQuantity={initialDeliverable ? Math.min(initialDeliverable.remainingQuantity, initialDeliverable.stockQuantity) : undefined}
                defaultOpen={openFormRequested || Boolean(initialDeliverable)}
              />
            )}
            <Button asChild variant="secondary" size="sm">
              <a href={faena ? `/api/entregas/export?faena=${encodeURIComponent(faena)}` : "/api/entregas/export"} download>
                <DownloadSimple size={15} aria-hidden />
                Exportar Excel
              </a>
            </Button>
          </div>
        }
      />
      {/* Reemplaza a un "Alcance de faena: X" que sólo preseleccionaba la
          bodega del formulario mientras el historial seguía mostrando todas. */}
      <DeliveryFilters worksites={worksiteOptions} faena={faena} q={q} />

      <div className="flex flex-col gap-6">
        {/* La captura depende de stock físico, no de una solicitud EPP
            pendiente: así el selector de trabajadores no desaparece por una
            condición ajena al padrón de trabajadores. */}
        {stockProducts.length === 0 ? (
          <section className="flex flex-col gap-3">
            <div>
              <h2 className="text-base font-semibold text-(--color-text)">Sin stock físico para entregar</h2>
              <p className="mt-1 text-sm text-(--color-text-muted)">
                No hay productos físicos con saldo en las bodegas a las que tienes acceso.
              </p>
            </div>
            <div className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]">
              <EmptyState
                icon={<Package size={24} />}
                title="Aún no hay stock disponible"
                description="Registra la recepción física de una OC o confirma la guía a faena. Los servicios no se incorporan al stock."
                action={
                  <Button asChild variant="secondary">
                    <Link href="/recepcion">Ir a Recepción</Link>
                  </Button>
                }
              />
            </div>
          </section>
        ) : (
          <PendingEppStrip
            items={deliverableItems.map((item) => ({
              ...item,
              worksiteName: worksiteNameForPending(item.worksiteId),
            }))}
            canCreate={canCreateDelivery}
          />
        )}

        {/* ── Historial de entregas ── */}
        <section id="delivery-history" className="flex flex-col gap-3 scroll-mt-24">
          <div>
            <h2 className="text-base font-semibold text-(--color-text)">Historial de entregas</h2>
            <p className="mt-1 text-sm text-(--color-text-muted)">
              Registro nominal de productos físicos entregados a trabajadores.
            </p>
          </div>

          {deliveriesForTable.length === 0 ? (
            <div className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]">
              {q ? (
                // Distinto de "no hay entregas": hay historial, la búsqueda no
                // coincide con nada (BOD-01).
                <EmptyState
                  icon={<User size={22} />}
                  title={`Sin resultados para “${q}”`}
                  description="Prueba con el nombre o RUT del trabajador, el código de la entrega o un producto."
                  action={
                    <Button asChild variant="secondary" size="sm">
                      <Link href={buildPaginationHref("/entregas", { ...sp, q: undefined }, 1)} scroll={false}>Limpiar búsqueda</Link>
                    </Button>
                  }
                  compact
                />
              ) : faena ? (
                <EmptyState
                  icon={<User size={22} />}
                  title="Sin entregas en esta faena"
                  description={`Todavía no se registran entregas a trabajadores de ${worksiteNameById.get(faena) ?? "esta faena"}.`}
                  action={
                    <Button asChild variant="secondary" size="sm">
                      <Link href="/entregas" scroll={false}>Ver todas las faenas</Link>
                    </Button>
                  }
                  compact
                />
              ) : (
                <EmptyState
                  icon={<User size={22} />}
                  title="Sin entregas registradas"
                  description="Cuando registres una entrega, quedará disponible en este historial."
                  compact
                />
              )}
            </div>
          ) : (
            <DeliveriesTable deliveries={deliveriesForTable} canViewTraceability={canViewTraceability} canVoid={canVoidDelivery} />
          )}
          <ServerPagination pagination={historyPagination} hrefForPage={pageHref} />
        </section>
      </div>
    </PageContainer>
  )
}
