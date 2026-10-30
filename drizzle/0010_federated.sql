ALTER TYPE "public"."permission" ADD VALUE 'federated.coordinate';--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE 'federated.approve';--> statement-breakpoint
CREATE TABLE "fl_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_version_id" uuid NOT NULL,
	"action" text NOT NULL,
	"decided_by" uuid NOT NULL,
	"note" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fl_enrolments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"programme_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"participant_ref" text NOT NULL,
	"status" text NOT NULL,
	"profile" text NOT NULL,
	"consent_version" text NOT NULL,
	"enrolled_by" uuid NOT NULL,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_by" uuid,
	"withdrawn_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "fl_model_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"programme_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"label" text NOT NULL,
	"weights" jsonb NOT NULL,
	"metrics" jsonb NOT NULL,
	"status" text NOT NULL,
	"parent_version_id" uuid,
	"contributor_refs" jsonb NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"needs_review_reason" text,
	"registered_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fl_programmes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"schema_version" text NOT NULL,
	"min_cohort" integer NOT NULL,
	"config" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fl_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"round" integer NOT NULL,
	"status" text NOT NULL,
	"abandon_reason" text,
	"model_version_before" text NOT NULL,
	"model_version_after" text NOT NULL,
	"aggregation" jsonb,
	"holdout" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fl_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"programme_id" uuid NOT NULL,
	"started_by" uuid NOT NULL,
	"config" jsonb NOT NULL,
	"injected_faults" jsonb NOT NULL,
	"baselines" jsonb NOT NULL,
	"dp" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fl_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"participant_ref" text NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"n_examples" integer,
	"raw_norm" double precision,
	"clipped_norm" double precision,
	"weight" double precision
);
--> statement-breakpoint
ALTER TABLE "fl_decisions" ADD CONSTRAINT "fl_decisions_model_version_id_fl_model_versions_id_fk" FOREIGN KEY ("model_version_id") REFERENCES "public"."fl_model_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fl_decisions" ADD CONSTRAINT "fl_decisions_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fl_enrolments" ADD CONSTRAINT "fl_enrolments_programme_id_fl_programmes_id_fk" FOREIGN KEY ("programme_id") REFERENCES "public"."fl_programmes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fl_enrolments" ADD CONSTRAINT "fl_enrolments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fl_enrolments" ADD CONSTRAINT "fl_enrolments_enrolled_by_users_id_fk" FOREIGN KEY ("enrolled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fl_enrolments" ADD CONSTRAINT "fl_enrolments_withdrawn_by_users_id_fk" FOREIGN KEY ("withdrawn_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fl_model_versions" ADD CONSTRAINT "fl_model_versions_programme_id_fl_programmes_id_fk" FOREIGN KEY ("programme_id") REFERENCES "public"."fl_programmes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fl_model_versions" ADD CONSTRAINT "fl_model_versions_run_id_fl_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."fl_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fl_model_versions" ADD CONSTRAINT "fl_model_versions_registered_by_users_id_fk" FOREIGN KEY ("registered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fl_programmes" ADD CONSTRAINT "fl_programmes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fl_rounds" ADD CONSTRAINT "fl_rounds_run_id_fl_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."fl_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fl_runs" ADD CONSTRAINT "fl_runs_programme_id_fl_programmes_id_fk" FOREIGN KEY ("programme_id") REFERENCES "public"."fl_programmes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fl_runs" ADD CONSTRAINT "fl_runs_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fl_updates" ADD CONSTRAINT "fl_updates_round_id_fl_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."fl_rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fl_enrolments_programme_org" ON "fl_enrolments" USING btree ("programme_id","org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fl_enrolments_ref" ON "fl_enrolments" USING btree ("programme_id","participant_ref");--> statement-breakpoint
CREATE INDEX "fl_model_versions_programme" ON "fl_model_versions" USING btree ("programme_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "fl_rounds_run_round" ON "fl_rounds" USING btree ("run_id","round");--> statement-breakpoint
CREATE INDEX "fl_updates_round" ON "fl_updates" USING btree ("round_id");