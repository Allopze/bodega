/**
 * Regresión de la taxonomía documental SST contra PGlite.
 *
 * La fuente de verdad de las categorías es la tabla `sst_document_categories`,
 * que el admin puede extender desde `/admin/taxonomia-sst`. El schema de tipos
 * valida el formato del slug y el servicio verifica la existencia: una
 * categoría real creada en BD debe aceptar tipos nuevos, y un slug inexistente
 * debe fallar.
 */
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import path from "node:path"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
  get Tx() { return undefined },
}))

import { sstDocumentTypeUpsertSchema } from "@/lib/validation/prevention"
import {
  seedDefaultCategories,
  upsertDocumentCategory,
  upsertDocumentType,
} from "@/lib/services/prevention-documents/taxonomy"

describe("taxonomía documental SST", () => {
  beforeAll(async () => {
    await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  })

  afterAll(async () => pg.close())

  it("acepta una categoría real creada en BD aunque no esté en el enum histórico", async () => {
    await upsertDocumentCategory({
      slug: "procedimientos_operacionales_audit",
      name: "Procedimientos operacionales",
      description: "Categoría de captura para documentación preventiva vigente.",
      sortOrder: 1,
      isActive: true,
    })

    const parsed = sstDocumentTypeUpsertSchema.safeParse({
      categorySlug: "procedimientos_operacionales_audit",
      code: "PROC-LOTO",
      name: "Procedimiento de bloqueo y etiquetado",
    })
    expect(parsed.success).toBe(true)

    const row = await upsertDocumentType({
      categorySlug: "procedimientos_operacionales_audit",
      code: "PROC-LOTO",
      name: "Procedimiento de bloqueo y etiquetado",
      requiresApproval: true,
    })
    expect(row?.categorySlug).toBe("procedimientos_operacionales_audit")
  })

  /*
   * El formulario de tipos pasó a cablear identidades de catálogo y dejó de
   * emitir los campos numéricos. Omitirlos tiene que conservar el snapshot:
   * `resolvePdtpAccreditationTarget` cae a los números sólo si el tipo no
   * tiene binding, así que son la red de un rollback anterior al segundo
   * despliegue. Un `[]` explícito sigue significando "no acredita".
   */
  it("omitir los números PDTP conserva los que el tipo ya declaraba", async () => {
    await upsertDocumentCategory({
      slug: "difusion_audit", name: "Difusión",
      description: "Categoría de prueba para el snapshot numérico.", sortOrder: 2, isActive: true,
    })
    const creado = await upsertDocumentType({
      categorySlug: "difusion_audit", code: "DIF-001", name: "Comunicado de difusión",
      pdtpActivityNumbers: [36], pdtpAcknowledgmentActivityNumbers: [78],
    })
    expect(creado?.pdtpActivityNumbers).toEqual([36])

    const renombrado = await upsertDocumentType({
      id: creado!.id, categorySlug: "difusion_audit", code: "DIF-001",
      name: "Comunicado de difusión interna",
    })

    expect(renombrado?.pdtpActivityNumbers).toEqual([36])
    expect(renombrado?.pdtpAcknowledgmentActivityNumbers).toEqual([78])
  })

  it("un [] explícito apaga los números PDTP del tipo", async () => {
    await upsertDocumentCategory({
      slug: "difusion_audit_off", name: "Difusión sin acreditación",
      description: "Categoría de prueba para apagar el snapshot.", sortOrder: 3, isActive: true,
    })
    const creado = await upsertDocumentType({
      categorySlug: "difusion_audit_off", code: "DIF-002", name: "Comunicado sin acreditación",
      pdtpActivityNumbers: [36],
    })

    const apagado = await upsertDocumentType({
      id: creado!.id, categorySlug: "difusion_audit_off", code: "DIF-002",
      name: "Comunicado sin acreditación", pdtpActivityNumbers: [],
    })

    expect(apagado?.pdtpActivityNumbers).toBeNull()
  })

  it("rechaza un tipo con categoría inexistente", async () => {
    await expect(upsertDocumentType({
      categorySlug: "categoria_que_no_existe",
      code: "X-001",
      name: "Tipo huérfano",
    })).rejects.toThrow("La categoría indicada no existe")
  })

  it("el seed sigue aceptando las categorías base", async () => {
    await seedDefaultCategories()
    const parsed = sstDocumentTypeUpsertSchema.safeParse({
      categorySlug: "gestion_preventiva",
      code: "PROC",
      name: "Procedimiento",
    })
    expect(parsed.success).toBe(true)
    // El seed ya dejó (gestion_preventiva, PROC): el upsert con otro id choca
    // contra el unique (categoría, código) porque el conflicto es por id. Acá
    // basta verificar que el seed no rompe la validación; la escritura con
    // categoría base ya está cubierta por el primer test.
    const [seeded] = await testDb
      .select()
      .from(schema.sstDocumentTypes)
      .where(eq(schema.sstDocumentTypes.code, "PROC"))
    expect(seeded?.categorySlug).toBe("gestion_preventiva")
  })
})
