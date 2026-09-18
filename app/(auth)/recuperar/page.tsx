import type { Metadata } from "next"
import Link from "next/link"
import { AuthShell } from "@/components/layout/auth-shell"
import { ForgotPasswordForm } from "./forgot-form"

export const metadata: Metadata = {
  title: "Recuperar contraseña",
}

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Recuperar contraseña"
      subtitle="Ingresa tu correo y te enviaremos un enlace para restablecer tu contraseña."
      footer={
        <Link href="/login" className="hover:text-text">
          ← Volver al inicio de sesión
        </Link>
      }
    >
      <ForgotPasswordForm />
    </AuthShell>
  )
}
