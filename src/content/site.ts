// Public marketing content, reused from the reference prototype where it exists.
// Everything here is public by definition. Anything restricted lives in the database with an audience.

export const NAV = [
  { href: "/products", label: "Products" },
  { href: "/solutions", label: "Solutions" },
  { href: "/lab", label: "Innovation" },
  { href: "/media", label: "Media" },
  { href: "/insights", label: "Insights" },
  { href: "/technology", label: "Technology" },
  { href: "/about", label: "About" },
] as const;

export const CAPABILITIES = [
  { n: "01", title: "Domain understanding", text: "Intelligence shaped by how credit, reporting and operations actually work." },
  { n: "02", title: "Advanced AI", text: "Models, workflows and deterministic logic combined, with humans in the loop." },
  { n: "03", title: "Intuitive experiences", text: "Workbenches and copilots that make complex decisions easier to inspect." },
  { n: "04", title: "Enterprise-grade engineering", text: "Controlled interfaces, auditability and governance at every layer." },
] as const;

export const SOLUTIONS = [
  { n: "01", title: "Smarter Credit Decisions", text: "Improve transparency and efficiency across credit assessment.", products: ["sme-credit-decisioning", "financial-analysis-intelligence"] },
  { n: "02", title: "Adaptive Credit Strategies", text: "Evaluate policy scenarios before implementation.", products: ["credit-strategy-simulator", "rejection-intelligence"] },
  { n: "03", title: "Intelligent Reporting", text: "Simplify data mapping, validation, and reporting preparation.", products: ["riva"] },
  { n: "04", title: "Portfolio Intelligence", text: "Use historical patterns to strengthen decision context.", products: ["similar-portfolio-intelligence"] },
  { n: "05", title: "Operational Intelligence", text: "Connect fragmented information and repetitive workflows.", products: ["document-intelligence"] },
  { n: "06", title: "Knowledge & Content Intelligence", text: "Turn information into relevant, contextual outputs.", products: ["persona-newsroom"] },
] as const;

export interface ProductDetail {
  audience: string;
  does: string[];
  oversight: string;
}

/** Extra public copy per product slug. The product rows themselves (name, summary, audience) come from the database. */
export const PRODUCT_DETAIL: Record<string, ProductDetail> = {
  "credit-strategy-simulator": {
    audience: "Credit policy and risk teams",
    does: ["Model the effect of a policy change on approvals and exposure before it ships", "Compare scenarios side by side against a baseline", "Keep the assumptions behind every run visible"],
    oversight: "Outputs are simulations to inform a policy review. They are not approved credit decisions.",
  },
  "sme-credit-decisioning": {
    audience: "Credit analysts and approvers",
    does: ["Bring financial analysis, policy evaluation and risk review into one workbench", "Cite the evidence behind each recommendation", "Route the final call to a human approver"],
    oversight: "Recommendations are decision support. A named person approves or declines.",
  },
  "similar-portfolio-intelligence": {
    audience: "Portfolio and underwriting teams",
    does: ["Compare an application with relevant historical segments", "Surface patterns, risk indicators and comparable outcomes", "Explain why a segment was considered similar"],
    oversight: "Comparable outcomes add context; they do not predict an individual result.",
  },
  "rejection-intelligence": {
    audience: "Credit strategy and operations teams",
    does: ["Analyse declined applications and uncover rejection patterns", "Simulate changes that could improve eligible approvals", "Separate policy-driven declines from data-quality declines"],
    oversight: "Simulated improvements are hypotheses to test, not instructions to relax policy.",
  },
  riva: {
    audience: "Reporting, finance and compliance teams",
    does: ["Connect data sources and map report fields", "Validate data before it reaches a report", "Simplify recurring reporting workflows"],
    oversight: "Validation findings are surfaced for review; reports are not filed automatically.",
  },
  "financial-analysis-intelligence": {
    audience: "Credit analysts and relationship managers",
    does: ["Turn financial statements into structured analysis, ratios and trends", "Produce decision-ready credit insights with their sources", "Make period-over-period changes explainable"],
    oversight: "Analysis supports a credit decision; it is not one.",
  },
  "document-intelligence": {
    audience: "Operations and onboarding teams",
    does: ["Extract, classify and structure information from financial documents and identity records", "Validate extracted fields against rules", "Flag low-confidence fields for a person to check"],
    oversight: "Low-confidence extractions are routed to review rather than accepted silently.",
  },
  "persona-newsroom": {
    audience: "Marketing and executive communications",
    does: ["Discover relevant market news", "Match stories to executive personas", "Generate editable thought-leadership drafts"],
    oversight: "Drafts are suggestions. Nothing is published without an editor.",
  },
};

export const FEATURED_PRODUCTS = [
  "credit-strategy-simulator",
  "sme-credit-decisioning",
  "similar-portfolio-intelligence",
  "riva",
] as const;

export const LAB = [
  { n: "01", title: "Inside the Lab", text: "Explore how we approach rapid prototyping and real-world experimentation." },
  { n: "02", title: "What We're Exploring", text: "Agentic AI, small language models, multimodal intelligence, and AI-assisted engineering." },
  { n: "03", title: "Build Stories", text: "From problem statements and experiments to working prototypes and lessons learned." },
  { n: "04", title: "Hackathons & Collaboration", text: "Innovation challenges, working sessions, and opportunities to build together." },
] as const;

export const INSIGHTS = [
  { n: "01", title: "Why Explainability Matters in Credit Decisions", text: "How evidence, oversight, and transparent recommendations shape responsible decision support." },
  { n: "02", title: "From Reporting Automation to Intelligence", text: "Moving beyond templates to configurable, validated, and traceable reporting." },
  { n: "03", title: "Small Language Models in Financial Services", text: "Considerations for privacy, performance, deployment, and governance." },
  { n: "04", title: "Engineering Notes", text: "Lessons from experiments, prototypes, and production-oriented design." },
] as const;

export const MEDIA = [
  { tag: "Brand", title: "The azentio.ai Story", text: "Introducing our approach to applied AI." },
  { tag: "Products", title: "Product Showreel", text: "An overview of intelligent products in action." },
  { tag: "Product Demo", title: "Credit Decisioning Deep Dive", text: "Explore evidence-backed credit decisioning." },
  { tag: "AI Lab", title: "Inside the AI Lab", text: "Experiments, prototypes, and lessons learned." },
] as const;

export const TECHNOLOGY = [
  { n: "01", title: "Enterprise Integration", text: "Connect applications, data sources, business rules, and enterprise services through controlled interfaces." },
  { n: "02", title: "AI Orchestration", text: "Combine models, workflows, agents, deterministic logic, and human approvals." },
  { n: "03", title: "Security by Design", text: "Support institution SSO, role-based access, encrypted transport, audit trails, and secure deployment." },
  { n: "04", title: "Responsible AI", text: "Support explainability, model oversight, traceability, and human control." },
] as const;

export const ARCHITECTURE = [
  { layer: "User experience", items: "Workbenches · Copilots · APIs" },
  { layer: "AI orchestration & business logic", items: "Workflows · Agents · Rules · Approvals" },
  { layer: "Model intelligence · Enterprise data · System integration", items: "Models · Data · Services" },
  { layer: "Trust, security & governance", items: "SSO · RBAC · Encryption · Audit · Monitoring" },
] as const;

export const TRUST_PRINCIPLES = [
  "Human oversight on every recommendation that could affect a customer.",
  "Synthetic or explicitly approved data in demonstrations. Sample data and simulated outputs are always labelled.",
  "Access enforced on the server for every page, API call and media file.",
  "Product capabilities and release readiness are validated before public commitments.",
] as const;
