# Reporte de Equipos: papel de noviembre, v03 e indicadores — QA 2026-11-17

Rama `feat/reporte-equipos-papel`. Este informe cubre lo que se verificó y lo que no.

## Qué cambió

1. **Plantilla `reporte_equipos` v03.**
   - Los domingos no se programan.
   - Se ocultan las secciones que no aplican al tipo de equipo.
   - Se valida que el horómetro de término sea ≥ al de inicio.
   - Admite lo que el papel trae en blanco: firmas, turno, área y horómetros.
   - Los detalles están en `lib/sst/definitions/reporte-equipos*.ts`, `lib/prevention/inspections.ts` y `lib/services/prevention-inspection-scheduler.ts`.
2. **«Incorporar» una versión nueva de una plantilla** ahora hereda el nombre y el ejecutor de registro del catálogo PDTP (`catalogDefaultsFor`). Antes la v03 nacía como «Reporte de Equipos» con `platform_user`, y quien transcribe ya no podía revisar su propia transcripción.
3. **Panel de mantención: sección «Reportes de equipos».**
   - Una tira de 4 cifras: recibidos/esperados, firmas completas, horas operadas y fallas abiertas.
   - Cuatro gráficos: reportes por día, horas por equipo, fallas abiertas por antigüedad y fallas por sistema.
4. **`scripts/import-reporte-equipos-papel-2026-11.ts`.** Carga de los 30 papeles del 2 al 9-11 por los servicios oficiales, con consolidación «una abierta por falla».

## Evidencia

### Ensayo sobre una copia de producción

`pg_dump` de solo lectura del 2026-11-17, restaurado como `bodega_reporte_equipos`, 391 migraciones. Se repitió tres veces desde cero.

- **v03:** importada como borrador. La aprobación exige una fuente documental oficial que producción no tiene (ver «Pendiente»), así que el ensayo saltó esa sola puerta en la copia. Al aprobarla, los 6 programas y los 20 reportes planificados pasaron a la v03.
- **Carga:**
  - Los 30 reportes quedaron con `ingestion_source = legacy_document_import`, cada uno con la foto de su página como documento fuente (8,6 MB).
  - La consolidación cerró 18 hallazgos repetidos.
  - 25 reportes quedaron revisados y 5 esperan CAPA.
- **Fallas abiertas: 15.** Calzan con la hoja «Hallazgos» del Excel del supervisor.
  - Frenos del H-14 y del H-16.
  - Alarma de retroceso y bocina del H-15.
  - Neumáticos, cilindro hidráulico, techo, aire acondicionado y limpiaparabrisas del H-14.
  - Motor sobreacelerado, vidrio y asiento del H-16.
  - Luz baja del KPL-133.
  - Tablero del H-4.
  - Parabrisas del H-15.
- **Una falla grave o fatal no se cierra porque un papel posterior la marque normal.** Así pasa con los frenos largos del H-14: el 09-11 vienen marcados normal, pero la reparación la verifica la CAPA y su OT.
- **Avisos:**
  - Se crearon 70 «Inspección pendiente de revisión». La carga marcó como leídos los 45 de los reportes que ella misma dejó revisados.
  - El bundle de producción reemplaza `@/lib/email/smtp` por un módulo nulo, así que no sale ningún correo.
- **Domingo 15-11:** se cancelaron sus 5 reportes planificados.
- **Idempotencia:** el bundle de producción, corrido otra vez sobre la copia ya cargada, no escribió nada.

### Navegador

`next dev` :3002 contra la copia, con usuario QA y viewport de 1440 y 390.

- El Panel, con faena Santa Fe y período 01–17-11, muestra:
  - 30 de 45 reportes recibidos (66 %);
  - 11 de 30 con las tres firmas (36 %);
  - 83,5 h operadas;
  - 15 fallas abiertas, 9 de seguridad.
- Los gráficos se ven y no hay desborde horizontal en 390 px.
- 0 errores de consola y 0 respuestas 5xx.
- La ficha del reporte 023502 (H-16) muestra la planilla escaneada junto a la transcripción y los hallazgos con «Derivar a CAPA». No aparecen las secciones de acoplado ni las exclusivas.
- Programación muestra «Diaria (lunes a sábado)».
- **Defecto encontrado y corregido.** Las desviaciones sin ítem contaban su antigüedad desde que se transcribieron, no desde el reporte, y salían «0 a 3 días». Ahora se fechan por el reporte, con regresión PGlite.

### Pruebas automáticas

Ver la sección «Puertas» al final.

## Pendiente o no verificado

- **Aprobar la v03 en producción** es un acto de Prevención:
  1. Subir al control documental SST el formulario oficial «Reporte de Equipos».
  2. «Incorporar» la v03.
  3. Vincular la fuente y declarar la paridad.
  4. Aprobar.

  `inspectionDefinitionNeedsOfficialSource` lo exige para `reporte_equipos`. La v02 se aprobó antes de esa regla.
- **La carga en producción** va después de esa aprobación: el script exige la v03.
- **El Excel del tablero** con las tablas nuevas no se descargó en el navegador.
- **La E2E completa** no se corrió en esta rama; sí las dirigidas (ver «Puertas»).
- **Km/h por equipo (KPL-133/134)** es una propuesta, no está implementada: `docs/superpowers/specs/2026-11-17-medidor-km-horas-por-equipo.md`.

## Puertas

Se corrieron una sola vez, al final, sobre el árbol de la rama.

| Puerta | Resultado |
|---|---|
| `npm run typecheck` | OK. La primera pasada encontró 2 errores de tipos en un fixture de `print/document.test.tsx`; se corrigieron. |
| `npm run lint` | OK |
| `npm run test:fast` | 1.383 archivos y 20.744 pruebas pasan; 32 archivos y 277 pruebas omitidos. |
| `npm run test:pglite` | 388 de 389 archivos pasan. Falla `lib/combustibles/control/queries/queries.test.ts › litros por mes y medio`, que **también falla en `main` (8725e74a9)** sin estos cambios: espera «Tarjeta Copec de abastecimiento» y recibe «Vasija (carga Copec)». Viene del cambio de nombres de medios de `7728cdc8f`. Esta rama no toca `lib/combustibles`. |
| Pruebas dirigidas nuevas | v03 (31), catálogo (3), script de carga (14), métricas del Panel (49), sección (12), PGlite del loader (10), domingos (8), secciones por equipo (7) |
| Bundle de producción | Desde cero sobre la copia: 30 cargados, 18 cerrados, 9 revisados, 5 esperando CAPA, 45 avisos leídos, 5 domingos cancelados y 56 correos omitidos. Corrido otra vez, no escribe nada. |
| E2E dirigidas (chromium) | 95 pasan y 1 se omite: `indicadores-mantencion`, `control-operacional-navegacion`, `prevencion-inspecciones` (general, captura, lectura, cierre, roles y permisos), `pdtp-habilitacion` y `densidad-kpi`. |
| Build de producción | `next build --webpack`, con las mismas variables inertes de `e2e/start-server.sh`, compila bien. |

**Nota de entorno.** En sesiones de agente, Next 16.4.2 detiene `next build` y `next dev` con un aviso de vulnerabilidad conocida y pide reintentar. El recibo del reintento vive en `.next/cache`, y `e2e/start-server.sh` borra `.next` antes de compilar, así que `npm run test:e2e` se detiene siempre. Se compiló aparte, reintentando, y se corrió con `E2E_SKIP_BUILD=true`. El aviso no aplica en CI (`isCI`). Queda pendiente decidir la actualización de Next.

No se corrió la E2E completa.
