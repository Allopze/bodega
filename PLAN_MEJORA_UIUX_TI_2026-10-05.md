# Plan de mejora UI/UX del módulo TI — 5 de octubre de 2026

Implementa los 63 hallazgos de [qa/reports/2026-10-05-ti-uiux-audit.md](qa/reports/2026-10-05-ti-uiux-audit.md) (IDs `TIUX-NN`). Rama `fix/ti-uiux-audit`, base `8553b7e4`.

**Decisiones del usuario (2026-10-05):** integridad primero · alcance completo · tablero y accesos rediseñados alrededor de "qué atender hoy" · los datos `QA_` sembrados se conservan en `bodega_dev`.

**Método:**

- **Fase 0:** contratos compartidos, en la sesión principal.
- **Fase 1:** siete líneas de trabajo en paralelo, cada una dueña exclusiva de sus archivos.
- **Fase 2:** verificación completa al final: puertas deterministas, E2E en worktree desechable, recorrido en navegador e informe QA.

## Avance

| Fase / línea | Alcance | Estado |
|---|---|---|
| Fase 0 — contratos | `DataTable.sortValue`, helper de garantía, vocabulario TI | ✅ Terminada |
| L1 — Capa compartida y shell | foco, `Select`, TopBar, campana, `ConfirmDialog` | ✅ Terminada (verificada) |
| L2 — Inventario y ficha del activo | P0, ficha "siguiente acción", historial legible | ✅ Terminada (verificada) |
| L3 — Entregas | acuse, préstamos con vencimiento, fotos, devolución y transferencia | ✅ Terminada (verificada) |
| L4 — Mesa de ayuda | cierre, vencimiento, responsable, línea de tiempo, avisos, paginación | ✅ Terminada (verificada) |
| L5 — Mantenciones, garantías y bajas | móvil, faena, filtros, baja con contexto | ✅ Terminada (verificada) |
| L6 — Accesos y licencias | matriz, pestañas, egresos conectados, licencias | ✅ Terminada (verificada) |
| L7 — Resumen, reportes y navegación | "Atención hoy", gráficos, reportes, nombres, `loading.tsx` | ✅ Terminada (verificada) |
| Fase 2 — verificación | typecheck, lint, tests, migraciones, E2E, navegador, informe | ✅ Terminada |

## Fase 0 — contratos compartidos (hecho)

- [x] `ColumnDef.sortValue?: (row) => string | number | null` en `components/ui/data-table.types.ts`. `DataTable` ordena por él y avisa en desarrollo si una columna ordenable no existe en la fila. Prueba en `components/__tests__/data-table.test.tsx`. *(base de TIUX-03)*
- [x] `lib/services/ti/warranty.ts`: `warrantyStatus(endDate, today?)` devuelve `{ kind, daysLeft, label, variant }`, con ≤30 d en *danger*, ≤90 d en *warning* y etiquetas sin abreviar ("Vence en 15 días"). *(base de TIUX-20)*
- [x] `lib/services/ti/constants.ts`: checklists **Ingreso/Egreso** (antes Alta/Baja), acceso revocado **"Revocado"** (antes "Baja") y "En préstamo" en `info` (antes el mismo verde que "Disponible"). *(TIUX-46, parte de TIUX-38)*

### Contratos que las líneas respetan

| Contrato | Dueño | Consumidores |
|---|---|---|
| Columna `it_asset_assignments.expected_return_date` (`date`, nula), propiedad Drizzle `expectedReturnDate` | L3 | L2, L7 |
| `/ti/asignaciones?acuse=pendiente`, `?prestamo=vencido`, `?faena=<id>` (se conserva `?estado=vigentes`) | L3 | L7 |
| `/ti/tickets?vencimiento=vencido\|por_vencer`, `?asignado=yo\|sin_asignar`, `?faena=<id>`, `?q=`, `?pagina=` | L4 | L7 |
| `/ti/garantias?ventana=expiring_30` y `?ventana=expired` siguen funcionando | L5 | L7 |
| `/ti/licencias?renovacion=proxima` | L6 | L7 |
| `/ti/accesos?vista=accesos\|ingreso-egreso\|sistemas`, `?revision=inactivos` | L6 | L7 |
| `RetirementSheet` acepta `assetId?` (preselecciona y bloquea el activo); los `assets` aceptan opcionales `workerName?`, `worksiteName?`, `brand?`, `model?` | L5 | L2 |
| `ReturnSheet`, `TransferSheet` y `AcceptanceSheet` solo suman props **opcionales** | L3 | L2 |
| TopBar: sin buscador de la shell en `/ti`, `/ti/reportes`, `/ti/activos/<id>` y `/ti/tickets/<id>`; `/ti/tickets` pasa a `ROUTES_WITH_OWN_SEARCH` | L1 | L4 |
| Títulos (iguales al ítem de navegación): Resumen · Inventario · Entregas · Mesa de ayuda · Accesos · Licencias · Mantenciones · Garantías y proveedores · Bajas · Reportes TI | cada página / L7 en el manifest | — |
| `loading.tsx` en todas las rutas `/ti/**` | L7 | — |

## Fase 1 — líneas de trabajo

### L1 — Capa compartida y shell
- [x] TIUX-24 Retorno de foco al cerrar en `SheetContent`, `DialogContent`, `ConfirmDialog` y `FilterToolbar` (capa compartida), con prueba.
- [x] TIUX-25 `Select` reenvía `aria-labelledby`, `aria-describedby` y `aria-invalid` del `Field` al trigger, y pinta el error, con prueba.
- [x] TIUX-35 TopBar sin buscador inerte en rutas TI sin lista; `/ti/tickets` con búsqueda propia. *(Bajo 640 px el buscador sigue oculto en toda la app: decisión de shell pendiente.)*
- [x] TIUX-54 Campana: `animate-ping` solo con `motion-safe` y sin tapar el contador; contadores ≥ 11 px.
- [x] TIUX-57 (parte) Nombre accesible "Más filtros (N activos)".
- [x] TIUX-30 (parte) Cerrar de `ConfirmDialog` y acciones de catálogo con 44 px en móvil.
- [x] TIUX-15 (parte) `KpiCard`: el anillo y la cifra del tile usan el mismo tono.
- [ ] TIUX-58 Chip "Tu faena" sobre listas multifaena: sin cambio; requiere que las listas declaren su filtro de faena (documentado).

### L2 — Inventario y ficha del activo
- [x] **TIUX-01 (P0)** El servicio rechaza transiciones manuales desde "Dado de baja"; la ficha no ofrece el control en estados terminales. Prueba de regresión.
- [x] TIUX-11 Panel "Siguiente acción" según el estado (Entregar · Registrar acuse · Devolver · Transferir · Registrar mantención · Dar de baja); "Corregir estado…" pasa a un menú.
- [x] TIUX-07 Corregir estado valida dentro del diálogo, que muestra "Estado actual → Nuevo".
- [x] TIUX-12 Banner de baja con fecha, motivo, destino, responsable, autorizante y enlace; edición deshabilitada.
- [x] TIUX-13 Historial legible: formateador por acción, sin JSON, IDs ni enums, con la fecha del evento. Plantillas de `assets.ts` con etiquetas.
- [x] TIUX-20 Estado de garantía con texto en inventario y ficha.
- [x] TIUX-03 (parte) `sortValue` en la tabla de inventario.
- [x] TIUX-36 Un solo estado vacío; total de resultados; aviso de bajas ocultas; "Limpiar filtros" para todos.
- [x] TIUX-37 Columna "Activo" con espacio; la fila entera navega.
- [x] TIUX-21 (parte) Faena en las tarjetas móviles del inventario.
- [x] TIUX-28 (parte) `<dl>` en la ficha; nombre del selector móvil de pestañas.
- [x] TIUX-49 "Custodia vigente" muestra acuse, fecha y fotos reales.
- [x] TIUX-50 Sin tipos de activo: explicación y enlace al catálogo.
- [x] TIUX-51 Visor de fotos con `Dialog`.
- [x] TIUX-53 (parte) `Callout` en "Bajas registradas".
- [x] TIUX-55 "Asignado a" con "—".
- [x] TIUX-56 Sin duplicaciones en la ficha; ícono según el tipo.
- [x] TIUX-59 (parte) / 60 / 61 / 62 (parte) Encabezados, cifras en mono, overlay con token, Phosphor, chips de filtros, cascadas y catálogos solo para quien gestiona.
- [x] TIUX-30 (parte) Objetivos táctiles de la ficha.

### L3 — Entregas
- [x] TIUX-09 (parte) Acuse sin valor por defecto; estado físico sin preselección.
- [x] TIUX-14 Préstamos con "Devolver a más tardar" (migración `0350_thin_shape`, aplicada en `bodega_dev`); estado "Préstamo vencido"; filtros de acuse, préstamo y faena.
- [x] TIUX-22 (parte) Tabla sin desborde a 1440 px: acción principal más menú.
- [x] TIUX-23 Fecha de entrega en fila propia.
- [x] TIUX-28 (parte) / 34 Componente compartido de fotos (nombre del "+", input de archivo no enfocable, "Quitar" visible con foco).
- [x] TIUX-48 Transferencia: custodio ordenado y filtrado por faena, etiqueta clara, fotos. Devolución: muestra la entrega de referencia y ofrece "En reparación".
- [x] TIUX-39 (parte) Filtros con semántica correcta y `scroll={false}`.
- [x] TIUX-44 (parte) Tarjetas móviles con estado de acuse y acciones de 44 px.
- [x] TIUX-58 (parte) El acta impresa vuelve al origen.
- [x] TIUX-46 (parte) Título y navegación "Entregas"; vocabulario entrega / custodia / acta.

### L4 — Mesa de ayuda
- [x] TIUX-04 "Cerrado" con Resolución; mínimo de 10 en cliente y servidor; error en el campo correcto.
- [x] TIUX-05 Los formularios conservan lo escrito al fallar.
- [x] TIUX-16 Vencimiento en la ficha ("Vence el … · en 2 días"); columna "Vence"; orden por urgencia por defecto y selector "Ordenar por" en servidor (los encabezados no ordenan porque la lista pagina en servidor).
- [x] TIUX-17 "Responsable" (con "Asignarme") separado de "Cambiar estado"; sin estado preseleccionado arbitrario.
- [x] TIUX-40 Línea de tiempo con comentarios y cambios de estado (con motivo); sin repeticiones.
- [x] TIUX-31 Aviso al solicitante en "Esperando usuario" y en comentarios públicos de TI; toast con código y enlace.
- [x] TIUX-42 Faena precargada, trabajador con búsqueda, prioridad con su plazo; pista hacia Soporte para "Plataforma CHOME".
- [x] TIUX-43 (parte) Mensajes de error sin duplicar, sin enums y bajo el campo correcto.
- [x] TIUX-39 (parte) Pastillas sin ceros; `aria-current` correcto.
- [x] TIUX-03 (parte) / 37 (parte) Columnas ordenables reales; "Asunto" como columna principal.
- [x] TIUX-44 (parte) Tarjeta móvil con prioridad, vencimiento y técnico.
- [x] TIUX-29 Reflow de la ficha a 320 px y texto al 200 %.
- [x] TIUX-52 (parte) Paginación y búsqueda en el servidor.
- [x] TIUX-53 (parte) / 38 (parte) / 60 (parte) / 61 (parte) `Callout` de resolución, notas internas sin signal, fechas uniformes, `Checkbox` del sistema.

### L5 — Mantenciones, garantías y bajas
- [x] TIUX-10 Editar y Anular mantención y Revertir baja en móvil.
- [x] TIUX-09 (parte) Baja sin motivo preseleccionado.
- [x] TIUX-21 (parte) Faena en las tres pantallas y en las tarjetas móviles de garantías.
- [x] TIUX-22 (parte) Tabla de mantenciones sin desborde.
- [x] TIUX-33 Filas anuladas o revertidas atenuadas con token, sin opacidad (incluida la pestaña de la ficha, hecha por L2).
- [x] TIUX-39 (parte) Ventanas de garantía sin solapes y con contadores; filtros en mantenciones y bajas.
- [x] TIUX-47 "Dar de baja" con contexto (custodio, aviso de cierre de custodia), botón final destructivo, "Autorizado por" en la lista, `assetId` para la ficha.
- [x] TIUX-13 (parte) Plantillas de historial de `maintenance.ts` y `retirements.ts` con etiquetas.
- [x] TIUX-20 (parte) Garantías usa `warrantyStatus()` compartido.
- [x] TIUX-63 Ranking de reemplazo relativo al costo del equipo.
- [x] TIUX-57 (parte) / 61 (parte) Errata "Vincúlalos"; `formatCLP`. *(Sin enlace en la tarjeta "Proveedores TI": no existe ruta de proveedores.)*

### L6 — Accesos y licencias
- [x] TIUX-02 Filtro por sistema: solo esa columna, solo trabajadores con registro, estado real precargado.
- [x] TIUX-18 Pestañas Accesos · Ingresos y egresos · Sistemas; acciones en `PageHeader`; matriz solo con quien tiene registro (interruptor "mostrar todos"); cabecera fija.
- [x] TIUX-19 El egreso lista los accesos, licencias y equipos vigentes de la persona, con acción en línea; dueño y fechas visibles; revisión de accesos activos de trabajadores inactivos.
- [x] TIUX-27 Nombres accesibles completos en la matriz; radios con foco, grupo y borde de control.
- [x] TIUX-44 (parte) Vista móvil por trabajador.
- [x] TIUX-06 "Asignar licencia" muestra el error; pregunta primero a quién se asigna.
- [x] TIUX-08 "Revocar" con `ConfirmDialog` que dice la consecuencia.
- [x] TIUX-41 Urgencia de renovación, responsable, costo por período, faena, revocadas plegadas, cupos ociosos.
- [x] TIUX-35 (parte) El buscador del TopBar filtra licencias.
- [x] TIUX-52 (parte) N+1 de licencias; matriz filtrada en SQL.
- [x] TIUX-57 (parte) / 61 (parte) "1 con acceso activo"; barra de progreso con `role`.
- [x] TIUX-30 (parte) Objetivos táctiles de matriz, checklist y "Revocar".

### L7 — Resumen, reportes y navegación
- [x] TIUX-14 / 15 "Atención hoy" por faena (actas sin acuse, préstamos vencidos, tickets vencidos o por vencer, garantías ≤ 30 d, licencias ≤ 14 d, accesos de inactivos, egresos pendientes, reparaciones largas), hasta 4 tiles accionables, como máximo 2 gráficos.
- [x] TIUX-26 Gráficos con alternativa textual, leyendas legibles y colores por estado.
- [x] TIUX-32 Reportes de tickets, licencias, accesos y egresos (faena y período), agrupados por tema.
- [x] TIUX-45 Navegación con nombres iguales a los títulos, agrupada en Equipos y Servicios; fila de TI en DESIGN.md. *(El enlace a Tipos de activo lo cubre L2 desde Inventario.)*
- [x] TIUX-52 (parte) Recharts con import dinámico real; `loading.tsx` en las rutas TI.
- [x] TIUX-57 (parte) / 59 (parte) "1 asignados"; encabezados h2.

## Decisiones de alcance

- **Tipografía de badges (parte de TIUX-38):** no se cambia. DESIGN.md manda a propósito que `default/info/outline` vayan en sans y las severidades en mono, y así funciona en toda la plataforma. Solo se corrigen variantes con semántica equivocada.
- **Buscador del TopBar oculto bajo 640 px (parte de TIUX-35):** es una decisión de la shell para toda la app; L1 lo evalúa, pero no se cambia solo para TI.
- **Constancia del acuse (TIUX-09):** se elimina el valor por defecto. Volver obligatoria la nota es una regla de negocio que no se decidió: queda opcional, con ayuda que explica qué registrar.
- **Avisos nuevos (TIUX-31):** solo al solicitante, solo en "Esperando usuario" y en comentarios públicos de TI, nunca al autor del propio comentario. Así se respeta la corrección de volumen de correos del 2026-10-05.

## Fase 2 — verificación (al final)

- [x] `npm run typecheck` · `npm run lint` — limpios (se corrigieron 5 errores de integración: un import en Accesos y tipos en una prueba)
- [x] `npm run test:fast` (11 371 ✓, 1 ✗ corregida: grupos de navegación fuera de `NAV_GROUP_ORDER`) · `npm run test:pglite` (252 archivos, 3 024 ✓)
- [x] `npm run db:verify-migrations` (351 entradas, checksums OK) · `db:generate` sin cambios · `0350_thin_shape` aplicada en `bodega_dev`
- [x] E2E completa (829 pruebas) en worktree desechable: 823 ✓. La regresión de PDTP (nombre del `Select`) se corrigió y reverificó; la falla de MIPER es preexistente en `main`. `ti-modulo.spec.ts` actualizado con títulos nuevos y 2 regresiones, que pasan.
- [x] Recorrido en navegador: 19 vistas × 2 tamaños, 0 errores de consola, 0 requests fallidos, **0 violaciones axe**, sin desborde; reproducción del P0 **rechazada**. Corregidos en esta fase: tabla del inventario a 1440 px, `pointer-events: none` tras abrir una hoja desde un menú, y foco que no volvía al menú.
- [x] Informe [`qa/reports/2026-10-05-ti-uiux-implementacion.md`](qa/reports/2026-10-05-ti-uiux-implementacion.md) (copiado en `latest.md`)

## Seguimiento (decisiones del usuario, 2026-10-05)

- [x] Spec E2E de MIPER alineada con el h3 de la actividad (commit `492ea9a2`).
- [x] Los motivos de cambios de estado y de responsable de un ticket los ve también quien lo reportó; los campos "Motivo" lo avisan. Las notas internas siguen solo para TI.
- [x] Tile "Alertas" de Analítica en `danger` ante una alerta crítica.
- [ ] Buscador de la shell en móvil (TIUX-35): pendiente de decisión de diseño.
