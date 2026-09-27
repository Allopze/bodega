/**
 * lib/auth/pdtp-registration.ts
 *
 * Traduce la sesión al actor de `lib/services/pdtp/registration-authority.ts`
 * (PREV-I03). Vive aparte de `can.ts` para poder probarse sin NextAuth.
 *
 * **Quién es "Prevención o administración"** (registra cualquier actividad de
 * las faenas de su alcance) se expresa con permisos, no con nombres de rol, para
 * que un ajuste en `/admin/roles` lo mueva sin tocar código:
 *
 * - `prevention:pdtp:override:manage` — administra el programa (prevencionista,
 *   administrador). Ya era la llave de "actuar por otro" en PREV-B03.
 * - `prevention:pdtp:close_period` — cierra el mes de la faena
 *   (prevencionista_faena, prevencionista). Quien congela y firma la foto del
 *   mes responde por que esté completa, así que puede registrar lo que falte.
 *
 * No se agregó un permiso nuevo: los dos existentes ya separan exactamente a
 * Prevención de los roles de terreno y de los globales no operacionales
 * (gerente_legal_rrhh, subgerente_operaciones, jefe_mantencion), que sólo
 * tienen `execute` por las actividades que sí son suyas. El alcance de faenas
 * se sigue exigiendo aparte (`assertWorksiteAccess`).
 */
import type { Session } from "next-auth"
import type { PdtpRegistrationActor } from "@/lib/services/pdtp/registration-authority"

const ANY_ACTIVITY_PERMISSIONS = ["prevention:pdtp:override:manage", "prevention:pdtp:close_period"] as const

export function canRegisterAnyPdtpActivity(session: Session): boolean {
  const permissions = session.user?.permissions ?? []
  return ANY_ACTIVITY_PERMISSIONS.some((permission) => permissions.includes(permission))
}

export function pdtpRegistrationActorFromSession(session: Session): PdtpRegistrationActor {
  return {
    userId: session.user.id,
    roles: [...(session.user.roles ?? [])],
    canRegisterAnyActivity: canRegisterAnyPdtpActivity(session),
  }
}
