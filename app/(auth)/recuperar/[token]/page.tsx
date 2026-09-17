import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { AuthShell } from "@/components/layout/auth-shell"
import { validateResetToken } from "@/lib/services/password-reset"
import { ResetPasswordForm } from "./reset-form"

export const metadata: Metadata = {
  title: "Nueva contraseña",
}

interface Props {
  params: Promise<{ token: string }>
}

export default async function ResetPasswordPage({ params }: Props) {
  const { token } = await params

  // Validate token before rendering the form (expired / already-used = 404)
  const result = await validateResetToken(token)
  if (!result.valid) notFound()

  return (
    <AuthShell
      title="Nueva contraseña"
      subtitle="Elige una contraseña segura para tu cuenta."
      footer={
        <Link href="/login" className="hover:text-text">
          ← Volver al inicio de sesión
        </Link>
      }
    >
      <ResetPasswordForm token={token} />
    </AuthShell>
  )
}
