# Recorrido de navegador — Expediente RE-20 rediseñado (Fase 2)

Fecha: 2026-10-20 · Entorno: `next dev` local (:3001) sobre `bodega_dev` con migraciones hasta `0355` y RBAC sincronizado · Sesión: usuario QA (`playwright/.auth/monkeytest.json`) · Herramienta: Chromium de `@playwright/test` + `@axe-core/playwright` (WCAG 2 A/AA).

## Datos usados

Tres casos `QA_` creados con los servicios (`reportPreventionIncident`, `savePreventionIncidentRe20Workspace`), en la faena Masisa:

| Caso | Tipo | Para qué |
|---|---|---|
| `QA_re20_accidente` | Accidente del trabajo, con tiempo perdido | Las 7 etapas; árbol de 5 hechos con conjunción y 2 causas raíz |
| `QA_re20_trayecto` | Accidente de trayecto | Etapas que no aplican (PASO A PASO!N7) |
| `QA_re20_cuasi` | Cuasi accidente, potencial crítico | Árbol obligatorio |

## Alcance recorrido

- Escritorio 1440 px: las 7 etapas del accidente (`?etapa=`), trayecto, cuasi accidente, `/prevencion/incidentes/configuracion` y `/prevencion/incidentes/[id]/re20/print`.
- Móvil 390 px: las 7 etapas del accidente.
- Total: 18 vistas, todas HTTP 200.

## Resultado final (tras correcciones)

| Chequeo | Resultado |
|---|---|
| Errores de consola / `pageerror` | 0 |
| Respuestas de red ≥ 400 | 0 (se excluye el avatar externo de dicebear, sin internet en el sandbox) |
| Violaciones axe WCAG 2 A/AA | 0 (en las 11 vistas de escritorio auditadas) |
| Desborde horizontal en móvil | 0 px en las 7 etapas |

## Hallazgos y su resolución

| # | Clase | Hallazgo | Evidencia | Resolución |
|---|---|---|---|---|
| 1 | PRODUCT BUG | Error de hidratación en la etapa DIAT: los plazos relativos («vence en 3 h 12 min») se calculaban con `Date.now()` en servidor y cliente | `pageerror` «Hydration failed…» | Reloj único `ws.now`: la página pasa la hora de render y el hook la avanza cada minuto tras montar; `re20RelativeTime`/`re20DeadlineState`/`re20StageViews` exigen `now` |
| 2 | PRODUCT BUG | Desborde horizontal de 541 px en móvil en todas las etapas | `scrollWidth − clientWidth` del contenedor del shell | La grilla de `page.tsx` no definía columnas bajo `lg`; ahora `grid-cols-[minmax(0,1fr)]` |
| 3 | PRODUCT BUG | Revisora de calidad o quien confirma difusión sin permiso de investigar quedaba con el formulario deshabilitado | Revisión de código del shell (`fieldset disabled={readOnly}`) | Calidad y difusión se bloquean solo con el caso cerrado; cada etapa aplica sus permisos y el servidor los revalida |
| 4 | UX FINDING | El expediente RE-20 quedaba bajo triage, evidencia y denuncias, en media columna; el árbol cortaba hechos | Capturas 1440 px | Expediente a ancho completo bajo la franja de resumen; diagrama del árbol a ancho completo sobre el constructor |
| 5 | UX FINDING | Quien no puede revisar veía 13 «Falta…» que llevaban a campos ocultos | Captura de la etapa 5 | El progreso de calidad no lista faltantes a quien no puede revisar |
| 6 | INCONSISTENCY | Letras de sección («D Árbol de causas») sin información | Capturas | Retiradas de títulos y navegación |
| 7 | ACCESIBILIDAD (preexistente en HEAD) | 3–5 selectores del panel de flujo sin nombre accesible (`button-name`, crítico) | axe en todas las vistas del incidente | `Label htmlFor` + `id` / `aria-label` en los `SelectTrigger` de triage, evidencia, CAPA e inclusión |

## Fase 3 — comprobaciones adicionales en navegador (mismo entorno)

| Comprobación | Resultado |
|---|---|
| Guardado real: «Jefatura a cargo» del preliminar → Guardar → recargar | PASS: persiste en `prevention_incident_re20_workspaces` (v2→v4), indicador «Guardado 20-10-2026 18:21», avance 3/13 |
| Datos reservados por la pantalla: propósito en el velo → «Ver con propósito» | PASS: navega con `sensitive=1&purpose=…` y habilita «Agregar declaración» |
| Service worker | PASS: un registro, alcance `/prevencion/incidentes/`, script `/re20-sw.js` |
| Shell sin conexión `/prevencion/incidentes/re20-offline` | PASS: 200 |
| Impresión → PDF (mismo render que la ruta, Chromium del repo) | PASS: PDF válido de 103 KB; orden RE-20-02 → 04 (§1–§14) con árbol, matriz 8.1 y trayectorias 8.2; reservado omitido con aviso |
| Consola durante estas acciones | 0 errores |

**AUTOMATION WARNING:** la ruta `/re20/print/pdf` del `next dev` local responde 500 porque busca Chromium del sistema en `/usr/bin/chromium-browser`, que esta máquina no tiene (`lib/pdf/browser-pool.ts` admite `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`). La imagen de producción lo incluye. No es un defecto del RE-20; se verificó el render equivalente.

## Fase 3 — E2E determinista `e2e/prevencion-incidentes-re20.spec.ts`

Worktree desechable, servidor E2E :3100, base `bodega_e2e` (:55432), Chromium escritorio. **24 pasadas, 0 fallidas, 0 fixme**, 1,7 min por corrida, 3 corridas seguidas idénticas.

Cubre: accidente con tiempo perdido de punta a punta con dos usuarios (triage → aviso → preliminar que lleva el caso a «En investigación» → declaración reservada que sobrevive a recargar → árbol con cadena, conjunción e independiente → medidas con verificador ≠ responsable → definitivo → «Requiere corrección» que reabre → «Aprobado con observaciones» → «Pendiente CAPA» → CAPA desde medida → ONE PAGE bloqueado antes y permitido después → seguimiento); trayecto con 3 etapas; cuasi accidente grave con árbol obligatorio y uno leve sin árbol; cierre de sesión que purga la cola v2 en claro.

### PRODUCT BUGS encontrados por la E2E (corregidos y cubiertos)

| # | Severidad | Defecto | Corrección |
|---|---|---|---|
| 1 | Bloqueante | Guardar cualquier dato reservado fallaba («Inválido fecha y hora ISO»): `diat.knownAt` se sembraba con el timestamp de Postgres | `page.tsx` pasa fechas ISO y `emptyRe20Sensitive` normaliza |
| 2 | Alto | Los bloques plegables se cerraban al primer carácter tecleado (`open` atado al avance) | `Re20Block` con estado propio; el avance solo decide la apertura inicial |
| 3 | Alto | Ningún control llevaba el caso de «Medidas inmediatas» a «En investigación» (lo hacía la «Investigación guiada» retirada) | Guardar el expediente RE-20 hace la transición con historial; el panel lo explica |
| 4 | Medio | Tras aprobar, la etapa «Revisión de calidad» seguía «en curso» | La aprobación completa la tarea `quality_review` en la misma transacción |
| 5 | Medio | La pantalla daba el árbol por optativo cuando el potencial grave venía del reporte; el servidor lo exigía | Misma regla que el servidor (`treeRequired` con `potentialSeverity`) |

Regresiones PGlite agregadas: la aprobación completa `quality_review`; guardar el expediente mueve el caso a «En investigación» una sola vez.

**AUTOMATION WARNING (resuelto):** el servidor standalone de `e2e/start-server.sh` no recibía `PREVENTION_DATA_ENCRYPTION_KEY`; se agregó una llave constante de prueba (solo base E2E desechable).

## Cierre de pendientes (misma fecha)

La E2E se amplió a 32 pruebas: usuario sin `view_sensitive` (velo, impresión sin reservado, PDF/anexos reservados rechazados, intento auditado como «denegado»), registro de la DIAT, cuestionario RE-20-03, anexos (PNG real subido y descargado; contenido que no coincide rechazado) y trabajo sin conexión con la bóveda (editar offline, volver, sincronizar, recargar).

Ajustes de producto derivados:

| Hallazgo | Clase | Resolución |
|---|---|---|
| Sin `view_sensitive`, un enlace con `?sensitive=1` devolvía 404 del caso entero | UX FINDING | Vista normal con el velo; el intento se sigue auditando como «denegado» |
| Etapa completa (DIAT presentada) mostraba «1 de 6 datos obligatorios» | INCONSISTENCY | La etapa terminada muestra «Etapa completa» |
| El aviso de la DIAT repetía su título en el cuerpo | UX FINDING | Texto sin duplicar |
| «Agregar fotografía» aceptaba texto y PDF | UX FINDING | El selector acepta solo imágenes |
| La ruta `/re20/print/pdf` fallaba en local con una `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` inexistente | FUNCTIONAL FINDING | `browser-pool` ignora una ruta configurada que no existe (con aviso) y usa otro Chromium; la ruta responde 200 `application/pdf` |
| La reunión post accidente vivía como texto con encabezados en la nota de la tarea | Deuda técnica | Campo propio `postAccidentMeeting`; las notas antiguas se leen como respaldo |
| Anexos antiguos en base64 dependían de correr un script a mano en cada ambiente | Despliegue | El servicio `migrate` los traslada a disco en cada despliegue (con volumen de almacenamiento); un fallo no corta el despliegue y la fila sigue legible |

## Lo que NO se verificó (coverage gaps)

- E2E solo en Chromium de escritorio; el ancho 390 px se verificó en el recorrido asistido, no en la E2E.
- El DROP de las columnas legado de anexos queda para una migración posterior, cuando producción informe 0 pendientes.
- Trabajo efectivamente sin conexión (bóveda cifrada con datos y sincronización al volver): solo se verificó el registro del service worker y el shell.
- La ruta `/re20/print/pdf` en sí, por la limitación de entorno indicada arriba.
- Teclado: el foco visible y los enlaces «Falta…» se revisaron por código y axe, no con un recorrido manual completo.
- El botón «N» que tapa la barra móvil es el indicador de desarrollo de Next; no existe en producción.
