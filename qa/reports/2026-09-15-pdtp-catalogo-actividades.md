# QA — Catálogo corporativo de actividades PDTP

Fecha: 2026-09-15
Alcance: catálogo corporativo, revisiones, actividad anual, bindings de acreditación, importación y consumidores de Inspecciones, Capacitación, Campañas, Emergencias y Taxonomía documental.
Entorno: worktree local `codex/pdtp-catalog-activities`, PostgreSQL local para preflight/backfill y navegador autenticado local. No se inspeccionó producción.

## Resultado

La implementación queda verificada localmente por migraciones, pruebas unitarias/PGlite, typecheck, lint y un recorrido Playwright autenticado de sólo lectura. El E2E completo no llegó a ejecutar escenarios: su servidor de producción terminó con código 143 durante el build y no produjo `.next/standalone/server.js`. Por ello este informe no certifica una liberación ni reemplaza el preflight de cada ambiente.

## Comprobaciones deterministas

| Puerta | Resultado | Evidencia |
|---|---|---|
| `npm run db:generate` | PASS | Sin cambios de esquema pendientes después de generar 0297/0298 |
| `npm run db:verify-migrations` | PASS | 299 entradas verificadas hasta 0298, incluidos checksums |
| `npm run db:migrate` | PASS | Migraciones aplicadas en la base local |
| Backfill local, modo apply + postcheck | PASS | 87 actividades, 81 activas, 6 retiradas, 87 revisiones, 81 bindings, 13 eventos/targets y cero huérfanos |
| Backfill local, dry-run final | PASS | `ok=true`, 87 filas de manifestación, cero incidencias |
| `npm run test:fast` | PASS | 710 archivos pasaron, 30 omitidos; 7.321 pruebas pasaron, 316 omitidas |
| `npm run test:pglite` | PASS | 169 archivos y 1.907 pruebas |
| `npm run typecheck` | PASS | Sin errores |
| `npm run lint` | PASS | Sin errores ni advertencias |
| `npm run check:secrets` | PASS | No se detectaron archivos de entorno fuera de lugar |
| `npm run check:security-audit` | PASS | Hallazgos altos existentes cubiertos por allowlist documentado hasta 2026-10-28 |
| React Doctor, alcance cambiado | WARN | 83/100, 11 advertencias, sin errores; el hallazgo de consumo HTTP introducido fue corregido |
| `npm run test:e2e` | BLOQUEADO | El web server terminó con código 143 durante el build; cero escenarios ejecutados |

React Doctor global obtuvo 49/100 con 865 hallazgos del repositorio. No se atribuyen a este cambio: el análisis acotado a 60 archivos modificados dejó 11 advertencias de complejidad, tamaño y esperas secuenciales. Las esperas de escritura revisadas conservan orden transaccional; no se hicieron refactors amplios sin relación con el catálogo.

## Recorrido autenticado

Se levantó Next.js 16.3.3 en `127.0.0.1:3001` con webpack. Turbopack no puede usar el enlace de `node_modules` del worktree porque apunta fuera de su raíz. Se usó la sesión QA existente y no se guardaron formularios ni se modificaron datos.

| Pantalla | Estado | Pasos verificados |
|---|---|---|
| `/admin/pdtp-catalogos` | PASS | Pestaña Actividades, búsqueda por código, título visible y formulario con código, título, descripción y guía |
| `/prevencion/pdtp/pdtp-2026-v1/editar` | COBERTURA BLOQUEADA | El único programa local está activo; redirige al detalle congelado, como exige el dominio. El selector del alta editable quedó cubierto por pruebas de componente |
| `/prevencion/inspecciones/plantillas` | PASS | Diálogo Acreditación PDTP, selectores separados ejecutar/revisar, búsqueda `PDT-030`, título, descripción y código |
| `/prevencion/capacitacion` | PASS PARCIAL | Catálogo anual controlado visible, sin inputs numéricos. El disparo `close` y sus bindings normalizados están cubiertos por PGlite; no existe alta libre operativa en esta ruta |
| `/prevencion/campanas` | PASS | Alta de campaña y selector por identidad; búsqueda `PDT-030` muestra título, descripción y código |
| `/prevencion/emergencias/:planId` | PASS | Diálogo Acreditación PDTP del simulacro y selector múltiple por identidad |
| `/admin/taxonomia-sst` | PASS | Alta de tipo y selectores separados para publicar y acusar recibo |

En Inspecciones, Campañas, Emergencias y Taxonomía, la búsqueda `PDT-030` devolvió exactamente una opción: “Realizar alcotest por Prevención”, su descripción “Realizar alcotest” y el código estable completo. No se observaron errores de consola ni fallos de red atribuibles a estas pantallas durante el recorrido interactivo.

## Hallazgos clasificados

### Bugs de producto confirmados

Ninguno en el alcance recorrido.

### Hallazgos funcionales

- Ninguno confirmado. La ausencia del editor para el programa 2026 es el comportamiento esperado de un programa activo y congelado.

### UI/UX e inconsistencias

- No se encontraron inputs visibles de números separados por coma en los consumidores recorridos.
- Capacitación conserva un catálogo anual predefinido y no expone alta libre; su configuración se resuelve por bindings normalizados. Esto limita la comprobación visual del picker en esa ruta, aunque elimina el ingreso numérico heredado.

### Advertencias de automatización

- La primera navegación observó siete solicitudes de avatar a DiceBear bloqueadas por ORB. Es un recurso externo del perfil y no afecta el catálogo PDTP.
- Turbopack rechazó el symlink de `node_modules` del worktree; el recorrido se completó con webpack enlazado sólo a loopback.
- E2E no inició escenarios por salida 143 del servidor durante build.

### Brechas de cobertura

- No se recorrió el alta anual en navegador porque no existe un programa editable en la base local.
- No se aplicaron cambios desde los diálogos de consumidores; se verificó apertura, contenido, búsqueda y selección disponible sin mutar datos.
- No se verificaron producción, otros ambientes, navegadores móviles ni el segundo despliegue de retirada de columnas antiguas.
- La paridad de cada ambiente sigue condicionada al preflight de sólo lectura y al backfill propios.

## Recomendaciones antes del corte

1. Ejecutar en cada ambiente el reconciliador de watermarks en dry-run, migraciones, backfill en dry-run y recién después apply/postcheck.
2. Bloquear el segundo despliegue ante cualquier actividad, binding o evento huérfano o ambiguo.
3. Repetir `npm run test:e2e` en un runner con memoria suficiente y agregar un fixture de programa borrador para recorrer “Agregar desde catálogo”.
4. Mantener `activity_numbers` como snapshot histórico hasta confirmar paridad en el ambiente desplegado; no usarlo como fuente de resolución nueva.
