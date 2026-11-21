CREATE TABLE "source_tokens" (
	"source" text PRIMARY KEY NOT NULL,
	"refresh_token" text NOT NULL,
	"access_token" text,
	"expires_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "source" text DEFAULT 'intervals' NOT NULL;