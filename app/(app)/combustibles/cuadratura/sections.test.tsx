import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { MediumCrossRow } from "@/lib/combustibles/control/queries/reconciliation"
import type { MandanteReconciliationDetail } from "@/lib/combustibles/control/queries/reconciliation-summary"
import type { SealDetailRow, SealJustificationRow, SupervisorSealRow } from "@/lib/combustibles/control/queries/seals"
import type { SealMovement } from "@/lib/combustibles/seal-history"
import type { CardFieldCoverage, TaeCopecReconciliationRow } from "@/lib/combustibles/tae-copec-reconciliation"
import { resolvePagination } from "@/lib/pagination"
import { plainChileDateTime } from "./_components/format"
import { wholeMonthsNote, wholeMonthsPhrase } from "./_components/period-text"
import { cycleAnswer, MovementsTable, movementSourceHref, StorageLevelBars, StorageLevels } from "./estanques/estanques-sections"
import { MandanteMonths, MandantesTable, WhatToCheck, mandanteAnswer } from "./mandante/mandante-sections"
import { MediumSection, mediumAnswer } from "./proveedor/medium-section"
import { DetailSection } from "./sellos/detail-section"
import { SealHistorySection, sealFollowUp } from "./sellos/history-section"
import { SupervisorsSection, sealsAnswer } from "./sellos/supervisors-section"
import { CoverageTable, coverageAnswer } from "./tarjeta-y-terreno/coverage-table"

const mandante = (overrides: Partial<MandanteReconciliationDetail> = {}): MandanteReconciliationDetail => ({
  mandanteId: "m1", name: "CMPC Santa Fe", worksiteNames: ["Santa Fe"], worksiteIds: ["w1"], tolerancePct: 2,
  inLiters: 42_100, directLiters: 29_300, viaTankLiters: 11_480, deliveredLiters: 40_780, differenceLiters: 1_320, differencePct: 3.1356, overTolerance: true,
  wholeMonths: true, monthKeys: ["2026-10"], monthsOverTolerance: ["2026-10"], assumedDirectLiters: 0, hasMovement: true,
  months: [{ month: "2026-10", inLiters: 42_100, directLiters: 29_300, viaTankLiters: 11_480, deliveredLiters: 40_780, differenceLiters: 1_320, differencePct: 3.1356, overTolerance: true }],
  ...overrides,
})
const fits = mandante({ mandanteId: "m2", name: "CMPC Pacífico", worksiteNames: ["Pacífico", "Mininco"], inLiters: 28_400, directLiters: 17_900, viaTankLiters: 10_270, deliveredLiters: 28_170, differenceLiters: 230, differencePct: 0.81, overTolerance: false, monthsOverTolerance: [] })

describe("Cuadratura › Por mandante", () => {
  it("la frase de apertura dice cuántos cuadran y el peor mandante en palabras", () => {
    const text = mandanteAnswer([mandante(), fits, mandante({ mandanteId: "m3", name: "Forestal Biodiversa", overTolerance: false, monthsOverTolerance: [] })], "en octubre")
    expect(text).toContain("En octubre cuadran 2 de 3 mandantes.")
    expect(text).toContain("A CMPC Santa Fe le faltan 1.320 L (3,1 %), sobre su tolerancia de 2 %.")
  })

  it("con un solo mandante, o sin movimiento, la frase no inventa un conteo", () => {
    expect(mandanteAnswer([fits], "en octubre")).toBe("En octubre, CMPC Pacífico cuadra.")
    const idle = mandante({ overTolerance: null, inLiters: 0, directLiters: 0, viaTankLiters: 0, deliveredLiters: 0, differenceLiters: 0, differencePct: null, hasMovement: false })
    expect(mandanteAnswer([idle], "en octubre")).toBe("No hay entradas ni entregas en octubre que cuadrar.")
  })

  it("entregas sin ninguna entrada, o más entregado que lo que entró, se dicen sin un % inventado", () => {
    const noInput = mandante({ inLiters: 0, directLiters: 300, viaTankLiters: 0, deliveredLiters: 300, differenceLiters: -300, differencePct: null })
    expect(mandanteAnswer([noInput], "en octubre")).toBe("En octubre, CMPC Santa Fe no cuadra. Se entregaron 300 L y no hay ninguna entrada registrada en el período.")
    const surplus = mandante({ differenceLiters: -500, differencePct: -1.4, overTolerance: true, tolerancePct: 1 })
    expect(mandanteAnswer([surplus], "en octubre")).toContain("Se entregaron 500 L (1,4 %) más de lo que entró, sobre su tolerancia de 1 %")
    expect(mandanteAnswer([mandante()], "en octubre")).toBe("En octubre, CMPC Santa Fe no cuadra. Le faltan 1.320 L (3,1 %), sobre su tolerancia de 2 %.")
  })

  it("la tabla lista a todos con su tolerancia, su estado en palabras y un enlace a su mes a mes", () => {
    const html = renderToStaticMarkup(<MandantesTable rows={[mandante(), fits]} selectedId="m1" hrefFor={(id) => `?mandante=${id}`} />)
    expect(html).toContain("CMPC Santa Fe")
    expect(html).toContain("CMPC Pacífico")
    expect(html).toContain("Pacífico, Mininco")
    expect(html).toContain("Fuera de tolerancia")
    expect(html).toContain("Faltan 1.320 L (3,1 %), sobre su tolerancia de 2 %.")
    expect(html).toContain("Cuadra")
    expect(html).toContain("Cuadra: la diferencia es de 230 L (0,8 %), dentro de su tolerancia de 2 %.")
    expect(html).toContain('href="?mandante=m1"')
    expect(html).toContain("2 %")
    expect(html).not.toMatch(/conciliaci|vasija|TAE/i)
  })

  it("un mandante que cuadra en el total pero tiene un mes fuera lo avisa", () => {
    const html = renderToStaticMarkup(<MandantesTable rows={[{ ...fits, monthsOverTolerance: ["2026-09"] }]} selectedId={null} hrefFor={() => "#"} />)
    expect(html).toContain("Un mes quedó fuera de tolerancia: Sep 2026")
  })

  it("sin movimiento no pinta ceros: guiones y «Sin movimiento»", () => {
    const idle = mandante({ overTolerance: null, hasMovement: false, inLiters: 0, directLiters: 0, viaTankLiters: 0, deliveredLiters: 0, differenceLiters: 0, differencePct: null, worksiteNames: [] })
    const html = renderToStaticMarkup(<MandantesTable rows={[idle]} selectedId={null} hrefFor={() => "#"} />)
    expect(html).toContain("Sin movimiento")
    expect(html).toContain("Sin faenas asignadas")
    expect(html).not.toContain("0 L")
  })

  it("el mes a mes muestra cada mes contra la tolerancia, los meses en blanco y el total", () => {
    const row = mandante({
      months: [
        { month: "2026-08", inLiters: 0, directLiters: 0, viaTankLiters: 0, deliveredLiters: 0, differenceLiters: 0, differencePct: null, overTolerance: null },
        { month: "2026-09", inLiters: 41_900, directLiters: 30_000, viaTankLiters: 11_300, deliveredLiters: 41_300, differenceLiters: 600, differencePct: 1.43, overTolerance: false },
        { month: "2026-10", inLiters: 42_100, directLiters: 29_300, viaTankLiters: 11_480, deliveredLiters: 40_780, differenceLiters: 1_320, differencePct: 3.14, overTolerance: true },
      ],
      assumedDirectLiters: 120,
    })
    const html = renderToStaticMarkup(<MandanteMonths row={row} />)
    expect(html).toContain("Sin movimiento")
    expect(html).toContain("Cuadra")
    expect(html).toContain("Fuera de tolerancia")
    expect(html).toContain("Total")
    expect(html).toContain("120 L de cargas en un punto sin tipo definido")
  })

  it("«qué mirar» ofrece enlaces reales y omite Fuentes si no hay permiso", () => {
    const withSources = renderToStaticMarkup(<WhatToCheck row={mandante()} links={{ cargas: "/c", fuentes: "/f", estanques: "/e" }} />)
    expect(withSources).toContain('href="/c"')
    expect(withSources).toContain('href="/f"')
    expect(withSources).toContain('href="/e"')
    const without = renderToStaticMarkup(<WhatToCheck row={mandante()} links={{ cargas: "/c", fuentes: null, estanques: "/e" }} />)
    expect(without).not.toContain('href="/f"')
    expect(renderToStaticMarkup(<WhatToCheck row={mandante({ inLiters: 0 })} links={{ cargas: "/c", fuentes: "/f", estanques: "/e" }} />)).toContain("Entradas que faltan")
  })
})

describe("Período por mes completo", () => {
  const month = { isWholeMonths: true, inLabel: "octubre", monthKeys: ["2026-10"], label: "Octubre 2026" }
  const week = { isWholeMonths: false, inLabel: "la semana del 26 de octubre", monthKeys: ["2026-10", "2026-11"], label: "Semana del 26 oct" }

  it("un mes completo no lleva aviso; una semana dice qué meses se midieron", () => {
    expect(wholeMonthsNote(month)).toBeNull()
    expect(wholeMonthsNote(week)).toBe("La cuadratura se mide por mes completo: con «Semana del 26 oct» se muestran los meses completos de Oct 2026 a Nov 2026.")
    expect(wholeMonthsNote({ ...week, monthKeys: ["2026-10"] }, "El cruce")).toContain("se muestra el mes completo de Oct 2026")
  })

  it("la frase de período usa los meses completos cuando el período no lo es", () => {
    expect(wholeMonthsPhrase(month, "2026-10-31")).toBe("en octubre")
    expect(wholeMonthsPhrase({ ...week, monthKeys: ["2026-10"] }, "2026-10-31")).toBe("en octubre")
    expect(wholeMonthsPhrase({ ...week, monthKeys: ["2026-09", "2026-10"] }, "2026-10-31")).toBe("entre Sep 2026 y Oct 2026")
    expect(wholeMonthsPhrase({ ...week, monthKeys: ["2025-12"] }, "2026-10-31")).toBe("en diciembre de 2025")
  })
})

describe("Cuadratura › Proveedor y terreno", () => {
  const rows: MediumCrossRow[] = [
    { mediumId: "a", name: "TCT", fieldLiters: 100, fieldLoads: 1, reportedLiters: 120, differenceLiters: 20, differencePct: 16.7 },
    { mediumId: "b", name: "Surtidor CMPC", fieldLiters: 80, fieldLoads: 2, reportedLiters: null, differenceLiters: null, differencePct: null },
  ]

  it("una fila sin informe del proveedor lo dice y no muestra 0 %", () => {
    const html = renderToStaticMarkup(<MediumSection rows={rows} />)
    expect(html).toContain("Sin informe del proveedor")
    expect(html).toContain("16,7 %")
    expect(html).not.toContain("0 %")
    expect(html).toContain("De dónde salió")
  })

  it("la frase de apertura nombra la mayor diferencia y cuenta los medios sin informe", () => {
    const text = mediumAnswer(rows)!
    expect(text).toContain("La mayor diferencia está en TCT: informó 120 L y en terreno se registraron 100 L (16,7 %).")
    expect(text).toContain("Un medio no tiene informe del proveedor")
    expect(mediumAnswer([{ ...rows[0]!, differenceLiters: 0.4, differencePct: 0.4 }])).toContain("coinciden")
    expect(mediumAnswer([rows[1]!])).toContain("Ningún medio tiene informe del proveedor")
    expect(mediumAnswer([])).toBeNull()
  })

  it("sin nada que cruzar es un estado vacío con salida", () => {
    const html = renderToStaticMarkup(<MediumSection rows={[]} cargasHref="/cargas" fuentesHref="/fuentes" />)
    expect(html).toContain("No hay cargas en terreno ni informes del proveedor")
    expect(html).toContain('href="/cargas"')
    expect(html).toContain('href="/fuentes"')
  })
})

describe("Cuadratura › Tarjeta y terreno", () => {
  const coverage = (overrides: Partial<CardFieldCoverage> = {}): CardFieldCoverage => ({ cardRows: 12, both: 9, cardOnly: 3, fieldOnly: 2, coveragePct: 75, cardLiters: 24_800, coveredCardLiters: 20_100, coveredLitersPct: 81.05, ...overrides })

  it("de lo que informó la tarjeta, cuánto quedó registrado en terreno", () => {
    expect(coverageAnswer(coverage(), false)).toBe("La tarjeta informó 12 equipos y 9 (75 %) también tienen cargas registradas en terreno: 20.100 L de los 24.800 L que informó (81 %). 3 aparecen sólo en la tarjeta.")
    expect(coverageAnswer(coverage({ cardRows: 1, both: 1, cardOnly: 0, coveragePct: 100, cardLiters: 100, coveredCardLiters: 100, coveredLitersPct: 100 }), false)).toContain("La tarjeta informó 1 equipo y 1 (100 %) también tiene")
    expect(coverageAnswer(coverage(), true)).toContain("12 equipos por mes")
    expect(coverageAnswer(coverage({ cardRows: 0, both: 0, cardOnly: 0, coveragePct: null, cardLiters: 0, coveredCardLiters: 0, coveredLitersPct: null }), false)).toContain("La tarjeta no informó ningún equipo")
  })

  it("la tabla dice dónde aparece cada equipo, con la tarjeta y el terreno lado a lado", () => {
    const row = (overrides: Partial<TaeCopecReconciliationRow>): TaeCopecReconciliationRow => ({
      month: "2026-10", worksiteId: "w1", worksiteName: "Biodiversa", vehicleId: "v1", equipment: "CA-14", plate: "AA-0001",
      taeLiters: 1620, taeLoads: 18, tctDieselLiters: 1840, tctBlueMaxLiters: 0, tctRecords: 1, tctPartial: false, tctLiters: 1840, totalLiters: 3460, coverage: "both_channels", ...overrides,
    })
    const html = renderToStaticMarkup(<CoverageTable rows={[row({}), row({ vehicleId: "v2", equipment: "CA-31", taeLiters: 0, taeLoads: 0, coverage: "tct_only", tctPartial: true }), row({ vehicleId: "v3", equipment: "RE-05", tctDieselLiters: 0, tctLiters: 0, coverage: "tae_only" })]} />)
    expect(html).toContain("En ambos")
    expect(html).toContain("Sólo tarjeta")
    expect(html).toContain("Sólo terreno")
    expect(html).toContain("Parcial")
    expect(html).toContain("18 cargas")
    expect(html).toContain("/combustibles/consumo/equipos/v1")
    expect(html).not.toMatch(/conciliaci|TCT|TAE/)
  })
})

describe("Cuadratura › Estanques", () => {
  const available = (absolute: number, percent: number | null) => ({ status: "available" as const, absolute, percent })

  it("la frase de apertura compara lo recibido con lo entregado y no inventa lo que falta", () => {
    const base = { received: { liters: 18_200, records: 3 }, delivered: { liters: 17_640, records: 40 } }
    expect(cycleAnswer({ ...base, differences: { receivedVsDelivered: available(560, 3.08) } }, "en octubre"))
      .toBe("En los estanques entraron 18.200 L y se entregaron 17.640 L a equipos en octubre: la diferencia es 560 L (3,1 %).")
    const unavailable = { status: "unavailable" as const, absolute: null, percent: null }
    expect(cycleAnswer({ received: null, delivered: base.delivered, differences: { receivedVsDelivered: unavailable } }, "en octubre")).toContain("no hay recepciones registradas")
    expect(cycleAnswer({ received: base.received, delivered: null, differences: { receivedVsDelivered: unavailable } }, "en octubre")).toContain("no hay entregas registradas")
    expect(cycleAnswer({ received: null, delivered: null, differences: { receivedVsDelivered: unavailable } }, "en octubre")).toContain("No hay recepciones ni entregas")
  })

  it("no hay etapa «Consumido» en ninguna parte de la pantalla", () => {
    const html = renderToStaticMarkup(<StorageLevels balances={[]} canCreateTank={false} />)
    expect(html).not.toContain("Consumido")
    expect(cycleAnswer({ received: { liters: 1, records: 1 }, delivered: { liters: 1, records: 1 }, differences: { receivedVsDelivered: available(0, 0) } }, "en octubre")).not.toContain("onsum")
  })

  it("el nivel por estanque avisa cuando pasa su capacidad y no inventa una capacidad", () => {
    const html = renderToStaticMarkup(<StorageLevels canCreateTank balances={[
      { storageLocationId: "s1", worksiteId: "w1", name: "Camión surtidor CS-02", productId: "p", capacityLiters: 5000, receivedLiters: 9800, transferInLiters: 0, transferOutLiters: 0, deliveredLiters: 4000, openingLiters: 2100, periodNetLiters: 5800, balanceLiters: 7900 },
      { storageLocationId: "s2", worksiteId: "w1", name: "Estanque base", productId: "p", capacityLiters: null, receivedLiters: 0, transferInLiters: 0, transferOutLiters: 0, deliveredLiters: 0, openingLiters: 0, periodNetLiters: 0, balanceLiters: 0 },
    ]} />)
    expect(html).toContain("Sobre su capacidad")
    expect(html).toContain("Sin capacidad informada")
    expect(html).toContain("Al inicio")
  })

  it("CHART-020: una barra de nivel sobre capacidad por estanque, con la frase que lo responde y sin escala inventada", () => {
    const tank = (storageLocationId: string, name: string, balanceLiters: number, capacityLiters: number | null) => ({
      storageLocationId, worksiteId: "w1", name, productId: "p", capacityLiters, receivedLiters: 0, transferInLiters: 0, transferOutLiters: 0, deliveredLiters: 0, openingLiters: 0, periodNetLiters: 0, balanceLiters,
    })
    const html = renderToStaticMarkup(<StorageLevelBars balances={[
      tank("s1", "Camión surtidor CS-02", 7_900, 5_000),
      tank("s2", "Estanque base", 12_400, 20_000),
      tank("s3", "Estanque sin dato", 800, null),
    ]} />)
    // Una figura con nombre y la frase que responde la pregunta.
    expect(html).toContain("<figure")
    expect(html).toContain("Nivel contra capacidad")
    expect(html).toContain("1 de 3 estanques está sobre su capacidad. 1 no tiene capacidad informada, así que sólo se ve su nivel.")
    // Los dos con capacidad son un `meter` accesible; el que no la tiene, no.
    expect(html.match(/role="meter"/g)).toHaveLength(2)
    expect(html).toContain('aria-label="Camión surtidor CS-02"')
    expect(html).toContain("7.900 L de 5.000 L")
    expect(html).toContain("Sobre su capacidad en 2.900 L")
    expect(html).toContain("62 % de su capacidad")
    expect(html).toContain("Estanque sin dato")
    expect(html).toContain("Sin capacidad informada: no hay una escala contra la que comparar el nivel.")
    // No hay punto de reposición en el catálogo: no se dibuja una marca que nadie declaró.
    expect(html).not.toMatch(/reposici/i)
    expect(renderToStaticMarkup(<StorageLevelBars balances={[]} />)).toBe("")
  })

  it("sin estanques es un estado vacío con salida solo para quien puede crearlos", () => {
    expect(renderToStaticMarkup(<StorageLevels balances={[]} canCreateTank />)).toContain("/admin/flota-catalogos/estanques-combustible")
    expect(renderToStaticMarkup(<StorageLevels balances={[]} canCreateTank={false} />)).not.toContain("/admin/flota-catalogos")
  })

  it("los movimientos enlazan la carga que los respalda y la ficha del equipo", () => {
    expect(movementSourceHref("fuel_load", "f1")).toBe("/combustibles/cargas/factura/f1")
    expect(movementSourceHref("tae_submission", "t1")).toBe("/combustibles/cargas/terreno/t1")
    expect(movementSourceHref("otro", "x")).toBeNull()
    expect(movementSourceHref(null, null)).toBeNull()
    const html = renderToStaticMarkup(<MovementsTable rows={[
      { id: "m1", eventType: "tank_delivery", occurredAt: "2026-10-29T21:05:00.000Z", quantity: 210, documentNumber: null, sourceType: "tae_submission", sourceId: "t1", worksite: { name: "Santa Fe" }, product: { name: "Diésel" }, sourceLocation: { name: "CS-02" }, targetLocation: null, vehicle: { id: "v1", plate: "AA-0001", code: "CA-22" }, supplier: null },
      { id: "m2", eventType: "received", occurredAt: "2026-10-29T18:20:00.000Z", quantity: 4000, documentNumber: "7731", sourceType: null, sourceId: null, worksite: { name: "Santa Fe" }, product: { name: "Diésel" }, sourceLocation: null, targetLocation: { name: "CS-02" }, vehicle: null, supplier: { name: "Copec" } },
      { id: "m3", eventType: "transfer", occurredAt: "2026-10-28T11:00:00.000Z", quantity: 1500, documentNumber: null, sourceType: null, sourceId: null, worksite: { name: "Santa Fe" }, product: { name: "Diésel" }, sourceLocation: { name: "Base" }, targetLocation: { name: "CS-02" }, vehicle: null, supplier: null },
    ]} />)
    expect(html).toContain("Entrega desde estanque")
    expect(html).toContain("Recepción en estanque")
    expect(html).toContain("Traspaso entre estanques")
    expect(html).toContain("/combustibles/cargas/terreno/t1")
    expect(html).toContain("/combustibles/consumo/equipos/v1")
    expect(html).toContain("7731")
    expect(html).toContain("Sin documento")
  })
})

describe("Cuadratura › Sellos", () => {
  const rows: SupervisorSealRow[] = [
    { key: "s0", name: "Reservado", loads: 10, liters: 900, withoutRemovedSeal: 2, withoutInstalledSeal: 0, chainBreaks: 1 },
    { key: "s1", name: "Reservado", loads: 4, liters: 300, withoutRemovedSeal: 0, withoutInstalledSeal: 0, chainBreaks: 0 },
  ]
  const justifications: SealJustificationRow[] = [{ supervisorKey: "s0", submissionId: "x", loadedAt: "2026-03-10T15:00:00.000Z", equipment: "KA-1", missing: "removed", reason: null }]

  it("destaca solo los conteos mayores que cero, lista las justificaciones y aclara que el último sello no cuenta", () => {
    const html = renderToStaticMarkup(<SupervisorsSection rows={rows} justifications={justifications} />)
    expect(html).toContain("2 cargas sin sello retirado")
    expect(html).toContain("1 cadenas de sellos rotas")
    expect(html).not.toContain("0 cargas sin sello nuevo")
    expect(html).toContain("<details")
    expect(html).toContain("Sin motivo registrado")
    expect(html).toContain("El último sello de cada equipo no cuenta como cadena rota")
  })

  it("sin cargas es un estado vacío con salida", () => {
    const html = renderToStaticMarkup(<SupervisorsSection rows={[]} justifications={[]} cargasHref="/combustibles/cargas" />)
    expect(html).toContain("No hay cargas en terreno en este período")
    expect(html).toContain('href="/combustibles/cargas"')
  })

  it("la frase de apertura cuenta cargas y faltas de sello", () => {
    expect(sealsAnswer(rows, "en octubre")).toBe("En octubre se registraron 14 cargas en terreno. A 2 cargas les faltó el sello retirado y una tiene la cadena de sellos rota.")
    expect(sealsAnswer([{ loads: 3, withoutRemovedSeal: 0, withoutInstalledSeal: 0, chainBreaks: 0 }], "en octubre")).toBe("En octubre se registraron 3 cargas en terreno. Todas tienen sus sellos y la cadena está completa.")
    expect(sealsAnswer([{ loads: 9, withoutRemovedSeal: 1, withoutInstalledSeal: 5, chainBreaks: 2 }], "en octubre")).toContain("A 1 carga les faltó el sello retirado, a 5 cargas les faltó el sello nuevo y 2 tienen la cadena de sellos rota.")
    expect(sealsAnswer([], "en octubre")).toBe("No hay cargas en terreno en octubre.")
  })

  const detail: SealDetailRow = {
    id: "sub-1", vehicleId: "veh-1", loadedAt: "2026-03-10T15:00:00.000Z", loadedAtSource: "device_offline", equipment: "KA-1", plate: "AA-0001", worksiteName: "Faena A",
    loadingPointType: "pickup_tank", loadingPointName: "Estanque", mediumName: "TCT", liters: 120.5, meterType: "hour_meter", meterReading: 1500,
    driver: "Reservado", supervisor: "Reservado", removedSeal: "R-1", installedSeal: null, noSealReason: "Se rompió", sealChainStatus: "mismatch", sealChainExpected: "I-0", notes: null, evidenceCount: 4,
  }
  const pagination = resolvePagination({ pageParam: "1", totalItems: 1, pageSize: 50 })

  it("el detalle muestra el origen de la hora, la cadena rota, la ficha del equipo y las fotos solo con permiso", () => {
    const withPhotos = renderToStaticMarkup(<DetailSection rows={[detail]} pagination={pagination} hrefForPage={(p) => `?pagina=${p}`} canViewPhotos />)
    expect(withPhotos).toContain("Hora del dispositivo (sin conexión)")
    expect(withPhotos).toContain("Estanque de camioneta")
    expect(withPhotos).toContain("Cadena rota")
    expect(withPhotos).toContain("/combustibles/cargas/terreno/sub-1#evidencia")
    expect(withPhotos).toContain("/combustibles/consumo/equipos/veh-1")
    const without = renderToStaticMarkup(<DetailSection rows={[detail]} pagination={pagination} hrefForPage={(p) => `?pagina=${p}`} canViewPhotos={false} />)
    expect(without).not.toContain("#evidencia")
    expect(without).not.toContain("Ver fotos")
    expect(without).toContain("Reservado")
  })

  it("una carga registrada después lo dice en vez de mostrar el valor crudo", () => {
    const html = renderToStaticMarkup(<DetailSection rows={[{ ...detail, loadedAtSource: "backdated" }]} pagination={pagination} hrefForPage={() => "#"} canViewPhotos={false} />)
    expect(html).toContain("Registrada después, con fecha pasada")
    expect(html).not.toContain("backdated")
  })

  const movement = (overrides: Partial<SealMovement> = {}): SealMovement => ({
    submissionId: "s1", vehicleId: "v1", loadedAt: "2026-03-10 11:00", worksiteName: "Faena A", loadingPointName: "Surtidor", equipmentCode: "KA-1", plate: "AA-0001", productName: "Diésel", liters: 100,
    removedSeal: "0001", installedSeal: "0002", nextRemovedBy: null, nextRemovedAt: null, installedRepeated: false, continuityBroken: false, isLatestForEquipment: false, ...overrides,
  })

  it("el último sello de un equipo figura como vigente y no como problema", () => {
    expect(sealFollowUp(movement({ isLatestForEquipment: true }))).toEqual({ kind: "current" })
    expect(sealFollowUp(movement({ continuityBroken: true }))).toEqual({ kind: "missing" })
    expect(sealFollowUp(movement({ nextRemovedBy: "KB-2 (BB-0002)", nextRemovedAt: "2026-03-12 09:30" }))).toEqual({ kind: "removed", by: "KB-2 (BB-0002)", at: "2026-03-12 09:30" })
    expect(sealFollowUp(movement({ installedSeal: null, continuityBroken: true }))).toEqual({ kind: "none" })
    const html = renderToStaticMarkup(<SealHistorySection total={2} rows={[movement({ isLatestForEquipment: true }), movement({ submissionId: "s2", continuityBroken: true, installedRepeated: true })]} pagination={resolvePagination({ pageParam: "1", totalItems: 2, pageSize: 50 })} hrefForPage={() => "#"} clearHref="/x" />)
    expect(html).toContain("Vigente")
    expect(html).toContain("Sin retiro posterior")
    expect(html).toContain("repetido")
    expect(html).not.toContain("sin siguiente")
    expect(html).toContain("10-03-2026 11:00")
    expect(html).toContain("/combustibles/cargas/terreno/s1")
  })

  it("el historial vacío ofrece quitar los filtros", () => {
    const html = renderToStaticMarkup(<SealHistorySection total={0} rows={[]} pagination={resolvePagination({ pageParam: "1", totalItems: 0, pageSize: 50 })} hrefForPage={() => "#"} clearHref="/limpio" />)
    expect(html).toContain("Sin movimientos de sello para estos filtros")
    expect(html).toContain('href="/limpio"')
  })

  it("la hora ya en Chile no pasa por Date", () => {
    expect(plainChileDateTime("2026-03-10 11:00")).toBe("10-03-2026 11:00")
    expect(plainChileDateTime(null)).toBe("—")
    expect(plainChileDateTime("basura")).toBe("—")
  })
})
