import { pgTable, uuid, text, timestamp, boolean, index } from "drizzle-orm/pg-core";

// Submissions from the unauthenticated public site. Stored, not "sent": nothing here claims follow-up delivery.
export const demoEnquiries = pgTable(
  "demo_enquiries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    organisation: text("organisation").notNull(),
    role: text("role"),
    productSlug: text("product_slug"),
    message: text("message").notNull(),
    // Permission to contact the person about this enquiry only.
    contactConsent: boolean("contact_consent").notNull(),
    status: text("status").notNull().default("new"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("demo_enquiries_email").on(t.email)],
);

export const hackathonRegistrations = pgTable(
  "hackathon_registrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    organisation: text("organisation"),
    interest: text("interest").notNull(),
    contactConsent: boolean("contact_consent").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("hackathon_registrations_email").on(t.email)],
);
