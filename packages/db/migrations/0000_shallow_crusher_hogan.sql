CREATE TABLE "activities" (
	"id" text PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"type" text,
	"raw" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"trigger" text NOT NULL,
	"inputs" jsonb NOT NULL,
	"options" jsonb,
	"rule_results" jsonb,
	"choice" jsonb,
	"calendar_changes" jsonb,
	"status" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goal_changes" (
	"id" serial PRIMARY KEY NOT NULL,
	"goal" text NOT NULL,
	"effective_week" date NOT NULL,
	"mode" text NOT NULL,
	"target_min" integer NOT NULL,
	"step_min" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lift_targets" (
	"effective_week" date PRIMARY KEY NOT NULL,
	"upper" integer NOT NULL,
	"lower" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"ok" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manual_done" (
	"session_id" text PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"kind" text NOT NULL,
	"marked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "program_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"start_week" date NOT NULL,
	"recovery_after" integer NOT NULL,
	"recovery_factor" real NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
CREATE INDEX "activities_date_idx" ON "activities" USING btree ("date");--> statement-breakpoint
CREATE INDEX "goal_changes_week_idx" ON "goal_changes" USING btree ("effective_week","id");--> statement-breakpoint
CREATE INDEX "login_attempts_at_idx" ON "login_attempts" USING btree ("at");