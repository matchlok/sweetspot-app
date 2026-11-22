CREATE TABLE "planned_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"program_id" integer NOT NULL,
	"date" date NOT NULL,
	"kind" text NOT NULL,
	"minutes" integer NOT NULL,
	"title" text,
	"calendar_event_id" text,
	"status" text DEFAULT 'planned' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "programs" (
	"id" serial PRIMARY KEY NOT NULL,
	"purpose" text NOT NULL,
	"race_date" date,
	"block_weeks" integer NOT NULL,
	"availability" jsonb NOT NULL,
	"card" jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "planned_sessions" ADD CONSTRAINT "planned_sessions_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "planned_sessions_date_idx" ON "planned_sessions" USING btree ("date");--> statement-breakpoint
CREATE INDEX "planned_sessions_program_idx" ON "planned_sessions" USING btree ("program_id");