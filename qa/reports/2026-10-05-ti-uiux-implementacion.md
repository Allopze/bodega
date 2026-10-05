# Implementación UI/UX del módulo TI — 5 de octubre de 2026

Implementa los 63 hallazgos de [2026-10-05-ti-uiux-audit.md](2026-10-05-ti-uiux-audit.md) según [PLAN_MEJORA_UIUX_TI_2026-10-05.md](../../PLAN_MEJORA_UIUX_TI_2026-10-05.md). Rama `fix/ti-uiux-audit`, base `8553b7e4`, sin commits todavía.

**Este informe es evidencia de verificación técnica.** No mide comprensión con usuarios reales ni recorre roles con alcance de faena: la sesión QA es de administrador.

## Resultado

- **P0 (TIUX-01) cerrado y verificado.** La reproducción que antes se aceptaba ahora se rechaza: "Este activo está dado de baja: la baja se revierte desde Bajas, con su permiso". El activo sigue en "Dado de baja". La ficha ya no ofrece corregir el estado en estados terminales. Dos pruebas PGlite de regresión.
- **59 hallazgos resueltos, 3 parciales con motivo y 1 sin cambio por decisión.** El detalle está en "Estado por hallazgo".
- **Puertas deterministas:** typecheck, lint, `test:fast`, `test:pglite`, verificación de migraciones, `check:secrets` y `check:security-audit` en verde.
- **E2E:** 823 de 829 pasan. Una regresión de esta rama (nombre del `Select` en PDTP) se corrigió y se reverificó. La otra falla es preexistente en `main` (spec de MIPER desactualizada) y ajena a TI.
- **Navegador:** 19 vistas × 2 tamaños, 0 errores de consola, 0 requests fallidos, **0 violaciones axe** (WCAG 2.2 AA) y sin desborde horizontal. Los objetivos táctiles bajo 44 px en móvil bajan de **285 a 13**; de esos, 8 son falsos positivos: inputs nativos ocultos de Radix y un enlace dentro de una oración, que WCAG 2.5.8 exime. Los 5 reales se corrigieron después de medir.
- **Detector Impeccable:** 0 hallazgos en `app/(app)/ti` (antes 2).

## Verificaciones ejecutadas

| Puerta | Resultado |
|---|---|
| `npm run typecheck` | Pasa. Hubo 5 errores de integración entre líneas de trabajo, corregidos: un import roto en Accesos y tipos posiblemente indefinidos en una prueba. |
| `npm run lint` | Pasa |
| `npm run test:fast` | Primera corrida: 1 falla, corregida (los grupos de navegación nuevos no estaban registrados en `NAV_GROUP_ORDER`). Final: 891 archivos / 11 374 pruebas pasan. |
| `npm run test:pglite` | 252 archivos / 3 024 pruebas pasan (1 omitida) |
| `npm run db:verify-migrations` | Pasa: 351 entradas hasta `0350_thin_shape`, checksums verificados. `db:generate` dice "No schema changes". |
| Migración en `bodega_dev` | `it_asset_assignments.expected_return_date` (`date`) aplicada con `db:migrate` |
| E2E completa en worktree desechable | 823/829 pasan. Corregida la regresión de PDTP; la de MIPER es preexistente (ver "E2E"). |
| `check:secrets` · `check:security-audit` | Pasan |
| Detector Impeccable (`detect app/(app)/ti`) | 0 hallazgos |

## Defectos encontrados y corregidos durante la verificación

1. **PRODUCT BUG: la página dejaba de responder a clics después de abrir una hoja desde un menú "Más".**
   - *Causa:* un `DropdownMenu` modal deja `pointer-events: none` en el `body`. La hoja se monta en ese mismo momento, guarda ese valor como si fuera el original y lo restaura al cerrarse.
   - *Medición:* en Entregas, tras "Más → Transferir" y Esc, el `body` quedaba en `none`.
   - *Corrección:* los tres menús de TI que abren hojas pasan a `modal={false}`. Después: `pointer-events: auto` y el menú vuelve a abrir en los cuatro casos probados.
   - *Regresión:* `e2e/ti-modulo.spec.ts`.
2. **Foco perdido al cerrar un diálogo abierto desde un menú.**
   - *Causa:* el ítem de menú que tenía el foco desaparece al cerrarse el menú.
   - *Corrección:* `useReturnFocus` (`components/ui/dialog-focus.ts`) devuelve el foco al botón que abrió el menú, identificado por el `aria-labelledby` del contenido.
   - *Regresión:* prueba unitaria y E2E.
3. **El inventario volvía a desbordar a 1440 px (1280/1126 px).** Al reemplazar "Mant." por "Mantenciones" se cortaba esa columna y la de Tickets quedaba fuera de vista. Costo y Tickets pasan a ocultos por defecto: siguen en "Columnas" y en la ficha.
4. **Objetivos táctiles residuales en móvil.** Se corrigieron:
   - el `Combobox` compartido, que medía 32 px y ahora mide 44 px en móvil como `Input` y `Select`;
   - "Ver datos" de los gráficos;
   - los códigos enlazados en las tarjetas de Entregas y Mantenciones y en la ficha del ticket.
5. **La pestaña de la ficha decía "Asignaciones"** mientras el resto del módulo dice "Entregas". Corregido.
6. **REGRESIÓN fuera de TI: un `Select` con nombre propio se renombraba.** El cambio compartido de TIUX-25 hacía que un trigger con `aria-label` dentro de un `Field` tomara el nombre del campo. Lo detectó `e2e/pdtp-objetivos.spec.ts`. Corregido en `components/ui/select.tsx`, con prueba unitaria; la E2E pasa en el reintento.

## Estado por hallazgo

**Resueltos (59):** todos los TIUX-01 a TIUX-63 salvo los cuatro de abajo. Dos de los resueltos tienen alcance acotado por decisión:

- **TIUX-38:** se corrigieron las variantes con semántica equivocada ("En préstamo" ya no comparte verde con "Disponible", notas internas sin `signal`, pendientes en `signal`). La tipografía mixta de badges se mantiene porque es regla deliberada de DESIGN.md para toda la plataforma.
- **TIUX-09:** se eliminó todo valor por defecto (acuse, motivo de baja, estado físico). La nota del acuse sigue opcional: volverla obligatoria es una regla de negocio no decidida.

**Parciales (3):**

| ID | Qué falta y por qué |
|---|---|
| TIUX-16 | Los encabezados de la tabla de tickets no ordenan: la lista ahora pagina en servidor y un orden por encabezado solo ordenaría la página cargada. Se reemplazó por "Ordenar por" (`?orden=`), con urgencia por defecto. |
| TIUX-35 | El buscador de la shell sigue oculto bajo 640 px **en toda la app**: en el teléfono ninguna lista se filtra por texto. Es una decisión de shell, no de TI, y queda pendiente. En TI ya no aparece donde no filtra nada. |
| TIUX-52 | Solo Mesa de ayuda pagina en servidor. El inventario (cientos de filas) sigue paginando en cliente, el historial se limita a 200 eventos y la matriz de accesos filtra en SQL. |

**Sin cambio (1):** TIUX-58. El chip "Tu faena" sobre listas multifaena se mantiene: cambiarlo requiere que cada lista declare su filtro de faena (`useHasWorksiteFilter`).

**Fuera de los hallazgos:** la tarjeta "Proveedores TI" de Garantías sigue sin enlace, porque no existe una ruta de proveedores.

## Cambios de comportamiento que conviene conocer

- **Entregas:** un préstamo exige "Devolver a más tardar". La entrega y la devolución exigen estado físico, porque se quitó el "bueno" por defecto que también aplicaba el servidor.
- **Activos:** no se puede salir a mano de "Dado de baja", ni de "Perdido" o "Robado" cuando tienen una baja vigente.
- **Tickets:**
  - "Cerrado" exige resolución, con un mínimo de 10 caracteres en cliente y servidor.
  - La categoría es obligatoria al crear.
  - Reasignar un ticket que ya tiene responsable exige motivo.
- **Avisos nuevos:** llegan solo al solicitante, cuando el ticket pasa a "Esperando usuario" (`ti_ticket_waiting_user`) y cuando TI escribe un comentario público (`ti_ticket_comment`). Nunca le llegan al autor del cambio y las notas internas no avisan.
- **Navegación de TI:**
  - **Seguimiento:** Resumen y Reportes TI.
  - **Equipos:** Inventario, Entregas, Mantenciones, Garantías y proveedores, Bajas.
  - **Servicios:** Mesa de ayuda, Accesos, Licencias.

  Los nombres coinciden con los títulos de página. Hrefs y permisos no cambian.
- **Vocabulario:**
  - checklists "Ingreso/Egreso" (antes "Alta/Baja");
  - acceso "Revocado" (antes "Baja");
  - página "Entregas" (antes "Asignaciones") y "Mesa de ayuda" (antes "Tickets TI").
- **Cambios globales fuera de TI:**
  - **Foco:** todo `Dialog`/`Sheet` devuelve el foco al botón que lo abrió.
  - **`Select` dentro de `Field`:** expone `aria-invalid`/`aria-describedby` y su nombre accesible pasa a ser la etiqueta del campo.
  - **Tamaños:** el `Combobox` mide 44 px en móvil, lo mismo que los botones de catálogo y el "Cerrar" de los diálogos.
  - **`KpiCard` con tono `signal`:** pinta la cifra en `signal-ink`.
  - **Campana:** ya no anima con "reducir movimiento".

## Decisiones tomadas tras el informe

1. **Spec E2E de MIPER desactualizada.** Corregida en el commit aparte `492ea9a2`: `prevencion-miper-interacciones.spec.ts:43` espera la actividad como h3, como la pinta la UI desde `6d4c3c63`. Pasa 8/8.
2. **Motivos de los cambios de un ticket.**
   - Ahora los ve todo el que ve el ticket, incluido quien lo reportó: le dicen por qué espera o quién lo toma.
   - Las notas internas siguen siendo solo de TI.
   - Los dos campos "Motivo" avisan "Lo ve también quien reportó el ticket", para que lo reservado se escriba como nota interna.
   - Cambio en `getTicketTimeline` (`lib/services/ti/tickets.ts`), con prueba PGlite actualizada (24/24).
3. **Buscador de la shell en móvil (TIUX-35).** Sigue pendiente, como decisión de diseño de toda la app.
4. **Analítica.** El tile "Alertas" usa tono `danger` cuando hay una alerta crítica, en vez de `signal`, que está reservado a pendientes (`app/(app)/analitica/page.tsx`). `analytics-ranking-table.tsx` también usa `signal` y no se revisó.

Verificación de estos cambios:

- lint y typecheck limpios;
- navegador: la ficha del ticket muestra la ayuda y el motivo en el historial, y Analítica carga sin errores;
- E2E en worktree desechable: `pdtp-objetivos`, `prevencion-miper-interacciones` y `ti-modulo`, 16/16.

## Datos que quedaron en `bodega_dev`

- Set `QA_` sembrado para la auditoría.
- Préstamo de QA-CEL-001 con vencimiento el 03-10-2026, para ver "Préstamo vencido".
- Trabajador inactivo `QA_Exfuncionario TI` con un acceso activo, para la revisión de inactivos.
- `QA-NB-099`, el activo inconsistente de la reproducción original del P0: quedó disponible con su baja vigente.
- `QA-NB-098`, reproducción posterior al arreglo: sigue dado de baja.
- Un comentario `QA_` en INC-2026-0001.

## E2E

Corrida en un worktree desechable (`bodega-wt/e2e-ti-uiux`, contenedor `bodega-e2e-postgres`), para no borrar el `.next` del dev server.

| Corrida | Resultado |
|---|---|
| Suite completa (140 specs, 829 pruebas) | **823 pasan**, 2 fallan, 4 omitidas (34,6 min) |
| Reintento dirigido con build nuevo: `ti-modulo`, `pdtp-objetivos`, `prevencion-miper-interacciones`, `combustibles`, `zoom-200`, `keyboard-navigation` | **74 pasan**, 1 falla |

**Las dos fallas:**

1. **`pdtp-objetivos.spec.ts`: regresión causada por esta rama. Corregida y verificada.**
   - *Causa:* el reenvío de `aria-labelledby` del `Field` al trigger del `Select` (TIUX-25) le ganaba al `aria-label` propio del trigger. "Seleccionar objetivo" pasaba a llamarse como la etiqueta del campo.
   - *Corrección:* un trigger con `aria-label` conserva su nombre.
   - *Regresión:* `components/__tests__/select.test.tsx`.
   - *Resultado:* pasa en el reintento.
2. **`prevencion-miper-interacciones.spec.ts:33`: falla preexistente en `main`, ajena a TI** (corregida después en `492ea9a2`; ver "Decisiones tomadas").
   - La spec espera la actividad como `heading` de nivel 2.
   - El commit `6d4c3c63` (5-oct 00:47, auditoría MIPER) la cambió a propósito a h3, bajo "Por actividades y tareas". La última actualización de la spec es anterior (`7934efd2`, 4-oct 16:32).
   - Ningún archivo de MIPER cambia en esta rama. Falla igual en el reintento. Queda para mantenimiento de las pruebas de MIPER.

`ti-modulo.spec.ts` se actualizó con los títulos nuevos y suma dos regresiones:

- "Corregir estado" abierto desde el menú de la ficha no deja la página sin clics y devuelve el foco al menú;
- "Cerrado" ofrece el campo Resolución.

Ambas pasan.

**Otras puertas tras los últimos arreglos:**

- `npm run typecheck`, limpio.
- `npm run test:fast`: 891 archivos / 11 374 pruebas.
- `npm run check:secrets`, pasa.
- `npm run check:security-audit`: hallazgos cubiertos por el allowlist vigente.

## Evidencia

- Capturas y JSON del recorrido: `qa/reports/evidence/2026-10-05-ti-uiux-implementacion/`, ignorada por git.
- Evidencia de la auditoría: `qa/reports/evidence/2026-10-05-ti-uiux-audit/`.
