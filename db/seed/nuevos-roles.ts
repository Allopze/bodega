/**
 * Seed for users defined in docs/planificacion/nuevos_roles.md
 * Crea 6 prevencionistas de faena + 1 jefe de mantención con
 * marcador de contraseña pendiente e invitaciones para que puedan
 * completar su registro al primer ingreso.
 *
 * Cada prevencionista se asigna a su faena correspondiente según
 * los worksites cargados desde trabajadores_por_faena_actualizado.md.
 *
 * Se invoca desde db/seed.ts pasándole db y el schema de drizzle.
 */
import { and, eq } from "drizzle-orm"
import { generateInvitationToken, hashInvitationToken } from "../../lib/auth/bootstrap"
import { nanoid } from "../../lib/id"
import { createPendingPasswordMarker } from "../../lib/auth/password-setup"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"
import type * as schemaDef from "../schema"

type Schema = typeof schemaDef
type Db = PostgresJsDatabase<Schema>

interface SeedUser {
  name: string
  email: string
  roleId: string
  position: string
  worksiteId?: string   // worksite scope for prevencionistas
}

const SEED_USERS: SeedUser[] = [
  // ── Prevencionistas de faena ──────────────────────────────────────────
  // Los worksiteId corresponden a los slugs generados por db/seed/workers.ts
  // desde los nombres de faena en trabajadores_por_faena_actualizado.md.
  { name: "Ruth Flores",       email: "chomerodantes.prevencion@gmail.com",  roleId: "rol-prev-faena", position: "Prevencionista de faena – Grúas (Rodantes)",  worksiteId: "ws-santa-fe-gruas" },
  { name: "Mauricio Sandoval", email: "prevencion.chomecholguan@gmail.com",  roleId: "rol-prev-faena", position: "Prevencionista de faena – Faena Cholguán",     worksiteId: "ws-cholguan" },
  { name: "Solangue Acuña",    email: "prevencionmasisa@servicioschome.cl",  roleId: "rol-prev-faena", position: "Prevencionista de faena – Faena Cabrero",     worksiteId: "ws-masisa" },
  { name: "María Ancamilla",   email: "prevencionpacifico.chome@gmail.com",  roleId: "rol-prev-faena", position: "Prevencionista de faena – Faena Pacífico (Mininco)", worksiteId: "ws-pacifico" },
  { name: "Nikole Osses",      email: "prevencionresiduoschome@gmail.com",   roleId: "rol-prev-faena", position: "Prevencionista de faena – Faena Santa Fe y Calymag", worksiteId: "ws-santa-fe-gruas" },
  { name: "María José",        email: "prevencion.b.chome@gmail.com",        roleId: "rol-prev-faena", position: "Prevencionista de faena – Faena Biodiversa",  worksiteId: "ws-biodiversa" },
  // ── Jefe de mantención (sin scope de faena — ve todas) ────────────────
  { name: "Alexis Morales",    email: "alexismoraleschome@gmail.com",        roleId: "rol-jefe-mant",  position: "Jefe de Mantención" },
]

export async function seedNuevosRoles(db: Db, schema: Schema) {
  let created = 0
  let assignedRoles = 0
  let assignedWorksites = 0
  let skipped = 0
  let roleAssigned = false
  let worksiteAssigned = false

  for (const user of SEED_USERS) {
    const existing = await db.query.users.findFirst({
      where: eq(schema.users.email, user.email),
    })

    if (existing) {
      // Usuario ya existe — asegurar rol y worksite scope
      roleAssigned = false
      worksiteAssigned = false

      const existingRole = await db.query.userRoles.findFirst({
        where: and(
          eq(schema.userRoles.userId, existing.id),
          eq(schema.userRoles.roleId, user.roleId),
        ),
      })
      if (!existingRole) {
        await db.insert(schema.userRoles).values({
          userId: existing.id,
          roleId: user.roleId,
        })
        assignedRoles++
        roleAssigned = true
        console.log(`  → Rol ${user.roleId} asignado a ${user.email}`)
      }

      // Asignar worksite scope si el usuario tiene worksiteId definido
      if (user.worksiteId) {
        const existingWs = await db.query.worksiteUsers.findFirst({
          where: and(
            eq(schema.worksiteUsers.userId, existing.id),
            eq(schema.worksiteUsers.worksiteId, user.worksiteId),
          ),
        })
        if (!existingWs) {
          await db.insert(schema.worksiteUsers).values({
            userId: existing.id,
            worksiteId: user.worksiteId,
            isPrimary: true,
          })
          assignedWorksites++
          worksiteAssigned = true
          console.log(`  → Faena ${user.worksiteId} asignada a ${user.email}`)
        }
      }

      if (!roleAssigned && !worksiteAssigned) {
        skipped++
      }
      continue
    }

    // Crear usuario + invitación + worksite scope
    const id = nanoid()
    const token = generateInvitationToken()
    const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString() // 1 año
    const invitationId = nanoid()
    const avatarColor = String(Math.abs(hashStr(user.name)) % 360)
    const worksiteAssignments = user.worksiteId
      ? [{ worksiteId: user.worksiteId, isPrimary: true }]
      : []

    await db.transaction(async (tx) => {
      await tx.insert(schema.users).values({
        id,
        name: user.name,
        email: user.email,
        hashedPassword: createPendingPasswordMarker(),
        avatarColor,
        isActive: true,
      })

      await tx.insert(schema.userRoles).values({
        userId: id,
        roleId: user.roleId,
      })

      if (worksiteAssignments.length > 0) {
        await tx.insert(schema.worksiteUsers).values(
          worksiteAssignments.map((a) => ({
            userId: id,
            worksiteId: a.worksiteId,
            isPrimary: a.isPrimary,
          })),
        )
      }

      await tx.insert(schema.userInvitations).values({
        id: invitationId,
        email: user.email,
        name: user.name,
        tokenHash: hashInvitationToken(token),
        roleIdsJson: JSON.stringify([user.roleId]),
        worksiteAssignmentsJson: JSON.stringify(worksiteAssignments),
        expiresAt,
      })
    })

    const baseUrl = (process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3001").replace(/\/$/, "")
    const inviteUrl = `${baseUrl}/registro?token=${encodeURIComponent(token)}`
    console.log(`  ✓ ${user.name} (${user.email}) → ${user.roleId}${user.worksiteId ? ` · faena: ${user.worksiteId}` : ""}`)
    console.log(`    Invitación: ${inviteUrl}`)

    created++
  }

  return { created, assignedRoles, assignedWorksites, skipped }
}

function hashStr(str: string): number {
  let h = 0
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h)
  return h
}
