import type { ReactNode } from "react"
import { requireRecord } from "@/lib/routing/require-record"
import { purchaseRequestItems } from "@/db/schema"

export default async function Layout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ itemId: string }>
}) {
  const { itemId } = await params
  await requireRecord(purchaseRequestItems, purchaseRequestItems.id, itemId)
  return children
}
