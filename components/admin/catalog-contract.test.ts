import { describe, it, expect } from "vitest"
import { CONTRACT as faenasContract } from "@/app/(app)/admin/faenas/catalog-contract"
import { CONTRACT as trabajadoresContract } from "@/app/(app)/admin/trabajadores/catalog-contract"
import { CONTRACT as suppliersContract } from "@/app/(app)/admin/proveedores/catalog-contract"
import { CONTRACT as costCentersContract } from "@/app/(app)/admin/centros-costo/catalog-contract"
import { CONTRACT as productsContract } from "@/app/(app)/admin/productos/catalog-contract"
import { CONTRACT as vehiclesContract } from "@/app/(app)/combustibles/vehiculos/catalog-contract"
import { CONTRACT as fuelSuppliersContract } from "@/app/(app)/combustibles/proveedores-combustible/catalog-contract"

/**
 * Fase 0 contract test — every registered catalog must declare the same
 * shape: a non-empty search surface, a Estado column, and a row-actions
 * column. Add new catalogs here as they migrate to the shared primitives.
 */
const CATALOGS = [
  faenasContract,
  trabajadoresContract,
  suppliersContract,
  costCentersContract,
  productsContract,
  vehiclesContract,
  fuelSuppliersContract,
]

describe("catalog contract", () => {
  for (const catalog of CATALOGS) {
    describe(catalog.name, () => {
      it("declares a non-empty search surface", () => {
        expect(catalog.searchKeys.length).toBeGreaterThan(0)
      })

      it("has a Estado column", () => {
        expect(catalog.columns.some((c) => c.key === "isActive")).toBe(true)
      })

      it("has a row-actions column", () => {
        expect(catalog.columns.some((c) => c.key === "")).toBe(true)
      })

      it("declares a mobile representation", () => {
        expect(catalog.hasMobileView).toBe(true)
      })
    })
  }
})
