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
