# Remediación de hallazgos de auditoría PDTP

Fecha: 2026-09-17  
Fuente: [`2026-09-16-pdtp-final-audit.md`](2026-09-16-pdtp-final-audit.md)

## Resultado

Los hallazgos PDTP-F01 a PDTP-F04 quedaron corregidos y cubiertos por regresiones focalizadas. PDTP-F05 quedó optimizado en los recorridos que crecían con faenas y diferencias: se usan `Set`/`Map`, escrituras agrupadas para parámetros por faena y componentes separados en el panel de cobertura. React Doctor todavía deja deuda de complejidad en componentes grandes.

## Cambios verificados

- El comparativo con la Base cuenta deltas reales por identidad y valor para parámetros por faena, overrides, exclusiones y retiros. Una configuración idéntica ya no aparece como cambio.
- Los totales del comparativo y sus dimensiones asociadas usan la identidad estable de catálogo (con caída al número legado), no sólo `n`; renumerar una actividad no la presenta como alta/baja falsa.
- Las decisiones del diff muestran `Conservada` o `Aplicada desde la Base` y deshabilitan la acción que ya fue elegida.
- La cobertura expone `segregated_valid` como estado positivo separado de `ready`; no exige permisos incompatibles con la segregación y no reduce el contador de actividades listas.
- Una huella firmada sin `schemaVersion` ya no se compara contra la forma actual. Se informa como no verificable, con motivo explícito y CTA de revisión para un programa activo; las versiones históricas no reconstruibles siguen la misma ruta segura.
- El backlog usa un `Set` para intersectar faenas visibles y la adopción de parámetros por faena usa un `Map` más un upsert por lote, eliminando los recorridos lineales y las escrituras repetidas observados en la auditoría.

## Verificación autenticada posterior

- Se levantó el servidor local y se renovó la sesión QA sin exponer credenciales. La primera carga reveló una base local atrasada en 0298 que no tenía `pdtp_activity_executor_assignments`; se aplicaron únicamente las migraciones oficiales 0299 y 0300 mediante `scripts/migrate.mjs`, sin editar el journal.
- Después de migrar, las rutas `/prevencion/pdtp/pdtp-2026-v1`, `/prevencion/pdtp/pdtp-2026-v1/editar`, `/prevencion/pdtp/actividades`, `/prevencion/pdtp/programas` y `/prevencion/pdtp/cobertura` respondieron 200 en escritorio y móvil, con encabezados esperados y sin errores de aplicación en consola. El bloqueo ORB del avatar externo de DiceBear sigue fuera de alcance.
- La captura del detalle confirma `6/81 listas`, el grupo `SIN EJECUTOR ACREDITADOR CONFIGURADO` y la CTA contextual `Crear revisión v+1`; el tablero móvil muestra `Aún no hay ejecuciones acreditadas` y `Ir al trabajo operativo`; la vista anual móvil muestra `Plan / ejecutado` y el aviso accesible `Desliza horizontalmente para revisar más semanas y columnas`.
- Evidencia visual: `qa/reports/2026-09-17-pdtp-desktop-detail.png`, `qa/reports/2026-09-17-pdtp-mobile-detail.png`, `qa/reports/2026-09-17-pdtp-desktop-actividades-anual.png`, `qa/reports/2026-09-17-pdtp-mobile-actividades-anual.png`, `qa/reports/2026-09-17-pdtp-mobile-dashboard.png` y sus capturas post-migración del detalle/edición/actividades.
- Inventario read-only de la base local `.env.local`: 1 programa firmado, 0 snapshots firmados sin `schemaVersion`, 1 activo firmado y 0 activos con versión ausente. Falta repetir el inventario en staging/producción antes de cerrar la política histórica.

## Validación ejecutada después de todos los parches

- `npm run typecheck` — OK.
- `npm run lint` — OK.
- `npm run check:secrets` — OK.
- `npm run check:security-audit` — OK; allowlist documentado con próxima revisión 2026-10-28.
- `npm run db:verify-migrations` — OK: 301 entradas y checksums válidos.
- `git diff --check` — OK.
- `npm run test:pglite -- lib/__tests__/pdtp-fulfillment.test.ts lib/__tests__/prevention-pdtp.test.ts lib/__tests__/pdtp-revision-diff-decisions.test.ts` — **147/147 pruebas OK**.
- `npm run test:fast -- app/(app)/prevencion/pdtp/[programId]/coverage-report-panel.test.tsx app/(app)/prevencion/pdtp/[programId]/editar/revision-diff-decisions.test.tsx app/(app)/prevencion/pdtp/pdtp-indicators-panel.test.tsx` — **16/16 pruebas OK**.
- `npm run test:fast` — **711 archivos OK**, 30 omitidos; **7.343 pruebas OK**, 314 omitidas. Sólo quedaron warnings conocidos de `punycode` y resolución de imágenes.
- `npx react-doctor@latest --verbose --scope changed` — **84/100**, 10 avisos de mantenibilidad (9 funciones complejas y 1 componente grande); no quedan avisos de rendimiento en los archivos cambiados. La complejidad de las páginas PDTP queda como deuda de mantenimiento, no como fallo funcional.

## Límites de verificación

- No se ejecutó nuevamente la suite PGlite completa: la corrida previa quedó sin certificar por 11 fallos de `lib/__tests__/sst-delete-evaluation.test.ts`, fuera del alcance PDTP.
- La UAT autenticada local ya está disponible para las rutas principales y estados de cobertura, tablero cero, planilla anual y scroll móvil. No se recorrieron mutaciones de v+1, decisión Aplicar/Conservar ni una activación completa en navegador; esas rutas quedan cubiertas por servicios y pruebas deterministas, no por esta captura exploratoria.
- No se generó migración: estos fixes sólo cambian lógica, estados de cobertura, UI y pruebas; `db:verify-migrations` confirma que la cadena existente permanece intacta.

## Riesgo remanente y siguiente paso

El único riesgo de datos pendiente es inventariar snapshots firmados antiguos sin `schemaVersion` fuera de la base local y decidir si se backfillean con evidencia histórica o se mantienen como no verificables. El warning de hidratación y el bloqueo externo del avatar permanecen fuera del alcance.
