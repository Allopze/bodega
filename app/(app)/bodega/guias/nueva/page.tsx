import type { Metadata } from "next"
import { redirect } from "next/navigation"

export const metadata: Metadata = { title: "Preparar despacho interno" }

/**
 * Compatibility route for old bookmarks. New GDIs are prepared from the
 * office receipt, where the OC, destination and received quantities already
 * exist; there is intentionally no standalone product-entry flow here.
 */
export default function NewDispatchGuideCompatibilityPage() {
  redirect("/recepcion")
}
