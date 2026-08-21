ALTER TABLE "work_item_assignments" DROP CONSTRAINT "work_item_assignments_assignee_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "work_item_assignments" DROP CONSTRAINT "work_item_assignments_assigned_by_user_id_users_id_fk";
--> statement-breakpoint
DROP INDEX "work_item_assignments_worksite_assignee_idx";--> statement-breakpoint
ALTER TABLE "work_item_assignments" DROP COLUMN "assignee_user_id";--> statement-breakpoint
ALTER TABLE "work_item_assignments" DROP COLUMN "assigned_by_user_id";