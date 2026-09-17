import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import path from "node:path"
import { describe, expect, it, afterAll } from "vitest"
import { sql } from "drizzle-orm"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
const db = drizzle(pg)

afterAll(async () => {
  await pg.close()
})

describe("database schema consistency", () => {
  it("has the operational-integrity ledger tables and lookup indexes", async () => {
    const tables = await db.execute(sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (
          'purchase_order_invoice_item_allocations',
          'operational_integrity_cases',
          'operational_integrity_observations',
          'operational_integrity_case_events'
        )
    `)
    expect(tables.rows.map((row) => (row as { table_name: string }).table_name).sort()).toEqual([
      "operational_integrity_case_events",
      "operational_integrity_cases",
      "operational_integrity_observations",
      "purchase_order_invoice_item_allocations",
    ])

    const indexes = await db.execute(sql`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'po_invoice_item_allocations_oc_item_idx',
          'po_invoice_item_allocations_pair_unique',
          'operational_integrity_cases_worksite_detected_idx',
          'operational_integrity_cases_domain_code_idx',
          'operational_integrity_observation_fingerprint_unique',
          'operational_integrity_case_events_case_created_idx',
          'operational_integrity_case_events_case_observation_kind_unique'
        )
    `)
    expect(indexes.rows.map((row) => (row as { indexname: string }).indexname).sort()).toEqual([
      "operational_integrity_case_events_case_created_idx",
      "operational_integrity_case_events_case_observation_kind_unique",
      "operational_integrity_cases_domain_code_idx",
      "operational_integrity_cases_worksite_detected_idx",
      "operational_integrity_observation_fingerprint_unique",
      "po_invoice_item_allocations_oc_item_idx",
      "po_invoice_item_allocations_pair_unique",
    ])
  })

  it("has office receiving columns required by the runtime schema", async () => {

    const result = await db.execute(sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'purchase_order_items'
    `)

    const columns = result.rows.map((row) => (row as { column_name: string }).column_name)
    expect(columns).toContain("quantity_office_received")
  })

  it("has the user permissions join table required by direct RBAC grants", async () => {

    const result = await db.execute(sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'user_permissions'
    `)

    const columns = result.rows.map((row) => (row as { column_name: string }).column_name)
    expect(columns).toEqual(expect.arrayContaining(["user_id", "permission_id"]))
  })

  it("rejects negative worksite stock at the database level", async () => {

    await db.execute(sql`
      INSERT INTO worksites (id, name, code, is_active, created_at, updated_at)
      VALUES ('ws-negative-stock-check', 'Faena constraint', 'CHK-STOCK', true, NOW(), NOW())
    `)
    await db.execute(sql`
      INSERT INTO product_categories (id, name, slug)
      VALUES ('cat-negative-stock-check', 'Categoría constraint', 'cat-negative-stock-check')
    `)
    await db.execute(sql`
      INSERT INTO products (id, category_id, sku, name, unit_of_measure, is_active, created_at, updated_at)
      VALUES ('prod-negative-stock-check', 'cat-negative-stock-check', 'CHK-STOCK-1', 'Producto constraint', 'unidad', true, NOW(), NOW())
    `)

    await expect(db.execute(sql`
      INSERT INTO worksite_stock (id, worksite_id, product_id, quantity, min_stock, updated_at)
      VALUES ('stock-negative-check', 'ws-negative-stock-check', 'prod-negative-stock-check', -1, 0, NOW())
    `)).rejects.toThrow()
  })

  it("rejects invalid operational quantities and money at the database level", async () => {
    const fixture = await insertOperationalConstraintFixture("numeric-check")

    await expect(db.execute(sql`
      INSERT INTO purchase_request_items (id, request_id, product_id, quantity, unit_of_measure, status, created_at, updated_at)
      VALUES ('pri-zero-quantity-check', ${fixture.requestId}, ${fixture.productId}, 0, 'unidad', 'draft', NOW(), NOW())
    `)).rejects.toThrow()

    await expect(db.execute(sql`
      INSERT INTO purchase_orders (
      )
      VALUES ('po-negative-money-check', 'OC-negative-money-check', ${fixture.worksiteId}, ${fixture.supplierId}, ${fixture.userId}, 'draft', -1, 0, 0, NOW(), NOW())
    `)).rejects.toThrow()

    await expect(db.execute(sql`
      INSERT INTO purchase_order_items (
        id, purchase_order_id, product_id, quantity, unit_of_measure, unit_price, discount, subtotal,
        quantity_office_received, quantity_received, status, sort_order
      )
      VALUES (
        'poi-invalid-discount-check', ${fixture.orderId}, ${fixture.productId}, 1, 'unidad', 1000, 101, 1000,
        0, 0, 'issued', 0
      )
    `)).rejects.toThrow()

    await expect(db.execute(sql`
      INSERT INTO purchase_order_items (
        id, purchase_order_id, product_id, quantity, unit_of_measure, unit_price, discount, subtotal,
        quantity_office_received, quantity_received, status, sort_order
      )
      VALUES (
        'poi-negative-price-check', ${fixture.orderId}, ${fixture.productId}, 1, 'unidad', -1, 0, 0,
        0, 0, 'issued', 0
      )
    `)).rejects.toThrow()

    // quantity_received is bounded by quantity independently — not by quantity_office_received.
    // (directo_faena orders receive at faena without ever passing through office.)
    await expect(db.execute(sql`
      INSERT INTO purchase_order_items (
        id, purchase_order_id, product_id, quantity, unit_of_measure, unit_price, discount, subtotal,
        quantity_office_received, quantity_received, status, sort_order
      )
      VALUES (
        'poi-invalid-received-check', ${fixture.orderId}, ${fixture.productId}, 5, 'unidad', 1000, 0, 5000,
        0, 6, 'issued', 0
      )
    `)).rejects.toThrow()

    await expect(db.execute(sql`
      INSERT INTO receipt_items (
        id, receipt_id, purchase_order_item_id, quantity_received, quantity_rejected, quantity_damaged, status
      )
      VALUES ('receipt-zero-quantity-check', ${fixture.receiptId}, ${fixture.orderItemId}, 0, 0, 0, 'received')
    `)).rejects.toThrow()

    await expect(db.execute(sql`
      INSERT INTO delivery_items (id, delivery_id, product_id, quantity, unit_of_measure)
      VALUES ('delivery-zero-quantity-check', ${fixture.deliveryId}, ${fixture.productId}, 0, 'unidad')
    `)).rejects.toThrow()
  })

  it("rejects invalid operational states at the database level", async () => {
    const fixture = await insertOperationalConstraintFixture("state-check")

    await expect(db.execute(sql`
      INSERT INTO purchase_requests (id, code, worksite_id, requester_id, request_type, urgency, status, created_at, updated_at)
      VALUES ('request-invalid-status-check', 'SOL-invalid-status-check', ${fixture.worksiteId}, ${fixture.userId}, 'epp', 'normal', 'impossible', NOW(), NOW())
    `)).rejects.toThrow()

    await expect(db.execute(sql`
      INSERT INTO purchase_request_items (id, request_id, product_id, quantity, unit_of_measure, status, created_at, updated_at)
      VALUES ('pri-invalid-status-check', ${fixture.requestId}, ${fixture.productId}, 1, 'unidad', 'impossible', NOW(), NOW())
    `)).rejects.toThrow()

    await expect(db.execute(sql`
      INSERT INTO approval_decisions (id, request_id, type, decided_by, decided_at)
      VALUES ('approval-invalid-type-check', ${fixture.requestId}, 'impossible', ${fixture.userId}, NOW())
    `)).rejects.toThrow()

    await expect(db.execute(sql`
      INSERT INTO purchase_orders (
        id, code, worksite_id, supplier_id, created_by, status, net_amount, tax_amount, total_amount, created_at, updated_at
      )
      VALUES ('po-invalid-status-check', 'OC-invalid-status-check', ${fixture.worksiteId}, ${fixture.supplierId}, ${fixture.userId}, 'impossible', 0, 0, 0, NOW(), NOW())
    `)).rejects.toThrow()

    await expect(db.execute(sql`
      INSERT INTO purchase_order_items (
        id, purchase_order_id, product_id, quantity, unit_of_measure, unit_price, discount, subtotal,
        quantity_office_received, quantity_received, status, sort_order
      )
      VALUES (
        'poi-invalid-status-check', ${fixture.orderId}, ${fixture.productId}, 1, 'unidad', 1000, 0, 1000,
        0, 0, 'impossible', 0
      )
    `)).rejects.toThrow()

    await expect(db.execute(sql`
      INSERT INTO receipts (id, code, purchase_order_id, received_by, location_type, worksite_id, status, created_at)
      VALUES ('receipt-invalid-state-check', 'REC-invalid-state-check', ${fixture.orderId}, ${fixture.userId}, 'warehouse', ${fixture.worksiteId}, 'closed', NOW())
    `)).rejects.toThrow()

    await expect(db.execute(sql`
      INSERT INTO receipts (id, code, purchase_order_id, received_by, location_type, worksite_id, status, created_at)
      VALUES ('receipt-invalid-status-check', 'REC-invalid-status-check', ${fixture.orderId}, ${fixture.userId}, 'office', ${fixture.worksiteId}, 'impossible', NOW())
    `)).rejects.toThrow()

    await expect(db.execute(sql`
      INSERT INTO deliveries (id, code, delivered_by, destination_type, worksite_id, created_at)
      VALUES ('delivery-invalid-destination-check', 'ENT-invalid-destination-check', ${fixture.userId}, 'impossible', ${fixture.worksiteId}, NOW())
    `)).rejects.toThrow()

    await expect(db.execute(sql`
      INSERT INTO inventory_movements (
        id, worksite_id, product_id, type, quantity, stock_before, stock_after, performed_by, performed_at
      )
      VALUES ('movement-invalid-type-check', ${fixture.worksiteId}, ${fixture.productId}, 'impossible', 1, 0, 1, ${fixture.userId}, NOW())
    `)).rejects.toThrow()
  })

  /**
   * I3b (QA 2026-09-17, ronda de arreglos 2/5 de la tarea 1.2 PDTP): ancla en
   * el esquema el `ON DELETE` de columna específica que la migración
   * `0302_pdtp_objective_fk_set_null_column.sql` le dio a
   * `pdtp_activities_objective_same_program_fk` y que `db/schema/prevention/pdtp.ts`
   * NO puede expresar (`ForeignKeyBuilder.onDelete()` sólo acepta un string
   * de acción, sin lista de columnas). El snapshot de `drizzle-kit` tampoco
   * lo distingue — `0301_snapshot.json` y `0302_snapshot.json` son
   * idénticos en esa FK — así que nada en la cadena de migraciones detecta
   * si la 0302 se revierte. Este test es esa red: borra el OBJETIVO (no el
   * programa, que ya cubre `lib/__tests__/pdtp-objectives.test.ts`) y prueba
   * que la actividad sobrevive con `objective_id` en NULL y, sobre todo,
   * `program_id` intacto. Si alguien regenera la FK a la forma sin columna
   * (`ON DELETE SET NULL` a secas), este test se cae con 23502
   * ("null value in column program_id").
   */
  it("borrar un objetivo PDTP deja objective_id en NULL sin tocar program_id (FK 0302)", async () => {
    await db.execute(sql`
      INSERT INTO pdtp_programs (id, year, version, title, elaborated_by_name, elaborated_by_title, created_at, updated_at)
      VALUES ('program-objective-fk-check', 2090, 1, 'Programa constraint', 'Prevencionista', 'Prevencionista', NOW(), NOW())
    `)
    await db.execute(sql`
      INSERT INTO pdtp_objectives (id, program_id, code, name, display_order, created_at, updated_at)
      VALUES ('objective-fk-check', 'program-objective-fk-check', '1', 'Objetivo constraint', 0, NOW(), NOW())
    `)
    await db.execute(sql`
      INSERT INTO pdtp_activities (
        id, program_id, n, activity, program, responsible_slugs, responsible_display,
        objective_id, source_sheet_row, created_at, updated_at
      )
      VALUES (
        'activity-objective-fk-check', 'program-objective-fk-check', 1, 'Actividad constraint', 'Programa constraint',
        '[]'::jsonb, 'Responsable constraint', 'objective-fk-check', 0, NOW(), NOW()
      )
    `)

    await db.execute(sql`DELETE FROM pdtp_objectives WHERE id = 'objective-fk-check'`)

    const rows = await db.execute(sql`
      SELECT program_id, objective_id FROM pdtp_activities WHERE id = 'activity-objective-fk-check'
    `)
    expect(rows.rows).toEqual([{ program_id: "program-objective-fk-check", objective_id: null }])
  })
})

async function insertOperationalConstraintFixture(suffix: string) {
  const userId = `user-${suffix}`
  const worksiteId = `ws-${suffix}`
  const supplierId = `supplier-${suffix}`
  const categoryId = `cat-${suffix}`
  const productId = `prod-${suffix}`
  const requestId = `request-${suffix}`
  const orderId = `order-${suffix}`
  const orderItemId = `order-item-${suffix}`
  const receiptId = `receipt-${suffix}`
  const deliveryId = `delivery-${suffix}`

  await db.execute(sql`
    INSERT INTO users (id, name, email, hashed_password, is_active, created_at, updated_at)
    VALUES (${userId}, 'Constraint User', ${`${suffix}@constraints.local`}, 'hash', true, NOW(), NOW())
  `)
  await db.execute(sql`
    INSERT INTO worksites (id, name, code, is_active, created_at, updated_at)
    VALUES (${worksiteId}, 'Faena constraint', ${`CHK-${suffix}`}, true, NOW(), NOW())
  `)
  await db.execute(sql`
    INSERT INTO suppliers (id, name, rut, is_active, created_at, updated_at)
    VALUES (${supplierId}, 'Proveedor constraint', ${`RUT-${suffix}`}, true, NOW(), NOW())
  `)
  await db.execute(sql`
    INSERT INTO product_categories (id, name, slug)
    VALUES (${categoryId}, 'Categoría constraint', ${`cat-${suffix}`})
  `)
  await db.execute(sql`
    INSERT INTO products (id, category_id, sku, name, unit_of_measure, is_active, created_at, updated_at)
    VALUES (${productId}, ${categoryId}, ${`SKU-${suffix}`}, 'Producto constraint', 'unidad', true, NOW(), NOW())
  `)
  await db.execute(sql`
    INSERT INTO purchase_requests (id, code, worksite_id, requester_id, request_type, urgency, status, created_at, updated_at)
    VALUES (${requestId}, ${`SOL-${suffix}`}, ${worksiteId}, ${userId}, 'epp', 'normal', 'draft', NOW(), NOW())
  `)
  await db.execute(sql`
    INSERT INTO purchase_orders (
      id, code, worksite_id, supplier_id, created_by, status, net_amount, tax_amount, total_amount, created_at, updated_at
    )
    VALUES (${orderId}, ${`OC-${suffix}`}, ${worksiteId}, ${supplierId}, ${userId}, 'sent', 1000, 190, 1190, NOW(), NOW())
  `)
  await db.execute(sql`
    INSERT INTO purchase_order_items (
      id, purchase_order_id, product_id, quantity, unit_of_measure, unit_price, discount, subtotal,
      quantity_office_received, quantity_received, status, sort_order
    )
    VALUES (${orderItemId}, ${orderId}, ${productId}, 5, 'unidad', 1000, 0, 5000, 5, 0, 'issued', 0)
  `)
  await db.execute(sql`
    INSERT INTO receipts (id, code, purchase_order_id, received_by, location_type, worksite_id, status, created_at)
    VALUES (${receiptId}, ${`REC-${suffix}`}, ${orderId}, ${userId}, 'office', ${worksiteId}, 'closed', NOW())
  `)
  await db.execute(sql`
    INSERT INTO deliveries (id, code, delivered_by, destination_type, worksite_id, created_at)
    VALUES (${deliveryId}, ${`ENT-${suffix}`}, ${userId}, 'faena', ${worksiteId}, NOW())
  `)

  return { userId, worksiteId, supplierId, categoryId, productId, requestId, orderId, orderItemId, receiptId, deliveryId }
}
