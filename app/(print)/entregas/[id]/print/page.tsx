import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { db } from "@/db"
import { deliveries, products } from "@/db/schema"
import { eq, inArray } from "drizzle-orm"
import { formatSizedProductName } from "@/lib/products/product-size"
import { getProductSizesByIds } from "@/lib/services/product-sizes"
import { requirePermission } from "@/lib/auth/can"
import { canAccessWorksite } from "@/lib/auth/scope"
import { formatDate, formatQty } from "@/lib/utils"
import { MobileDocumentSummary } from "@/components/print/mobile-document-summary"
import { DELIVERY_PRINT_STYLES } from "./delivery-print-styles"
import { PrintTrigger } from "./print-trigger"

interface PageProps { params: Promise<{ id: string }> }

export const dynamic = "force-dynamic"

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params
  const delivery = await db.query.deliveries.findFirst({ where: eq(deliveries.id, id), columns: { code: true } })
  return { title: delivery ? `Comprobante ${delivery.code}` : "Comprobante" }
}

export default async function DeliveryPrintPage({ params }: PageProps) {
  let session
  try { session = await requirePermission("deliveries:view") }
  catch { redirect("/forbidden") }

  const { id } = await params
  const delivery = await db.query.deliveries.findFirst({
    where: eq(deliveries.id, id),
    with: { worker: true, worksite: true, sourceWorksite: true, deliveredBy: true, items: true },
  })
  if (!delivery) notFound()
  if (!delivery.worksiteId || !canAccessWorksite(session, delivery.worksiteId)) notFound()

  // El EPP devuelto puede venir del catálogo (`returnProductId`) o escrito a
  // mano (`returnProductNameFree`), y son excluyentes: si se eligió del
  // catálogo hay que resolver el nombre acá o el comprobante firmado sale con
  // un guion en vez del EPP.
  const productIds = delivery.items.reduce<string[]>((ids, item) => {
    if (item.productId) ids.push(item.productId)
    if (item.returnProductId) ids.push(item.returnProductId)
    return ids
  }, [])
  // La talla es parte de lo que el trabajador acusa recibo de haber recibido:
  // el catálogo guarda el mismo nombre en todas las tallas de una familia, así
  // que sin ella el comprobante firmado no dice qué talla se entregó.
  const productMap = productIds.length > 0
    ? await (async () => {
      const [rows, sizeById] = await Promise.all([
        db.query.products.findMany({ where: inArray(products.id, productIds) }),
        getProductSizesByIds(productIds),
      ])
      return new Map(rows.map((product) => [
        product.id,
        formatSizedProductName(product.name, sizeById.get(product.id)),
      ]))
    })()
    : new Map<string, string>()

  const workerName = delivery.worker
    ? `${delivery.worker.firstName} ${delivery.worker.lastName}`.trim()
    : delivery.receiverName ?? "—"
  const workerRut = delivery.worker?.rut ?? delivery.receiverRut ?? "—"
  const generatedAt = new Date().toISOString()
  const suggestedFilename = `comprobante-entrega-${delivery.code}.pdf`
  const deliveryItems = delivery.items.map((item, index) => ({
    label: `Producto ${index + 1}${item.quantityOriginal !== null ? " (regularizado)" : ""}`,
    value: `${productMap.get(item.productId ?? "") ?? item.productNameFree ?? "Producto"} · ${formatQty(item.quantity, item.unitOfMeasure)}`,
  }))
  const correctedItems = delivery.items
    .filter((item) => item.quantityOriginal !== null)
    .map((item, index) => ({
      label: `Corrección ${index + 1}`,
      value: `Original ${formatQty(item.quantityOriginal ?? 0, item.unitOfMeasure)} · efectiva ${formatQty(item.quantity, item.unitOfMeasure)}`,
    }))
  const returnedItems = delivery.items.reduce<Array<{ label: string; value: string }>>((items, item) => {
    if (item.returnQuantity) {
      items.push({
        label: `Devolución ${items.length + 1}`,
        value: `${productMap.get(item.returnProductId ?? "") ?? item.returnProductNameFree ?? "EPP"} · ${formatQty(item.returnQuantity, item.unitOfMeasure)}`,
      })
    }
    return items
  }, [])

  return (
    // Antes esto renderizaba su propio <html><head><body> además del que ya
    // pone app/layout.tsx (raíz, única fuente válida de <html> en el App
    // Router). El HTML llegaba con dos <html> anidados; el navegador los
    // fusiona al parsear (por spec no puede haber dos), pero React esperaba
    // ver el árbol tal cual lo mandó el servidor → mismatch de hidratación
    // (#418), reproducible sólo en build de producción porque en dev React
    // muestra el aviso pero no lo trata como fatal de la misma forma.
    // Mismo patrón que las rutas hermanas compras/print y sst/print: sólo
    // <style> + contenido, sin envoltorio de documento propio.
    <>
      <style>{DELIVERY_PRINT_STYLES}</style>

      <PrintTrigger pdfHref={`/entregas/${delivery.id}/print/pdf`} suggestedFilename={suggestedFilename} />

      <MobileDocumentSummary
        code={`Comprobante de entrega ${delivery.code}`}
        title={workerName}
        description={`${delivery.items.length} ${delivery.items.length === 1 ? "elemento entregado" : "elementos entregados"} · ${delivery.worksite?.name ?? "Sin faena"}`}
        sections={[
          {
            title: "Entrega",
            fields: [
              { label: "Faena", value: delivery.worksite?.name ?? "Sin faena" },
              { label: "Bodega origen", value: delivery.sourceWorksite?.name ?? delivery.worksite?.name ?? "Sin registro" },
              { label: "Fecha", value: formatDate(delivery.deliveredAt) },
              { label: "Entregado por", value: delivery.deliveredBy?.name ?? delivery.deliveredBy?.email ?? "Sin registro" },
              { label: "Tipo", value: delivery.destinationType === "faena" ? "Entrega a faena" : "Entrega a trabajador" },
            ],
          },
          { title: "Productos entregados", fields: deliveryItems },
          ...(correctedItems.length > 0 ? [{ title: "Regularización automática", fields: correctedItems }] : []),
          ...(returnedItems.length > 0 ? [{ title: "Devolución de EPP", fields: returnedItems }] : []),
          ...(delivery.signaturePath ? [{
            title: "Evidencia histórica",
            fields: [{
              label: "Archivo de firma",
              value: "Archivo de firma histórico conservado",
            }],
          }] : []),
        ]}
      />

      <main className="delivery-sheet" aria-label={`Comprobante de entrega ${delivery.code}`}>
        <div className="header">
          <div>
            <h1>Comprobante de Entrega</h1>
            <p className="code">{delivery.code}</p>
          </div>
          <div style={{ textAlign: "right" }}>
            <p style={{ fontSize: 10, color: "#6b7280" }}>Emitido: {formatDate(delivery.deliveredAt)}</p>
          </div>
        </div>

        <div className="section">
          <h2>Datos generales</h2>
          <dl className="grid">
            <div className="field">
              <dt>Faena</dt>
              <dd>{delivery.worksite?.name ?? "—"}</dd>
            </div>
            <div className="field">
              <dt>Bodega origen</dt>
              <dd>{delivery.sourceWorksite?.name ?? delivery.worksite?.name ?? "—"}</dd>
            </div>
            <div className="field">
              <dt>Entregado por</dt>
              <dd>{delivery.deliveredBy?.name ?? delivery.deliveredBy?.email ?? "—"}</dd>
            </div>
            <div className="field">
              <dt>Trabajador</dt>
              <dd>{workerName}</dd>
            </div>
            <div className="field">
              <dt>RUT</dt>
              <dd className="document-value-nowrap">{workerRut}</dd>
            </div>
            <div className="field">
              <dt>Fecha</dt>
              <dd className="document-value-nowrap">{formatDate(delivery.deliveredAt)}</dd>
            </div>
            <div className="field">
              <dt>Tipo</dt>
              <dd>{delivery.destinationType === "faena" ? "Entrega a faena" : "Entrega a trabajador"}</dd>
            </div>
          </dl>
        </div>

        <div className="section">
          <h2>Productos entregados</h2>
          <table>
            <thead>
              <tr>
                <th>Producto</th>
                <th scope="col" style={{ textAlign: "right" }}>Cantidad</th>
                <th>Unidad</th>
              </tr>
            </thead>
            <tbody>
              {delivery.items.map((item) => (
                <tr key={item.id}>
                  <td>{productMap.get(item.productId ?? "") ?? item.productNameFree ?? "Producto"}</td>
                  <td style={{ textAlign: "right" }} className="total">{item.quantity}</td>
                  <td>{item.unitOfMeasure}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {delivery.items.some((item) => item.quantityOriginal !== null) && (
            <p style={{ marginTop: 10, fontSize: 10, color: "#475569" }}>
              Cantidad regularizada automáticamente por el defecto histórico de escala. El valor original permanece conservado en la auditoría.
            </p>
          )}
          {delivery.notes && (
            <p style={{ marginTop: 12, fontSize: 11, color: "#6b7280" }}>
              Notas: {delivery.notes}
            </p>
          )}
        </div>

        {(delivery.items.some((i) => i.returnQuantity)) && (
          <div className="section">
            <h2>Devolución de EPP antiguo</h2>
            <table>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th scope="col" style={{ textAlign: "right" }}>Cantidad</th>
                  <th>Motivo</th>
                </tr>
              </thead>
              <tbody>
                {delivery.items.filter((i) => i.returnQuantity).map((item) => (
                  <tr key={`return-${item.id}`}>
                    <td>{productMap.get(item.returnProductId ?? "") ?? item.returnProductNameFree ?? "—"}</td>
                    <td style={{ textAlign: "right" }}>{item.returnQuantity}</td>
                    <td>{item.returnReason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {delivery.signaturePath && (
          <div className="section" aria-label="Evidencia histórica">
            <h2>Evidencia histórica</h2>
            <p style={{ fontSize: 11, color: "#6b7280" }}>
              Este comprobante conserva que el registro histórico tiene un archivo de firma adjunto. Las entregas nuevas no solicitan firma.
            </p>
          </div>
        )}

        <div className="footer">
          Documento generado por Plataforma Chome el {formatDate(generatedAt)}
        </div>
      </main>
      </>
  )
}
