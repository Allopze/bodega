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
    VALUES (${orderId}, ${`OC-${suffix}`}, ${worksiteId}, ${supplierId}, ${userId}, 'issued', 1000, 190, 1190, NOW(), NOW())
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
