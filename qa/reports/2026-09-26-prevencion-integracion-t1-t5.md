# Integración T1 + T5 y revisión adversarial (2026-09-26)

Rama local `prevencion/integracion-t1-t5`: T5 (cambio de año 2027) fusionado sobre T1 (cálculo del porcentaje), ambos sobre el commit de T0 (`319598c7`). Informes de origen: [T1](2026-09-26-prevencion-t1.md) y [T5](2026-09-26-prevencion-t5.md).

## Merge

- Solo chocó `qa/reports/latest.md`; quedaron las dos filas.
- Git fusionó solo `page.tsx`, `period-closures.ts`, `lib/validation/prevention-module/pdtp.ts` y dos pruebas. La revisión buscó choques de significado en esos archivos.
- La cadena de migraciones queda 0329 → 0330 (331 entradas, checksums verificados) y `db:generate` no encuentra cambios pendientes.
- Recién fusionado, antes de las correcciones: typecheck y lint PASS, `test:fast` 10.011 PASS, `test:pglite` 2.381 PASS.

## Revisión adversarial

Tres revisores de solo lectura, cada uno con un foco:
1. lo de T5 cuyas pruebas se escribieron después del código;
2. la interacción entre T1 y T5;
3. el cálculo de T1.

Cada hallazgo se verificó contra el código antes de corregirlo, y cada corrección tuvo primero su prueba en rojo.

### Corregidos

| Hallazgo | Qué pasaba | Corrección | Prueba |
|---|---|---|---|
| **Cierre anual y reapertura concurrentes** (T5) | La reapertura de un mes leía `yearClosedAt` sin lock. En READ COMMITTED no esperaba al cierre anual en curso, reabría un mes que el cierre ya había contado, y el año quedaba cerrado sobre un mes reabierto | La reapertura toma la fila del programa `FOR SHARE`, en serie con el `FOR UPDATE` del cierre anual | `pdtp-year-close-concurrency-postgres.test.ts`, contra PostgreSQL real. Sin la corrección la reapertura se cuela; con ella espera y se rechaza |
| **`addedAt` reiniciado al editar faenas** (anterior a T5, lo destapó T5) | `setPdtpProgramWorksites` borraba y volvía a insertar toda la membresía con fecha de hoy. Editar las faenas de una v2 en julio dejaba de exigir enero a junio, tanto en el porcentaje como en el cierre anual | Una faena que ya era miembro conserva su `addedAt` y su autor | `pdtp-worksites.test.ts` |
| **Obligaciones entre dos años** (T1 × T5) | T5 asigna la obligación al programa del año de su hecho; el M07 de T1 descartaba la que vence el año siguiente. Un caso del 29-12 con vencimiento el 03-01 no contaba en ningún año | Una obligación que vence fuera del año de su programa cuenta en su mes límite: diciembre si vence después, enero si venció antes | `pdtp-compliance-zero.test.ts` (M07 reescrita) |
| **Mes equivocado con el año en cierre** (T5) | En enero de 2027, `/prevencion/pdtp` mostraba 2026 pero leía "pendientes del mes" y "en cero" contra enero | `pdtpReferencePeriodForYear`: un año terminado se lee en diciembre, semana 4. La usan la página y la tarjeta del tablero | `pdtp-period.test.ts` |
| **Chips por faena de la planilla agregada** (T1) | Sumaban lo aprobado sin deduplicar: manual + acreditación de la misma semana mostraba 2 junto a un 1 | Misma regla de deduplicación que el resto de la planilla | `pdtp-compliance-zero.test.ts` |
| **Alcance para cerrar el año** (T5) | Bastaba el permiso de ciclo de vida, aunque el cierre afecta a todas las faenas | `closePdtpProgramYear` exige alcance global de faenas (parámetro obligatorio), igual que editar la cobertura del programa | `pdtp-year-close.test.ts` |

### Refutado

- **Techo de 100.000 en el importador XLSX.** El parser nunca materializa las columnas E del libro (`importedExecutions: []` por diseño), así que no hay cantidad importada que topar.

### Pendientes, con motivo

| Hallazgo | Por qué no se corrigió aquí |
|---|---|
| **RE-36: % semanal y trimestral sin tope** (T1) | El libro RE-36 calcula `SUM(E)/SUM(P)` con fórmulas de Excel, y ahora puede decir 100 % donde la plataforma, en la misma hoja, dice 50 %. Replicar el tope por actividad y mes en las fórmulas cambia el formato del documento. **Decisión de producto pendiente:** topar las celdas E, cambiar las fórmulas o rotular la diferencia |
| **Casillas sobrantes tras una revisión** (T5, solo desde 2027) | Activar una v2 que mueve una actividad de mes siembra la casilla nueva sin retirar la anterior. Es parte de la revisión a mitad de año (T6) |
| **Casos residuales de I08-a** (T1) | Una fila manual en la misma semana que una acreditación excluida todavía suma. Además, la exclusión solo rige en el indicador y no en eje, reporte, planilla ni RE-36. El tope lo acota |
| **Actividades programadas por ocurrencias fuera del eje y del reporte** | Es anterior a T1. Queda para I12 (T7), que unifica el cálculo |
| **Cierre anual de programas corporativos y faenas dadas de baja** (T5) | Las faenas nuevas de un programa corporativo deben el año desde la activación. Una faena desactivada no debe nada. Es coherente con el porcentaje, pero conviene confirmarlo con Prevención |
| **Siembra de casillas sin programa activo** (T5) | En enero de 2027, antes de activar 2027, una faena nueva recibe casillas de 2026. Además, un fallo de siembra al activar solo se registra en el log |
| **D6** | El conteo de cierres que quedarían desviados sigue pendiente de una consulta de solo lectura antes del despliegue |

## Verificación (después de las correcciones)

| Puerta | Resultado |
|---|---|
| `npm run typecheck` / `npm run lint` | PASS |
| `db:generate` / `db:verify-migrations` | Sin cambios pendientes / PASS (331 entradas) |
| `npm run test:fast` | 771 archivos / **10.014 pruebas PASS**, 30 archivos omitidos (suites `*-postgres`, incluida la nueva) |
| `npm run test:pglite` | 198 archivos / **2.384 pruebas PASS** |
| `pdtp-year-close-concurrency-postgres.test.ts` contra el contenedor desechable `:55432` | PASS. Con `period-closures.ts` revertido falla: la reapertura se resuelve en vez de rechazarse |
| E2E `pdtp-*` + `prevencion-*`, incluidas `pdtp-cierre-anual` y `pdtp-transicion-anual` de T5, contra un servidor aislado reconstruido (puerto 3100, base desechable) | **152 PASS, 1 omitida** (la condicional de `pdtp-habilitacion:98`) |
| Recorrido de navegador en `/prevencion/pdtp?anio=2025` y `?anio=2026`, a 1440 px y 390 px | Sin errores de consola, sin 5xx, sin desborde horizontal. Con 2026 aparece "PDTP 2025 · cierre pendiente". El fixture 2025 no tiene ejecuciones, así que la captura no distingue qué mes lee la página; eso lo cubre la prueba de `pdtpReferencePeriodForYear` |

**Sin recorrer:** `npm run test:e2e` completo, las demás suites `*-postgres`, `npm run doctor` y la consulta D6.
