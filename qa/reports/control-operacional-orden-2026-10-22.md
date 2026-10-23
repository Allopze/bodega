# Recorrido de navegador — Reordenamiento del área «Control operacional»

Fecha: 2026-10-22 · Rama `feat/control-operacional-orden` (sin merge, push ni deploy) · Entorno: `next dev` local (:3001) sobre `bodega_dev` (360/360 migraciones) · Sesión: usuario QA (`playwright/.auth/monkeytest.json`, rol administrador) · Herramienta: Chromium de `@playwright/test` + `@axe-core/playwright` (WCAG 2.1 A/AA).

## Qué cambió

El área tenía 10 ítems planos de tres módulos, y Combustibles repetía importar, análisis, revisión y sellos por cada fuente del dato (TCT, TAE, control de cargas). Ahora el menú se ordena por tarea:

| Grupo | Ítems |
|---|---|
| Seguimiento | Panel operacional |
| Flota | Vehículos · Monitoreo GPS · Mantenciones |
| Combustible | Consumo y rendimiento · Cargas · Revisión · TAE y sellos · Facturas y pagos |

Cada sección de Combustible tiene una barra de pestañas (`SectionNav`). Hay una sola entrada «Importar» que pregunta qué fuente se importa, y el panel tiene 4 tiles accionables con una tira de desempeño. `/combustibles/analisis` y `/combustibles/reportes` redirigen.

## Alcance recorrido

- Escritorio 1440 px: 31 vistas, todas HTTP 200 y sin la pantalla de error.
  - Las 9 entradas del menú.
  - Las pestañas de cada sección.
  - Los importadores y la configuración.
  - Los dos filtros nuevos (`/flota?estado=detenidos`, `/mantenciones?status=abiertas`).
  - Las tres redirecciones (`/combustibles/revision`, `/analisis?faena=x`, `/reportes?desde=…`).
- 375 y 768 px: panel, Consumo y rendimiento, rendimiento por familia, TAE y Mantenciones.
- Interacción: el botón «Importar» de Cargas abre el selector con las 4 fuentes, y «Log operacional» abre la pestaña `?tab=operaciones`.

## Resultado

| Chequeo | Resultado |
|---|---|
| Ítem activo del menú | Correcto en las 31 vistas, incluidas las rutas alias (`/combustibles/control/revision` → Revisión, `/combustibles/control/sellos` → TAE y sellos, `/combustibles/control/registrar` → Cargas) |
| Pestaña activa (`aria-current`) | Correcta en todas las secciones |
| Errores de consola | 0 |
| Respuestas de red ≥ 400 | 0 (se excluye el avatar de dicebear, sin internet) |
| axe WCAG 2.1 A/AA | 0 violaciones en 12 vistas |
| Desborde horizontal | 0 a 375, 768 y 1440 px |
| Tile ↔ lista (A1) | «Combustible por revisar 4» = pestaña «Anomalías 4» = «4 casos encontrados» en `?estado=vigentes` |

## Pruebas deterministas

`typecheck`, `lint`, `db:verify-migrations`: verde.
- `test:fast`: 996 archivos y 13.221 pruebas.
- `test:pglite`: 274 archivos y 3.300 pruebas.
- E2E (17 specs de las áreas tocadas): 140 pasan y 1 se salta.
  - Specs: combustibles, combustibles-control, flota, flota-documentos, mantenciones, module-toggles, reflow-anchos, keyboard-navigation, densidad-kpi, densidad-kpi-filtros, tae-reconciliation, tae-history-import, shell-scroll, dashboard, admin-index, catalogs-migrated, ui-ux-audit-evidence.
  - La única falla de la primera corrida fue `module-toggles`: el interruptor de submódulo ahora se llama «Desactivar Vehículos». Se ajustó la spec y volvió a pasar 6/6.

## Hallazgos

| Tipo | Hallazgo | Estado |
|---|---|---|
| INCONSISTENCIA | La pestaña «Anomalías» contaba solo casos vigentes y la lista abría con todos los estados. | Corregido: filtro `estado=vigentes`, que es el destino de la pestaña y de `/combustibles/revision`. |
| INCONSISTENCIA | `/combustibles/control` se titulaba «Control de combustible» y su pestaña y miga decían «Cargas por equipo». | Corregido. |
| UX FINDING | En el menú, «Consumo y rendimiento» se trunca («Consumo y rendimie…») cuando está activo, porque va en negrita. | Abierto. |
| FUNCTIONAL FINDING (previo) | `/combustibles/nueva` y `/combustibles/[id]` muestran y editan montos sin exigir `combustibles:view_costs`. | Abierto; no lo introdujo este cambio. |

## Cobertura que falta

- No se recorrió con un rol acotado por faena ni sin `view_costs`. La visibilidad por permiso la cubren las pruebas de paridad menú–página y de navegación.
- `bodega_dev` tiene pocos datos: los tiles del panel se vieron en su estado vacío («Ninguno», «Todo operativo»), salvo combustible.
- No se corrió la suite E2E completa, solo las 17 specs relacionadas.

## Segunda ronda (misma fecha): pendientes cerrados

| Tipo | Cambio |
|---|---|
| PRODUCT BUG (previo) | Crear, editar, registrar, eliminar e importar cargas facturadas exigían solo su permiso, sin `view_costs`, aunque muestran y graban montos. Ahora lo exigen la página, la acción y `/api/combustibles/import`. La ficha `/combustibles/[id]` redacta los montos en el servidor para quien llega desde Cargas sin costos. **Efecto:** `jefe_mantencion` ya no crea ni edita cargas facturadas; conserva «Registrar carga» del control y la corrección de medidor. |
| UX FINDING | El menú dice «Consumo», porque «Consumo y rendimiento» activo se truncaba por 2 px; el título de la página no cambia. Anomalías tiene estado vacío con acción y aviso de datos degradados: antes una consulta fallida se leía como «Aún no hay anomalías». Los `loading.tsx` reservan la barra de pestañas. La tira del panel distingue danger y signal. |
| INCONSISTENCIA | El importador de facturas pasó a ser la 5.ª opción del único «Importar». Al guardar una carga facturada se vuelve a Facturas y pagos. Se unificaron «Reglas de anomalías» y el Excel «Cargas de combustible». Los enlaces del dashboard usan los nombres del menú. |
| Deuda | Un solo criterio de vencimiento de flota (`resolveNextExpiryDate`). La exportación del panel ya no consulta los conteos de atención. Se retiró el código muerto (`accountableOnly`, `ProductPieChart`, estadísticas sin uso) y se actualizaron GAP_MODULO_COMBUSTIBLE.md §11, `docs/plan.yml` y `docs/auditoria-componentes.md`. |

### Verificación de la segunda ronda

- `typecheck`, `lint`, `db:verify-migrations`, `check:secrets`, `check:security-audit` (en el checkout principal): verde.
  - En el worktree, `check:security-audit` falla por el `node_modules` enlazado; con las mismas dependencias pasa en el checkout principal.
- `test:fast`: 1.001 archivos y 13.270 pruebas. `test:pglite`: 274 archivos y 3.300 pruebas.
- **Suite E2E completa:** 943 pasan, 4 se saltan y falló 1.
  - La falla era de la propia prueba nueva: el localizador ubicaba el menú por el Panel, que el rol sin costos no ve.
  - Se corrigió el localizador; `control-operacional-navegacion` y `densidad-kpi` pasan 44/44.
- Navegador: 11 vistas sin errores ni desborde. Las 5 opciones de «Importar» aparecen; la de facturas abre su modal y cierra el selector.
- E2E nuevas:
  - Navegación del área, alias, pestañas, «Importar», Revisión y rutas retiradas.
  - Tiles del panel, con navegación real y filtro activo.
  - Tres roles acotados: sin permisos del área, solo inspecciones, y combustible sin costos (nuevo en el seed).

### Sigue abierto

- Merge a `main` hecho en local; falta push y deploy.
- Si en producción algún interruptor de submódulo está apagado para `/combustibles/importar`, `/analisis` o `/control`, deja de aplicarse. Es de bajo riesgo porque el área todavía no se usa.
- El gráfico de distribución de Anomalías no filtra por `?ref=` (ya pasaba antes).
- `docs/.knowledge` y el registro de docs se regeneran con sus scripts; no se regeneraron.
- Con el rótulo «Consumo», la búsqueda ⌘K no encuentra «rendimiento».
