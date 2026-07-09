# Prompt de auditoria profunda - Modulo Adquisiciones

Usa este prompt para auditar el modulo de Adquisiciones de Plataforma Chome.

```text
Actua como auditor senior de producto, QA y codigo para una plataforma interna de operaciones. Audita en profundidad el modulo de Adquisiciones de Plataforma Chome, basandote solo en el codigo real del repositorio. No inventes funcionalidades. Si algo no se puede confirmar desde codigo, dilo como supuesto o pendiente de verificacion.

Objetivo:
Encontrar bugs, fallas logicas, inconsistencias de flujo, problemas de permisos, problemas de datos, fricciones UI/UX, textos confusos, estados imposibles, brechas de pruebas y mejoras accionables en el flujo completo:

Solicitudes -> Aprobaciones -> Compras -> Recepcion -> Entregas -> Bodega/Trazabilidad/Reportes.

La auditoria debe incluir TODO lo asociado al modulo, no solo las pantallas:
permisos, roles, usuarios que pueden acceder, visibilidad por faena, acciones
permitidas por rol, rutas directas, Server Actions, exports, navegacion,
dashboard, cola de trabajo, reportes, trazabilidad, notificaciones si aplican,
auditoria de cambios y cualquier efecto en stock.

Alcance principal a revisar:
- app/(app)/solicitudes/**
- app/(app)/aprobaciones/**
- app/(app)/compras/**
- app/(app)/recepcion/**
- app/(app)/entregas/**
- app/(app)/trazabilidad/**
- components/operaciones/**
- lib/requests/**
- lib/services/requests-*.ts
- lib/services/purchasing*.ts
- lib/services/receiving.ts
- lib/services/deliveries*.ts
- lib/services/item-state*.ts
- lib/work-queue*.ts
- lib/reports/export-module/solicitudes.ts
- lib/reports/export-module/compras.ts
- lib/reports/export-module/recepcion.ts
- app/api/reportes/export/route.ts
- app/api/trazabilidad/export/route.ts
- modules/requests/manifest.ts
- modules/approvals/manifest.ts
- modules/purchasing/manifest.ts
- modules/receiving/manifest.ts
- modules/deliveries/manifest.ts
- modules/traceability/manifest.ts
- lib/auth/**
- lib/auth/system-rbac.ts
- lib/auth/rbac.ts
- lib/auth/can.ts
- lib/auth/scope.ts
- components/layout/nav-items.ts
- components/layout/command-palette.tsx
- app/(app)/dashboard/**
- components/states/**
- db/schema/**
- tests relacionados en lib/__tests__ y app/(app)/**

Reglas del proyecto que debes respetar:
- La logica viva esta en lib/ y app/. No propongas recrear core/ ni modules/*/services.
- modules/*/manifest.ts solo debe usarse para navegacion, permisos y grants.
- Todas las exportaciones deben ser XLSX, nunca CSV.
- Las paginas autenticadas deben usar PageHeader y PageContainer.
- No debe haber buscadores de texto duplicados si el TopBar o los filtros URL de la pagina ya cubren la busqueda.
- Distingue busqueda de texto de filtros estructurados.
- No propongas cambios de base de datos editando migraciones antiguas. Si hace falta schema, propone nueva migracion.

Forma de trabajo:
1. Primero construye un mapa del flujo real:
   - que rutas existen,
   - que acciones principales hay,
   - que estados usa cada entidad,
   - que permisos/roles pueden ver o ejecutar cada paso,
   - que roles reales existen y cuales tienen acceso a cada pantalla,
   - que usuarios ven todas las faenas y cuales solo sus faenas asignadas,
   - como se filtra la informacion por faena, creador o alcance del usuario,
   - que datos se escriben al avanzar de etapa.

   Debes incluir una matriz de acceso con filas por rol real:
   - Administrador
   - Jefatura
   - Secretaria
   - Jefa Dpto. Prevencion de riesgos
   - Solicitante faena
   - Prevencionista faena
   - Jefe de mantencion
   - Administrador de contrato / Supervisor de faena
   - otros roles si aparecen relacionados

   Y columnas por capacidad:
   - ver solicitudes propias,
   - ver todas las solicitudes,
   - crear/enviar solicitudes,
   - eliminar/cancelar/duplicar/reenviar,
   - aprobar/rechazar,
   - crear OC,
   - emitir/enviar/cerrar/eliminar OC,
   - registrar recepcion oficina,
   - registrar recepcion faena,
   - ver recepciones,
   - registrar entregas,
   - ver bodega/stock,
   - ver trazabilidad,
   - exportar reportes,
   - ver datos de otras faenas.

2. Revisa la logica de negocio:
   - solicitudes borrador, envio, duplicado, cancelacion, reenvio y eliminacion,
   - aprobacion item a item y aprobacion masiva,
   - rechazo y motivos,
   - tipos EPP, Otro, Repuestos y Servicios,
   - seleccion de proveedor sugerido o preferente,
   - creacion de OC por proveedor,
   - estados de OC: borrador, emitida/enviada, recibida parcial, recibida total, cerrada/cancelada,
   - recepcion en oficina vs recepcion en faena,
   - modo de despacho via oficina vs directo a faena,
   - entrega de EPP a trabajadores,
   - stock y movimientos de bodega,
   - trazabilidad de items desde solicitud hasta entrega,
   - reportes y exportaciones.

3. Busca bugs e inconsistencias:
   - transiciones de estado permitidas en UI pero bloqueadas en backend, o al reves,
   - items que pueden quedar atrapados sin siguiente accion,
   - cantidades negativas, cero, exceso de recepcion o exceso de entrega,
   - doble click, concurrencia o acciones repetidas,
   - permisos aplicados en pantalla pero no en server action,
   - permisos aplicados en server action pero no reflejados en UI,
   - permisos concedidos en manifests que no tienen ruta o accion visible,
   - rutas visibles en navegacion pero bloqueadas al entrar,
   - rutas ocultas en navegacion pero accesibles por URL,
   - diferencias entre permisos del manifest, controles `can(...)`, `requirePermission(...)` y validaciones en servicios,
   - filtros que muestran registros fuera de la faena del usuario,
   - usuarios de faena que pueden ver o tocar datos de otra faena,
   - usuarios globales que pierden informacion por filtros demasiado restrictivos,
   - exports que no respetan los mismos permisos/filtros que la pantalla,
   - trazabilidad o reportes que exponen datos que la lista principal no muestra,
   - diferencias entre lista, detalle, exportacion y trazabilidad,
   - estados o labels distintos para la misma cosa,
   - acciones visibles para roles que no pueden completarlas,
   - rutas accesibles directo por URL sin validacion suficiente,
   - documentos/facturas/adjuntos que puedan quedar huerfanos,
   - datos obligatorios en UI pero no validados en servidor, o al reves.

4. Revisa UI/UX con mirada de usuario no tecnico:
   - si la siguiente accion es clara,
   - si los botones tienen nombres entendibles,
   - si los errores explican que hacer,
   - si la pagina distingue pendiente, aprobado, comprado, recibido y entregado,
   - si filtros y busqueda son coherentes entre listas,
   - si la experiencia movil o tablas densas pueden bloquear trabajo diario,
   - si hay pantallas con informacion duplicada o escondida,
   - si el usuario sabe por que no ve una accion.

5. Revisa pruebas:
   - que flujos criticos tienen tests,
   - que flujos solo tienen tests superficiales,
   - que casos de concurrencia estan cubiertos,
   - que exportaciones y trazabilidad estan cubiertas,
   - que tests prueban permisos por rol,
   - que tests prueban aislamiento por faena,
   - que tests prueban acceso directo por URL o Server Action,
   - que faltaria agregar como test unitario, integracion o e2e.

6. Si encuentras problemas, clasificalos por severidad:
   - Critico: perdida de datos, acceso indebido, stock incorrecto, bloqueo total del flujo.
   - Alto: flujo importante roto, estado inconsistente, permiso mal aplicado, recepcion/entrega incorrecta.
   - Medio: confusion fuerte, reporte/exportacion incorrecta, accion incompleta.
   - Bajo: texto, pulido visual, mejora de claridad, deuda menor.

Formato de salida requerido:

1. Resumen ejecutivo breve:
   - estado general del modulo,
   - principales riesgos,
   - donde conviene actuar primero.

2. Mapa del flujo real:
   - Solicitudes
   - Aprobaciones
   - Compras
   - Recepcion
   - Entregas
   - Trazabilidad/Reportes

3. Hallazgos ordenados por severidad.
   Para cada hallazgo incluye:
   - Titulo
   - Severidad
   - Evidencia con archivo y linea aproximada
   - Que usuario se ve afectado
   - Pasos para reproducir o escenario
   - Impacto
   - Recomendacion concreta
   - Prueba sugerida

4. Matriz de roles y acceso.
   Debe mostrar:
   - rol,
   - pantallas visibles,
   - acciones permitidas,
   - alcance de faena,
   - riesgos o dudas detectadas,
   - evidencia en manifest, page, server action o servicio.

5. Inconsistencias UI/UX:
   - pantalla,
   - problema,
   - propuesta de mejora,
   - prioridad.

6. Brechas de pruebas:
   - archivo o flujo,
   - riesgo que cubre,
   - test sugerido.

7. Mejoras recomendadas:
   - quick wins,
   - mejoras medianas,
   - cambios grandes que requieren plan.

8. Lista final de acciones priorizadas:
   - Top 5 fixes obligatorios,
   - Top 5 mejoras de UX,
   - Top 5 tests a agregar.

Restricciones:
- No hagas refactors amplios como recomendacion generica.
- No propongas cambiar tecnologia.
- No propongas CSV.
- No propongas soluciones sin decir que archivo o flujo tocarian.
- No mezcles hallazgos confirmados con sospechas: marca claramente "confirmado" o "por verificar".
- Si para confirmar un hallazgo necesitas correr la app, revisar la base de datos o probar una pantalla, hazlo cuando sea posible. Si no puedes hacerlo en ese contexto, marca el punto como verificacion pendiente e indica el comando, query o pantalla exacta para comprobarlo.
```
