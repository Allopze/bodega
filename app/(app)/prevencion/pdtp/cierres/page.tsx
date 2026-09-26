import { redirect } from "next/navigation"
import { can, requireAuth } from "@/lib/auth/can"
import { resolveActivePdtpProgramId } from "@/lib/services/prevention-pdtp"
import { getPdtpOperationalYears } from "@/lib/services/pdtp/operational-years"

/**
 * Entrada de menú "Cierres mensuales".
 *
 * Los cierres viven bajo un programa (`/prevencion/pdtp/[programId]/cierres`),
 * pero el menú lateral no puede conocer un id: esta ruta resuelve el programa
 * del año en curso con el mismo criterio que el resto del módulo
 * (`resolveActivePdtpProgramId`: el activo del año, o el de mayor versión si no
 * hay ninguno activo) y redirige. Sin ella, el enlace del menú caería en el
 * segmento dinámico `[programId]` con "cierres" como id y rendiría un 404.
 */
export default async function PdtpClosuresEntryPage() {
  let session
  try { session = await requireAuth() }
  catch { redirect(`/forbidden?desde=${encodeURIComponent("/prevencion/pdtp/cierres")}`) }
  if (!can(session, "prevention:pdtp:view")) redirect(`/forbidden?desde=${encodeURIComponent("/prevencion/pdtp/cierres")}`)

  // PREV-C03.7: en enero, con el año anterior todavía abierto, lo urgente es
  // cerrar su diciembre: el menú lleva al año en cierre si lo hay y, si no, al
  // año operativo.
  const { primary, closing } = await getPdtpOperationalYears()
  const programId = await resolveActivePdtpProgramId(closing ?? primary)
  // Sin programa del año, el tablero explica qué falta mejor que un 404.
  redirect(programId ? `/prevencion/pdtp/${programId}/cierres` : "/prevencion/pdtp")
}
