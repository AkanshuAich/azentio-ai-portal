CREATE TABLE "demo_enquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"organisation" text NOT NULL,
	"role" text,
	"product_slug" text,
	"message" text NOT NULL,
	"contact_consent" boolean NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hackathon_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"organisation" text,
	"interest" text NOT NULL,
	"contact_consent" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "demo_enquiries_email" ON "demo_enquiries" USING btree ("email");--> statement-breakpoint
CREATE INDEX "hackathon_registrations_email" ON "hackathon_registrations" USING btree ("email");