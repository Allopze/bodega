/**
 * Genera un entorno de **demostración** con volumen realista sobre la base ya
 * migrada y con el seed base cargado (faenas, trabajadores, catálogo EPP).
 *
 * Para qué: el seed base deja sólo catálogo, así que el dashboard —que ahora
 * cubre seis dominios— se ve vacío y no permite juzgar la pantalla. Esto escribe
 * seis meses de operación en todos los dominios que el tablero muestra.
 *
 * Determinista a propósito: un PRNG con semilla fija hace que dos corridas den
 * el mismo resultado, así que una captura de pantalla es comparable con la
 * siguiente y un bug de render no se confunde con datos distintos.
 *
 *   DATABASE_URL=… npx tsx scripts/seed-demo.ts
 *
 * NO tocar en producción: asume que puede escribir libremente y usa ids con
 * prefijo `demo-`.
 */
import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"
import { sql } from "drizzle-orm"
import bcrypt from "bcryptjs"
import { loadEnvConfig } from "@next/env"
import * as schema from "../db/schema"
import { SYSTEM_ROLES } from "../lib/auth/system-rbac"

loadEnvConfig(process.cwd())

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL es obligatorio")
  process.exit(1)
}

const client = postgres(process.env.DATABASE_URL, { max: 1 })
const db = drizzle(client, { schema })

// ── Utilidades deterministas ────────────────────────────────────────────────

/** PRNG con semilla: mismas corridas, mismos datos. */
let seed = 20260802
function rnd() {
  seed = (seed * 1664525 + 1013904223) % 4294967296
  return seed / 4294967296
}
const int = (min: number, max: number) => Math.floor(rnd() * (max - min + 1)) + min
const pick = <T,>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)]!
const chance = (p: number) => rnd() < p

const TODAY = new Date("2026-08-02T12:00:00.000Z")
const daysAgo = (n: number) => new Date(TODAY.getTime() - n * 86_400_000)
const iso = (d: Date) => d.toISOString()
const day = (d: Date) => d.toISOString().slice(0, 10)

let counter = 0
const id = (prefix: string) => `demo-${prefix}-${(++counter).toString(36).padStart(5, "0")}`

/**
 * Tablas operacionales que este script posee y reescribe en cada corrida.
 *
 * Se vacían al empezar para que el generador sea **idempotente**: como los ids
 * son deterministas, una segunda corrida sin esto choca contra su propia clave
 * primaria. El orden no importa: `CASCADE` resuelve las dependencias.
 */
const TABLAS_DEMO = [
  "purchase_requests", "purchase_orders", "receipts", "deliveries",
  "worksite_stock", "approval_decisions", "inventory_movements",
  "fuel_loads", "maintenance_records", "fleet_vehicle_documents", "fuel_vehicles",
  "prevention_incidents", "prevention_capa_actions", "safety_indicators",
  "sst_documents", "prevention_inspection_runs", "prevention_work_permits",
  "prevention_emergency_drills", "prevention_committees", "prevention_change_requests",
  "prevention_exposure_groups", "prevention_exposure_agents",
  "ppa_submissions", "operational_metric_snapshots",
  "safety_indicator_denominators", "prevention_incident_people",
]

async function main() {
  console.log("Generando entorno de demostración…")

  await db.execute(sql.raw(`TRUNCATE ${TABLAS_DEMO.join(", ")} CASCADE`))
  console.log(`  Limpieza: ${TABLAS_DEMO.length} tablas operacionales vaciadas`)

  const worksites = await db.select().from(schema.worksites)
  const workers = await db.select().from(schema.workers)
  const products = await db.select().from(schema.products)
  const suppliers = await db.select().from(schema.suppliers)

  if (worksites.length === 0 || products.length === 0) {
    console.error("Falta el seed base. Corre `npm run db:seed` primero.")
    process.exit(1)
  }
  console.log(`  Base: ${worksites.length} faenas · ${workers.length} trabajadores · ${products.length} productos`)

  // ── Usuarios: uno por rol, para poder entrar como cada perfil ─────────────
  const password = await bcrypt.hash("chome2026", 10)
  const usuarios = SYSTEM_ROLES.map((role, index) => ({
    id: `demo-user-${role.name}`,
    name: role.label,
    email: `${role.name.replace(/_/g, ".")}@chome.cl`,
    hashedPassword: password,
    avatarColor: String(140 + index * 17),
    isActive: true,
    createdAt: iso(daysAgo(200)),
    updatedAt: iso(daysAgo(200)),
  }))
  await db.insert(schema.users).values(usuarios).onConflictDoNothing()
  await db.insert(schema.userRoles)
    .values(SYSTEM_ROLES.map((role) => ({ userId: `demo-user-${role.name}`, roleId: role.id })))
    .onConflictDoNothing()

  // Los roles de faena se asignan a las tres primeras; los globales ven todo.
  const faenasDeRolLocal = worksites.slice(0, 3)
  await db.insert(schema.worksiteUsers).values(
    SYSTEM_ROLES.filter((role) => !role.isGlobal).flatMap((role) =>
      faenasDeRolLocal.map((ws, i) => ({ userId: `demo-user-${role.name}`, worksiteId: ws.id, isPrimary: i === 0 })),
    ),
  ).onConflictDoNothing()
  console.log(`  Usuarios: ${usuarios.length} (uno por rol, clave chome2026)`)

  const admin = "demo-user-administrador"
  const jefa = "demo-user-jefa_chome"

  // ── Centros de costo y proveedores de servicio ────────────────────────────
  const costCenters = worksites.map((ws, i) => ({
    id: id("cc"),
    code: `CC-${String(i + 1).padStart(3, "0")}`,
    name: `Centro de costos ${ws.name}`,
    isActive: true,
    createdAt: iso(daysAgo(200)),
    updatedAt: iso(daysAgo(200)),
  }))
  await db.insert(schema.costCenters).values(costCenters).onConflictDoNothing()

  // ── Equipos de servicio: monogás y alcotest por faena ─────────────────────
  // Sin ellos, "Mantención de monogás" y "Calibración de alcotest" no se pueden
  // solicitar: el ítem exige un equipo del registro.
  const equipmentRows: (typeof schema.serviceEquipment.$inferInsert)[] = []
  for (const [index, ws] of worksites.entries()) {
    equipmentRows.push(
      {
        id: id("eq"),
        code: `MG-${String(index + 1).padStart(3, "0")}`,
        name: `Detector monogás H2S ${ws.name}`,
        kind: "monogas",
        brand: "Dräger",
        model: "Pac 6500",
        serialNumber: `MG${String(index + 1).padStart(4, "0")}-DEMO`,
        worksiteId: ws.id,
        isActive: true,
        createdAt: iso(daysAgo(180)),
        updatedAt: iso(daysAgo(180)),
      },
      {
        id: id("eq"),
        code: `ALC-${String(index + 1).padStart(3, "0")}`,
        name: `Alcotest de bolsillo ${ws.name}`,
        kind: "alcotest",
        brand: "Dräger",
        model: "Alcotest 3820",
        serialNumber: `ALC${String(index + 1).padStart(4, "0")}-DEMO`,
        worksiteId: ws.id,
        isActive: true,
        createdAt: iso(daysAgo(180)),
        updatedAt: iso(daysAgo(180)),
      },
    )
  }
  await db.insert(schema.serviceEquipment).values(equipmentRows).onConflictDoNothing()
  console.log(`  Equipos de servicio: ${equipmentRows.length}`)

  // ── Stock por faena, con mínimos y algunos bajo el mínimo ─────────────────
  const stockRows: (typeof schema.worksiteStock.$inferInsert)[] = []
  for (const ws of worksites) {
    for (const product of products.slice(0, 40)) {
      const minStock = int(5, 40)
      // ~18% bajo el mínimo: el tablero necesita alertas reales, no todas.
      const quantity = chance(0.18) ? int(0, minStock - 1) : int(minStock, minStock * 4)
      stockRows.push({
        id: id("stk"),
        worksiteId: ws.id,
        productId: product.id,
        quantity,
        minStock,
        lastMovementAt: iso(daysAgo(int(0, 60))),
        updatedAt: iso(daysAgo(int(0, 30))),
      })
    }
  }
  await db.insert(schema.worksiteStock).values(stockRows).onConflictDoNothing()
  console.log(`  Stock: ${stockRows.length} filas (~18% bajo el mínimo)`)


  // ── Adquisiciones: 6 meses de solicitudes → OC → recepción → entrega ──────
  const requests: (typeof schema.purchaseRequests.$inferInsert)[] = []
  const requestItems: (typeof schema.purchaseRequestItems.$inferInsert)[] = []
  const orders: (typeof schema.purchaseOrders.$inferInsert)[] = []
  const orderItems: (typeof schema.purchaseOrderItems.$inferInsert)[] = []
  const receipts: (typeof schema.receipts.$inferInsert)[] = []
  const receiptItems: (typeof schema.receiptItems.$inferInsert)[] = []
  const deliveries: (typeof schema.deliveries.$inferInsert)[] = []
  const deliveryItems: (typeof schema.deliveryItems.$inferInsert)[] = []
  const decisions: (typeof schema.approvalDecisions.$inferInsert)[] = []

  /*
   * El embudo imita la realidad: no toda solicitud llega a OC ni toda OC se
   * recibe completa. Sin esa merma el tablero mostraría un flujo perfecto y
   * los KPIs de backlog y de rechazo quedarían en cero, que es justo lo que
   * hace imposible juzgar la pantalla.
   */
  for (let d = 180; d >= 0; d--) {
    // Más actividad en días hábiles; el fin de semana casi nada.
    const date = daysAgo(d)
    const weekday = date.getUTCDay()
    const nRequests = weekday === 0 || weekday === 6 ? int(0, 1) : int(1, 4)

    for (let r = 0; r < nRequests; r++) {
      const ws = pick(worksites)
      const requestId = id("req")
      const createdAt = new Date(date.getTime() + int(8, 18) * 3_600_000)
      // Las recientes siguen en curso; las viejas casi todas cerraron.
      const status = d < 20
        ? pick(["draft", "submitted", "in_review", "partially_approved", "approved", "in_purchasing"] as const)
        : d < 60 ? pick(["in_purchasing", "approved", "closed", "closed", "rejected"] as const)
        : pick(["closed", "closed", "closed", "rejected"] as const)

      requests.push({
        id: requestId,
        code: `SOL-${day(date).replace(/-/g, "")}-${r + 1}`,
        worksiteId: ws.id,
        requesterId: pick([admin, jefa, "demo-user-solicitante_faena"]),
        status,
        urgency: chance(0.08) ? "critical" : chance(0.2) ? "high" : "normal",
        requiredDate: day(daysAgo(d - int(5, 25))),
        notes: null,
        submittedAt: status === "draft" ? null : iso(createdAt),
        closedAt: status === "closed" ? iso(daysAgo(Math.max(0, d - int(3, 15)))) : null,
        createdAt: iso(createdAt),
        updatedAt: iso(createdAt),
      })

      const nItems = int(1, 4)
      for (let i = 0; i < nItems; i++) {
        const product = pick(products)
        const itemStatus = status === "draft" ? "draft"
          : status === "rejected" ? "rejected"
          : status === "closed" ? "delivered"
          : pick(["requested", "approved", "pending_purchase", "in_purchase_order"] as const)
        requestItems.push({
          id: id("ri"),
          requestId,
          productId: product.id,
          quantity: int(1, 20),
          status: itemStatus,
          urgency: chance(0.15) ? "high" : "normal",
          requiredDate: day(daysAgo(d - int(5, 25))),
          createdAt: iso(createdAt),
          updatedAt: iso(createdAt),
        })
        if (itemStatus !== "draft" && itemStatus !== "requested" && chance(0.7)) {
          decisions.push({
            id: id("dec"),
            requestItemId: requestItems.at(-1)!.id!,
            decidedBy: jefa,
            type: itemStatus === "rejected" ? "reject" : "approve",
            roleContext: "jefa_chome",
            decidedAt: iso(new Date(createdAt.getTime() + int(4, 72) * 3_600_000)),
          })
        }
      }
    }
  }

  await db.insert(schema.purchaseRequests).values(requests)
  await db.insert(schema.purchaseRequestItems).values(requestItems)
  await db.insert(schema.approvalDecisions).values(decisions).onConflictDoNothing()
  console.log(`  Adquisiciones: ${requests.length} solicitudes · ${requestItems.length} ítems · ${decisions.length} decisiones`)


  /*
   * Órdenes de compra sobre los ítems que llegaron a compra.
   *
   * Se agrupan por (faena, proveedor) como en la operación real: una OC junta
   * varios ítems del mismo proveedor, no uno por solicitud.
   */
  const comprables = requestItems.filter((item) =>
    item.status === "in_purchase_order" || item.status === "delivered" || item.status === "purchased")

  const porFaena = new Map<string, typeof comprables>()
  for (const item of comprables) {
    const req = requests.find((r) => r.id === item.requestId)!
    const key = req.worksiteId
    if (!porFaena.has(key)) porFaena.set(key, [])
    porFaena.get(key)!.push(item)
  }

  let ocSeq = 0
  for (const [worksiteId, items] of porFaena) {
    // Lotes de 2 a 5 ítems por OC.
    for (let i = 0; i < items.length; i += int(2, 5)) {
      const lote = items.slice(i, i + int(2, 5))
      if (lote.length === 0) continue
      const d = int(0, 175)
      const issued = daysAgo(d)
      const supplier = pick(suppliers)
      const orderId = id("oc")
      ocSeq++

      // Las viejas cerraron; las nuevas están en tránsito. Sin este reparto,
      // "OC activas" y "Por recibir" quedarían en cero o en todo.
      const status = d < 15 ? pick(["draft", "sent", "sent", "partially_office_received"] as const)
        : d < 45 ? pick(["sent", "partially_received", "office_received", "received"] as const)
        : pick(["received", "closed", "closed"] as const)

      let net = 0
      const itemsDeOc: typeof orderItems = []
      // DAT-12: el contador de la línea (quantityReceived/quantityOfficeReceived)
      // y la suma de sus receipt_items son la misma cifra en producción (un solo
      // writer serializado, sólo suma lo bueno) — aquí se calcula la merma una
      // sola vez, antes de sembrar ambas fuentes, para que el receptor no tope
      // con un CHECK descuadrado al abrir datos demo.
      const disposicionByItemId = new Map<string, { rechazado: number; danado: number }>()
      for (const [k, item] of lote.entries()) {
        const unitPrice = int(3, 180) * 1000
        const quantity = item.quantity as number
        const subtotal = unitPrice * quantity
        net += subtotal
        const recibidoBruto = status === "closed" || status === "received"
          ? quantity
          : status === "partially_received" ? Math.floor(quantity / 2) : 0
        const rechazado = recibidoBruto > 0 && chance(0.06) ? int(1, Math.max(1, Math.floor(recibidoBruto * 0.2))) : 0
        const danado = recibidoBruto > 0 && chance(0.04) ? int(1, Math.max(1, Math.floor(recibidoBruto * 0.15))) : 0
        const recibido = Math.max(0, recibidoBruto - rechazado - danado)
        const itemId = id("oci")
        disposicionByItemId.set(itemId, { rechazado, danado })
        itemsDeOc.push({
          id: itemId,
          purchaseOrderId: orderId,
          requestItemId: item.id,
          productId: item.productId,
          quantity,
          unitPrice,
          subtotal,
          quantityOfficeReceived: recibido,
          quantityReceived: recibido,
          // ARQ-12: purchase_order_items.status sólo es 'issued'/'cancelled' —
          // la recepción ya la representan quantityOfficeReceived/quantityReceived.
          status: "issued",
          sortOrder: k,
        })
      }

      const tax = Math.round(net * 0.19)
      orders.push({
        id: orderId,
        code: `OC-2026-${String(ocSeq).padStart(4, "0")}`,
        worksiteId,
        supplierId: supplier.id,
        createdBy: admin,
        status,
        // Una OC en borrador todavía no se emitió ni se envió: sin estas fechas
        // la bandeja de compras la ordena por createdAt, como en producción.
        issuedAt: status === "draft" ? null : day(issued),
        issuedBy: status === "draft" ? null : admin,
        sentAt: status === "draft" ? null : day(issued),
        estimatedDelivery: day(daysAgo(d - int(5, 20))),
        netAmount: net,
        taxAmount: tax,
        totalAmount: net + tax,
        closedAt: status === "closed" ? iso(daysAgo(Math.max(0, d - int(2, 10)))) : null,
        createdAt: iso(issued),
        updatedAt: iso(issued),
      })
      orderItems.push(...itemsDeOc)

      // Recepción de las que ya llegaron, con merma real: ~6% rechazado o dañado.
      if (["partially_received", "office_received", "received", "closed"].includes(status)) {
        const receiptId = id("rec")
        const recibidoAt = daysAgo(Math.max(0, d - int(2, 12)))
        receipts.push({
          id: receiptId,
          code: `REC-2026-${String(ocSeq).padStart(4, "0")}`,
          purchaseOrderId: orderId,
          receivedBy: admin,
          receivedAt: iso(recibidoAt),
          locationType: chance(0.5) ? "office" : "faena",
          worksiteId,
          status: status === "closed" ? "closed" : "open",
          createdAt: iso(recibidoAt),
        })
        for (const oci of itemsDeOc) {
          const q = oci.quantityReceived as number
          const { rechazado, danado } = disposicionByItemId.get(oci.id!)!
          if (q <= 0 && rechazado <= 0 && danado <= 0) continue
          receiptItems.push({
            id: id("reci"),
            receiptId,
            purchaseOrderItemId: oci.id!,
            quantityReceived: q,
            quantityRejected: rechazado,
            quantityDamaged: danado,
            status: rechazado > 0 ? "partially_received" : "received",
          })
        }
      }
    }
  }

  await db.insert(schema.purchaseOrders).values(orders)
  await db.insert(schema.purchaseOrderItems).values(orderItems)
  await db.insert(schema.receipts).values(receipts)
  await db.insert(schema.receiptItems).values(receiptItems)
  console.log(`  Compras: ${orders.length} OC · ${orderItems.length} líneas · ${receipts.length} recepciones · ${receiptItems.length} ítems recibidos`)

  // ── Entregas a trabajador y a faena ──────────────────────────────────────
  let entSeq = 0
  for (let d = 170; d >= 0; d--) {
    if (chance(0.45)) continue
    const ws = pick(worksites)
    const worker = pick(workers)
    const deliveryId = id("ent")
    const at = daysAgo(d)
    entSeq++
    const aTrabajador = chance(0.7)
    deliveries.push({
      id: deliveryId,
      code: `ENT-2026-${String(entSeq).padStart(4, "0")}`,
      deliveredBy: admin,
      deliveredAt: iso(at),
      destinationType: aTrabajador ? "worker" : "faena",
      worksiteId: ws.id,
      workerId: aTrabajador ? worker.id : null,
      receiverName: aTrabajador ? `${worker.firstName} ${worker.lastName}` : null,
      createdAt: iso(at),
    })
    for (let i = 0; i < int(1, 3); i++) {
      const cantidad = int(1, 6)
      deliveryItems.push({
        id: id("enti"),
        deliveryId,
        productId: pick(products).id,
        quantity: cantidad,
        // ~12% vuelve: es lo que alimenta la tasa de devolución de EPP.
        returnQuantity: chance(0.12) ? int(1, cantidad) : 0,
        returnReason: chance(0.12) ? pick(["desgastado", "dañado", "vencido"] as const) : null,
      })
    }
  }
  await db.insert(schema.deliveries).values(deliveries)
  await db.insert(schema.deliveryItems).values(deliveryItems)
  console.log(`  Entregas: ${deliveries.length} · ${deliveryItems.length} ítems`)


  // ── Flota, combustible y mantención ──────────────────────────────────────
  /*
   * El catálogo de combustible (tipos de equipo, proveedores, productos) ya
   * viene con las migraciones: 15 tipos, 2 proveedores, 3 productos. Se leen en
   * vez de crearlos — un primer intento los insertó con `onConflictDoNothing` y
   * el choque de `slug` los descartó en silencio, dejando las patentes
   * apuntando a tipos inexistentes.
   */
  const equipmentTypes = await db.select().from(schema.fuelEquipmentTypes)
  const fuelSuppliers = await db.select().from(schema.fuelSuppliers)
  const fuelProducts = await db.select().from(schema.fuelProducts)
  const tiposConMedidor = equipmentTypes.filter((t) => t.defaultMeterType !== "none")

  if (tiposConMedidor.length === 0 || fuelSuppliers.length === 0 || fuelProducts.length === 0) {
    console.error("Falta el catálogo de combustible; revisa las migraciones.")
    process.exit(1)
  }

  const vehicles: (typeof schema.fuelVehicles.$inferInsert)[] = []
  const vehicleDocs: (typeof schema.fleetVehicleDocuments.$inferInsert)[] = []
  for (let v = 0; v < 18; v++) {
    const tipo = pick(tiposConMedidor)
    const ws = pick(worksites)
    const vehicleId = id("veh")
    vehicles.push({
      id: vehicleId,
      plate: `DEMO${String(v + 10).padStart(2, "0")}`,
      code: `EQ-${String(v + 1).padStart(3, "0")}`,
      type: tipo.name,
      equipmentTypeId: tipo.id,
      meterType: tipo.defaultMeterType,
      performanceUnit: tipo.defaultPerformanceUnit,
      worksiteId: ws.id,
      brand: pick(["Volvo", "Caterpillar", "Toyota", "Scania"] as const),
      year: int(2015, 2025),
      isActive: true,
      createdAt: iso(daysAgo(400)),
      updatedAt: iso(daysAgo(30)),
    })
    // Vencimientos escalonados: unos ya vencidos, otros dentro de 30 días.
    for (const tipoDoc of ["Revisión técnica", "Permiso de circulación", "Seguro"] as const) {
      vehicleDocs.push({
        id: id("vdoc"),
        vehicleId,
        documentType: tipoDoc,
        fileName: `${tipoDoc}.pdf`,
        filePath: `/demo/${vehicleId}-${tipoDoc}.pdf`,
        expiresAt: day(daysAgo(chance(0.15) ? int(1, 40) : -int(1, 200))),
        uploadedBy: admin,
        createdAt: iso(daysAgo(200)),
      })
    }
  }
  await db.insert(schema.fuelVehicles).values(vehicles)
  await db.insert(schema.fleetVehicleDocuments).values(vehicleDocs)

  const fuelLoads: (typeof schema.fuelLoads.$inferInsert)[] = []
  const maintenances: (typeof schema.maintenanceRecords.$inferInsert)[] = []
  const odometros = new Map(vehicles.map((v) => [v.id!, int(20_000, 90_000)]))

  for (let d = 180; d >= 0; d--) {
    const fecha = daysAgo(d)
    for (let c = 0; c < int(0, 4); c++) {
      const veh = pick(vehicles)
      const litros = int(40, 320)
      const precio = int(900, 1250)
      // El odómetro sube con el tiempo: sin eso, el costo por km no se puede calcular.
      const km = odometros.get(veh.id!)! + int(80, 600)
      odometros.set(veh.id!, km)
      const esHorometro = veh.performanceUnit === "liters_per_hour"
      fuelLoads.push({
        id: id("fl"),
        loadDate: day(fecha),
        month: day(fecha).slice(0, 7),
        serviceType: chance(0.25) ? "TAE" : "TCT",
        vehicleId: veh.id!,
        fuelSupplierId: pick(fuelSuppliers).id,
        worksiteId: veh.worksiteId!,
        product: pick(fuelProducts).name,
        productId: pick(fuelProducts).id,
        odometerReading: esHorometro ? null : km,
        hourMeterReading: esHorometro ? Math.round(km / 40) : null,
        liters: litros,
        baseAmount: litros * precio,
        totalAmount: Math.round(litros * precio * 1.19),
        status: "registered",
        createdBy: admin,
        createdAt: iso(fecha),
        updatedAt: iso(fecha),
      })
    }
    if (chance(0.12)) {
      const veh = pick(vehicles)
      const neto = int(80, 900) * 1000
      const completada = d > 10
      maintenances.push({
        id: id("mant"),
        vehicleId: veh.id!,
        worksiteId: veh.worksiteId!,
        maintenanceDate: day(fecha),
        maintenanceType: pick(["Preventiva", "Correctiva", "Cambio de aceite"] as const),
        status: completada ? "completed" : "scheduled",
        odometerReading: odometros.get(veh.id!) ?? null,
        netAmount: neto,
        taxAmount: Math.round(neto * 0.19),
        totalAmount: Math.round(neto * 1.19),
        createdBy: admin,
        createdAt: iso(fecha),
        updatedAt: iso(fecha),
      })
    }
  }
  await db.insert(schema.fuelLoads).values(fuelLoads)
  await db.insert(schema.maintenanceRecords).values(maintenances)
  console.log(`  Flota: ${vehicles.length} equipos · ${vehicleDocs.length} documentos · ${fuelLoads.length} cargas · ${maintenances.length} mantenciones`)


  // ── Prevención: incidentes, CAPA e indicadores SST ───────────────────────
  const incidents: (typeof schema.preventionIncidents.$inferInsert)[] = []
  for (let i = 0; i < 34; i++) {
    const d = int(0, 300)
    const ocurrio = daysAgo(d)
    // Los recientes siguen abiertos; los viejos cerraron. Y ~9% son graves.
    const status = d < 25 ? pick(["reported", "triage", "immediate_measures", "under_investigation"] as const)
      : d < 90 ? pick(["under_investigation", "pending_capa", "pending_verification", "closed"] as const)
      : "closed"
    incidents.push({
      id: id("inc"),
      code: `INC-2026-${String(i + 1).padStart(4, "0")}`,
      clientSubmissionId: id("csub"),
      worksiteId: pick(worksites).id,
      companyName: "Chome",
      eventType: pick(["work_accident", "dangerous_incident", "material_damage", "vehicle_event", "environmental_spill"] as const),
      status,
      occurredAt: iso(ocurrio),
      knownAt: iso(ocurrio),
      location: pick(["Frente de carga", "Taller", "Patio de acopio", "Ruta interna"] as const),
      initialNarrative: "Evento registrado en el entorno de demostración.",
      reportedByUserId: pick([admin, jefa]),
      isFatalOrSerious: chance(0.09),
      closedAt: status === "closed" ? iso(daysAgo(Math.max(0, d - int(5, 30)))) : null,
      createdAt: iso(ocurrio),
      updatedAt: iso(ocurrio),
    })
  }
  await db.insert(schema.preventionIncidents).values(incidents)

  const capas: (typeof schema.preventionCapaActions.$inferInsert)[] = []
  for (let i = 0; i < 60; i++) {
    const d = int(0, 200)
    const creada = daysAgo(d)
    // El plazo cae antes de hoy en ~1 de cada 3: así "CAPA vencidas" no es cero.
    const plazo = daysAgo(d - int(10, 45))
    const status = d < 20 ? pick(["pending", "in_progress"] as const)
      : d < 80 ? pick(["in_progress", "pending_verification", "verified", "reopened"] as const)
      : pick(["closed", "closed", "verified"] as const)
    const fuente = pick(incidents)
    capas.push({
      id: id("capa"),
      code: `CAPA-2026-${String(i + 1).padStart(4, "0")}`,
      sourceType: pick(["incident", "inspection", "pdtp", "cphs", "manual"] as const),
      sourceId: fuente.id!,
      worksiteId: fuente.worksiteId!,
      finding: "Hallazgo del entorno de demostración.",
      actionDescription: "Acción correctiva planificada.",
      responsibleUserId: pick([admin, jefa]),
      priority: pick(["low", "medium", "high", "critical"] as const),
      targetDate: day(plazo),
      status,
      requiresImmediateStop: chance(0.08),
      closedAt: status === "closed" ? iso(daysAgo(Math.max(0, d - int(5, 20)))) : null,
      createdByUserId: admin,
      createdAt: iso(creada),
      updatedAt: iso(creada),
    })
  }
  await db.insert(schema.preventionCapaActions).values(capas)

  // Indicadores de accidentabilidad: 12 meses por faena, con horas hombre reales.
  const indicadores: (typeof schema.safetyIndicators.$inferInsert)[] = []
  for (const ws of worksites) {
    for (let m = 1; m <= 8; m++) {
      const trabajadores = int(25, 120)
      const ctp = chance(0.3) ? int(1, 3) : 0
      indicadores.push({
        id: id("si"),
        worksiteId: ws.id,
        year: 2026,
        month: m,
        trabajadores,
        horasHombre: trabajadores * 180,
        accConTiempoPerdido: ctp,
        accSinTiempoPerdido: chance(0.4) ? int(1, 4) : 0,
        diasPerdidos: ctp * int(3, 30),
        incidentes: int(0, 6),
        danoMaterial: chance(0.3) ? int(1, 3) : 0,
        danoAmbiental: chance(0.15) ? int(1, 2) : 0,
        createdAt: iso(daysAgo(240 - m * 30)),
        updatedAt: iso(daysAgo(240 - m * 30)),
      })
    }
  }
  await db.insert(schema.safetyIndicators).values(indicadores)
  console.log(`  Prevención: ${incidents.length} incidentes · ${capas.length} CAPA · ${indicadores.length} meses de indicadores`)


  // ── Control preventivo en terreno ────────────────────────────────────────
  const plantilla = {
    id: id("itpl"), code: "INSP-DEMO", versionLabel: "v1", name: "Inspección planeada",
    kind: "inspection", definitionSnapshot: { items: [] }, contentHash: "d".repeat(64),
    authorUserId: admin, status: "approved" as const,
    // La plantilla aprobada exige quién y cuándo, o la restricción la rechaza.
    approvedByUserId: admin, approvedAt: iso(daysAgo(299)),
    createdAt: iso(daysAgo(300)), updatedAt: iso(daysAgo(300)),
  }
  await db.insert(schema.preventionInspectionTemplates).values(plantilla).onConflictDoNothing()

  const inspections: (typeof schema.preventionInspectionRuns.$inferInsert)[] = []
  const findings: (typeof schema.preventionInspectionFindings.$inferInsert)[] = []
  for (let i = 0; i < 48; i++) {
    const d = int(0, 170)
    const runId = id("insp")
    const revisada = d > 12
    inspections.push({
      id: runId,
      code: `INSP-2026-${String(i + 1).padStart(4, "0")}`,
      templateId: plantilla.id,
      worksiteId: pick(worksites).id,
      status: revisada ? pick(["completed", "reviewed", "reviewed"] as const) : pick(["planned", "in_progress"] as const),
      // Reparto de cumplimiento que hace legible el semáforo: no todo en verde.
      compliancePercent: revisada ? (chance(0.25) ? int(40, 69) : chance(0.35) ? int(70, 84) : int(85, 100)) : null,
      createdByUserId: admin,
      createdAt: iso(daysAgo(d)),
      updatedAt: iso(daysAgo(d)),
    })
    if (revisada) {
      for (let f = 0; f < int(0, 3); f++) {
        findings.push({
          id: id("find"),
          runId,
          description: "Hallazgo de inspección del entorno de demostración.",
          criticality: pick(["low", "medium", "high", "critical"] as const),
          status: chance(0.4) ? "open" : pick(["capa_linked", "closed"] as const),
          createdAt: iso(daysAgo(d)),
          updatedAt: iso(daysAgo(d)),
        })
      }
    }
  }
  await db.insert(schema.preventionInspectionRuns).values(inspections)
  if (findings.length > 0) await db.insert(schema.preventionInspectionFindings).values(findings)

  const tipoPermiso = {
    id: id("ptype"), code: "ALTURA", name: "Trabajo en altura",
    legalBasis: "DS 44", createdByUserId: admin, isActive: true,
    createdAt: iso(daysAgo(300)), updatedAt: iso(daysAgo(300)),
  }
  await db.insert(schema.preventionPermitTypes).values(tipoPermiso).onConflictDoNothing()

  const permits: (typeof schema.preventionWorkPermits.$inferInsert)[] = []
  for (let i = 0; i < 40; i++) {
    const d = int(0, 90)
    const inicio = daysAgo(d)
    permits.push({
      id: id("perm"),
      code: `PT-2026-${String(i + 1).padStart(4, "0")}`,
      permitTypeId: tipoPermiso.id,
      worksiteId: pick(worksites).id,
      taskDescription: "Trabajo en altura sobre estructura.",
      location: "Frente de trabajo",
      supervisorUserId: admin,
      requestedByUserId: admin,
      plannedStartAt: iso(inicio),
      plannedEndAt: iso(new Date(inicio.getTime() + 8 * 3_600_000)),
      status: d < 3 ? pick(["active", "active", "suspended"] as const)
        : d < 10 ? pick(["approved", "active", "closed"] as const) : "closed",
      createdAt: iso(inicio),
      updatedAt: iso(inicio),
    })
  }
  await db.insert(schema.preventionWorkPermits).values(permits)

  const plan = {
    id: id("eplan"), code: "PE-DEMO", worksiteId: worksites[0]!.id, title: "Plan de emergencia",
    status: "approved" as const, createdByUserId: admin,
    approvedByUserId: admin, approvedAt: iso(daysAgo(299)),
    createdAt: iso(daysAgo(300)), updatedAt: iso(daysAgo(300)),
  }
  await db.insert(schema.preventionEmergencyPlans).values(plan).onConflictDoNothing()

  const drills: (typeof schema.preventionEmergencyDrills.$inferInsert)[] = []
  for (let i = 0; i < 14; i++) {
    const d = int(10, 200)
    const ejecutado = chance(0.8)
    drills.push({
      id: id("drill"),
      planId: plan.id,
      worksiteId: pick(worksites).id,
      scenarioType: pick(["incendio", "derrame", "sismo", "rescate", "fuga"] as const),
      scheduledFor: day(daysAgo(d)),
      status: ejecutado ? "completed" : "scheduled",
      executedAt: ejecutado ? iso(daysAgo(d)) : null,
      // ~35% sale "por mejorar": el KPI necesita señal, no todo satisfactorio.
      outcome: ejecutado ? (chance(0.35) ? "needs_improvement" : "satisfactory") : null,
      createdByUserId: admin,
      createdAt: iso(daysAgo(d + 20)),
      updatedAt: iso(daysAgo(d)),
    })
  }
  await db.insert(schema.preventionEmergencyDrills).values(drills)

  // Comité paritario: sesiones con acuerdos abiertos.
  const comites = worksites.slice(0, 4).map((ws) => ({
    id: id("cphs"), worksiteId: ws.id, name: `CPHS ${ws.name}`,
    constitutedOn: day(daysAgo(300)), mandateEndsOn: day(daysAgo(-400)),
    status: "active" as const, createdByUserId: admin,
    createdAt: iso(daysAgo(300)), updatedAt: iso(daysAgo(300)),
  }))
  await db.insert(schema.preventionCommittees).values(comites)

  const meetings: (typeof schema.preventionCommitteeMeetings.$inferInsert)[] = []
  const agreements: (typeof schema.preventionCommitteeAgreements.$inferInsert)[] = []
  for (const comite of comites) {
    for (let m = 0; m < 5; m++) {
      const meetingId = id("cmeet")
      const d = 30 * m + int(1, 10)
      meetings.push({
        id: meetingId, code: `ACT-${comite.id.slice(-4)}-${m + 1}`, committeeId: comite.id,
        scheduledFor: day(daysAgo(d)), agenda: "Revisión mensual del comité.",
        status: "closed", closedAt: iso(daysAgo(d)),
        createdByUserId: admin, createdAt: iso(daysAgo(d)), updatedAt: iso(daysAgo(d)),
      })
      for (let a = 0; a < int(1, 3); a++) {
        agreements.push({
          id: id("cagr"), meetingId,
          description: "Acuerdo del comité paritario.",
          status: chance(0.4) ? "open" : pick(["capa_linked", "closed"] as const),
          createdAt: iso(daysAgo(d)), updatedAt: iso(daysAgo(d)),
        })
      }
    }
  }
  await db.insert(schema.preventionCommitteeMeetings).values(meetings)
  await db.insert(schema.preventionCommitteeAgreements).values(agreements)

  // Higiene: agentes, GES y mediciones, algunas sobre el límite.
  const agentes = [
    { id: id("agt"), code: "RUIDO", name: "Ruido", agentType: "physical", unit: "dB(A)", limitBasis: "jornada", permissibleLimit: "82.0000" },
    { id: id("agt"), code: "SILICE", name: "Sílice", agentType: "chemical", unit: "mg/m3", limitBasis: "jornada", permissibleLimit: "0.0800" },
  ].map((a) => ({ ...a, createdByUserId: admin, createdAt: iso(daysAgo(300)), updatedAt: iso(daysAgo(300)) }))
  await db.insert(schema.preventionExposureAgents).values(agentes)

  const grupos = worksites.slice(0, 5).flatMap((ws) => agentes.map((agente) => ({
    id: id("ges"), code: `GES-${ws.code ?? ws.id}-${agente.code}`, name: `GES ${agente.name}`,
    worksiteId: ws.id, agentId: agente.id, processDescription: "Grupo de exposición similar.",
    isActive: true, createdByUserId: admin, createdAt: iso(daysAgo(280)), updatedAt: iso(daysAgo(280)),
  })))
  await db.insert(schema.preventionExposureGroups).values(grupos)

  const mediciones = grupos.flatMap((grupo) => Array.from({ length: int(1, 3) }, () => {
    const agente = agentes.find((a) => a.id === grupo.agentId)!
    const limite = Number(agente.permissibleLimit)
    const sobre = chance(0.22)
    return {
      id: id("meas"), groupId: grupo.id, measuredOn: day(daysAgo(int(5, 180))),
      value: (sobre ? limite * 1.3 : limite * 0.6).toFixed(4),
      unit: agente.unit,
      permissibleLimitSnapshot: limite.toFixed(4),
      outcome: sobre ? "above_limit" as const : chance(0.3) ? "above_action" as const : "below_action" as const,
      method: "NCh", equipmentTag: "EQ-DEMO",
      recordedByUserId: admin, createdAt: iso(daysAgo(60)),
    }
  }))
  await db.insert(schema.preventionExposureMeasurements).values(mediciones)

  const cambios = Array.from({ length: 12 }, (_, i) => {
    const d = int(5, 200)
    return {
      id: id("chg"), worksiteId: pick(worksites).id, code: `GC-2026-${String(i + 1).padStart(3, "0")}`,
      title: "Cambio operacional", changeType: pick(["proceso", "equipo", "instalacion", "procedimiento", "dotacion"] as const),
      description: "Cambio evaluado según DS 44 art. 15.", reason: "Mejora operacional.",
      riskLevel: pick(["low", "medium", "high"] as const),
      ...(d < 40
        ? { status: pick(["draft", "under_evaluation"] as const) }
        : {
            // Un cambio aprobado exige aprobador y fecha, o la restricción lo rechaza.
            status: pick(["approved", "implemented", "closed"] as const),
            approvedByUserId: jefa,
            approvedAt: iso(daysAgo(Math.max(0, d - 5))),
            // El DS 44 exige fecha de revisión posterior para aprobar un cambio.
            plannedReviewDate: day(daysAgo(d - 60)),
          }),
      requestedByUserId: admin, createdAt: iso(daysAgo(d)), updatedAt: iso(daysAgo(d)),
    }
  })
  await db.insert(schema.preventionChangeRequests).values(cambios)
  console.log(`  Terreno: ${inspections.length} inspecciones · ${findings.length} hallazgos · ${permits.length} permisos · ${drills.length} simulacros · ${agreements.length} acuerdos · ${mediciones.length} mediciones · ${cambios.length} cambios`)


  // ── Instantáneas diarias: sin esto no hay sparklines ni backlog comparado ──
  /*
   * `getOperationalSnapshotHistory` descarta los días **sin cobertura completa**
   * (todas las faenas activas × las 5 métricas), así que hay que escribir la
   * malla entera por día o la serie queda vacía. Es el mismo contrato que
   * verifica `/api/cron/operational-snapshot-health`.
   */
  const METRICAS = ["backlog_requests", "backlog_orders", "backlog_capa", "backlog_pdtp", "stock_alerts"] as const
  const snapshots: (typeof schema.operationalMetricSnapshots.$inferInsert)[] = []
  const nivel = new Map<string, number>()

  for (let d = 45; d >= 0; d--) {
    for (const ws of worksites) {
      for (const metric of METRICAS) {
        const key = `${ws.id}:${metric}`
        // Caminata aleatoria alrededor de un nivel base: una serie plana no
        // dibuja nada y una puramente aleatoria no parece un backlog real.
        const base = nivel.get(key) ?? int(3, 25)
        const siguiente = Math.max(0, base + int(-2, 2))
        nivel.set(key, siguiente)
        snapshots.push({
          id: id("snap"),
          metric,
          worksiteId: ws.id,
          snapshotDate: day(daysAgo(d)),
          value: String(siguiente),
        })
      }
    }
  }
  await db.insert(schema.operationalMetricSnapshots).values(snapshots)
  console.log(`  Instantáneas: ${snapshots.length} filas · 46 días × ${worksites.length} faenas × ${METRICAS.length} métricas`)


  /*
   * El motor canónico de indicadores **no lee** `safety_indicators` (esa tabla es
   * el legado manual): calcula tasas desde las personas lesionadas de cada
   * incidente y los denominadores de horas hombre. Sin estas dos, las tasas de
   * frecuencia y gravedad salen en 0 y sus gráficos quedan planos.
   */
  const denominadores: (typeof schema.safetyIndicatorDenominators.$inferInsert)[] = []
  for (const ws of worksites) {
    for (let m = 1; m <= 8; m++) {
      const trabajadores = int(25, 120)
      denominadores.push({
        id: id("den"),
        worksiteId: ws.id,
        year: 2026,
        month: m,
        workerCount: trabajadores,
        workedHours: trabajadores * 180,
        sourceType: "rrhh",
        sourceReference: "Planilla mensual de demostración",
        status: "approved",
        // Aprobar un denominador exige aprobador, fecha, evidencia y
        // conciliación resuelta: es el dato que sostiene la tasa.
        approvedByUserId: jefa,
        approvedAt: iso(daysAgo(238 - m * 25)),
        evidenceReference: "Planilla RRHH firmada",
        reconciliationStatus: "matched",
        createdByUserId: admin,
        updatedByUserId: admin,
        createdAt: iso(daysAgo(240 - m * 25)),
        updatedAt: iso(daysAgo(240 - m * 25)),
      })
    }
  }
  await db.insert(schema.safetyIndicatorDenominators).values(denominadores)

  // Personas lesionadas: el numerador. `included` entra en la tasa confirmada;
  // `pending` sólo en la provisional — que es la partición del gráfico apilado.
  const lesionados: (typeof schema.preventionIncidentPeople.$inferInsert)[] = []
  for (const incidente of incidents) {
    if (!["work_accident", "commute_accident"].includes(incidente.eventType as string)) continue
    for (let i = 0; i < int(1, 2); i++) {
      const conTiempoPerdido = chance(0.6)
      lesionados.push({
        id: id("pers"),
        incidentId: incidente.id!,
        displayLabel: `Trabajador ${lesionados.length + 1}`,
        employerName: "Chome",
        relationshipType: pick(["employee", "employee", "contractor"] as const),
        absenceAtLeastNormalShift: conTiempoPerdido,
        absenceDays: conTiempoPerdido ? int(2, 25) : 0,
        chargeDays: 0,
        // ~25% queda por calificar: lo que separa la barra confirmada de la total.
        // Clasificar exige motivo, quién y cuándo; `pending` no lleva ninguno.
        ...(chance(0.75)
          ? {
              indicatorInclusionStatus: "included" as const,
              indicatorInclusionReason: "Accidente del trabajo acreditado.",
              indicatorClassifiedByUserId: jefa,
              indicatorClassifiedAt: incidente.occurredAt as string,
            }
          : { indicatorInclusionStatus: "pending" as const }),
        createdAt: incidente.occurredAt as string,
        updatedAt: incidente.occurredAt as string,
      })
    }
  }
  if (lesionados.length > 0) await db.insert(schema.preventionIncidentPeople).values(lesionados)
  console.log(`  Indicadores SST: ${denominadores.length} denominadores · ${lesionados.length} personas lesionadas`)

  await client.end()
  console.log("Listo.")
}

main().catch(async (error) => {
  console.error(error)
  await client.end()
  process.exit(1)
})
