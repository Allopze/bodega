import { describe, expect, it } from "vitest"
import { aramcoMovementReading, copecDetailReading } from "./meter-readings"

/**
 * Fila del informe de detalle de Copec con el juego de columnas REAL, tomado de
 * un archivo ya sincronizado. Copec entrega la fecha a medianoche UTC y la hora
 * como serial de Excel (época 1899), en celdas separadas.
 */
function copecRow(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    "Producto": "Diésel",
    "Tarjeta": "1-242269-00130-1-9",
    "Tipo de Tarjeta": "TCT PREMIUM",
    "N° Vehículo": 64,
    "Tipo de Vehículo": "CAMION",
    "Departamento": "TRANSPORTES CHOME LTDA.",
    "Rut Chofer": "9559224-4",
    "Región": "LOS RIOS",
    "Comuna": "MARIQUINA",
    "Estación de Servicio": "2071-RUTA 5 KM 786 SAN JOSE DE LA MARIQU",
    "Patente": "BPDH-41",
    "Fecha Transacción": new Date("2020-01-31T00:00:00.000Z"),
    "Hora Transacción": new Date("1899-12-30T17:24:00.000Z"),
    "Guía de Despacho": 600318519,
    "Rut Atendedor": "-",
    "Precio": 676,
    "Volumen": 236.91,
    "Monto": 160157,
    "Odómetro (Kms.)": 562580,
    "Rendimiento (Kms. por Litro)": 2.29,
    "Rendimiento ($ por Km.)": 295.49,
    __row: 3,
    ...over,
  }
}

describe("copecDetailReading", () => {
  it("rescata odómetro, instante, estación y guía de la fila real", () => {
    const reading = copecDetailReading(copecRow())!
    expect(reading.plate).toBe("BPDH-41")
    expect(reading.sourceRef).toBe("600318519")
    expect(reading.value).toBe(562_580)
    expect(reading.liters).toBe(236.91)
    expect(reading.providerPerformance).toBe(2.29)
    expect(reading.stationName).toBe("2071-RUTA 5 KM 786 SAN JOSE DE LA MARIQU")
    expect(reading.cardNumber).toBe("1-242269-00130-1-9")
    // 17:24 hora de pared chilena en enero (UTC-3) → 20:24 UTC.
    expect(reading.occurredAt).toBe("2020-01-31T20:24:00.000Z")
  })

  it("no copia el RUT del chofer ni el del atendedor al payload guardado", () => {
    const reading = copecDetailReading(copecRow())!
    expect(reading.rawPayload).not.toHaveProperty("Rut Chofer")
    expect(reading.rawPayload).not.toHaveProperty("Rut Atendedor")
    expect(reading.rawPayload).toHaveProperty("Estación de Servicio")
  })

  it("acepta la fila sin odómetro con la lectura en null", () => {
    const reading = copecDetailReading(copecRow({ "Odómetro (Kms.)": 0 }))!
    expect(reading.value).toBeNull()
    expect(reading.liters).toBe(236.91)
  })

  it("descarta la fila que no se puede situar en la serie", () => {
    expect(copecDetailReading(copecRow({ "Patente": "" }))).toBeNull()
    expect(copecDetailReading(copecRow({ "Fecha Transacción": null }))).toBeNull()
  })

  it("lee la fecha como string ISO, que es la forma que devuelve jsonb en el backfill", () => {
    const reading = copecDetailReading(copecRow({
      "Fecha Transacción": "2020-01-31T00:00:00.000Z",
      "Hora Transacción": "1899-12-30T17:24:00.000Z",
    }))!
    expect(reading.occurredAt).toBe("2020-01-31T20:24:00.000Z")
    expect(reading.value).toBe(562_580)
  })
})

describe("aramcoMovementReading", () => {
  const movement = {
    transactionId: 90210,
    transactionDate: "2026-08-18T07:49:32",
    vehicleRegistrationPlate: "RW YH 93",
    cardNumber: "  4455  ",
    quantity: 120.5,
    vehicleOdometer: "412300",
    vehiclePreviousOdometer: "411800",
    serviceStationName: "ESMAX LOS ANGELES",
  }

  it("normaliza la patente con espacios y conserva la hora de pared del portal", () => {
    const reading = aramcoMovementReading(movement)!
    expect(reading.plate).toBe("RWYH93")
    expect(reading.sourceRef).toBe("90210")
    expect(reading.occurredAt).toBe("2026-08-18T07:49:32")
    expect(reading.value).toBe(412_300)
    expect(reading.liters).toBe(120.5)
    expect(reading.cardNumber).toBe("4455")
  })

  it("deja la lectura en null cuando el portal no trae odómetro", () => {
    expect(aramcoMovementReading({ ...movement, vehicleOdometer: null })!.value).toBeNull()
  })

  it("descarta el movimiento sin patente o sin fecha", () => {
    expect(aramcoMovementReading({ ...movement, vehicleRegistrationPlate: null })).toBeNull()
    expect(aramcoMovementReading({ ...movement, transactionDate: "" })).toBeNull()
  })
})
