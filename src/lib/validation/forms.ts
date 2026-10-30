import { z } from "zod";

// Shared by the browser and the server, so the same limits apply in both places.
const email = z.string().trim().toLowerCase().max(254, "Email is too long").email("Enter a valid email address");

export const demoEnquirySchema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(100, "Name is too long"),
  email,
  organisation: z.string().trim().min(2, "Enter your organisation").max(150, "Organisation name is too long"),
  role: z.string().trim().max(100, "Role is too long").optional().transform((v) => v || undefined),
  productSlug: z.string().trim().max(80).optional().transform((v) => v || undefined),
  message: z.string().trim().min(10, "Tell us a little more (at least 10 characters)").max(2000, "Keep the message under 2000 characters"),
  contactConsent: z.literal(true, { message: "Please confirm we may contact you about this enquiry" }),
  // Honeypot: real people never see or fill this field.
  website: z.string().max(0).optional(),
});
export type DemoEnquiryInput = z.infer<typeof demoEnquirySchema>;

export const hackathonSchema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(100, "Name is too long"),
  email,
  organisation: z.string().trim().max(150, "Organisation name is too long").optional().transform((v) => v || undefined),
  interest: z.string().trim().min(10, "Tell us what you'd like to build (at least 10 characters)").max(1000, "Keep it under 1000 characters"),
  contactConsent: z.literal(true, { message: "Please confirm we may contact you about the hackathon" }),
  website: z.string().max(0).optional(),
});
export type HackathonInput = z.infer<typeof hackathonSchema>;
