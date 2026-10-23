ALTER TABLE "customer_research_projects"
  ADD COLUMN "executor" TEXT NOT NULL DEFAULT 'internal';
ALTER TABLE "customer_research_projects"
  ADD CONSTRAINT "customer_research_projects_executor_check"
  CHECK ("executor" IN ('internal', 'hermes'));
