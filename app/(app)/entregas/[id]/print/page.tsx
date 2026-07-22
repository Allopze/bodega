import type { Metadata } from "next"
import { redirect, notFound } from "next/navigation"
import { and, eq } from "drizzle-orm"
import { db } from "@/db"
import {
  deliveries, deliveryItems, products, workers, worksites, users, attachments,
} from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { formatDate } from "@/lib/utils"
import { Printer } from "@phosphor-icons/react/dist/ssr"

export const metadata: Metadata = { title: "Acta de Entrega de EPP" }

export default async function DeliveryPrintPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  let session
  try { session = await requirePermission("deliveries:view") }
  catch { redirect("/forbidden") }

  const { id } = await params

  const delivery = await db.query.deliveries.findFirst({
    where: and(eq(deliveries.id, id), worksiteScopeSql(session, deliveries.worksiteId)),
    with: {
      worksite: true,
      worker: true,
    },
  })

  if (!delivery) {
    notFound()
  }

  const items = await db
    .select({
      productName: products.name,
      productSku: products.sku,
      quantity: deliveryItems.quantity,
      unitOfMeasure: deliveryItems.unitOfMeasure,
      returnQuantity: deliveryItems.returnQuantity,
      returnProductName: deliveryItems.returnProductNameFree,
      returnReason: deliveryItems.returnReason,
    })
    .from(deliveryItems)
    .leftJoin(products, eq(deliveryItems.productId, products.id))
    .where(eq(deliveryItems.deliveryId, delivery.id))

  const deliveredByUser = delivery.deliveredBy
    ? await db.query.users.findFirst({ where: eq(users.id, delivery.deliveredBy) })
    : null

  return (
    <div className="min-h-screen bg-white p-8 text-slate-900 font-sans print:p-0 print:bg-white">
      {/* ── Toolbar solo visible en pantalla ── */}
      <div className="mb-6 flex items-center justify-between print:hidden border-b pb-4">
        <div>
          <h1 className="text-lg font-bold text-slate-800">Comprobante de Entrega de EPP</h1>
          <p className="text-xs text-slate-500">Vista previa para impresión o archivo en PDF</p>
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow hover:bg-slate-800 transition-colors"
        >
          <Printer size={16} />
          Imprimir Acta
        </button>
      </div>

      {/* ── Documento Formato A4 / Acta ── */}
      <div className="mx-auto max-w-3xl border border-slate-200 p-8 shadow-sm print:border-none print:p-0 print:shadow-none">
        {/* Cabecera / Encabezado */}
        <div className="flex items-start justify-between border-b border-slate-300 pb-4 mb-6">
          <div>
            <h2 className="text-xl font-bold uppercase tracking-wide text-slate-900">Acta de Entrega de EPP</h2>
            <p className="text-xs font-semibold text-slate-600">Equipos de Protección Personal (Art. 184 Código del Trabajo)</p>
          </div>
          <div className="text-right">
            <p className="font-mono text-sm font-bold text-slate-800">{delivery.code}</p>
            <p className="text-xs text-slate-500">Fecha: {delivery.deliveredAt ? formatDate(delivery.deliveredAt) : ""}</p>
          </div>
        </div>

        {/* Datos de la Empresa y Faena */}
        <div className="grid grid-cols-2 gap-4 rounded-md bg-slate-50 p-4 text-xs mb-6 border border-slate-200">
          <div>
            <p className="font-semibold text-slate-700">Lugar de Entrega / Faena:</p>
            <p className="text-slate-900 font-medium">{delivery.worksite?.name ?? "Faena General"}</p>
          </div>
          <div>
            <p className="font-semibold text-slate-700">Entregado por (Bodega/Supervisor):</p>
            <p className="text-slate-900 font-medium">{deliveredByUser?.name ?? deliveredByUser?.email ?? "Encargado de Bodega"}</p>
          </div>
        </div>

        {/* Datos del Trabajador Receptor */}
        <div className="mb-6">
          <h3 className="text-xs font-bold uppercase text-slate-700 mb-2 border-b pb-1">Identificación del Trabajador</h3>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
            <div>
              <span className="text-slate-500">Nombre completo: </span>
              <span className="font-semibold text-slate-900">{delivery.worker ? `${delivery.worker.firstName} ${delivery.worker.lastName}` : (delivery.receiverName ?? "Trabajador")}</span>
            </div>
            <div>
              <span className="text-slate-500">RUT: </span>
              <span className="font-mono font-semibold text-slate-900">{delivery.worker?.rut ?? "—"}</span>
            </div>
            <div>
              <span className="text-slate-500">Cargo / Función: </span>
              <span className="font-semibold text-slate-900">{delivery.worker?.position ?? "—"}</span>
            </div>
            <div>
              <span className="text-slate-500">Receptor real: </span>
              <span className="font-semibold text-slate-900">{delivery.receiverName ?? "Mismo trabajador"}</span>
            </div>
          </div>
        </div>

        {/* Tabla de EPP Entregado */}
        <div className="mb-6">
          <h3 className="text-xs font-bold uppercase text-slate-700 mb-2 border-b pb-1">Detalle del Elemento Entregado</h3>
          <table className="w-full text-left text-xs border-collapse border border-slate-300">
            <thead>
              <tr className="bg-slate-100 font-semibold text-slate-700 border-b border-slate-300">
                <th className="p-2 border-r border-slate-300">SKU</th>
                <th className="p-2 border-r border-slate-300">Descripción EPP</th>
                <th className="p-2 border-r border-slate-300 text-right">Cantidad</th>
                <th className="p-2 text-center">Unidad</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <tr key={idx} className="border-b border-slate-200">
                  <td className="p-2 font-mono border-r border-slate-200">{item.productSku ?? "—"}</td>
                  <td className="p-2 font-medium border-r border-slate-200">{item.productName ?? "EPP"}</td>
                  <td className="p-2 text-right font-mono border-r border-slate-200">{item.quantity}</td>
                  <td className="p-2 text-center">{item.unitOfMeasure}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Devolución de EPP Usado / Retirado */}
        {items.some((i) => i.returnQuantity) && (
          <div className="mb-6">
            <h3 className="text-xs font-bold uppercase text-slate-700 mb-2 border-b pb-1">EPP Antiguo Devuelto / Retirado</h3>
            <div className="rounded-md bg-slate-50 p-3 text-xs border border-slate-200 space-y-1">
              {items.filter((i) => i.returnQuantity).map((item, idx) => (
                <p key={idx} className="text-slate-800">
                  • <strong>{item.returnProductName ?? "EPP antiguo"}</strong>: {item.returnQuantity} unidad(es) retiras para desecho/reciclaje (Motivo: {item.returnReason ?? "cambio por desgaste"}).
                </p>
              ))}
            </div>
          </div>
        )}

        {/* Declaración Legal */}
        <div className="mb-12 rounded-md border border-slate-200 bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-600">
          <p className="font-semibold text-slate-800 mb-1">Declaración de Recepción y Obligación de Uso:</p>
          Declaro haber recibido los Elementos de Protección Personal (EPP) detallados en este documento, en perfecto estado de conservación y funcionamiento. Me comprometo a utilizarlos permanentemente durante el desempeño de mis labores, velar por su cuidado y comunicar oportunamente a mi jefatura cualquier deterioro o extravío conforme a la normativa de Seguridad y Salud en el Trabajo.
        </div>

        {/* Firma del Trabajador y Bodeguero */}
        <div className="mt-16 grid grid-cols-2 gap-12 text-center text-xs">
          <div className="flex flex-col items-center justify-end">
            <div className="mb-2 h-16 w-48 border-b border-slate-400 flex items-center justify-center">
              {/* Si hay firma digital en signaturePath se podría renderizar acá */}
            </div>
            <p className="font-bold text-slate-800">{delivery.worker ? `${delivery.worker.firstName} ${delivery.worker.lastName}` : (delivery.receiverName ?? "Trabajador")}</p>
            <p className="text-slate-500">Firma Trabajador / RUT: {delivery.worker?.rut ?? "—"}</p>
          </div>

          <div className="flex flex-col items-center justify-end">
            <div className="mb-2 h-16 w-48 border-b border-slate-400"></div>
            <p className="font-bold text-slate-800">{deliveredByUser?.name ?? "Encargado de Bodega"}</p>
            <p className="text-slate-500">Firma Entregador / Bodega</p>
          </div>
        </div>
      </div>
    </div>
  )
}
