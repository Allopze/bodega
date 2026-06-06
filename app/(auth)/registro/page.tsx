import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { and, eq, isNull } from "drizzle-orm"
import { db } from "@/db"
import { userInvitations } from "@/db/schema"
import { getUserCount, hashInvitationToken } from "@/lib/auth/bootstrap"
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

  if (mode === "invite") {
    if (!token) {
      inviteError = "Necesitas una invitación para registrarte."
    } else {
      const invitation = await db.query.userInvitations.findFirst({
        where: and(
          eq(userInvitations.tokenHash, hashInvitationToken(token)),
          isNull(userInvitations.acceptedAt),
        ),
      })

      if (!invitation) {
        inviteError = "Invitación inválida o ya utilizada."
      } else {
        initialEmail = invitation.email
        initialName = invitation.name ?? ""
      }
    }
  }

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-[var(--color-bg)] px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <Image
            src="/chome_logo_white.svg"
            alt="Chome"
            width={36}
            height={36}
            unoptimized
            className="h-9 w-9 shrink-0 rounded-[var(--radius-sm)] bg-[var(--color-brand-surface)] p-0.5"
          />
          <div>
            <p className="font-display text-base font-bold leading-tight text-[var(--color-text)]">
              Chome
            </p>
            <p className="text-xs text-[var(--color-text-muted)]">Solicitudes y Bodega</p>
          </div>
        </div>

        <h1 className="font-display text-xl font-semibold text-[var(--color-text)]">
          {mode === "bootstrap" ? "Crear primer administrador" : "Completar registro"}
        </h1>
        <p className="mb-6 mt-1 text-sm text-[var(--color-text-muted)]">
          {mode === "bootstrap"
            ? "No hay usuarios activos en el sistema. Esta primera cuenta tendrá control administrativo."
            : "Define tu contraseña para activar el acceso otorgado por el administrador."}
        </p>

        <RegisterForm
          token={token}
          mode={mode}
          initialName={initialName}
          initialEmail={initialEmail}
          inviteError={inviteError}
        />

        <p className="mt-5 text-center text-xs text-[var(--color-text-subtle)]">
          <Link href="/login" className="text-[var(--color-primary-700)] hover:underline">
            Volver a iniciar sesión
          </Link>
        </p>
      </div>
    </div>
  )
}
