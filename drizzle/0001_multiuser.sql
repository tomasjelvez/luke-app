CREATE TYPE "public"."auth_purpose" AS ENUM('signup', 'login');--> statement-breakpoint
CREATE TYPE "public"."auth_status" AS ENUM('pending', 'awaiting_confirmation', 'verified', 'consumed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."session_kind" AS ENUM('web', 'mobile');--> statement-breakpoint
CREATE TABLE "auth_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"purpose" "auth_purpose" NOT NULL,
	"status" "auth_status" DEFAULT 'pending' NOT NULL,
	"signup_data" jsonb,
	"poll_secret_hash" text NOT NULL,
	"phone" text,
	"user_id" integer,
	"expires_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" integer NOT NULL,
	"kind" "session_kind" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "apple_pay_token_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "apple_pay_connected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth_codes" ADD CONSTRAINT "auth_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_apple_pay_token_hash_unique" UNIQUE("apple_pay_token_hash");