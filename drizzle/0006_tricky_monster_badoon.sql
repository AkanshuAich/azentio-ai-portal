CREATE TABLE "aira_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"publication_id" uuid NOT NULL,
	"text" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contribution_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contribution_id" uuid NOT NULL,
	"actor_type" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"note" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idea_evidence" (
	"idea_id" uuid NOT NULL,
	"publication_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publication_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"publication_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_drafts" (
	"contribution_id" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"offering" text NOT NULL,
	"industry" text,
	"region" text,
	"observation_period" text,
	"evidence_type" text,
	"confidence" text,
	"attribution" text DEFAULT 'anonymous' NOT NULL,
	"evidence_quality" text,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_searches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"query" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contribution_reports" ADD COLUMN "status" text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "contribution_reports" ADD COLUMN "resolution" text;--> statement-breakpoint
ALTER TABLE "contribution_reports" ADD COLUMN "resolved_by" uuid;--> statement-breakpoint
ALTER TABLE "contribution_reports" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contributions" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "contributions" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD COLUMN "to_status" text;--> statement-breakpoint
ALTER TABLE "shared_publications" ADD COLUMN "superseded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shared_publications" ADD COLUMN "evidence_quality" text;--> statement-breakpoint
ALTER TABLE "aira_chunks" ADD CONSTRAINT "aira_chunks_publication_id_shared_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."shared_publications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_events" ADD CONSTRAINT "contribution_events_contribution_id_contributions_id_fk" FOREIGN KEY ("contribution_id") REFERENCES "public"."contributions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idea_evidence" ADD CONSTRAINT "idea_evidence_idea_id_improvement_ideas_id_fk" FOREIGN KEY ("idea_id") REFERENCES "public"."improvement_ideas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idea_evidence" ADD CONSTRAINT "idea_evidence_publication_id_shared_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."shared_publications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_feedback" ADD CONSTRAINT "publication_feedback_publication_id_shared_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."shared_publications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_feedback" ADD CONSTRAINT "publication_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_drafts" ADD CONSTRAINT "review_drafts_contribution_id_contributions_id_fk" FOREIGN KEY ("contribution_id") REFERENCES "public"."contributions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_drafts" ADD CONSTRAINT "review_drafts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_searches" ADD CONSTRAINT "saved_searches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_searches" ADD CONSTRAINT "saved_searches_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contribution_events_contrib" ON "contribution_events" USING btree ("contribution_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idea_evidence_pk" ON "idea_evidence" USING btree ("idea_id","publication_id");--> statement-breakpoint
CREATE UNIQUE INDEX "publication_feedback_pk" ON "publication_feedback" USING btree ("publication_id","user_id");--> statement-breakpoint
ALTER TABLE "contribution_reports" ADD CONSTRAINT "contribution_reports_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;