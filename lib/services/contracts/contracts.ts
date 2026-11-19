import { desc, eq, sql } from "drizzle-orm"
import { db, type DB, type Tx } from "@/db"
import { billingInvoices, clients, contracts, worksites } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { nextCodeTx } from "@/lib/code-sequences"
import { nanoid } from "@/lib/id"
import { cleanRut, describeRutProblem } from "@/lib/rut"
import { contractHasBillingHistory } from "@/lib/services/billing/client-identity"
import { assertContractChangeKeepsAssignmentsTx, capContractAssignmentsTx, type AssignmentActor } from "@/lib/services/contracts/assignments"
import { codeYear } from "@/lib/utils"
import { mandanteSchema, operationalContractSchema } from "@/lib/validation/contracts"

/**
 * Contratos que se crean y editan desde la faena, y los mandantes (clientes)
 * para los que se prestan. Es el MISMO `contracts` de Facturación: aquí sólo se
 * escribe lo que la operación necesita y nunca los campos de cobro. Este
 * servicio NO revisa permisos: las actions piden `admin:worksites` y
 * `canAccessWorksite` sobre la faena del contrato.
 */

export type ContractWriteResult =
  | { ok: true; id: string; code: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> }

/** Siguiente código de contrato: `CTR-AAAA-NNNN` (año civil de Chile). */
export async function nextContractCodeTx(client: Tx | DB): Promise<string> {
  return nextCodeTx(client, "CTR", codeYear())
}

function firstIssue(error: { issues: Array<{ message: string }> }): string {
  return error.issues[0]?.message ?? "Datos inválidos"
}

function rutMessage(problem: "format" | "check-digit"): string {
  return problem === "format"
    ? "El RUT no tiene un formato válido (ej.: 76.543.210-K)"
    : "El dígito verificador del RUT no coincide: revísalo"
}

/**
 * Crea o edita un contrato desde la faena.
 *
 * - Alta: vigente, ciclo «Sin calendario», CLP y código `CTR-AAAA-NNNN`.
 * - Edición: sólo cambia nombre, mandante, fechas y estado; lo de cobro
 *   (monto, ciclo, plazos…) que haya cargado Facturación se conserva. Fijar el
 *   término acota las asignaciones de equipos en la misma transacción.
 */
export async function saveOperationalContract(actor: AssignmentActor, input: unknown, client: DB = db): Promise<ContractWriteResult> {
  const parsed = operationalContractSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: firstIssue(parsed.error), fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }
  const data = parsed.data
  const startDate = data.startDate ?? null
  const endDate = data.endDate ?? null
  const actorFields = { userId: actor.userId, userEmail: actor.email ?? undefined }

  return client.transaction(async (tx): Promise<ContractWriteResult> => {
    const [mandante] = await tx.select({ id: clients.id }).from(clients).where(eq(clients.id, data.clientId)).limit(1)
    if (!mandante) return { ok: false, message: "El mandante elegido no existe", fieldErrors: { clientId: ["El mandante elegido no existe"] } }

    if (!data.id) {
      const [worksite] = await tx.select({ id: worksites.id }).from(worksites).where(eq(worksites.id, data.worksiteId)).limit(1)
      if (!worksite) return { ok: false, message: "La faena no existe" }
      const code = await nextContractCodeTx(tx)
      const id = nanoid()
      await tx.insert(contracts).values({
        id, code, clientId: data.clientId, name: data.name, worksiteId: data.worksiteId, startDate, endDate,
        status: "active", billingCycle: "none", currency: "CLP",
      })
      await recordAudit({
        ...actorFields, action: "create", entityType: "contract", entityId: id, entityCode: code, worksiteId: data.worksiteId,
        newState: { code, clientId: data.clientId, name: data.name, startDate, endDate, status: "active" },
      }, tx)
      return { ok: true, id, code }
    }

    const [current] = await tx.select().from(contracts).where(eq(contracts.id, data.id)).limit(1).for("update")
    if (!current) return { ok: false, message: "El contrato ya no existe: recarga la lista." }
    if (current.worksiteId !== data.worksiteId) {
      return { ok: false, message: `El contrato ${current.code} pertenece a otra faena: no se cambia de faena desde aquí` }
    }
    if (current.clientId !== data.clientId && await contractHasBillingHistory(current.id, tx)) {
      return {
        ok: false,
        message: `El contrato ${current.code} ya tiene facturas o propuestas: cambiar su mandante movería esa facturación a otro cliente. Crea otro contrato para el mandante correcto.`,
        fieldErrors: { clientId: ["No se puede cambiar: el contrato tiene facturación"] },
      }
    }

    const blocked = await assertContractChangeKeepsAssignmentsTx(tx, current.id, {
      worksiteId: current.worksiteId, startDate, endDate, status: data.status,
    })
    if (blocked) return { ok: false, message: blocked }
    if (endDate !== null) await capContractAssignmentsTx(tx, current.id, endDate, actor)

    await tx.update(contracts)
      .set({ name: data.name, clientId: data.clientId, startDate, endDate, status: data.status, updatedAt: new Date().toISOString() })
      .where(eq(contracts.id, current.id))
    await recordAudit({
      ...actorFields, action: "update", entityType: "contract", entityId: current.id, entityCode: current.code,
      worksiteId: current.worksiteId ?? undefined,
      oldState: { clientId: current.clientId, name: current.name, startDate: current.startDate, endDate: current.endDate, status: current.status },
      newState: { clientId: data.clientId, name: data.name, startDate, endDate, status: data.status },
    }, tx)
    return { ok: true, id: current.id, code: current.code }
  })
}

/**
 * Crea el mandante (cliente) por su RUT. Si el RUT ya existe devuelve ese
 * cliente en vez de duplicarlo ni fallar: quien tecleó el RUT quería usarlo.
 */
export async function createMandante(actor: AssignmentActor, input: unknown, client: DB = db): Promise<{ ok: true; id: string; existed: boolean } | { ok: false; message: string }> {
  const parsed = mandanteSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) }
  const rut = cleanRut(parsed.data.rut)
  const problem = describeRutProblem(rut)
  if (problem) return { ok: false, message: rutMessage(problem) }

  return client.transaction(async (tx) => {
    const id = nanoid()
    // El RUT es único: dos altas simultáneas del mismo RUT terminan en el mismo cliente.
    const inserted = await tx.insert(clients)
      .values({ id, rut, name: parsed.data.name, defaultCurrency: "CLP", isActive: true })
      .onConflictDoNothing({ target: clients.rut })
      .returning({ id: clients.id })
    if (inserted.length === 0) {
      const [existing] = await tx.select({ id: clients.id }).from(clients).where(eq(clients.rut, rut)).limit(1)
      if (!existing) return { ok: false as const, message: "No se pudo crear el mandante: reintenta" }
      return { ok: true as const, id: existing.id, existed: true }
    }
    await recordAudit({
      userId: actor.userId, userEmail: actor.email ?? undefined, action: "create", entityType: "client", entityId: id, entityCode: rut,
      newState: { rut, name: parsed.data.name, isActive: true },
      reason: "Alta de mandante desde una faena",
    }, tx)
    return { ok: true as const, id, existed: false }
  })
}

export interface MandanteOptions {
  clients: { id: string; rut: string; name: string }[]
  suggestions: { rut: string; name: string }[]
}

const MAX_SUGGESTIONS = 20

/**
 * Mandantes elegibles y sugerencias de alta. Las sugerencias salen de quienes
 * ya reciben facturas de venta y todavía no son cliente: el RUT se normaliza
 * (en las facturas viene con puntos o sin guion), se descartan los que no
 * pasan el dígito verificador —no se podrían crear— y quedan los 20 más
 * frecuentes con su razón social más usada.
 */
export async function listMandanteOptions(client: DB = db): Promise<MandanteOptions> {
  const activeClients = await client.select({ id: clients.id, rut: clients.rut, name: clients.name })
    .from(clients).where(eq(clients.isActive, true)).orderBy(clients.name)
  const knownRuts = new Set((await client.select({ rut: clients.rut }).from(clients)).map((row) => cleanRut(row.rut)))

  const receivers = await client.select({
    taxId: billingInvoices.receiverTaxId, name: billingInvoices.receiverName, total: sql<number>`count(*)::int`,
  }).from(billingInvoices)
    .where(eq(billingInvoices.direction, "sale"))
    .groupBy(billingInvoices.receiverTaxId, billingInvoices.receiverName)
    .orderBy(desc(sql`count(*)`))

  const byRut = new Map<string, { total: number; topName: string; topCount: number }>()
  for (const row of receivers) {
    const rut = cleanRut(row.taxId)
    const name = row.name.trim()
    if (!name || knownRuts.has(rut) || describeRutProblem(rut)) continue
    const entry = byRut.get(rut) ?? { total: 0, topName: name, topCount: 0 }
    entry.total += row.total
    if (row.total > entry.topCount) { entry.topCount = row.total; entry.topName = name }
    byRut.set(rut, entry)
  }
  const suggestions = [...byRut.entries()]
    .sort((a, b) => b[1].total - a[1].total || a[1].topName.localeCompare(b[1].topName, "es"))
    .slice(0, MAX_SUGGESTIONS)
    .map(([rut, entry]) => ({ rut, name: entry.topName }))
  return { clients: activeClients, suggestions }
}
