import { permanentRedirect } from "next/navigation"
import { legacyFuelRedirect } from "@/lib/combustibles/legacy-redirects"

type SearchParams = Record<string, string | string[] | undefined>

/** Ruta anterior al rediseño de Combustible (2026-10-31): página puente permanente. */
export default async function LegacyFuelBridge({ params, searchParams }: { params: Promise<{ familia: string }>; searchParams: Promise<SearchParams> }) {
  permanentRedirect(legacyFuelRedirect("control-rendimiento", await params, await searchParams))
}
