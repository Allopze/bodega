/**
 * modules/admin/manifest.ts
 *
 * Módulo de administración del sistema.
 * Gestiona datos maestros (faenas, proveedores, trabajadores, productos, usuarios)
 * y configuración del sistema.
 *
 * Nota: el enlace de /admin aparece en el dropdown del TopBar para cualquier
 * usuario con al menos un permiso admin:*, no en la barra lateral principal.
 */

import type { ModuleManifest } from "@/modules/manifest-types"

export const adminModule = {
  id: "admin",

  permissions: [
    // Usuarios y roles
    "admin:users",
    "admin:manage_admins",
    "admin:roles",
    // Datos maestros
    "admin:worksites",
    "admin:workers",
    "admin:products",
    "admin:epp_import_upload",
    "admin:epp_import_review",
    "admin:epp_import_confirm",
    "admin:suppliers",
    "admin:cost_centers",
    "admin:product_catalogs",
    "admin:service_equipment",
    "admin:worksite_inventory",
    // Prevención / SST
    "admin:document_taxonomy",
    "admin:pdtp_catalog",
    // Flota
    "admin:fleet_catalog",
    "admin:fleet_vehicles",
    // Sistema
    "admin:config",
    "admin:smtp",
    "admin:email_templates",
    "admin:audit_log",
    "admin:security",
    "admin:folios",
    "admin:notifications",
    "admin:ops_settings",
    "admin:module_management",
    // Backups
    "admin:backups",
    // DTE Portal
    "admin:dte_sync",
  ] as const,

  permissionMeta: {
    "admin:users":             { id: "p-adm-usr",   description: "Gestionar usuarios" },
    "admin:manage_admins":     { id: "p-adm-mgt",   description: "Asignar roles y permisos de administración" },
    "admin:roles":             { id: "p-adm-roles", description: "Gestionar roles y permisos base" },
    "admin:worksites":         { id: "p-adm-ws",    description: "Gestionar faenas" },
    "admin:workers":           { id: "p-adm-wrk",   description: "Gestionar trabajadores" },
    "admin:products":          { id: "p-adm-prod",  description: "Gestionar catálogo" },
    "admin:service_equipment": { id: "p-adm-equip", description: "Gestionar el registro de equipos de servicio (monogás, alcotest)" },
    "admin:worksite_inventory": { id: "p-adm-wsinv", description: "Cargar y mantener el inventario físico de cada faena (extintores, kits de derrame y otros recursos)" },
    "admin:epp_import_upload": { id: "p-adm-epp-up", description: "Cargar archivos de importación EPP" },
    "admin:epp_import_review": { id: "p-adm-epp-rv", description: "Revisar y resolver importaciones EPP" },
    "admin:epp_import_confirm": { id: "p-adm-epp-cf", description: "Confirmar importaciones EPP" },
    "admin:suppliers":         { id: "p-adm-sup",   description: "Gestionar proveedores" },
    "admin:cost_centers":      { id: "p-adm-cost",  description: "Gestionar centros de costo" },
    "admin:product_catalogs":  { id: "p-adm-pcat",  description: "Gestionar catálogos auxiliares de productos" },
    "admin:document_taxonomy": { id: "p-adm-docx",  description: "Gestionar taxonomía documental SST" },
    "admin:pdtp_catalog":      { id: "p-adm-pdtp",  description: "Gestionar catálogos base del programa preventivo" },
    "admin:fleet_catalog":     { id: "p-adm-fleet", description: "Gestionar catálogos administrativos de flota" },
    "admin:fleet_vehicles":    { id: "p-adm-fleetveh", description: "Mantener el padrón de vehículos: alta, edición, baja e importación desde planilla" },
    "admin:config":            { id: "p-adm-cfg",   description: "Configuración del sistema" },
    "admin:smtp":              { id: "p-adm-smtp",  description: "Configurar servidor SMTP" },
    "admin:email_templates":   { id: "p-adm-tpl",   description: "Gestionar plantillas de correo" },
    "admin:audit_log":         { id: "p-adm-audit", description: "Ver log de auditoría" },
    "admin:security":          { id: "p-adm-sec",   description: "Gestionar bloqueos y controles de seguridad" },
    "admin:folios":            { id: "p-adm-fol",   description: "Ver y corregir folios operativos" },
    "admin:notifications":     { id: "p-adm-notif", description: "Administrar notificaciones del sistema" },
    "admin:ops_settings":      { id: "p-adm-ops",    description: "Gestionar parámetros operativos avanzados" },
    "admin:module_management": { id: "p-adm-modules", description: "Activar/desactivar módulos del sistema" },
    "admin:backups":            { id: "p-adm-bkp",   description: "Gestionar respaldos y restauración" },
    "admin:dte_sync":           { id: "p-adm-dte",   description: "Sincronizar documentos tributarios (DTE)" },
  },

  // No aparece en el sidebar principal; el TopBar lo descubre dinámicamente
  nav: [],

  /**
   * Grants por defecto al hacer seed.
   * Mapea 1:1 con SYSTEM_ROLE_PERMISSIONS en lib/auth/bootstrap.ts.
   * En Fase 3 el seed usará estos grants en lugar de bootstrap.ts.
   */
  defaultGrants: [
    // Administrador — todos los permisos del módulo
    { roleSlug: "administrador", permission: "admin:users" },
    { roleSlug: "administrador", permission: "admin:manage_admins" },
    { roleSlug: "administrador", permission: "admin:roles" },
    { roleSlug: "administrador", permission: "admin:worksites" },
    { roleSlug: "administrador", permission: "admin:workers" },
    { roleSlug: "administrador", permission: "admin:products" },
    { roleSlug: "administrador", permission: "admin:epp_import_upload" },
    { roleSlug: "administrador", permission: "admin:epp_import_review" },
    { roleSlug: "administrador", permission: "admin:epp_import_confirm" },
    { roleSlug: "administrador", permission: "admin:suppliers" },
    { roleSlug: "administrador", permission: "admin:cost_centers" },
    { roleSlug: "administrador", permission: "admin:product_catalogs" },
    { roleSlug: "administrador", permission: "admin:service_equipment" },
    { roleSlug: "administrador", permission: "admin:worksite_inventory" },
    { roleSlug: "administrador", permission: "admin:document_taxonomy" },
    { roleSlug: "administrador", permission: "admin:pdtp_catalog" },
    { roleSlug: "administrador", permission: "admin:fleet_catalog" },
    { roleSlug: "administrador", permission: "admin:fleet_vehicles" },
    { roleSlug: "administrador", permission: "admin:config" },
    { roleSlug: "administrador", permission: "admin:smtp" },
    { roleSlug: "administrador", permission: "admin:email_templates" },
    { roleSlug: "administrador", permission: "admin:audit_log" },
    { roleSlug: "administrador", permission: "admin:security" },
    { roleSlug: "administrador", permission: "admin:folios" },
    { roleSlug: "administrador", permission: "admin:notifications" },
    { roleSlug: "administrador", permission: "admin:ops_settings" },
    // Secretaría
    { roleSlug: "secretaria", permission: "admin:users" },
    { roleSlug: "secretaria", permission: "admin:worksites" },
    { roleSlug: "secretaria", permission: "admin:workers" },
    { roleSlug: "secretaria", permission: "admin:products" },
    { roleSlug: "secretaria", permission: "admin:epp_import_upload" },
    { roleSlug: "secretaria", permission: "admin:epp_import_review" },
    { roleSlug: "secretaria", permission: "admin:suppliers" },
    { roleSlug: "secretaria", permission: "admin:cost_centers" },
    { roleSlug: "secretaria", permission: "admin:product_catalogs" },
    { roleSlug: "secretaria", permission: "admin:service_equipment" },
    // Cargar el inventario de una faena es digitación de datos maestros, no una
    // tarea de Prevención: por eso lo tiene secretaría además de administración.
    // El prevencionista global lo conserva porque es quien detecta que falta un
    // extintor al programar la inspección. Los roles acotados a una faena
    // quedan fuera a propósito: la pantalla es global.
    { roleSlug: "secretaria", permission: "admin:worksite_inventory" },
    { roleSlug: "secretaria", permission: "admin:fleet_vehicles" },
    { roleSlug: "admin_contrato", permission: "admin:fleet_vehicles" },
    { roleSlug: "prevencionista_faena", permission: "admin:fleet_vehicles" },
    { roleSlug: "solicitante_faena", permission: "admin:fleet_vehicles" },
    { roleSlug: "prevencionista", permission: "admin:worksite_inventory" },
    // Jefa Chome (Jefatura)
    { roleSlug: "jefa_chome", permission: "admin:cost_centers" },
    { roleSlug: "jefa_chome", permission: "admin:product_catalogs" },
    { roleSlug: "jefa_chome", permission: "admin:pdtp_catalog" },
    { roleSlug: "jefa_chome", permission: "admin:fleet_catalog" },
    { roleSlug: "jefa_chome", permission: "admin:fleet_vehicles" },
    { roleSlug: "jefa_chome", permission: "admin:notifications" },
    // Jefa Dpto. Prevención de riesgos
    { roleSlug: "prevencionista", permission: "admin:users" },
    { roleSlug: "prevencionista", permission: "admin:worksites" },
    { roleSlug: "prevencionista", permission: "admin:workers" },
    { roleSlug: "prevencionista", permission: "admin:products" },
    { roleSlug: "prevencionista", permission: "admin:epp_import_upload" },
    { roleSlug: "prevencionista", permission: "admin:epp_import_review" },
    { roleSlug: "prevencionista", permission: "admin:suppliers" },
    { roleSlug: "prevencionista", permission: "admin:document_taxonomy" },
    { roleSlug: "prevencionista", permission: "admin:pdtp_catalog" },
    // Jefe de mantención — flota
    { roleSlug: "jefe_mantencion", permission: "admin:fleet_catalog" },
    { roleSlug: "jefe_mantencion", permission: "admin:fleet_vehicles" },
    // Quien manda a mantener y calibrar los instrumentos es quien los da de alta.
    { roleSlug: "jefe_mantencion", permission: "admin:service_equipment" },
    // Prevencionista faena — solo trabajadores (para EPP tracking)
    { roleSlug: "solicitante_faena", permission: "admin:workers" },
    { roleSlug: "prevencionista_faena", permission: "admin:workers" },
    // Admin de módulos
    { roleSlug: "administrador", permission: "admin:module_management" },
    { roleSlug: "administrador", permission: "admin:backups" },
    { roleSlug: "jefa_chome", permission: "admin:backups" },
    // DTE Portal
    { roleSlug: "administrador", permission: "admin:dte_sync" },
    { roleSlug: "jefa_chome", permission: "admin:dte_sync" },
  ],
} as const satisfies ModuleManifest
