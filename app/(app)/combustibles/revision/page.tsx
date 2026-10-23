import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { loadRevisionCounts } from "@/lib/combustibles/revision-counts"
import { revisionLandingHref } from "./landing"

export const metadata: Metadata = { title: "Revisión" }

/**
 * Entrada del ítem «Revisión» del menú. No pinta nada: manda a la cola que
 * tiene trabajo (`revisionLandingHref`). Las dos colas llevan la misma barra de
 * pestañas, así que la otra queda a un clic.
 */
export default async function RevisionLandingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  let session
  try { session = await requirePermission("combustibles:view") } catch { redirect("/forbidden") }

  const [counts, raw] = await Promise.all([loadRevisionCounts(session), searchParams])
  redirect(revisionLandingHref(counts, raw.faena))
}
