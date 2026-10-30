CREATE TABLE "experiments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"hypothesis" text NOT NULL,
	"expected_outcome" text,
	"status" text DEFAULT 'proposed' NOT NULL,
	"owner_id" uuid NOT NULL,
	"audience" "audience_kind" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hackathon_team_members" (
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hackathon_teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"created_by" uuid NOT NULL,
	"audience" "audience_kind" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hackathon_teams_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "knowledge_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"useful" boolean NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "playground_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"org_id" uuid,
	"scenario_id" text NOT NULL,
	"params" jsonb NOT NULL,
	"output" jsonb NOT NULL,
	"feedback" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_banners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message" text NOT NULL,
	"href" text,
	"active" boolean DEFAULT false NOT NULL,
	"audience" "audience_kind" NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_articles" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "live_sessions" ADD COLUMN "recording_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "content_type" text NOT NULL;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "byte_size" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "improvement_ideas" ADD COLUMN "owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hackathon_team_members" ADD CONSTRAINT "hackathon_team_members_team_id_hackathon_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."hackathon_teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hackathon_team_members" ADD CONSTRAINT "hackathon_team_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hackathon_teams" ADD CONSTRAINT "hackathon_teams_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_feedback" ADD CONSTRAINT "knowledge_feedback_article_id_knowledge_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."knowledge_articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_feedback" ADD CONSTRAINT "knowledge_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playground_runs" ADD CONSTRAINT "playground_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playground_runs" ADD CONSTRAINT "playground_runs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_banners" ADD CONSTRAINT "site_banners_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hackathon_team_members_pk" ON "hackathon_team_members" USING btree ("team_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_feedback_article_user" ON "knowledge_feedback" USING btree ("article_id","user_id");--> statement-breakpoint
CREATE INDEX "playground_runs_user" ON "playground_runs" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "live_sessions" ADD CONSTRAINT "live_sessions_recording_asset_id_media_assets_id_fk" FOREIGN KEY ("recording_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "improvement_ideas" ADD CONSTRAINT "improvement_ideas_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;