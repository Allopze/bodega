import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { can, requireAuth } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { listMiperPortfolio } from "@/lib/services/miper/portfolio"
import { listMiperCreationOptions } from "@/lib/services/miper/queries"
import { codeYear } from "@/lib/utils"
import { MiperHome } from "./miper-home"

export const metadata: Metadata = { title: "Matriz de riesgos (MIPER)" }

/**
 * Portada del RE-04 por faena (spec §7, Fase B): una fila por faena en alcance
 * —con o sin MIPER— y la franja de cuatro cifras. Los filtros (`vista`,
 * `estado`, `sincontrol`, `faena`) viven en la URL y se aplican en el cliente
 * sobre las faenas del alcance, que son pocas. El alcance lo aplica el
 * servicio: el navegador nunca recibe una faena ajena. No lleva buscador
 * propio: el del TopBar filtra la tabla (`DataTable`).
 */
export default async function MiperPage() {
  let session
  try { session = await requireAuth() } catch { redirect("/forbidden") }
  if (!can(session, "prevention:risk:view")) redirect("/forbidden")
  const access = { userId: session.user.id, scope: resolveWorksiteScope(session), permissions: session.user.permissions }
  const canEdit = can(session, "prevention:risk:edit")
  const [portfolio, creation] = await Promise.all([
    listMiperPortfolio(access),
    // El alta exige `prevention:risk:edit`; sin ese permiso no se consultan faenas ni vigentes.
    canEdit ? listMiperCreationOptions(access) : Promise.resolve({ worksites: [] }),
  ])
  return (
    <MiperHome
      rows={portfolio.rows}
      creationWorksites={creation.worksites}
      currentYear={codeYear()}
      permissions={{ canEdit, canManageCatalog: can(session, "prevention:risk:catalog:manage") }}
    />
  )
}
