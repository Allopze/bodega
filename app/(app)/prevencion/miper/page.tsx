import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { can, requireAuth } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { listMiperCreationOptions, listMiperInbox, listMipers } from "@/lib/services/miper/queries"
import { codeYear } from "@/lib/utils"
import { MiperHome } from "./miper-home"

export const metadata: Metadata = { title: "Matriz IPER (MIPER)" }

type SearchParams = { tab?: string; faena?: string; periodo?: string; estado?: string }

/**
 * Portada del RE-04: la bandeja "Por hacer" (lo que espera a esta persona según
 * sus permisos) y la lista completa de la faena/período. El filtrado vive en la
 * URL —`faena`, `periodo`, `estado`— y lo aplica el servicio, así que el
 * navegador no recibe matrices fuera de alcance. No lleva buscador propio: el
 * de la shell filtra la tabla en memoria (ver `hidesShellSearch`).
 */
export default async function MiperPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  let session
  try { session = await requireAuth() } catch { redirect("/forbidden") }
  if (!can(session, "prevention:risk:view")) redirect("/forbidden")
  const access = { userId: session.user.id, scope: resolveWorksiteScope(session), permissions: session.user.permissions }
  const params = await searchParams
  const period = params.periodo && /^\d{4}$/.test(params.periodo) ? Number(params.periodo) : undefined
  const canEdit = can(session, "prevention:risk:edit")
  const [inbox, all, creation] = await Promise.all([
    listMiperInbox(access),
    listMipers(access, { worksiteId: params.faena || undefined, period, state: params.estado || undefined }),
    // El diálogo sólo se abre con `prevention:risk:edit`; sin ese permiso no se
    // consultan faenas ni MIPER vigentes (el servicio las exigiría igual).
    canEdit ? listMiperCreationOptions(access) : Promise.resolve({ worksites: [] }),
  ])
  return (
    <MiperHome
      inbox={inbox}
      all={all}
      creationWorksites={creation.worksites}
      currentYear={codeYear()}
      permissions={{ canEdit, canManageCatalog: can(session, "prevention:risk:catalog:manage") }}
    />
  )
}
