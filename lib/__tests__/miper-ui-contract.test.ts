import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const source = (relativePath: string) => readFileSync(path.join(root, relativePath), "utf8")

describe("contratos React de la pantalla MIPER", () => {
  it("serializa una fecha de referencia estable para SSR e hidratación", () => {
    const page = source("app/(app)/prevencion/miper/page.tsx")
    const workbench = source("app/(app)/prevencion/miper/miper-workbench.tsx")

    // La estabilidad la da la *forma*, no la función: `today` se resuelve una
    // vez en el servidor y baja como prop, y el workbench (cliente) no la
    // recalcula. `todayInChile()` reemplazó a `toISOString().slice(0, 10)`
    // porque aquella medía el día en UTC y adelantaba el corte 3-4 horas;
    // además queda fijada a America/Santiago, así que tampoco depende de la
    // zona del navegador.
    expect(page).toContain("const today = todayInChile()")
    expect(page).toContain("today={today}")
    expect(workbench).toContain("today: string")
    expect(workbench).not.toContain("new Date().toISOString().slice(0, 10)")
    expect(workbench).not.toContain("todayInChile(")
  })

  it("conserva el tab activo cuando una mutación refresca los datos", () => {
    const workbench = source("app/(app)/prevencion/miper/miper-workbench.tsx")

    expect(workbench).toContain('useState(() => resolveMiperTab(searchParams.get("tab")))')
    expect(workbench).toContain('params.set("tab", value)')
    expect(workbench).toContain('router.replace(qs ? `?${qs}` : "", { scroll: false })')
    expect(workbench).toContain('<Tabs value={activeTab} onValueChange={navigateTab}>')
    expect(workbench).not.toContain('<Tabs defaultValue="versions">')
  })

  // MIPER-06: el servicio sabe crear una revisión copiando la versión vigente,
  // pero el diálogo nunca enviaba `sourceMatrixId`, así que ese camino era
  // inalcanzable desde la aplicación y toda "nueva versión" nacía vacía.
  it("el diálogo de nueva versión envía sourceMatrixId y ofrece la vigente por defecto", () => {
    const workbench = source("app/(app)/prevencion/miper/miper-workbench.tsx")
    const page = source("app/(app)/prevencion/miper/page.tsx")

    expect(workbench).toContain("sourceMatrixId: source")
    expect(workbench).toContain('const source = String(values.get("sourceMatrixId") ?? "")')
    expect(workbench).toContain('<input type="hidden" name="sourceMatrixId" value={sourceMatrixId} />')
    // El desplegable se alimenta de las matrices publicadas de la faena elegida,
    // que es lo único que `createRiskMatrixDraftWithClient` acepta como fuente.
    expect(workbench).toContain('matrices.filter((item) => item.status === "published" && item.worksiteId === worksiteId)')
    expect(page).toContain("matrices={dashboard.matrices}")
  })

  /* MIPER-07: `committeeMeetingId` existe en la tabla, en el Zod y en el guard
   * del servicio, pero ningún formulario lo enviaba: la columna quedaba siempre
   * NULL y el crédito Oro `iper_committee_participation` era inalcanzable. */
  it("el diálogo de nueva versión ofrece y envía la sesión del comité", () => {
    const workbench = source("app/(app)/prevencion/miper/miper-workbench.tsx")
    const page = source("app/(app)/prevencion/miper/page.tsx")
    const service = source("lib/services/prevention-risk-legal.ts")

    expect(workbench).toContain('committeeMeetingId: values.get("committeeMeetingId") || null')
    expect(workbench).toContain('<input type="hidden" name="committeeMeetingId" value={committeeMeetingId} />')
    // Opcional: no toda revisión MIPER pasa por el comité, así que el select
    // lleva la opción vacía del patrón de la casa (centinela `__none__`).
    expect(workbench).toContain('emptyLabel="Sin sesión del comité"')
    expect(workbench).toContain('id="miper-committee-meeting"')
    // Y acotado a la faena elegida: la sesión cuelga del comité de una faena, y
    // el servidor rechaza la de otra.
    expect(workbench).toContain("committeeMeetings.filter((item) => item.worksiteId === worksiteId)")
    expect(workbench).toContain('setCommitteeMeetingId("")')
    expect(page).toContain("committeeMeetings={dashboard.committeeMeetings}")
    /* El panel es quien resuelve la elegibilidad; el diálogo sólo pinta la
     * lista. La faena viaja en cada sesión porque la sesión no la tiene: cuelga
     * del comité, y el comité de la faena — de ahí el JOIN. */
    expect(service).toContain("worksiteId: preventionCommittees.worksiteId")
    expect(service).toContain("scopeCondition(access.scope, preventionCommittees.worksiteId), ne(preventionCommitteeMeetings.status, \"cancelled\")")
  })

  /* La otra puerta de entrada a una MIPER: el lote de Excel. Se cableó después,
   * y sin ella una matriz importada no podía declarar su sesión de comité, así
   * que el crédito Oro seguía inalcanzable por ese camino. */
  it("el diálogo de activación de un lote importado también ofrece y envía la sesión del comité", () => {
    const workbench = source("app/(app)/prevencion/miper/miper-workbench.tsx")
    const importService = source("lib/services/prevention-risk-import.ts")

    expect(workbench).toContain('id="miper-import-committee-meeting"')
    expect(workbench).toContain('committeeMeetingId: v.get("committeeMeetingId") || null')
    // Las sesiones llegan ya acotadas a la faena del lote, no a una elegida en
    // el diálogo: el lote nace con su faena y no se puede cambiar acá.
    expect(workbench).toContain("committeeMeetings.filter((item) => item.worksiteId === batch.worksiteId)")
    // Y el servicio lo acepta y lo propaga al borrador, donde el guard de faena
    // y estado de la sesión ya vive.
    expect(importService).toContain("committeeMeetingId: data.committeeMeetingId ?? null")
  })

  // MIPER-10: sin este botón el revisor no tenía cómo devolver una versión
  // trabada en revisión.
  it("el revisor puede devolver a borrador desde la ficha de la versión", () => {
    const workbench = source("app/(app)/prevencion/miper/miper-workbench.tsx")

    expect(workbench).toContain('const canReturn = matrix.status === "in_review" && canReview')
    expect(workbench).toContain('toStatus="draft" label="Devolver a borrador"')
  })

})
