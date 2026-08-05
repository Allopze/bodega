# Permisos y seguridad

## Permisos del módulo

Declarados en `modules/billing/manifest.ts`; el tipo `Permission` y la navegación
se derivan del registry automáticamente.

| Permiso | Habilita |
|---|---|
| `billing:view` | Ver el módulo (acotado por faena para roles no globales) |
| `billing:view_sensitive` | Ver detalle de pagos y movimientos bancarios |
| `billing:manage_clients` | Administrar clientes, contactos y contratos |
| `billing:create_proposal` | Crear, editar, enviar a revisión, reabrir y anular propuestas |
| `billing:review_proposal` | Observar una propuesta en revisión |
| `billing:approve_proposal` | Aprobar, rechazar y marcar lista para facturar |
| `billing:manage_invoices` | Editar datos internos y vínculos de una factura |
| `billing:manage_collections` | Registrar gestiones y compromisos de cobranza |
| `billing:confirm_payments` | **Convertir una sugerencia en cobro.** El más sensible del módulo. |
| `billing:manage_sync` | Disparar sincronizaciones y ver el diagnóstico |
| `billing:export` | Exportar |
| `billing:view_audit` | Ver el historial completo de cambios |

## Perfiles por rol (grants por defecto)

| Rol | Permisos |
|---|---|
| **Administrador** (técnico) | `view`, `manage_clients`, `manage_sync`, `view_audit`. **No** confirma pagos ni ve el detalle financiero sensible: configura integraciones, no maneja plata. |
| **Jefatura** (`jefa_chome`) | Todo: visión global, aprobación, confirmación de pagos, exportación y auditoría. |
| **Administración** (`secretaria`) | Prepara, mantiene maestros, edita datos internos, gestiona cobranza y exporta. **No aprueba propuestas ni confirma pagos.** |
| **Administrador de contrato** (`admin_contrato`) | `view` y `create_proposal`, acotado a sus faenas. |

Los demás roles no reciben ningún permiso del módulo.

## Segregación de funciones

Dos controles que no dependen de la interfaz:

1. **Quien prepara no aprueba.** `assertProposalTransition` rechaza que el mismo
   usuario que envió una propuesta a revisión la apruebe o la rechace.
2. **Quien gestiona la cobranza no necesariamente confirma pagos.**
   `manage_collections` y `confirm_payments` son permisos distintos; la
   configuración por defecto se los da a roles distintos.

## Alcance por faena

`invoiceScopePredicate` inyecta en cada consulta:

```sql
EXISTS (SELECT 1 FROM billing_invoice_links
        WHERE invoice_id = billing_invoices.id
          AND status = 'confirmed'
          AND worksite_id IN (faenas del usuario))
```

Tres consecuencias deliberadas:

- Un rol global ve todo; uno acotado ve solo lo vinculado **y confirmado** a sus
  faenas. **Una sugerencia automática no otorga visibilidad**: si bastara un
  vínculo sugerido, el motor podría abrir acceso a información financiera.
- Las facturas sin vínculo confirmado no las ve ningún rol acotado: por
  definición no están en su alcance.
- Las **acciones de escritura repiten la verificación** (`canReachInvoice`,
  chequeo de faena en vínculos y propuestas). Nunca confían en que la pantalla
  filtró bien.

## Controles de seguridad

| Control | Implementación |
|---|---|
| Ninguna credencial en el frontend | Los adaptadores viven en `lib/`; ninguna variable lleva `NEXT_PUBLIC_`. |
| Ningún token en logs | `redact()` en adaptadores y sync; el logger enmascara RUT y correos. |
| Cuentas bancarias enmascaradas | `billing_bank_transactions.account_ref` guarda `****4321`; el número completo no entra. |
| Datos personales minimizados | El módulo trabaja con RUT de empresas, no de personas. |
| Autorización en backend | `guardPermission` en cada acción; ocultar un botón no es el control. |
| Sin acceso cruzado entre faenas | Predicado de alcance en lectura y verificación en escritura. |
| Glosas y XML tratados como no confiables | El XML se valida campo a campo y se descarta si falta identidad; la glosa bancaria se muestra escapada por React y se sanitiza al exportar. |
| Descargas masivas acotadas | `pageSize` tope 200; consultas de cobranza con límite 500. |
| Confirmaciones trazadas | CHECK en la base: confirmar exige autor y fecha. |
| Auditoría | `recordAudit` en cada acción + `billing_invoice_events` para la línea de tiempo. |

## Riesgo heredado, no introducido

`dte.clave` (credencial del portal) está en texto plano en `system_settings`. Es
una decisión previa al módulo, documentada en `lib/services/dte-portal/settings.ts`
y anotada como **P-2** en la auditoría. Este módulo no la empeoró; corregirla
afecta también al módulo de Compras y merece su propia decisión.
