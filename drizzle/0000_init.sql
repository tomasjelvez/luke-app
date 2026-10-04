CREATE TYPE "public"."msg_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "public"."tx_source" AS ENUM('apple_pay', 'whatsapp');--> statement-breakpoint
CREATE TYPE "public"."tx_status" AS ENUM('pending', 'confirmed');--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"wamid" text NOT NULL,
	"user_id" integer NOT NULL,
	"direction" "msg_direction" NOT NULL,
	"type" text NOT NULL,
	"body" text,
	"transaction_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_wamid_unique" UNIQUE("wamid")
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"merchant" text,
	"category" text NOT NULL,
	"description" text,
	"source" "tx_source" NOT NULL,
	"status" "tx_status" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"asked_at" timestamp with time zone,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"timezone" text NOT NULL,
	"currency" text NOT NULL,
	"last_inbound_at" timestamp with time zone,
	"last_nightly_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transactions_user_occurred_idx" ON "transactions" USING btree ("user_id","occurred_at");