/** Clave de igualdad de diccionario: sin tildes, minúsculas, espacios colapsados. */
export function normalizeMiperName(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("es-CL").replace(/\s+/g, " ").trim()
}

/** Texto a guardar: se respeta la escritura del usuario, sin espacios sobrantes. */
export function cleanMiperName(value: string | null | undefined): string | null {
  const cleaned = (value ?? "").replace(/\s+/g, " ").trim()
  return cleaned.length > 0 ? cleaned : null
}

/**
 * `workers.sex` admite male | female | other, y null significa "no
 * registrado" (`lib/person-sex.ts`). El RE-04 pide F / M / Otro: null también
 * va a Otro para que la suma cuadre con el total, y `unrecorded` avisa cuántos
 * de ellos son en realidad falta de dato.
 */
export function headcountFromSexCounts(rows: Array<{ sex: string | null; count: number }>) {
  let male = 0, female = 0, other = 0, unrecorded = 0
  for (const row of rows) {
    if (row.sex === "male") male += row.count
    else if (row.sex === "female") female += row.count
    else {
      other += row.count
      if (row.sex === null) unrecorded += row.count
    }
  }
  return { total: male + female + other, male, female, other, unrecorded }
}
