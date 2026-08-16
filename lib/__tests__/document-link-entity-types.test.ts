import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { DOCUMENT_LINK_ENTITY_TYPES } from "@/lib/services/prevention-documents/links"

const REPO = path.resolve(__dirname, "../..")
const LINKS_SRC = readFileSync(path.join(REPO, "lib/services/prevention-documents/links.ts"), "utf-8")
const SCHEMA_SRC = readFileSync(path.join(REPO, "db/schema/prevention/library.ts"), "utf-8")

/**
 * Los tipos de vínculo documental viven en tres lugares que tienen que decir lo
 * mismo: el check SQL, la whitelist de TypeScript, y las dos funciones que
 * resuelven la entidad (`resolveDocumentLinkTarget` e
 * `inspectDocumentLinkTargets`).
 *
 * Divergieron de verdad: el check aceptaba 15 valores y la whitelist listaba 9,
 * así que la base permitía vínculos que la aplicación rechazaba. Y al ampliar
 * la whitelist sin tocar las funciones, los tipos nuevos quedaban aceptados
 * pero devolviendo `undefined` — el `switch` no tiene `default`, así que
 * TypeScript no avisa.
 */
describe("tipos de vínculo documental", () => {
  const sqlTypes = (() => {
    const match = /sst_document_links_entity_type_valid[\s\S]*?IN \(([^)]*)\)/.exec(SCHEMA_SRC)
    if (!match) throw new Error("No se encontró el check sst_document_links_entity_type_valid")
    return match[1]!.split(",").map((value) => value.trim().replace(/^'|'$/g, ""))
  })()

  it("la whitelist de TypeScript no acepta nada que el check SQL rechace", () => {
    const extra = DOCUMENT_LINK_ENTITY_TYPES.filter((type) => !sqlTypes.includes(type))
    expect(extra, "tipos en TS que la base rechazaría").toEqual([])
  })

  it("cada tipo de la whitelist tiene rama en resolveDocumentLinkTarget", () => {
    const body = LINKS_SRC.slice(LINKS_SRC.indexOf("export async function resolveDocumentLinkTarget"))
    const missing = DOCUMENT_LINK_ENTITY_TYPES.filter((type) => !body.includes(`case "${type}":`))
    expect(missing, "sin rama: devolverían undefined en silencio").toEqual([])
  })

  it("cada tipo de la whitelist se resuelve en inspectDocumentLinkTargets", () => {
    const body = LINKS_SRC.slice(
      LINKS_SRC.indexOf("export async function inspectDocumentLinkTargets"),
      LINKS_SRC.indexOf("export async function resolveDocumentLinkTarget"),
    )
    // Sin su `targets.set`, el vínculo se reporta como roto aunque exista.
    const missing = DOCUMENT_LINK_ENTITY_TYPES.filter((type) => !body.includes(`\`${type}:\${row.id}\``))
    expect(missing, "sin targets.set: se reportarían como vínculos rotos").toEqual([])
  })
})
