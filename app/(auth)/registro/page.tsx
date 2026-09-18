import type { Metadata } from "next"
import Link from "next/link"
import { and, eq, isNull } from "drizzle-orm"
import { AuthShell } from "@/components/layout/auth-shell"
import { db } from "@/db"
import { userInvitations } from "@/db/schema"
import { getUserCount, hashInvitationToken } from "@/lib/auth/bootstrap"
import { isInvitationUsable } from "@/lib/auth/invitations"
import { RegisterForm } from "./register-form"

export const metadata: Metadata = {
  title: "Registro",
}

type RegistroPageProps = {
  searchParams: Promise<{ token?: string | string[] }>
}

export default async function RegistroPage({ searchParams }: RegistroPageProps) {
  const params = await searchParams
  const token = Array.isArray(params.token) ? params.token[0] ?? "" : params.token ?? ""
  const userCount = await getUserCount()
  const mode = userCount === 0 ? "bootstrap" : "invite"

  let initialEmail = ""
  let initialName = ""
  let inviteError: string | undefined
  let inviteNotice: string | undefined

  if (mode === "invite") {
    if (!token) {
      inviteNotice = "Para crear tu cuenta necesitas abrir el enlace de invitación enviado por el administrador."
    } else {
      const invitation = await db.query.userInvitations.findFirst({
        where: and(
          eq(userInvitations.tokenHash, hashInvitationToken(token)),
          isNull(userInvitations.acceptedAt),
        ),
      })

      if (!invitation) {
        inviteError = "Invitación inválida o ya utilizada."
      } else if (!isInvitationUsable(invitation)) {
        if (invitation.cancelledAt) {
          inviteError = "La invitación fue cancelada. Solicita una nueva al administrador."
        } else if (invitation.replacedAt) {
          inviteError = "La invitación fue reemplazada. Usa el enlace más reciente."
        } else {
          inviteError = "La invitación expiró. Solicita una nueva al administrador."
        }
      } else {
        initialEmail = invitation.email
        initialName = invitation.name ?? ""
      }
    }
  }

  return (
    <AuthShell
      title={mode === "bootstrap" ? "Crear primer administrador" : "Completar registro"}
      subtitle={
        mode === "bootstrap"
          ? "No hay usuarios activos en el sistema. Esta primera cuenta tendrá control administrativo."
          : "Define tu contraseña para activar el acceso otorgado por el administrador."
      }
      footer={
        <Link href="/login" className="hover:text-text">
          Volver a iniciar sesión
        </Link>
      }
    >
      <RegisterForm
        token={token}
        mode={mode}
        initialName={initialName}
        initialEmail={initialEmail}
        inviteError={inviteError}
        inviteNotice={inviteNotice}
      />
    </AuthShell>
  )
}
