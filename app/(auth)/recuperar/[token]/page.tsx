import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { BrandMark } from "@/components/layout/brand-mark"
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
    <div className="min-h-[100dvh] flex items-center justify-center px-6 py-12 bg-[var(--color-bg)]">
      <div className="w-full max-w-[26rem] rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] border border-[var(--color-border)] p-8">
        <div className="mb-8">
          <BrandMark variant="light" size={48} subtitle titleSize="base" />
        </div>

        <p className="text-eyebrow">Seguridad</p>
        <h1 className="mt-2 text-display text-[var(--color-text)]">Nueva contraseña</h1>
        <p className="mt-2 text-sub">Elige una contraseña segura para tu cuenta.</p>

        <div className="mt-8">
          <ResetPasswordForm token={token} />
        </div>
      </div>
    </div>
  )
}
