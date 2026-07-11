import { notFound } from "next/navigation"
import type { Session } from "next-auth"
import { db } from "@/db"
import { purchaseOrders } from "@/db/schema"
import { eq } from "drizzle-orm"
import { canAccessWorksite } from "@/lib/auth/can"
import { getCompanyProfile } from "@/lib/services/system-settings"
import { formatDate, formatWorksiteLabel } from "@/lib/utils"
import { ocPdfFilename } from "./filename"
import { formatRequestReference, unique } from "./oc-print-formatters"
import { clpAmountToWords } from "./oc-number-to-words"

export interface OcPrintData {
  order: NonNullable<Awaited<ReturnType<typeof loadOrderWithRelations>>>
  company: Awaited<ReturnType<typeof getCompanyProfile>>
  productMap: Record<string, { id: string; sku: string; name: string }>
  issuedDate: string
  authorizedByName: string | null
  authorizedDate: string | null
  suggestedFilename: string
  requestCodes: string[]
  orderDetailLines: string[]
  totalInWords: string
}

async function loadOrderWithRelations(id: string) {
  return db.query.purchaseOrders.findFirst({
    where: eq(purchaseOrders.id, id),
    with: {
      items: {
        orderBy: (i, { asc }) => [asc(i.sortOrder)],
        with: {
          requestItem: {
            with: { request: true, attributes: true },
          },
        },
      },
      worksite: true,
      supplier: true,
      issuedByUser: { columns: { name: true } },
    },
  })
}

export async function loadOcPrintData(id: string, session: Session): Promise<OcPrintData> {
  const [order, company] = await Promise.all([
    loadOrderWithRelations(id),
    getCompanyProfile(),
  ])

  if (!order) notFound()
  if (!canAccessWorksite(session, order.worksiteId)) notFound()

  const productIds = order.items.map((i) => i.productId).filter((v): v is string => v !== null)
  const products = productIds.length > 0
    ? await db.query.products.findMany({
        where: (p, { inArray }) => inArray(p.id, productIds),
        columns: { id: true, sku: true, name: true },
      })
    : []
  const productMap = Object.fromEntries(products.map((p) => [p.id, p]))

  const issuedDate = order.issuedAt ? formatDate(order.issuedAt) : formatDate(order.createdAt)
  const authorizedByName = order.issuedAt ? order.issuedByUser?.name ?? null : null
  const authorizedDate = order.issuedAt ? formatDate(order.issuedAt) : null
  const suggestedFilename = ocPdfFilename(order.code)

  const requestCodes = unique(
    order.items
      .map((item) => item.requestItem?.request?.code)
      .filter((code): code is string => !!code)
      .map(formatRequestReference),
  )

  const orderDetailLines = [
    order.notes,
    company.address ? `enviar a ${company.address}` : null,
    requestCodes.length > 0 ? `NP ${requestCodes.join("-")}` : null,
    order.worksite?.name ? formatWorksiteLabel(order.worksite.name) : null,
  ].filter((line): line is string => !!line?.trim())

  const totalInWords = `SON: ${clpAmountToWords(order.totalAmount)}`

  return {
    order,
    company,
    productMap,
    issuedDate,
    authorizedByName,
    authorizedDate,
    suggestedFilename,
    requestCodes,
    orderDetailLines,
    totalInWords,
  }
}
