# QA de la Fase 1 Trinorma (2026-11-21)

**Alcance.** La rama `feat/mantencion-trinorma` (WP0–WP4) recorrida en el navegador. El servidor fue `next dev` en :3003 desde el worktree, sobre `bodega_trinorma`: un clon local de producción del 2026-11-21 03:34, sin credenciales de integraciones y con los correos apagados. Al clon se le aplicaron la 0397 y la 0398, los maestros sin la unión de Arauco y la importación del consolidado. Recorrido asistido con Playwright (Chromium), no MonkeyTest.

**Usuarios:**
- QA global (administrador, jefe de mantención y otros roles);
- `QA_admin_contrato_bio`: admin_contrato y, sólo en el clon, supervisor_mantencion, con la faena Biodiversa.

## Puertas deterministas

| Puerta | Resultado |
|---|---|
| `npm run typecheck` | ✅ sin errores sobre la rama final (6c8d2c67b) |
| `npm run lint` | ✅ 0 errores; los 2 avisos de imports sin uso que dejó la integración se corrigieron (6c8d2c67b) |
| `npm run test:fast` | 1.429 archivos y 21.498 pruebas en verde, con **1 falla** (`equipment-detail-view.test.tsx`, que esperaba el texto viejo «Faena: Santa Fe» del formulario de OT). Corregida: la prueba pasa (10/10) |
| `npm run test:pglite` | 429 de 432 archivos en verde (5.519 pruebas). 3 archivos fallaron: 2 por el índice único nuevo, corregidos y en verde (`apply-vencimientos-planilla-2026-11`, ahora con intercambio de códigos en dos fases; un fixture de `fuel-sources-status` que repetía «KA-1»). El tercero, `module-toggles`, falla **igual en `main` a47271fd3** por las rutas `/apps/recientes` y `/apps/visita` de la vista Apps de TI: deuda previa, ajena a la rama |
| `npm run db:verify-migrations` | ✅ 399 entradas hasta la `0398_furry_luckman`; sin identificadores nuevos sobre 63 bytes |
| Migración sobre datos reales | ✅ la 0398 se aplicó sobre el clon de producción, índice único incluido |
| `npm run test:e2e` (14 specs de Flota, Mantención, historial, indicadores, densidad del tablero y contratos; base `bodega_e2e_trinorma` propia, :3100) | 87 en verde y 4 fallas. 2 de la rama, por textos de interfaz que cambiaron (formulario de OT y nombre del botón de exportar del Panel): specs actualizadas, y en la segunda corrida pasaron las 21 pruebas de esos dos archivos, incluidas las 17 que no habían corrido. 2 ajenas: `legacy-mantenciones-retired` y `mantencion-historico` fallan sólo por `POST /api/apps/visita` abortado (la baliza de la vista Apps de TI); el resto de sus aserciones pasa. No se corrieron contra `main` para confirmarlo |

## PASS: verificado en el navegador

| # | Pantalla | Resultado |
|---|---|---|
| 01–02 | `/mantencion/panel`, período por defecto y jun-2025 a nov-2026 | Secciones «Trabajos de mantención» y «Pautas y hallazgos de formularios» con datos reales; 0 errores de consola o red |
| 03 | Panel con la faena Biodiversa | 485 trabajos (485 del historial, 0 de OT); 52 % de correctivas (189 de 366 clasificados, 119 sin clasificar aparte); 121 días en taller; 1.670,5 horas hombre |
| 04 | Panel con `?equipo=` (KA-141) | Acotado al equipo, con enlace a la hoja de vida |
| 05 | Exportar Excel (Biodiversa) | Se descarga |
| 06 | Exportar PDF (Biodiversa) | 200 `application/pdf`, 2 páginas: portada, trabajos por tipo y mes, por faena, equipos con más correctivas, pautas con «Sin pauta definida», checklist (98 % sobre 4 pautas) y hallazgos «mal estado» (308 con equipo, 246 sin trabajo ni OT en 7 días) |
| 07 | `/mantencion/registros/historicos` | «Horas hombre», tipo de acción, contrato y posible prueba visibles |
| 08 | `/mantencion/ot`, «Nueva orden» | Tipo de acción, especialidades, faena de imputación de sólo lectura y faena de ejecución |
| 08b | Alta de una OT correctiva (KA-141, mecánica) | Queda `OT-BIO-0002` con `action_type = correctiva`, `specialties = {mecanica}`, `repair = true` (prellenado), imputada a BIODIVERSA, con auditoría `create` |
| 09 | `/admin/faenas`, «Tipo y alias» de Flor del Laja | Tipo «Depósito»; sin alias propios |
| 10 | `/flota?ubicacion=confirmar` | Filtro y marca «Ubicación por confirmar» |
| 11 | Ficha KCH-135 | Propietario visible; el diálogo «Propietario y ubicación» lista el catálogo cargado desde el inventario |
| 12 | `/admin/parametros-operativos` | Sección «Mantención» con los tres parámetros |
| 20–22 | Usuario acotado a Biodiversa: Panel, `faena=` de Santa Fe y `equipo=` de CR-49 (Santa Fe) en la URL | Sólo ve Biodiversa; la faena y el equipo ajenos se ignoran; no aparece ningún nombre de otra faena |
| 23 | Usuario acotado pide el PDF de Santa Fe | Recibe el de Biodiversa, con el mismo texto que el del usuario global; «Santa Fe» no aparece |

Capturas, textos y PDF en el scratchpad de la sesión (`qa/out/`), fuera del repo porque contienen datos de producción.

## PRODUCT BUG: encontrado y corregido en el recorrido

- **`/admin/faenas` daba 500 en `next dev`**: un pánico de Turbopack, «does not support external modules (request: node:net)».
  - **Causa:** los diálogos nuevos «Tipo y alias» y «Propietario y ubicación», que son componentes de cliente, importaban constantes desde servicios que arrastran la conexión a la base (`lib/services/worksite-kind.ts` y `lib/services/fleet-owners.ts`).
  - **Arreglo:** las constantes se movieron a `lib/worksites/worksite-kind.ts` y `lib/fleet/fleet-owner-kinds.ts`, sin dependencias de servidor, y los servicios las reexportan.
  - **Verificación:** el recorrido se repitió en verde. Además se comprobó que ningún otro componente de cliente nuevo de la rama importa servicios de servidor.
  - Los tests unitarios no lo detectaban, porque Vitest no compila los límites cliente/servidor de Next.

## FUNCTIONAL FINDING (decisión del usuario)

1. **Patentes cruzadas de KCH-133, KCH-135 y KCH-136.**
   - El consolidado las asocia de otra forma que la flota (consolidado: 133 = SRCJ-47, 135 = SRCJ-42, 136 = SRCJ-39; flota: 133 = SRCJ-42, 135 = SRCJ-39, 136 = SRCJ-47).
   - Quedan en conflicto, sin equipo ligado, **66 mantenciones y 270 inspecciones**. Más 2 filas de KCH-126 con KXZD-19.
   - Cuentan en los totales y en la faena, pero no en los indicadores por equipo ni en «hallazgos sin trabajo» (que necesita el equipo).
   - Hay que confirmarlas contra el padrón.
2. **16 equipos del consolidado no están en la flota**, con 112 mantenciones. Son las grúas H-1, H-2 y H-13, las bateas KCB-001/002/003/010, CA-47/81/82/85, KRR-002, SXCV-49, LCTC-21, «ESTRUCTURA DE LIMPIEZA» e «HIDROLAVADORA». Crearlos lo decide el usuario.
3. **Administradores de contrato.** En producción el rol `admin_contrato` sólo tiene permisos de OT (`mant:ot:*`): no ve el Panel ni exporta. Si deben ver y exportar el Panel de su faena, hay que darles `mant:records:view_worksite` y `mant:export`. El alcance por faena ya está verificado (filas 20–23).
4. **Unión de las dos Arauco** (pendiente de autorización). Sin ella, las 27 mantenciones con FAENA = ARAUCO se imputan a la «Arauco» inactiva del seed (MANT-ARA), junto con las 18 que ya estaban. Un usuario acotado no las ve.

## UX FINDING

- **Pautas con «Sin lecturas».** En el Panel de Biodiversa, «Pautas y disponibilidad» muestra 8 equipos con pauta, todos sin lecturas. El 0 % «al día» es real (producción no tiene lecturas iniciales), pero el auditor podría leerlo como incumplimiento. Conviene cargar las lecturas iniciales antes del 01-12.
- **El universo del semáforo de pautas** son los equipos con ficha de Mantención. Las bateas y los carros sin ficha no aparecen ni como «Sin pauta definida».

## INCONSISTENCY

- En «Equipos con más correctivas», los equipos sin código se rotulan con la patente tal como está guardada en la flota (`JN9376`, `PWTY84`), sin guion. Es el dato de la flota, no del tablero.

## COVERAGE GAP

- No se recorrió la app móvil del mecánico ni el término de una OT en el navegador: el alta sí; el término lo cubren las pruebas PGlite (`trinorma-ot-pglite`).
- No se ejecutó la unión de Arauco (`--unir-arauco`) sobre el clon. Sí está cubierta en PGlite.
- Las vistas móviles (cards `md:hidden`) no se recorrieron en el viewport móvil.
- MonkeyTest no se corrió; esto es un recorrido asistido de alcance acotado a las pantallas tocadas.

## AUTOMATION WARNING

- El MCP de Playwright no arranca en esta máquina. Se usó el Chromium de `@playwright/test` desde un script.

## Revisión y auditoría

- Revisor (Sonnet, `high`) por paquete: WP1, WP2, WP3 y WP4.
  - Un bloqueante en WP4: `"use server"` exportaba una función síncrona, lo que hacía caer el Panel en dev y build. Corregido.
  - Los importantes, corregidos.
- Auditor crítico (Opus, `xhigh`, en sesión aparte) sobre toda la rama:
  - **B1**, índice único y datos de producción: descartado con evidencia. La 0398 se aplicó sobre el clon de producción; producción no tiene equipos inactivos ni colisiones tras normalizar. Se agregó la consulta de control antes del deploy.
  - **I2**, prueba de la OT que fallaba entre las 00:00 y las 02:00 de Chile: corregida.
  - **M7**, la clave en TypeScript no calcaba el índice SQL con letras no ASCII: corregida y probada.
  - **I3**, rechazo de «no es equipo» no auditable: el informe ahora cuenta las filas de EQUIPOS con esa categoría (10 de 155 en el archivo real).
  - **I6**, el detalle del historial muestra correo y conductor de los formularios: es el patrón existente, ahora con unas 3.700 filas. Lo decide el usuario.

## Cierre

- **Commits** de la rama `feat/mantencion-trinorma` (sin push ni merge): d422858df (WP0), 0bd8019ec (WP3), 9f24affe6 (WP1), b0d17db03 (WP4), 0363f54bc (WP2), f91217e05 y 6c8d2c67b (correcciones), más las specs E2E y estos informes.
- **Producción no se tocó.** Hubo sólo lecturas autorizadas: el estado, las claves del historial, la flota y el `pg_dump` del clon.
- **Para producción falta**, en este orden:
  1. merge a `main` en turno con las otras sesiones;
  2. deploy (lo corre el usuario);
  3. maestros e importador, primero en simulación y después `--apply`, con autorización explícita y respaldo.

  Ver `docs/mantencion/trinorma/DESPLIEGUE.md`.
- **Decisiones pendientes:** las de «FUNCTIONAL FINDING» arriba.
