import * as schema from "../../db/schema"
import {
  countRows,
  dateOnly,
  daysAgo,
  devId,
  insertInBatches,
  int,
  iso,
  type SeedContext,
  type SeedResult,
} from "./shared"

/**
 * Clientes, contratos y la parte comercial de facturación.
 *
 * `billing_invoices` ya viene poblado desde el clon de producción; lo que falta
 * son sus ítems, vínculos y pagos. El sembrador no inventa facturas nuevas:
 * completa las existentes para que las pantallas de detalle y cobranza tengan
 * algo que mostrar.
 */
export async function seedFacturacion(context: SeedContext): Promise<SeedResult> {
  const { db, sql, apply, today, rng, base, actors, log } = context
  const notes: string[] = []
  let inserted = 0
  let skipped = 0

  const insertBatch = async <T>(rows: T[], run: (chunk: T[]) => Promise<number>): Promise<number> =>
    insertInBatches(rows, run)

  // ── Centros de costo ──────────────────────────────────────────────────────
  const costCenters: (typeof schema.costCenters.$inferInsert)[] = base.costCenters.length >= 3
    ? []
    : base.worksites.slice(0, 3).map((worksite, index) => ({
        id: devId("cost-center", index + 1),
        code: `CC-DEV-${String(index + 1).padStart(3, "0")}`,
        name: `Centro de costos ${worksite.name}`,
        isActive: true,
        createdAt: iso(daysAgo(today, 200)),
        updatedAt: iso(daysAgo(today, 200)),
      }))
  if (costCenters.length > 0) {
    if (apply) {
      inserted += await insertBatch(costCenters, async (chunk) =>
        (await db.insert(schema.costCenters).values(chunk).onConflictDoNothing().returning({ id: schema.costCenters.id })).length,
      )
    } else {
      skipped += costCenters.length
    }
  }
  const usableCostCenters = base.costCenters.length >= 3 ? base.costCenters : costCenters

  // ── Clientes y contactos ─────────────────────────────────────────────────
  const clientCount = await countRows(sql, "clients")
  const clients: (typeof schema.clients.$inferInsert)[] = [1, 2, 3, 4, 5, 6].map((index) => ({
    id: devId("client", index),
    rut: `761234${index}-6`,
    name: `Cliente de demostración ${index} SpA`,
    tradeName: `Cliente Demo ${index}`,
    businessActivity: "Servicios de gestión operacional",
    email: `contacto${index}@cliente-demo.cl`,
    phone: `+56 2 2345 67${String(index).padStart(2, "0")}`,
    address: `Av. Demostración ${100 + index}`,
    commune: "Concepción",
    city: "Concepción",
    paymentTermsDays: 30,
    defaultCurrency: "CLP",
    ownerUserId: actors.adminUserId,
    isActive: true,
    notes: "Cliente generado para el entorno de desarrollo.",
    createdAt: iso(daysAgo(today, 240)),
    updatedAt: iso(daysAgo(today, 240)),
  }))
  if (clientCount < 6) {
    if (apply) {
      inserted += await insertBatch(clients, async (chunk) =>
        (await db.insert(schema.clients).values(chunk).onConflictDoNothing().returning({ id: schema.clients.id })).length,
      )
    } else {
      skipped += clients.length
    }
  } else {
    skipped += clients.length
    notes.push(`clients ya tiene ${clientCount} filas; se omite.`)
  }
  const usableClients = clientCount < 6 ? clients : await db.select().from(schema.clients).limit(10)

  const contactCount = await countRows(sql, "client_contacts")
  const contacts: (typeof schema.clientContacts.$inferInsert)[] = usableClients.flatMap((client, index) => [
    {
      id: devId("client-contact", index * 2 + 1),
      clientId: client.id,
      name: `Contacto comercial ${index + 1}`,
      role: "Jefe de abastecimiento",
      email: `comercial${index + 1}@cliente-demo.cl`,
      phone: "+56 9 8765 4321",
      isBilling: false,
      isActive: true,
      createdAt: iso(daysAgo(today, 220)),
      updatedAt: iso(daysAgo(today, 220)),
    },
    {
      id: devId("client-contact", index * 2 + 2),
      clientId: client.id,
      name: `Contacto de cobranza ${index + 1}`,
      role: "Finanzas",
      email: `cobranza${index + 1}@cliente-demo.cl`,
      phone: "+56 9 1234 5678",
      isBilling: true,
      isActive: true,
      createdAt: iso(daysAgo(today, 220)),
      updatedAt: iso(daysAgo(today, 220)),
    },
  ])
  if (contactCount < 6) {
    if (apply) {
      inserted += await insertBatch(contacts, async (chunk) =>
        (await db.insert(schema.clientContacts).values(chunk).onConflictDoNothing().returning({ id: schema.clientContacts.id })).length,
      )
    } else {
      skipped += contacts.length
    }
  } else {
    skipped += contacts.length
  }

  // ── Contratos ────────────────────────────────────────────────────────────
  const contractCount = await countRows(sql, "contracts")
  const contracts: (typeof schema.contracts.$inferInsert)[] = usableClients.slice(0, 4).map((client, index) => ({
    id: devId("contract", index + 1),
    code: `CTR-DEV-2026-${String(index + 1).padStart(4, "0")}`,
    clientId: client.id,
    name: `Contrato de servicios ${index + 1}`,
    worksiteId: base.worksites[index % base.worksites.length]?.id ?? null,
    costCenterId: usableCostCenters[index % usableCostCenters.length]?.id ?? null,
    clientPoNumber: `OC-CLIENTE-${String(index + 1).padStart(4, "0")}`,
    startDate: dateOnly(daysAgo(today, 300)),
    endDate: dateOnly(daysAgo(today, -65)),
    currency: "CLP",
    paymentTermsDays: 30,
    billingCycle: "monthly",
    periodAmount: int(rng, 2_500_000, 9_000_000),
    ownerUserId: actors.adminUserId,
    status: "active",
    notes: "Contrato de demostración.",
    createdAt: iso(daysAgo(today, 300)),
    updatedAt: iso(daysAgo(today, 300)),
  }))
  if (contractCount < 4) {
    if (apply) {
      inserted += await insertBatch(contracts, async (chunk) =>
        (await db.insert(schema.contracts).values(chunk).onConflictDoNothing().returning({ id: schema.contracts.id })).length,
      )
    } else {
      skipped += contracts.length
    }
  } else {
    skipped += contracts.length
  }
  const usableContracts = contractCount < 4 ? contracts : await db.select().from(schema.contracts).limit(10)

  // ── Ítems, vínculos, pagos y gestiones de facturas existentes ─────────────
  const invoices = await db.select().from(schema.billingInvoices).limit(40)
  const payableInvoices = invoices.filter((invoice) => Number(invoice.totalAmount) !== 0)
  const itemCount = await countRows(sql, "billing_invoice_items")
  if (invoices.length > 0 && itemCount < invoices.length) {
    const items: (typeof schema.billingInvoiceItems.$inferInsert)[] = invoices.flatMap((invoice, invoiceIndex) => {
      const net = Number(invoice.netAmount ?? invoice.totalAmount) / 2
      const tax = Number(invoice.taxAmount ?? 0) / 2
      return [1, 2].map((line) => ({
        id: devId("billing-item", invoiceIndex * 2 + line, 6),
        invoiceId: invoice.id,
        description: line === 1 ? "Servicio de gestión operacional" : "Servicio adicional de terreno",
        quantity: 1,
        unit: "servicio",
        unitPrice: net,
        netAmount: net,
        taxAmount: tax,
        totalAmount: net + tax,
        sortOrder: line,
        createdAt: iso(daysAgo(today, 60)),
      }))
    })
    if (apply) {
      inserted += await insertBatch(items, async (chunk) =>
        (await db.insert(schema.billingInvoiceItems).values(chunk).onConflictDoNothing().returning({ id: schema.billingInvoiceItems.id })).length,
      )
    } else {
      skipped += items.length
    }
  } else {
    skipped += invoices.length * 2
  }

  const linkCount = await countRows(sql, "billing_invoice_links")
  const links: (typeof schema.billingInvoiceLinks.$inferInsert)[] = invoices.slice(0, 20).map((invoice, index) => ({
    id: devId("billing-link", index + 1),
    invoiceId: invoice.id,
    clientId: usableClients[index % usableClients.length]?.id ?? null,
    contractId: usableContracts[index % usableContracts.length]?.id ?? null,
    worksiteId: base.worksites[index % base.worksites.length]?.id ?? null,
    costCenterId: usableCostCenters[index % usableCostCenters.length]?.id ?? null,
    servicePeriod: dateOnly(daysAgo(today, 30 + index)).slice(0, 7),
    clientPoNumber: `OC-CLIENTE-${String(index + 1).padStart(4, "0")}`,
    amount: Number(invoice.totalAmount),
    status: "confirmed",
    matchedBy: "user",
    confidence: "high",
    evidence: { origen: "dev-seed" },
    confirmedBy: actors.adminUserId,
    confirmedAt: iso(daysAgo(today, 10)),
    createdBy: actors.adminUserId,
    createdAt: iso(daysAgo(today, 10)),
    updatedAt: iso(daysAgo(today, 10)),
  }))
  if (invoices.length > 0 && linkCount < 5) {
    if (apply) {
      inserted += await insertBatch(links, async (chunk) =>
        (await db.insert(schema.billingInvoiceLinks).values(chunk).onConflictDoNothing().returning({ id: schema.billingInvoiceLinks.id })).length,
      )
    } else {
      skipped += links.length
    }
  } else {
    skipped += links.length
  }

  const paymentCount = await countRows(sql, "billing_invoice_payments")
  const payments: (typeof schema.billingInvoicePayments.$inferInsert)[] = payableInvoices.slice(0, 10).map((invoice, index) => ({
    id: devId("billing-payment", index + 1),
    invoiceId: invoice.id,
    paymentDate: dateOnly(daysAgo(today, int(rng, 2, 45))),
    amount: Number(invoice.totalAmount),
    currency: invoice.currency ?? "CLP",
    method: "transferencia",
    source: "manual",
    clientRequestId: `dev-billing-payment-${index + 1}`,
    verificationStatus: "confirmed",
    confidence: "high",
    evidence: { origen: "dev-seed" },
    matchedBy: "user",
    confirmedBy: actors.adminUserId,
    confirmedAt: iso(daysAgo(today, int(rng, 1, 30))),
    createdBy: actors.adminUserId,
    createdAt: iso(daysAgo(today, int(rng, 2, 45))),
    updatedAt: iso(daysAgo(today, int(rng, 2, 45))),
  }))
  if (payableInvoices.length > 0 && paymentCount < 8) {
    if (apply) {
      inserted += await insertBatch(payments, async (chunk) =>
        (await db.insert(schema.billingInvoicePayments).values(chunk).onConflictDoNothing().returning({ id: schema.billingInvoicePayments.id })).length,
      )
    } else {
      skipped += payments.length
    }
  } else {
    skipped += payments.length
  }

  const collectionCount = await countRows(sql, "billing_collection_actions")
  const actions: (typeof schema.billingCollectionActions.$inferInsert)[] = payableInvoices.slice(0, 5).map((invoice, index) => ({
    id: devId("billing-collection", index + 1),
    invoiceId: invoice.id,
    contactName: `Contacto de cobranza ${index + 1}`,
    actionDate: dateOnly(daysAgo(today, int(rng, 1, 20))),
    actionType: index % 2 === 0 ? "call" : "email",
    channel: index % 2 === 0 ? "phone" : "email",
    outcome: index % 3 === 0 ? "promised_payment" : "contacted",
    commitmentDate: index % 3 === 0 ? dateOnly(daysAgo(today, -7)) : null,
    commitmentAmount: index % 3 === 0 ? Number(invoice.totalAmount) : null,
    nextActionDate: dateOnly(daysAgo(today, -3)),
    notes: "Gestión de cobranza de demostración.",
    assigneeUserId: actors.adminUserId,
    createdBy: actors.adminUserId,
    createdAt: iso(daysAgo(today, int(rng, 1, 20))),
  }))
  if (collectionCount < 5) {
    if (apply) {
      inserted += await insertBatch(actions, async (chunk) =>
        (await db.insert(schema.billingCollectionActions).values(chunk).onConflictDoNothing().returning({ id: schema.billingCollectionActions.id })).length,
      )
    } else {
      skipped += actions.length
    }
  } else {
    skipped += actions.length
  }

  // ── Propuestas de facturación ────────────────────────────────────────────
  const proposalCount = await countRows(sql, "billing_proposals")
  const proposals: (typeof schema.billingProposals.$inferInsert)[] = usableContracts.slice(0, 3).map((contract, index) => {
    const net = int(rng, 2_000_000, 6_000_000)
    const tax = Math.round(net * 0.19)
    const status = index === 0 ? "draft" : index === 1 ? "in_review" : "approved"
    return {
      id: devId("billing-proposal", index + 1),
      code: `PF-DEV-2026-${String(index + 1).padStart(4, "0")}`,
      clientId: contract.clientId,
      contractId: contract.id,
      worksiteId: contract.worksiteId,
      costCenterId: contract.costCenterId,
      servicePeriod: dateOnly(daysAgo(today, 30 * (index + 1))).slice(0, 7),
      currency: "CLP",
      estimatedNet: net,
      estimatedTax: tax,
      estimatedTotal: net + tax,
      clientPoNumber: `OC-CLIENTE-${String(index + 1).padStart(4, "0")}`,
      observations: "Propuesta de demostración.",
      status,
      ownerUserId: actors.adminUserId,
      submittedBy: status === "draft" ? null : actors.adminUserId,
      submittedAt: status === "draft" ? null : iso(daysAgo(today, 10)),
      reviewedBy: status === "approved" ? actors.adminUserId : null,
      reviewedAt: status === "approved" ? iso(daysAgo(today, 5)) : null,
      approvedBy: status === "approved" ? actors.adminUserId : null,
      approvedAt: status === "approved" ? iso(daysAgo(today, 3)) : null,
      createdBy: actors.adminUserId,
      createdAt: iso(daysAgo(today, 20)),
      updatedAt: iso(daysAgo(today, 3)),
    }
  })
  if (proposalCount < 3) {
    if (apply) {
      inserted += await insertBatch(proposals, async (chunk) =>
        (await db.insert(schema.billingProposals).values(chunk).onConflictDoNothing().returning({ id: schema.billingProposals.id })).length,
      )
    } else {
      skipped += proposals.length
    }
  } else {
    skipped += proposals.length
  }

  const usableProposals = proposalCount < 3 ? proposals : await db.select().from(schema.billingProposals).limit(10)
  const proposalItems: (typeof schema.billingProposalItems.$inferInsert)[] = usableProposals.flatMap((proposal, index) => {
    const net = Number(proposal.estimatedNet) / 2
    return [1, 2].map((line) => ({
      id: devId("billing-proposal-item", index * 2 + line, 6),
      proposalId: proposal.id,
      description: line === 1 ? "Servicio base del período" : "Servicio adicional del período",
      quantity: 1,
      unit: "servicio",
      unitPrice: net,
      netAmount: net,
      isExempt: false,
      sortOrder: line,
      createdAt: iso(daysAgo(today, 20)),
    }))
  })
  const proposalItemCount = await countRows(sql, "billing_proposal_items")
  if (proposalItemCount < 4) {
    if (apply) {
      inserted += await insertBatch(proposalItems, async (chunk) =>
        (await db.insert(schema.billingProposalItems).values(chunk).onConflictDoNothing().returning({ id: schema.billingProposalItems.id })).length,
      )
    } else {
      skipped += proposalItems.length
    }
  } else {
    skipped += proposalItems.length
  }

  const eventRows: (typeof schema.billingInvoiceEvents.$inferInsert)[] = invoices.slice(0, 10).map((invoice, index) => ({
    id: devId("billing-event", index + 1),
    invoiceId: invoice.id,
    eventType: "payment_registered",
    actorKind: "user",
    actorUserId: actors.adminUserId,
    detail: { origen: "dev-seed", monto: Number(invoice.totalAmount) },
    occurredAt: iso(daysAgo(today, int(rng, 1, 30))),
  }))
  const eventCount = await countRows(sql, "billing_invoice_events")
  if (eventCount < 5) {
    if (apply) {
      inserted += await insertBatch(eventRows, async (chunk) =>
        (await db.insert(schema.billingInvoiceEvents).values(chunk).onConflictDoNothing().returning({ id: schema.billingInvoiceEvents.id })).length,
      )
    } else {
      skipped += eventRows.length
    }
  } else {
    skipped += eventRows.length
  }

  log(`  facturación: ${inserted} filas insertadas, ${skipped} omitidas o planificadas`)
  return { domain: "facturacion", inserted, skipped, notes }
}
