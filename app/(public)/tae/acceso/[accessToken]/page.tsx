import { redirect } from "next/navigation"
import { TAE_ACCESS_PATH } from "@/lib/combustibles/tae-access-url"

/**
 * Los QR generados entre julio y octubre de 2026 apuntaban aquí por error
 * (ver `lib/combustibles/tae-access-url.ts`). Los que ya están impresos en los
 * puntos de carga siguen funcionando gracias a esta redirección permanente.
 */
export default async function LegacyTaeAccessPage({ params }: { params: Promise<{ accessToken: string }> }) {
  const { accessToken } = await params
  redirect(`${TAE_ACCESS_PATH}/${encodeURIComponent(accessToken)}`)
}
