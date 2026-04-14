-- Ручное применение поверх существующей allure_inspector_db (если не через knex migrate).
-- Нужны расширения: pgcrypto (для gen_random_uuid) — в setup-db.sh уже: CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS static_analysis_model_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id varchar(50) NOT NULL,
  jira_issue varchar(50) NULL,
  model_file_name varchar(512) NULL,
  created_at timestamptz DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS static_analysis_model_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES static_analysis_model_runs(id) ON DELETE CASCADE,
  title varchar(255) NULL,
  message text NOT NULL,
  severity varchar(20) NOT NULL,
  category varchar(64) NULL,
  rule_id varchar(128) NULL,
  node_name varchar(1024) NULL,
  extra jsonb NULL
);

CREATE INDEX IF NOT EXISTS idx_static_analysis_model_runs_project_created
  ON static_analysis_model_runs (project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_static_analysis_model_runs_jira_created
  ON static_analysis_model_runs (jira_issue, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_static_analysis_model_issues_run_id
  ON static_analysis_model_issues (run_id);

-- Если миграции дальше гоняете через knex, зарегистрируйте файл, чтобы migrate:latest не упал на «уже есть»:
-- INSERT INTO knex_migrations_inspector (name, batch, migration_time)
-- SELECT '20250401_static_analysis_model_results.js', COALESCE((SELECT MAX(batch) FROM knex_migrations_inspector), 0) + 1, NOW()
-- WHERE NOT EXISTS (
--   SELECT 1 FROM knex_migrations_inspector WHERE name = '20250401_static_analysis_model_results.js'
-- );
