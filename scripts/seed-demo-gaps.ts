/**
 * Rellena los dominios del tablero que `seed-demo.ts` truncaba pero nunca
 * poblaba (Finanzas, PPA, documentos/evaluaciones SST) más Riesgos, Legal y
 * Capacitación, que nunca tuvieron seed. Sin esto esas secciones del
 * dashboard renderizan "sin datos".
 *
 * Requiere que `npm run db:seed` y `npx tsx scripts/seed-demo.ts` ya hayan
 * corrido (usa faenas, trabajadores y usuarios demo-user-* existentes).
 *
 *   DATABASE_URL=… npx tsx scripts/seed-demo-gaps.ts
 *
 * Determinista e idempotente igual que seed-demo.ts: trunca sus propias
 * tablas al empezar.
 */
import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"
import { sql } from "drizzle-orm"
import { createHash } from "node:crypto"
import { loadEnvConfig } from "@next/env"
import * as schema from "../db/schema"
import { hashPpaPublicToken } from "@/lib/services/ppa-module/public-token"

loadEnvConfig(process.cwd())

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL es obligatorio")
  process.exit(1)
}

const client = postgres(process.env.DATABASE_URL, { max: 1 })
const db = drizzle(client, { schema })

// ── Utilidades deterministas (mismo patrón que seed-demo.ts) ───────────────

let seed = 20260806
function rnd() {
  seed = (seed * 1664525 + 1013904223) % 4294967296
  return seed / 4294967296
}
const int = (min: number, max: number) => Math.floor(rnd() * (max - min + 1)) + min
const pick = <T,>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)]!
const chance = (p: number) => rnd() < p

const TODAY = new Date("2026-08-06T12:00:00.000Z")
const daysAgo = (n: number) => new Date(TODAY.getTime() - n * 86_400_000)
const daysFromNow = (n: number) => new Date(TODAY.getTime() + n * 86_400_000)
const iso = (d: Date) => d.toISOString()
const day = (d: Date) => d.toISOString().slice(0, 10)
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex")

let counter = 0
const id = (prefix: string) => `demo-${prefix}-${(++counter).toString(36).padStart(5, "0")}`

const TABLAS = [
  "clients", "billing_invoices", "billing_sync_runs",
  "ppa_submissions",
  "sst_document_categories", "sst_documents", "sst_evaluations",
  "prevention_legal_requirements",
  "prevention_training_courses",
]

async function main() {
  console.log("Generando dominios faltantes del tablero…")

  await db.execute(sql.raw(`TRUNCATE ${TABLAS.join(", ")} CASCADE`))
  /*
   * El dominio de riesgo NO usa TRUNCATE CASCADE: `prevention_risk_entries` lo
   * referencian (nullable, "set null") programas de inspección, permisos de
   * trabajo e higiene que `seed-demo.ts` ya pobló. TRUNCATE CASCADE trunca esas
   * tablas por completo aunque el valor de la FK sea NULL en todas sus filas —
   * un DELETE normal respeta "set null" fila por fila y no las toca.
   */
  await db.execute(sql`DELETE FROM prevention_risk_entries`)
  await db.execute(sql`DELETE FROM prevention_risk_matrices`)
  await db.execute(sql`DELETE FROM prevention_risk_processes`)
  await db.execute(sql`DELETE FROM prevention_risk_methodologies`)
  console.log(`  Limpieza: ${TABLAS.length} tablas (con cascada) + dominio de riesgo (con delete) vaciados`)

  const worksites = await db.select().from(schema.worksites)
  const workers = await db.select().from(schema.workers)
  if (worksites.length === 0 || workers.length === 0) {
    console.error("Falta el seed base. Corre `npm run db:seed` y `scripts/seed-demo.ts` primero.")
    process.exit(1)
  }
  const admin = "demo-user-administrador"
  const jefa = "demo-user-jefa_chome"
  const usersExist = await db.select({ id: schema.users.id }).from(schema.users).where(sql`id = ${admin}`)
  if (usersExist.length === 0) {
    console.error("Faltan los usuarios demo. Corre `scripts/seed-demo.ts` primero.")
    process.exit(1)
  }

  // ══════════════════════════════════════════════════════════════════════
  // FINANZAS: clientes, facturas de venta, vínculos, pagos
  // ══════════════════════════════════════════════════════════════════════
  const CHOME_TAX_ID = "76099887-1"
  const CHOME_NAME = "Chome SpA"

  const clientNames = [
    "Constructora Andes SpA", "Minera Los Bronces Ltda", "Ingeniería del Sur S.A.",
    "Transportes Cordillera Ltda", "Servicios Industriales Maipo SpA", "Grupo Rocalta S.A.",
    "Faenas Norte Grande Ltda", "Explotaciones Mineras del Pacífico SpA",
  ]
  const clients = clientNames.map((name, i) => ({
    id: id("clt"),
    rut: `7${6 + i}${String(int(100000, 999999))}-${int(0, 9)}`,
    name,
    defaultCurrency: "CLP",
    paymentTermsDays: pick([30, 30, 45, 60]),
    isActive: true,
    ownerUserId: admin,
    createdAt: iso(daysAgo(300)),
    updatedAt: iso(daysAgo(300)),
  }))
  await db.insert(schema.clients).values(clients)

  const invoices: (typeof schema.billingInvoices.$inferInsert)[] = []
  const invoiceLinks: (typeof schema.billingInvoiceLinks.$inferInsert)[] = []
  const payments: (typeof schema.billingInvoicePayments.$inferInsert)[] = []
  let folioSeq = 1000
  let voidCount = 0

  for (let d = 360; d >= 0; d -= int(3, 6)) {
    const cl = pick(clients)
    const issued = daysAgo(d)
    const exenta = chance(0.1)
    const net = int(80, 2500) * 1000
    const tax = exenta ? 0 : Math.round(net * 0.19)
    const total = net + tax
    const paymentTermsDays = cl.paymentTermsDays ?? 30
    const due = new Date(issued.getTime() + paymentTermsDays * 86_400_000)

    // Más viejo → más probable que ya esté pagado; lo reciente sigue abierto.
    const pPaid = Math.min(0.9, Math.max(0.15, 0.25 + d / 450))
    const pPartial = 0.15
    const roll = rnd()
    const profile = roll < pPaid ? "paid" : roll < pPaid + pPartial ? "partial" : "unpaid"

    // ~1.5% de las facturas se anulan: prueba la exclusión de documentStatus.
    const isVoid = voidCount < 2 && chance(0.015)
    if (isVoid) voidCount++

    const invoiceId = id("inv")
    const paidAmount = isVoid ? 0 : profile === "paid" ? total : profile === "partial" ? Math.round(total * (0.3 + rnd() * 0.4)) : 0
    const paymentStatus = isVoid ? "unpaid" : profile === "paid" ? "paid" : profile === "partial" ? "partial" : "unpaid"

    invoices.push({
      id: invoiceId,
      direction: "sale",
      docType: exenta ? "34" : "33",
      folio: ++folioSeq,
      issuerTaxId: CHOME_TAX_ID,
      issuerName: CHOME_NAME,
      receiverTaxId: cl.rut,
      receiverName: cl.name,
      issueDate: day(issued),
      dueDate: day(due),
      dueDateSource: "client",
      currency: "CLP",
      netAmount: net,
      taxAmount: tax,
      totalAmount: total,
      documentStatus: isVoid ? "void" : chance(0.06) ? "issued" : "accepted",
      paymentStatus,
      paidAmount,
      source: "manual",
      ownerUserId: admin,
      createdAt: iso(issued),
      updatedAt: iso(issued),
    })

    if (!isVoid) {
      invoiceLinks.push({
        id: id("lnk"),
        invoiceId,
        clientId: cl.id,
        worksiteId: pick(worksites).id,
        status: "confirmed",
        matchedBy: "user",
        confirmedBy: admin,
        confirmedAt: iso(new Date(issued.getTime() + 3_600_000)),
        createdBy: admin,
        createdAt: iso(issued),
        updatedAt: iso(issued),
      })
    }

    if (!isVoid && paidAmount > 0) {
      const paymentDate = new Date(issued.getTime() + int(1, Math.min(120, d + 5)) * 86_400_000)
      payments.push({
        id: id("pay"),
        invoiceId,
        paymentDate: day(paymentDate > TODAY ? TODAY : paymentDate),
        amount: paidAmount,
        currency: "CLP",
        method: pick(["transferencia", "cheque", "transferencia"] as const),
        source: "manual",
        verificationStatus: "confirmed",
        matchedBy: "user",
        confirmedBy: admin,
        confirmedAt: iso(paymentDate > TODAY ? TODAY : paymentDate),
        createdBy: admin,
        createdAt: iso(paymentDate > TODAY ? TODAY : paymentDate),
        updatedAt: iso(paymentDate > TODAY ? TODAY : paymentDate),
      })
    }
  }
  await db.insert(schema.billingInvoices).values(invoices)
  await db.insert(schema.billingInvoiceLinks).values(invoiceLinks)
  if (payments.length > 0) await db.insert(schema.billingInvoicePayments).values(payments)
  console.log(`  Finanzas: ${clients.length} clientes · ${invoices.length} facturas · ${invoiceLinks.length} vínculos · ${payments.length} pagos`)

  // ══════════════════════════════════════════════════════════════════════
  // GOBERNANZA — PPA Digital
  // ══════════════════════════════════════════════════════════════════════
  const TAREAS = ["operador_maquinaria_pesada", "electricista", "soldador", "mecanico", "supervisor_terreno", "operador_grua", "chofer"] as const
  const STOP_REASONS = ["no_seguro", "peligro_no_controlado", "cambio_sin_descripcion", "respuesta_insuficiente", "faltan_controles"] as const

  const ppas: (typeof schema.ppaSubmissions.$inferInsert)[] = []
  for (let d = 180; d >= 0; d -= int(1, 3)) {
    const ocurrio = daysAgo(d)
    const worker = pick(workers)
    const tarea = pick(TAREAS)
    const esCritica = tarea === "operador_maquinaria_pesada"
    const detenido = chance(0.15)
    const answers = {
      tipoTrabajo: tarea, cambioPlanificado: "no", peligroNoControlado: detenido ? "si" : "no",
      controles: ["EPP completo", "Check-list de equipo"], seguroComenzar: detenido ? "no" : "si", complementarias: {},
    }
    let estado: string
    let reviewedAt: string | null = null
    if (!detenido) {
      estado = "aprobado_auto"
    } else if (d < 15) {
      estado = pick(["detenido", "en_correccion", "pendiente_verificacion"] as const)
    } else if (d < 60) {
      estado = pick(["autorizado", "rechazado", "pendiente_verificacion"] as const)
      reviewedAt = iso(new Date(ocurrio.getTime() + int(4, 48) * 3_600_000))
    } else {
      estado = pick(["cerrado", "autorizado", "rechazado"] as const)
      reviewedAt = iso(new Date(ocurrio.getTime() + int(4, 48) * 3_600_000))
    }
    ppas.push({
      id: id("ppa"),
      worksiteId: pick(worksites).id,
      workerId: worker.id,
      workerName: `${worker.firstName} ${worker.lastName}`,
      manualIdentificacion: false,
      tipoTrabajo: tarea,
      esCritica,
      answersJson: answers,
      resultado: detenido ? "detenido" : "autorizado_auto",
      triggeredReasons: detenido ? [pick(STOP_REASONS), ...(chance(0.4) ? [pick(STOP_REASONS)] : [])] : [],
      estado,
      // `public_token` guarda el HASH del enlace, nunca el valor en claro
      // (misma regla que createPpaSubmission). Estos PPA de demo no entregan
      // enlace a nadie, pero la columna tiene que verse como en producción.
      publicToken: hashPpaPublicToken(id("tok")),
      reviewedBy: reviewedAt ? pick([admin, jefa]) : null,
      reviewedAt,
      createdAt: iso(ocurrio),
      updatedAt: iso(reviewedAt ? new Date(reviewedAt) : ocurrio),
    })
  }
  await db.insert(schema.ppaSubmissions).values(ppas)
  console.log(`  PPA: ${ppas.length} envíos`)

  // ══════════════════════════════════════════════════════════════════════
  // GOBERNANZA — Biblioteca de documentos SST
  // ══════════════════════════════════════════════════════════════════════
  const categories = [
    { slug: "reglamentos", name: "Reglamentos" },
    { slug: "procedimientos", name: "Procedimientos" },
    { slug: "politicas", name: "Políticas" },
    { slug: "formularios", name: "Formularios" },
  ].map((c) => ({ ...c, sortOrder: 0, isActive: true, createdAt: iso(daysAgo(300)), updatedAt: iso(daysAgo(300)) }))
  await db.insert(schema.sstDocumentCategories).values(categories)

  const docTypes = categories.map((c) => ({
    id: id("doctype"), categorySlug: c.slug, code: "GEN", name: `${c.name} general`,
    requiresApproval: true, requiresAcknowledgment: true, isActive: true,
    createdAt: iso(daysAgo(300)), updatedAt: iso(daysAgo(300)),
  }))
  await db.insert(schema.sstDocumentTypes).values(docTypes)

  const STATUSES_WEIGHTED = [
    "vigente", "vigente", "vigente", "vigente", "vigente",
    "aprobado", "aprobado", "borrador", "en_revision", "observado",
    "vencido", "reemplazado", "archivado",
  ] as const
  const docs: (typeof schema.sstDocuments.$inferInsert)[] = []
  const docVersions: (typeof schema.sstDocumentVersions.$inferInsert)[] = []
  const distTargets: (typeof schema.sstDocumentDistributionTargets.$inferInsert)[] = []

  for (let i = 0; i < 40; i++) {
    const cat = pick(categories)
    const status: string = pick(STATUSES_WEIGHTED)
    const createdAt = daysAgo(int(30, 300))
    let expiresAt: string | null = null

    if (status === "vigente" || status === "aprobado") {
      // Reparto de vencimiento: dentro de 7, 15, 30 días, más lejos, o ya vencido (sólo para "vigente").
      const bucket = i % 7
      if (bucket === 0) expiresAt = day(daysFromNow(int(0, 7)))
      else if (bucket === 1) expiresAt = day(daysFromNow(int(8, 15)))
      else if (bucket === 2) expiresAt = day(daysFromNow(int(16, 30)))
      else if (bucket === 3 && status === "vigente") expiresAt = day(daysAgo(int(1, 60))) // reclasifica a "vencido"
      else expiresAt = day(daysFromNow(int(60, 400)))
    }

    const docId = id("sstdoc")
    docs.push({
      id: docId,
      categorySlug: cat.slug,
      typeId: docTypes.find((t) => t.categorySlug === cat.slug)!.id,
      title: `${cat.name} — documento ${i + 1}`,
      worksiteId: chance(0.8) ? pick(worksites).id : null,
      status,
      confidentiality: "publico_interno",
      dataClass: "operational",
      expiresAt,
      uploadedBy: admin,
      requiresAcknowledgment: status === "vigente",
      createdAt: iso(createdAt),
      updatedAt: iso(createdAt),
    })

    if (status === "vigente" || status === "aprobado" || status === "vencido") {
      const versionId = id("sstver")
      docVersions.push({
        id: versionId,
        documentId: docId,
        version: 1,
        status: "vigente",
        fileName: `documento-${i + 1}.pdf`,
        storageName: `${docId}.pdf`,
        filePath: `/demo/sst-docs/${docId}.pdf`,
        mimeType: "application/pdf",
        fileSize: int(20_000, 900_000),
        checksum: sha256(docId),
        uploadedBy: admin,
        reviewedBy: jefa,
        approvedBy: jefa,
        approvedAt: iso(createdAt),
        createdAt: iso(createdAt),
        updatedAt: iso(createdAt),
      })
      // currentVersionId no es una FK real, pero lo referencia el join de ackPending.
      docs[docs.length - 1]!.currentVersionId = versionId

      if (status !== "vencido") {
        for (let t = 0; t < int(2, 5); t++) {
          const worker = pick(workers)
          const statusRoll = rnd()
          const targetStatus = statusRoll < 0.55 ? "pendiente" : statusRoll < 0.85 ? "acusado" : "exento"
          distTargets.push({
            id: id("dist"),
            versionId,
            workerId: worker.id,
            assignmentReason: "Documento vigente asignado al personal de la faena.",
            worksiteId: docs[docs.length - 1]!.worksiteId ?? null,
            assignedByUserId: admin,
            assignedAt: iso(createdAt),
            status: targetStatus,
            exemptedByUserId: targetStatus === "exento" ? admin : null,
            exemptedAt: targetStatus === "exento" ? iso(createdAt) : null,
            exemptionReason: targetStatus === "exento" ? "Personal externo sin obligación de acuse." : null,
            createdAt: iso(createdAt),
            updatedAt: iso(createdAt),
          })
        }
      }
    }
  }
  await db.insert(schema.sstDocuments).values(docs)
  await db.insert(schema.sstDocumentVersions).values(docVersions)
  for (const d of docVersions) {
    const docId = docs.find((doc) => doc.currentVersionId === d.id)!.id
    await db.update(schema.sstDocuments).set({ currentVersionId: d.id }).where(sql`id = ${docId}`)
  }
  if (distTargets.length > 0) await db.insert(schema.sstDocumentDistributionTargets).values(distTargets)
  console.log(`  Documentos SST: ${categories.length} categorías · ${docs.length} documentos · ${docVersions.length} versiones · ${distTargets.length} destinatarios`)

  // ══════════════════════════════════════════════════════════════════════
  // GOBERNANZA — Evaluaciones SST de trabajador
  // ══════════════════════════════════════════════════════════════════════
  const RESULTADOS_HABILITA = ["habilitado_autonomo", "habilitado_autonomo", "habilitado_restricciones"] as const
  const RESULTADOS_NO_HABILITA = ["no_habilitado", "requiere_reforzamiento"] as const

  const sstEvals: (typeof schema.sstEvaluations.$inferInsert)[] = []
  for (let i = 0; i < 60; i++) {
    const d = int(0, 180)
    const fecha = daysAgo(d)
    const cerrado = chance(0.75)
    const tipo = chance(0.7) ? "nuevo" : "seguimiento"
    sstEvals.push({
      id: id("sst"),
      worksiteId: pick(worksites).id,
      workerId: pick(workers).id,
      createdBy: admin,
      definicionCode: pick(["trabajador_nuevo", "trabajador_antiguo"] as const),
      definicionVersion: "01",
      tipo,
      evaluatorRole: pick(["prevencionista_faena", "admin_contrato", "conductor_lider"] as const),
      motivo: tipo === "seguimiento" ? "reincorporacion" : null,
      fechaEvaluacion: day(fecha),
      estado: cerrado ? "cerrado" : "borrador",
      resultadoFinal: cerrado ? (chance(0.75) ? pick(RESULTADOS_HABILITA) : pick(RESULTADOS_NO_HABILITA)) : null,
      porcentajeCumplimiento: cerrado ? int(45, 100) : null,
      resultadoEficacia: tipo === "seguimiento" && cerrado ? pick(["eficaz", "parcialmente_eficaz", "no_eficaz"] as const) : null,
      createdAt: iso(fecha),
      updatedAt: iso(fecha),
    })
  }
  await db.insert(schema.sstEvaluations).values(sstEvals)
  console.log(`  Evaluaciones SST: ${sstEvals.length}`)

  // ══════════════════════════════════════════════════════════════════════
  // PREVENCIÓN — Riesgos (matriz, procesos, tareas, cargos, entradas, controles)
  // ══════════════════════════════════════════════════════════════════════
  const methodology = {
    id: id("metodo"), code: "MIPER", name: "Matriz de Identificación de Peligros y Evaluación de Riesgos",
    versionLabel: "v1", kind: "primary", authoritySource: "Procedimiento interno Chome",
    configuration: {}, isActive: true, createdByUserId: admin, createdAt: iso(daysAgo(300)),
  }
  await db.insert(schema.preventionRiskMethodologies).values(methodology)

  const PROCESOS = ["Movimiento de tierra", "Mantención de equipos", "Carguío y transporte"] as const
  const processes: (typeof schema.preventionRiskProcesses.$inferInsert)[] = []
  const tasks: (typeof schema.preventionRiskTasks.$inferInsert)[] = []
  const positions: (typeof schema.preventionRiskPositions.$inferInsert)[] = []

  for (const [wi, ws] of worksites.entries()) {
    for (const [pi, procName] of PROCESOS.entries()) {
      const processId = id("proc")
      processes.push({
        id: processId, worksiteId: ws.id, code: `P-${wi}-${pi}`, name: procName,
        isActive: true, createdAt: iso(daysAgo(280)), updatedAt: iso(daysAgo(280)),
      })
      for (let ti = 0; ti < 2; ti++) {
        const taskId = id("task")
        tasks.push({
          id: taskId, processId, code: `T-${wi}-${pi}-${ti}`, name: `${procName} — tarea ${ti + 1}`,
          isRoutine: true, isActive: true, createdAt: iso(daysAgo(280)), updatedAt: iso(daysAgo(280)),
        })
        for (let posi = 0; posi < 2; posi++) {
          positions.push({
            id: id("pos"), taskId, code: `POS-${wi}-${pi}-${ti}-${posi}`, name: `Cargo ${posi + 1}`,
            isActive: true, createdAt: iso(daysAgo(280)), updatedAt: iso(daysAgo(280)),
          })
        }
      }
    }
  }
  await db.insert(schema.preventionRiskProcesses).values(processes)
  await db.insert(schema.preventionRiskTasks).values(tasks)
  await db.insert(schema.preventionRiskPositions).values(positions)

  // 5 faenas con matriz publicada, 2 en revisión, 2 en borrador: la cobertura no es 100%.
  const matrices: (typeof schema.preventionRiskMatrices.$inferInsert)[] = worksites.map((ws, i) => {
    const status = i < 5 ? "published" : i < 7 ? "in_review" : "draft"
    return {
      id: id("mtx"), worksiteId: ws.id, matrixVersion: 1, title: `Matriz de riesgos — ${ws.name}`,
      status, methodologyId: methodology.id!, methodologySnapshot: { code: "MIPER" },
      revisionReason: "Elaboración inicial", participationSummary: "Consulta con comité paritario y jefaturas de faena.",
      consultationEvidenceReference: "Acta de consulta CPHS",
      createdByUserId: admin,
      ...(status !== "draft" ? { reviewedByUserId: jefa, reviewedAt: iso(daysAgo(250)) } : {}),
      ...(status === "published" ? { approvedByUserId: jefa, approvedAt: iso(daysAgo(240)), publishedByUserId: jefa, publishedAt: iso(daysAgo(230)) } : {}),
      createdAt: iso(daysAgo(280)), updatedAt: iso(daysAgo(230)),
    }
  })
  await db.insert(schema.preventionRiskMatrices).values(matrices)

  const publishedMatrices = matrices.filter((m) => m.status === "published")
  const entries: (typeof schema.preventionRiskEntries.$inferInsert)[] = []
  const controls: (typeof schema.preventionRiskControls.$inferInsert)[] = []
  // Vocabulario canónico de lib/prevention/risk-levels: la columna tiene un
  // CHECK y la UI sólo sabe etiquetar estas cuatro claves.
  const NIVELES = ["low", "medium", "high", "critical"] as const

  for (const matrix of publishedMatrices) {
    const procesosFaena = processes.filter((p) => p.worksiteId === matrix.worksiteId)
    for (const proc of procesosFaena) {
      const tareasProc = tasks.filter((t) => t.processId === proc.id)
      for (const task of tareasProc) {
        // Sólo el primer cargo de cada tarea queda cubierto: deja cobertura parcial.
        const position = positions.find((p) => p.taskId === task.id)!
        const isCritical = chance(0.2)
        const entryId = id("re")
        entries.push({
          id: entryId, matrixId: matrix.id!, processId: proc.id!, taskId: task.id!, positionId: position.id!,
          hazardCode: `HZ-${entries.length + 1}`, hazard: "Exposición a riesgo mecánico/operacional",
          riskFactor: "Condición insegura del entorno de trabajo", expectedEventOrDamage: "Lesión por contacto o atrapamiento",
          exposedPeopleDescription: "Trabajadores directos de la tarea", exposedPeopleCount: int(1, 6),
          genderConsiderations: "Sin diferencias relevantes identificadas",
          sensitiveWorkerConsiderations: "Se evalúa caso a caso ante trabajadores sensibles",
          inherentDimensions: { probabilidad: int(2, 5), consecuencia: int(2, 5) }, inherentLevel: pick(NIVELES),
          residualDimensions: { probabilidad: int(1, 3), consecuencia: int(1, 4) }, residualLevel: pick(NIVELES),
          isCritical, responsibleSnapshot: "Jefatura de Prevención de Riesgos",
          createdAt: iso(daysAgo(220)), updatedAt: iso(daysAgo(220)),
        })
        for (let c = 0; c < int(1, 2); c++) {
          const controlCritical = isCritical && c === 0
          controls.push({
            id: id("rc"), riskEntryId: entryId,
            description: c === 0 ? "Procedimiento de trabajo seguro y check-list previo" : "Uso obligatorio de EPP específico",
            hierarchy: pick(["engineering", "administrative", "ppe"] as const),
            isExisting: chance(0.6), isCritical: controlCritical,
            performanceStandard: controlCritical ? "100% de cumplimiento verificado en terreno" : null,
            verificationFrequency: controlCritical ? "Mensual" : null,
            responsibleSnapshot: "Supervisor de faena",
            status: pick(["proposed", "implemented", "implemented", "verified"] as const),
            effectivenessStatus: pick(["not_assessed", "effective"] as const),
            createdAt: iso(daysAgo(220)), updatedAt: iso(daysAgo(220)),
          })
        }
      }
    }
  }
  await db.insert(schema.preventionRiskEntries).values(entries)
  await db.insert(schema.preventionRiskControls).values(controls)
  console.log(`  Riesgos: 1 metodología · ${processes.length} procesos · ${tasks.length} tareas · ${positions.length} cargos · ${matrices.length} matrices (${publishedMatrices.length} publicadas) · ${entries.length} entradas · ${controls.length} controles`)

  // ══════════════════════════════════════════════════════════════════════
  // PREVENCIÓN — Legal (requisitos y aplicabilidad)
  // ══════════════════════════════════════════════════════════════════════
  const TOPICS = ["Riesgos", "EPP", "Capacitación", "Emergencias", "Higiene"] as const
  const requirements: (typeof schema.preventionLegalRequirements.$inferInsert)[] = []
  for (let i = 0; i < 12; i++) {
    const status = i < 9 ? "published" : i < 11 ? "draft" : "in_review"
    requirements.push({
      id: id("req"), code: `REQ-${String(i + 1).padStart(3, "0")}`, requirementVersion: 1,
      sourceType: pick(["legal", "regulatory", "internal"] as const), authority: "Dirección del Trabajo",
      sourceTitle: "DS 44 — Reglamento de gestión preventiva", sourceReference: "DS 44/2024",
      article: `Art. ${int(5, 40)}`, requirement: "Obligación de gestión preventiva aplicable a la operación.",
      versionLabel: "v1", validFrom: day(daysAgo(300)), topic: pick(TOPICS), chomeRole: "Empleador principal",
      evidenceRequired: "Registro documental firmado", frequency: "Anual",
      status,
      createdByUserId: admin,
      ...(status !== "draft" ? { reviewedByUserId: jefa, reviewedAt: iso(daysAgo(200)) } : {}),
      ...(status === "published" ? { approvedByUserId: jefa, approvedAt: iso(daysAgo(190)), publishedByUserId: jefa, publishedAt: iso(daysAgo(180)) } : {}),
      createdAt: iso(daysAgo(250)), updatedAt: iso(daysAgo(180)),
    })
  }
  await db.insert(schema.preventionLegalRequirements).values(requirements)

  const publishedReqs = requirements.filter((r) => r.status === "published")
  const applicabilities: (typeof schema.preventionLegalApplicabilities.$inferInsert)[] = []
  for (const req of publishedReqs) {
    const shuffled = [...worksites].sort(() => rnd() - 0.5).slice(0, 3)
    for (const ws of shuffled) {
      const roll = rnd()
      const applicabilityStatus = roll < 0.7 ? "applicable" : roll < 0.9 ? "pending" : "not_applicable"
      const isApplicable = applicabilityStatus === "applicable"
      const compliant = isApplicable && chance(0.6)
      applicabilities.push({
        id: id("apl"), requirementId: req.id!, worksiteId: ws.id,
        applicabilityStatus,
        rationale: applicabilityStatus === "not_applicable" ? "No existe la actividad asociada en esta faena." : "Actividad presente en la faena, requisito exigible.",
        responsibleSnapshot: "Jefatura de Prevención de Riesgos",
        evidenceReference: compliant ? "Registro de cumplimiento adjunto" : null,
        complianceStatus: isApplicable ? (compliant ? "compliant" : pick(["partial", "noncompliant"] as const)) : "not_assessed",
        ...(applicabilityStatus === "not_applicable" ? { approvedByUserId: jefa, approvedAt: iso(daysAgo(150)) } : {}),
        createdAt: iso(daysAgo(180)), updatedAt: iso(daysAgo(150)),
      })
    }
  }
  await db.insert(schema.preventionLegalApplicabilities).values(applicabilities)
  console.log(`  Legal: ${requirements.length} requisitos (${publishedReqs.length} publicados) · ${applicabilities.length} aplicabilidades`)

  // ══════════════════════════════════════════════════════════════════════
  // PREVENCIÓN — Capacitación
  // ══════════════════════════════════════════════════════════════════════
  const COURSES = [
    { name: "Inducción OSH corporativa", kind: "induction_corporate", validityMonths: 24 },
    { name: "ODI puesto de trabajo", kind: "odi", validityMonths: 12 },
    { name: "Uso y cuidado de EPP", kind: "legal_mandatory", validityMonths: 24, minimumDurationMinutes: 480 },
    { name: "Trabajo en altura", kind: "operational_talk", validityMonths: 12 },
    { name: "Manejo defensivo", kind: "practical_training", validityMonths: 12 },
  ] as const

  const courses = COURSES.map((c, i) => ({
    id: id("course"), code: `CUR-${String(i + 1).padStart(3, "0")}`, name: c.name, kind: c.kind,
    minimumDurationMinutes: "minimumDurationMinutes" in c ? c.minimumDurationMinutes : 240, validityMonths: c.validityMonths,
    requiresAssessment: true, passingScore: 70, isActive: true,
    createdByUserId: admin, createdAt: iso(daysAgo(280)), updatedAt: iso(daysAgo(280)),
  }))
  await db.insert(schema.preventionTrainingCourses).values(courses)

  const courseVersions = courses.map((c) => ({
    id: id("cver"), courseId: c.id, versionLabel: "v1", status: "published",
    contentOutline: { modulos: ["Introducción", "Contenido técnico", "Evaluación"] },
    durationMinutes: c.minimumDurationMinutes, modality: "presencial", assessmentType: "theoretical",
    passingScore: 70, contentHash: sha256(c.id),
    authorUserId: admin, reviewedByUserId: jefa, reviewedAt: iso(daysAgo(270)),
    approvedByUserId: jefa, approvedAt: iso(daysAgo(265)), publishedByUserId: jefa, publishedAt: iso(daysAgo(260)),
    createdAt: iso(daysAgo(280)), updatedAt: iso(daysAgo(260)),
  }))
  await db.insert(schema.preventionTrainingCourseVersions).values(courseVersions)

  const sessions: (typeof schema.preventionTrainingSessions.$inferInsert)[] = []
  const attendance: (typeof schema.preventionTrainingAttendance.$inferInsert)[] = []
  const competencies: (typeof schema.preventionWorkerCompetencies.$inferInsert)[] = []

  for (let i = 0; i < 24; i++) {
    const version = pick(courseVersions)
    const course = courses.find((c) => c.id === version.courseId)!
    const d = int(0, 180)
    const scheduled = daysAgo(d)
    const completed = d > 5
    const sessionId = id("sess")
    sessions.push({
      id: sessionId, code: `CAP-2026-${String(i + 1).padStart(4, "0")}`, courseVersionId: version.id!,
      worksiteId: pick(worksites).id, scheduledAt: iso(scheduled),
      startedAt: completed ? iso(scheduled) : null,
      endedAt: completed ? iso(new Date(scheduled.getTime() + version.durationMinutes! * 60_000)) : null,
      durationMinutes: version.durationMinutes, modality: version.modality,
      instructorUserId: chance(0.6) ? pick([admin, jefa]) : null,
      instructorExternalName: chance(0.6) ? null : "Relator OTEC externo",
      instructorCompetencyEvidence: "Certificado de competencia como relator vigente.",
      status: completed ? "completed" : pick(["planned", "in_progress"] as const),
      createdByUserId: admin, createdAt: iso(scheduled), updatedAt: iso(scheduled),
    })

    if (completed) {
      const asistentes = new Set<string>()
      while (asistentes.size < int(8, 15)) asistentes.add(pick(workers).id)
      for (const workerId of asistentes) {
        const worker = workers.find((w) => w.id === workerId)!
        const roll = rnd()
        const status = roll < 0.75 ? "attended" : roll < 0.9 ? "absent" : "excused"
        const attended = status === "attended"
        const approved = attended && chance(0.8)
        const attendanceId = id("att")
        attendance.push({
          id: attendanceId, sessionId, workerId: worker.id, status,
          assessmentResult: attended ? (approved ? "approved" : "failed") : "not_required",
          assessmentScore: attended ? (approved ? int(70, 100) : int(35, 69)) : null,
          assessmentAttempts: attended ? 1 : 0,
          excuseReason: status === "excused" ? "Licencia médica presentada." : null,
          recordedByUserId: admin, createdAt: iso(scheduled), updatedAt: iso(scheduled),
        })
        if (attended && approved) {
          const grantedAt = day(scheduled)
          const expiresAt = course.validityMonths ? day(new Date(scheduled.getTime() + course.validityMonths * 30 * 86_400_000)) : null
          competencies.push({
            id: id("comp"), workerId: worker.id, courseId: course.id, sourceType: "session",
            sourceSessionId: sessionId, sourceAttendanceId: attendanceId, grantedAt, expiresAt,
            status: "valid", createdByUserId: admin, createdAt: iso(scheduled), updatedAt: iso(scheduled),
          })
        }
      }
    }
  }
  await db.insert(schema.preventionTrainingSessions).values(sessions)
  if (attendance.length > 0) await db.insert(schema.preventionTrainingAttendance).values(attendance)
  if (competencies.length > 0) await db.insert(schema.preventionWorkerCompetencies).values(competencies)

  const requirements2 = courses.slice(0, 3).map((c) => ({
    id: id("creq"), courseId: c.id, scopeType: "global",
    enforcement: "warning", reason: "Curso exigido a toda la dotación por política interna de prevención.",
    isActive: true, createdByUserId: admin, createdAt: iso(daysAgo(200)), updatedAt: iso(daysAgo(200)),
  }))
  await db.insert(schema.preventionCompetencyRequirements).values(requirements2)
  console.log(`  Capacitación: ${courses.length} cursos · ${sessions.length} sesiones · ${attendance.length} asistencias · ${competencies.length} competencias · ${requirements2.length} requisitos`)

  await client.end()
  console.log("Listo.")
}

main().catch(async (error) => {
  console.error(error)
  await client.end()
  process.exit(1)
})
