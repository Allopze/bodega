CREATE UNIQUE INDEX `role_permissions_role_permission_unique` ON `role_permissions` (`role_id`, `permission_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_roles_user_role_unique` ON `user_roles` (`user_id`, `role_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `worksite_users_user_worksite_unique` ON `worksite_users` (`user_id`, `worksite_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_suppliers_product_supplier_unique` ON `product_suppliers` (`product_id`, `supplier_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `warehouse_stock_warehouse_product_unique` ON `warehouse_stock` (`warehouse_id`, `product_id`);
--> statement-breakpoint
CREATE INDEX `inventory_movements_warehouse_performed_at_idx` ON `inventory_movements` (`warehouse_id`, `performed_at`);
--> statement-breakpoint
CREATE INDEX `inventory_movements_product_performed_at_idx` ON `inventory_movements` (`product_id`, `performed_at`);
