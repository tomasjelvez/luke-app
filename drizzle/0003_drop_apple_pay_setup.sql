ALTER TABLE "users" DROP CONSTRAINT "users_apple_pay_setup_hash_unique";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "apple_pay_setup_hash";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "apple_pay_setup_expires_at";