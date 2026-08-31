/**
 * Unit tests for lib/validation/masters.ts — Zod validation schemas
 * for users, worksites, suppliers, products, and workers.
 */

import { describe, it, expect } from "vitest"
import {
  userCreateSchema,
  userUpdateSchema,
  registerUserSchema,
  userInvitationSchema,
  worksiteSchema,
  supplierSchema,
  productCategorySchema,
  productSchema,
  productAttributeSchema,
  workerSchema,
} from "@/lib/validation/masters"

// ── Helper: valid Chilean RUT (algorithmically correct) ───────────────────────
function validRut(): string {
  const body = "12345678"
  let sum = 0
  let mul = 2
  for (let i = body.length - 1; i >= 0; i--) {
    sum += parseInt(body[i]!, 10) * mul
    mul = mul === 7 ? 2 : mul + 1
  }
  const remainder = 11 - (sum % 11)
  const dv = remainder === 11 ? "0" : remainder === 10 ? "K" : String(remainder)
  return `${body}-${dv}`
}

// ═══════════════════════════════════════════════════════════════════════════════
// userCreateSchema
// ═══════════════════════════════════════════════════════════════════════════════

describe("userCreateSchema", () => {
  const valid = {
    email: "test@chome.cl",
    roleIds: ["rol-admin"],
  }

  it("accepts minimal valid payload", () => {
    const result = userCreateSchema.safeParse(valid)
    expect(result.success).toBe(true)
  })

  it("normalizes email to lowercase", () => {
    const result = userCreateSchema.parse({ ...valid, email: "TEST@CHOME.CL" })
    expect(result.email).toBe("test@chome.cl")
  })

  it("rejects invalid email", () => {
    const result = userCreateSchema.safeParse({ ...valid, email: "not-an-email" })
    expect(result.success).toBe(false)
  })

  it("rejects empty roleIds", () => {
    const result = userCreateSchema.safeParse({ ...valid, roleIds: [] })
    expect(result.success).toBe(false)
  })

  it("defaults isActive to true", () => {
    const result = userCreateSchema.parse(valid)
    expect(result.isActive).toBe(true)
  })

  it("defaults expiresInDays to 7", () => {
    const result = userCreateSchema.parse(valid)
    expect(result.expiresInDays).toBe(7)
  })

  it("accepts empty string for name (optional)", () => {
    const result = userCreateSchema.safeParse({ ...valid, name: "" })
    expect(result.success).toBe(true)
  })

  it("accepts an optional worker association", () => {
    const result = userCreateSchema.parse({ ...valid, workerId: "worker-1" })
    expect(result.workerId).toBe("worker-1")
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// userUpdateSchema
// ═══════════════════════════════════════════════════════════════════════════════

describe("userUpdateSchema", () => {
  const valid = {
    id: "user-1",
    name: "Juan Pérez",
    email: "juan@chome.cl",
    roleIds: ["rol-admin"],
  }

  it("accepts valid payload", () => {
    const result = userUpdateSchema.safeParse(valid)
    expect(result.success).toBe(true)
  })

  it("requires id", () => {
    const result = userUpdateSchema.safeParse({ ...valid, id: "" })
    expect(result.success).toBe(false)
  })

  it("requires name >= 2 chars", () => {
    const result = userUpdateSchema.safeParse({ ...valid, name: "J" })
    expect(result.success).toBe(false)
  })

  it("accepts empty password (optional)", () => {
    const result = userUpdateSchema.parse({ ...valid, password: "" })
    expect(result.password).toBe("")
  })

  it("accepts password with >= 8 chars", () => {
    const result = userUpdateSchema.safeParse({ ...valid, password: "12345678" })
    expect(result.success).toBe(true)
  })

  it("rejects password < 8 chars when provided", () => {
    const result = userUpdateSchema.safeParse({ ...valid, password: "12345" })
    expect(result.success).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// registerUserSchema
// ═══════════════════════════════════════════════════════════════════════════════

describe("registerUserSchema", () => {
  const valid = {
    name: "María García",
    email: "maria@example.com",
    password: "secure123",
    confirmPassword: "secure123",
  }

  it("accepts matching passwords", () => {
    const result = registerUserSchema.safeParse(valid)
    expect(result.success).toBe(true)
  })

  it("rejects non-matching passwords", () => {
    const result = registerUserSchema.safeParse({
      ...valid,
      confirmPassword: "different123",
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toContain("confirmPassword")
    }
  })

  it("rejects password < 8 chars", () => {
    const result = registerUserSchema.safeParse({
      ...valid,
      password: "short",
      confirmPassword: "short",
    })
    expect(result.success).toBe(false)
  })

  it("rejects name < 2 chars", () => {
    const result = registerUserSchema.safeParse({ ...valid, name: "M" })
    expect(result.success).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// userInvitationSchema
// ═══════════════════════════════════════════════════════════════════════════════

describe("userInvitationSchema", () => {
  it("accepts valid invitation", () => {
    const result = userInvitationSchema.safeParse({
      email: "invite@chome.cl",
      roleIds: ["rol-sec"],
    })
    expect(result.success).toBe(true)
  })

  it("rejects missing roleIds", () => {
    const result = userInvitationSchema.safeParse({
      email: "invite@chome.cl",
      roleIds: [],
    })
    expect(result.success).toBe(false)
  })

  it("defaults expiresInDays to 7", () => {
    const result = userInvitationSchema.parse({
      email: "invite@chome.cl",
      roleIds: ["rol-sec"],
    })
    expect(result.expiresInDays).toBe(7)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// worksiteSchema
// ═══════════════════════════════════════════════════════════════════════════════

describe("worksiteSchema", () => {
  it("accepts valid worksite", () => {
    const result = worksiteSchema.safeParse({
      name: "Faena Norte",
      code: "FN-01",
    })
    expect(result.success).toBe(true)
  })

  it("uppercases the code", () => {
    const result = worksiteSchema.parse({ name: "Faena", code: "fn-01" })
    expect(result.code).toBe("FN-01")
  })

  it("rejects name < 2 chars", () => {
    const result = worksiteSchema.safeParse({ name: "F", code: "FN" })
    expect(result.success).toBe(false)
  })

  it("rejects empty code", () => {
    const result = worksiteSchema.safeParse({ name: "Faena", code: "" })
    expect(result.success).toBe(false)
  })

  it("defaults isActive to true", () => {
    const result = worksiteSchema.parse({ name: "Faena", code: "FN" })
    expect(result.isActive).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// supplierSchema
// ═══════════════════════════════════════════════════════════════════════════════

describe("supplierSchema", () => {
  it("accepts valid supplier", () => {
    const result = supplierSchema.safeParse({
      name: "Distribuidora Chile",
      rut: validRut(),
    })
    expect(result.success).toBe(true)
  })

  it("rejects name < 2 chars", () => {
    const result = supplierSchema.safeParse({ name: "D" })
    expect(result.success).toBe(false)
  })

  it("rejects invalid email", () => {
    const result = supplierSchema.safeParse({
      name: "Proveedor",
      email: "not-email",
    })
    expect(result.success).toBe(false)
  })

  it("accepts optional fields as empty string", () => {
    const result = supplierSchema.safeParse({
      name: "Proveedor",
      phone: "",
      address: "",
    })
    expect(result.success).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// productCategorySchema
// ═══════════════════════════════════════════════════════════════════════════════

describe("productCategorySchema", () => {
  it("accepts valid category", () => {
    const result = productCategorySchema.safeParse({
      name: "EPP",
      slug: "epp",
    })
    expect(result.success).toBe(true)
  })

  it("lowercases the slug", () => {
    const result = productCategorySchema.parse({ name: "EPP", slug: "EPP" })
    expect(result.slug).toBe("epp")
  })

  it("rejects empty slug", () => {
    const result = productCategorySchema.safeParse({ name: "EPP", slug: "" })
    expect(result.success).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// productSchema
// ═══════════════════════════════════════════════════════════════════════════════

describe("productSchema", () => {
  it("accepts valid product", () => {
    const result = productSchema.safeParse({
      sku: "EPP-001",
      name: "Casco EPP",
      categoryId: "cat-1",
    })
    expect(result.success).toBe(true)
  })

  it("does not expose a manually supplied SKU", () => {
    const result = productSchema.parse({
      sku: "epp-001",
      name: "Casco",
      categoryId: "cat-1",
    })
    expect(result).not.toHaveProperty("sku")
  })

  it("does not require a SKU", () => {
    const result = productSchema.safeParse({
      name: "Casco",
      categoryId: "cat-1",
    })
    expect(result.success).toBe(true)
  })

  it("rejects missing categoryId", () => {
    const result = productSchema.safeParse({
      sku: "EPP-001",
      name: "Casco",
      categoryId: "",
    })
    expect(result.success).toBe(false)
  })

  it("defaults unitOfMeasure to unidad", () => {
    const result = productSchema.parse({
      sku: "EPP-001",
      name: "Casco",
      categoryId: "cat-1",
    })
    expect(result.unitOfMeasure).toBe("unidad")
  })

  it("accepts a single preferred supplier", () => {
    const result = productSchema.safeParse({
      name: "Casco",
      categoryId: "cat-1",
      suppliers: [
        { supplierId: "sup-1", isPreferred: true },
        { supplierId: "sup-2", isPreferred: false },
      ],
    })
    expect(result.success).toBe(true)
  })

  it("rejects more than one preferred supplier", () => {
    const result = productSchema.safeParse({
      name: "Casco",
      categoryId: "cat-1",
      suppliers: [
        { supplierId: "sup-1", isPreferred: true },
        { supplierId: "sup-2", isPreferred: true },
      ],
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.suppliers?.[0]).toMatch(/preferido/i)
    }
  })

  it("rejects product-attribute options larger than the storage contract", () => {
    const result = productSchema.safeParse({
      name: "Casco",
      categoryId: "cat-1",
      attributes: [{ name: "Talla", type: "select", options: "x".repeat(4001) }],
    })
    expect(result.success).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// productAttributeSchema
// ═══════════════════════════════════════════════════════════════════════════════

describe("productAttributeSchema", () => {
  it("rejects an optional attribute that drives the requested quantity", () => {
    const result = productAttributeSchema.safeParse({
      name: "Número de dosis",
      type: "integer",
      isRequired: false,
      drivesQuantity: true,
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: ["drivesQuantity"] }),
      ]))
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// workerSchema
// ═══════════════════════════════════════════════════════════════════════════════

describe("workerSchema", () => {
  it("accepts valid worker", () => {
    const result = workerSchema.safeParse({
      firstName: "Carlos",
      lastName: "Muñoz",
      worksiteId: "ws-1",
    })
    expect(result.success).toBe(true)
  })

  it("rejects empty firstName", () => {
    const result = workerSchema.safeParse({
      firstName: "",
      lastName: "Muñoz",
      worksiteId: "ws-1",
    })
    expect(result.success).toBe(false)
  })

  it("rejects empty worksiteId", () => {
    const result = workerSchema.safeParse({
      firstName: "Carlos",
      lastName: "Muñoz",
      worksiteId: "",
    })
    expect(result.success).toBe(false)
  })

  it("accepts optional RUT", () => {
    const result = workerSchema.safeParse({
      firstName: "Carlos",
      lastName: "Muñoz",
      worksiteId: "ws-1",
      rut: validRut(),
    })
    expect(result.success).toBe(true)
  })

  it("defaults isActive to true", () => {
    const result = workerSchema.parse({
      firstName: "Carlos",
      lastName: "Muñoz",
      worksiteId: "ws-1",
    })
    expect(result.isActive).toBe(true)
  })
})

describe("unitOfMeasureSchema", () => {
  it("normaliza espacios y caja: 'CAJAS ' y 'cajas' eran valores distintos en la base", async () => {
    const { unitOfMeasureSchema } = await import("@/lib/validation/product-catalogs")
    expect(unitOfMeasureSchema.parse("  CAJAS  ")).toBe("cajas")
    expect(unitOfMeasureSchema.parse("Unidad")).toBe("unidad")
  })

  it("acepta un código del catálogo de 24 caracteres (antes el max(20) lo rechazaba)", async () => {
    const { unitOfMeasureSchema } = await import("@/lib/validation/product-catalogs")
    const code = "a".repeat(24)
    expect(unitOfMeasureSchema.parse(code)).toBe(code)
  })

  it("no valida contra el catálogo: el texto libre es deliberado", async () => {
    const { unitOfMeasureSchema } = await import("@/lib/validation/product-catalogs")
    expect(unitOfMeasureSchema.parse("unidad inventada")).toBe("unidad inventada")
  })

  it("exige un valor no vacío", async () => {
    const { unitOfMeasureSchema } = await import("@/lib/validation/product-catalogs")
    expect(unitOfMeasureSchema.safeParse("   ").success).toBe(false)
  })
})
