import type { Metadata } from "next"
import { BrandMark } from "@/components/layout/brand-mark"
import { ForgotPasswordForm } from "./forgot-form"

export const metadata: Metadata = {
  title: "Recuperar contraseña",
}

export default function ForgotPasswordPage() {
  return (
    <div className="min-h-[100dvh] flex items-center justify-center px-6 py-12 bg-[var(--color-bg)]">
      <div className="w-full max-w-[26rem] rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] border border-[var(--color-border)] p-8">
        <div className="mb-8">
          <BrandMark variant="light" size={48} subtitle titleSize="base" />
        </div>

        <p className="text-eyebrow">Acceso</p>
        <h1 className="mt-2 text-display text-[var(--color-text)]">Recuperar contraseña</h1>
        <p className="mt-2 text-sub">
          Ingresa tu correo y te enviaremos un enlace para restablecer tu contraseña.
        </p>

        <div className="mt-8">
          <ForgotPasswordForm />
        </div>
      </div>
    </div>
  )
}
