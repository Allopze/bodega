import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requireAuth, can } from "@/lib/auth/can"
import { db } from "@/db"
import { users } from "@/db/schema"
import { and, asc, eq } from "drizzle-orm"
import { PageContainer } from "@/components/ui/page-container"
import { listActiveSubstitutions } from "@/lib/services/substitutions"
import { SuplenciasClient } from "./suplencias-client"

export const metadata: Metadata = {
  title: "Cuentas Temporales de Suplencia (R7) | Administración",
  description: "Gestión de reemplazos temporales para ausencias de rol",
}

export default async function SuplenciasPage() {
  const session = await requireAuth()
  if (!can(session, "admin:users")) {
    redirect("/admin")
  }

  // Lista de usuarios titulares activos
  const activeUsers = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(and(eq(users.isActive, true), eq(users.isTemporary, false)))
    .orderBy(asc(users.name))

  // Lista de suplencias (temporales)
  const substitutions = await listActiveSubstitutions()

  return (
    <PageContainer width="wide">
      <SuplenciasClient
        activeUsers={activeUsers}
        substitutions={substitutions}
      />
    </PageContainer>
  )
}
