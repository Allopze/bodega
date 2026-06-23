import type { Metadata } from "next"
import Link from "next/link"
import { BrandMark } from "@/components/layout/brand-mark"
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
        } else if (new Date(invitation.expiresAt) < new Date()) {
        inviteError = "La invitación expiró. Solicita una nueva al administrador."
      } else {
        initialEmail = invitation.email
        initialName = invitation.name ?? ""
      }
    }
  }

  return (
    <main className="min-h-[100dvh] flex items-center justify-center bg-[var(--color-bg)] px-6 py-12">
      <div className="w-full max-w-sm rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] border border-[var(--color-border)] p-8">
        <div className="mb-8">
          <BrandMark variant="light" size={36} subtitle titleSize="base" />
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
          inviteNotice={inviteNotice}
        />

        <p className="mt-5 text-center text-xs text-[var(--color-text-subtle)]">
          <Link href="/login" className="text-[var(--color-primary-ink)] hover:underline">
            Volver a iniciar sesión
          </Link>
        </p>
      </div>
    </main>
  )
}
