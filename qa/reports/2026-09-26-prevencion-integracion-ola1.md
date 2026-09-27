# Integración de la ola 1: T2, T4, laterales y decisiones (2026-09-26)

Rama local `prevencion/integracion-ola1` sobre la integración T1+T5 (`e47d9b7a`). Sin push.

| Rama integrada | Contenido | Informe |
|---|---|---|
| `prevencion/decisiones-re36-cierre` | RE-36 con el tope por actividad en sus % (decisión "fórmulas con tope"), reporte D6 de cierres desviados y paso Q5 del runbook | abajo |
| `prevencion/t2-estados` | Atrasos primero sobre la deuda vencida y "No aplica" con revisión (migración 0331) | [T2](2026-09-26-prevencion-t2.md) |
| `prevencion/laterales-i14-m10` | Etapas del ciclo de vida como lista que envuelve; vitest 4.1.11 | [laterales](2026-09-26-prevencion-laterales-i14-m10.md) |
| `prevencion/t4-evidencia` | Extensión por mime, historial de envíos, sha256, referencias únicas de evidencia, cron de integridad | [T4](2026-09-26-prevencion-t4.md) |

## Decisiones de la persona usuaria aplicadas

- **RE-36:** las celdas E siguen mostrando lo ejecutado real. El % semanal topa cada actividad a su P de la semana. El trimestral suma lo computable por actividad y mes, que es la regla del indicador de la plataforma. Verificado con recálculo real en LibreOffice: el caso "A planificó 1 e hizo 2, B planificó 1 e hizo 0" da 50 % (antes daba 100 %). Con las fórmulas anteriores la prueba falla.
- **D6:** `npm run pdtp:report-closure-drift` recalcula la foto de cada cierre vigente con el código del checkout y lista los desviados. Solo lee. Está como paso Q5 en `docs/deploy/DESPLIEGUE_PREVENCION_2026-09.md`, para correrlo desde la versión nueva contra producción con un usuario de solo lectura. No se corrió contra ninguna base real.
- **Reglas del cierre anual:** van en la rama siguiente (`prevencion/cierre-anual-reglas`, migración 0332) porque necesitan registrar la fecha de baja de una faena.

## Merge

Solo chocó `qa/reports/latest.md`, tres veces. Git fusionó el resto sin conflictos. Los choques que anticipaban los agentes (`executions.ts` entre T2 y T4, `period-closures.ts`) se resolvieron solos y no hubo conflicto de significado detectable por las puertas.

## Verificación de la rama integrada

| Puerta | Resultado |
|---|---|
| `npm ci` (lockfile nuevo de M10) | OK |
| `npm run typecheck` / `npm run lint` | PASS |
| `db:generate` / cadena de migraciones | Sin cambios pendientes / 332 entradas hasta 0331 |
| `npm run check:security-audit` | PASS |
| `npm run test:fast` | 769 archivos / **10.032 pruebas PASS**, 30 archivos omitidos (`*-postgres`) |
| `npm run test:pglite` | 208 archivos / **2.499 pruebas PASS** |
| E2E `pdtp-*` + `prevencion-*` contra un servidor aislado reconstruido (puerto 3100, base desechable) | **163 PASS, 1 omitida** (la condicional de `pdtp-habilitacion:98`) |
| Recálculo del RE-36 en LibreOffice | PASS |

**Sin recorrer:** `npm run test:e2e` completo, suites `*-postgres` (salvo la de concurrencia del cierre anual), `npm run doctor`, y el reporte D6 contra datos reales.

**Nota sobre el conteo de `test:fast`:** con vitest 4.1.11 el total de pruebas coincide, pero dos que antes pasaban ahora aparecen omitidas. No se investigó cuáles son; queda como pendiente menor.
