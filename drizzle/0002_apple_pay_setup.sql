ALTER TABLE "users" ADD COLUMN "apple_pay_setup_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "apple_pay_setup_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_apple_pay_setup_hash_unique" UNIQUE("apple_pay_setup_hash");