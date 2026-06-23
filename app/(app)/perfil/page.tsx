import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { eq } from "drizzle-orm"
import { auth } from "@/lib/auth/auth"
import { db } from "@/db"
import { users } from "@/db/schema"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { EmailNotificationsForm } from "./email-notifications-form"
import { PasswordChangeForm } from "./password-change-form"

export const metadata: Metadata = {
  title: "Mi perfil",
}

export default async function PerfilPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: { id: true, name: true, email: true, emailNotifications: true },
  })

  if (!user) redirect("/login")

  return (
    <PageContainer>
      <PageHeader
        title="Mi perfil"
        description={user.email}
      />

      <div className="max-w-lg space-y-4">
        <div className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] border border-[var(--color-border)] p-6 space-y-6">
          {/* Account info */}
          <div>
            <h2 className="text-h2 text-[var(--color-text)] mb-3">Cuenta</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex gap-2">
                <dt className="text-[var(--color-text-subtle)] min-w-[5rem]">Nombre</dt>
                <dd className="text-[var(--color-text)]">{user.name}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-[var(--color-text-subtle)] min-w-[5rem]">Correo</dt>
                <dd className="text-[var(--color-text)]">{user.email}</dd>
              </div>
            </dl>
          </div>

          <hr className="border-[var(--color-border)]" />

          {/* S-15: Email notifications toggle */}
          <div>
            <h2 className="text-h2 text-[var(--color-text)] mb-3">Notificaciones</h2>
            <EmailNotificationsForm enabled={user.emailNotifications} />
          </div>

          <hr className="border-[var(--color-border)]" />

          {/* Password change */}
          <div>
            <h2 className="text-h2 text-[var(--color-text)] mb-3">Seguridad</h2>
            <p className="text-xs text-[var(--color-text-subtle)] mb-4">
              Cambia tu contraseña para mantener tu cuenta segura.
            </p>
            <PasswordChangeForm />
          </div>
        </div>
      </div>
    </PageContainer>
  )
}
