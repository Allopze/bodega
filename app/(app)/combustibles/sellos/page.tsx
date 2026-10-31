import { permanentRedirect } from "next/navigation"
import { legacyFuelRedirect } from "@/lib/combustibles/legacy-redirects"

type SearchParams = Record<string, string | string[] | undefined>

/** Ruta anterior al rediseño de Combustible (2026-10-31): página puente permanente. */
export default async function LegacyFuelBridge({ searchParams }: { searchParams: Promise<SearchParams> }) {
  permanentRedirect(legacyFuelRedirect("sellos", {}, await searchParams))
}
