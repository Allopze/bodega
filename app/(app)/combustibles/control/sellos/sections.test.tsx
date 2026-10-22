import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { MediumCrossRow, ReconciliationFlow } from "@/lib/combustibles/control/queries/reconciliation"
import type { SealDetailRow, SealJustificationRow, SupervisorSealRow } from "@/lib/combustibles/control/queries/seals"
import { resolvePagination } from "@/lib/pagination"
import { DetailSection } from "./detail-section"
import { FlowSection } from "./flow-section"
import { MediumSection } from "./medium-section"
import { SupervisorsSection } from "./supervisors-section"

const totals = (input: number, direct: number, viaTank: number, over: boolean | null) => ({
  inputLiters: input, directLiters: direct, viaTankLiters: viaTank, deliveredLiters: direct + viaTank,
  differenceLiters: input - direct - viaTank, differencePct: input > 0 ? ((input - direct - viaTank) / input) * 100 : null, overTolerance: over,
})
const flow = (t: ReturnType<typeof totals>, assumed = 0): ReconciliationFlow => ({ totals: t, months: [{ month: "2026-03", ...t }], assumedDirectLiters: assumed })

describe("FlowSection", () => {
  it("avisa con la alerta exigida cuando la diferencia supera la tolerancia del mandante", () => {
    const html = renderToStaticMarkup(<FlowSection flow={flow(totals(1000, 700, 200, true))} tolerancePct={2} mandanteName="Mandante Uno" partialScope={false} />)
    expect(html).toContain("La diferencia supera la tolerancia del mandante (2 %)")
    expect(html).toContain('role="alert"')
    expect(html).toContain("Entrada")
    expect(html).toContain("Entregado directo")
    expect(html).toContain("Entregado vía estanque")
    expect(html).toContain("Fuera de tolerancia")
  })

  it("dentro de tolerancia es texto neutro, sin alerta", () => {
    const html = renderToStaticMarkup(<FlowSection flow={flow(totals(1000, 900, 95, false))} tolerancePct={2} mandanteName="Mandante Uno" partialScope={false} />)
    expect(html).toContain("Dentro de la tolerancia de Mandante Uno")
    expect(html).not.toContain('role="alert"')
  })

  it("sin mandante pide elegir uno y no declara tolerancia; sin nada que conciliar lo dice", () => {
    const html = renderToStaticMarkup(<FlowSection flow={flow(totals(1000, 900, 95, null))} tolerancePct={null} mandanteName={null} partialScope />)
    expect(html).toContain("Elige un mandante")
    expect(html).not.toContain("supera la tolerancia")
    expect(renderToStaticMarkup(<FlowSection flow={flow(totals(0, 0, 0, null))} tolerancePct={2} mandanteName="M" partialScope />)).toContain("No hay entradas ni entregas")
  })

  it("entregas sin ninguna entrada se explican en vez de mostrar un % inventado", () => {
    const html = renderToStaticMarkup(<FlowSection flow={flow(totals(0, 300, 0, true))} tolerancePct={2} mandanteName="M" partialScope={false} />)
    expect(html).toContain("ninguna entrada registrada")
    expect(html).toContain("Sin entrada para calcular el %")
  })
})

describe("MediumSection", () => {
  it("una fila sin informe del proveedor lo dice y no muestra 0 %", () => {
    const rows: MediumCrossRow[] = [
      { mediumId: "a", name: "TCT", fieldLiters: 100, fieldLoads: 1, reportedLiters: 120, differenceLiters: 20, differencePct: 16.7 },
      { mediumId: "b", name: "Surtidor CMPC", fieldLiters: 80, fieldLoads: 2, reportedLiters: null, differenceLiters: null, differencePct: null },
    ]
    const html = renderToStaticMarkup(<MediumSection rows={rows} />)
    expect(html).toContain("Sin informe del proveedor")
    expect(html).toContain("16,7 %")
    expect(html).not.toContain("0 %")
  })
})

describe("SupervisorsSection", () => {
  const rows: SupervisorSealRow[] = [
    { key: "s0", name: "Reservado", loads: 10, liters: 900, withoutRemovedSeal: 2, withoutInstalledSeal: 0, chainBreaks: 1 },
    { key: "s1", name: "Reservado", loads: 4, liters: 300, withoutRemovedSeal: 0, withoutInstalledSeal: 0, chainBreaks: 0 },
  ]
  const justifications: SealJustificationRow[] = [{ supervisorKey: "s0", submissionId: "x", loadedAt: "2026-03-10T15:00:00.000Z", equipment: "KA-1", missing: "removed", reason: null }]

  it("destaca solo los conteos mayores que cero y lista las justificaciones desplegables", () => {
    const html = renderToStaticMarkup(<SupervisorsSection rows={rows} justifications={justifications} />)
    expect(html).toContain("2 cargas sin sello retirado")
    expect(html).toContain("1 cadenas de sellos rotas")
    expect(html).not.toContain("0 cargas sin sello nuevo")
    expect(html).toContain("<details")
    expect(html).toContain("Sin motivo registrado")
  })

  it("sin cargas muestra un vacío en lenguaje de usuario", () => {
    expect(renderToStaticMarkup(<SupervisorsSection rows={[]} justifications={[]} />)).toContain("No hay cargas en terreno")
  })
})

describe("DetailSection", () => {
  const row: SealDetailRow = {
    id: "sub-1", loadedAt: "2026-03-10T15:00:00.000Z", loadedAtSource: "device_offline", equipment: "KA-1", plate: "AA-0001", worksiteName: "Faena A",
    loadingPointType: "pickup_tank", loadingPointName: "Estanque", mediumName: "TCT", liters: 120.5, meterType: "hour_meter", meterReading: 1500,
    driver: "Reservado", supervisor: "Reservado", removedSeal: "R-1", installedSeal: null, noSealReason: "Se rompió", sealChainStatus: "mismatch", sealChainExpected: "I-0", notes: null, evidenceCount: 4,
  }
  const pagination = resolvePagination({ pageParam: "1", totalItems: 1, pageSize: 50 })

  it("muestra el origen de la hora, la cadena rota y el enlace a las fotos solo con permiso", () => {
    const withPhotos = renderToStaticMarkup(<DetailSection rows={[row]} pagination={pagination} hrefForPage={(p) => `?pagina=${p}`} canViewPhotos />)
    expect(withPhotos).toContain("Hora del dispositivo (sin conexión)")
    expect(withPhotos).toContain("Estanque de camioneta")
    expect(withPhotos).toContain("Cadena rota")
    expect(withPhotos).toContain("/combustibles/tae/sub-1#evidencia")
    const without = renderToStaticMarkup(<DetailSection rows={[row]} pagination={pagination} hrefForPage={(p) => `?pagina=${p}`} canViewPhotos={false} />)
    expect(without).not.toContain("#evidencia")
    expect(without).not.toContain("Ver fotos")
    expect(without).toContain("Reservado")
  })
})
