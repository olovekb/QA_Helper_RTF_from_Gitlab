-- База данных для allure-test-inspector и bdd-server (статанализ)
CREATE DATABASE allure_inspector_db;

GRANT ALL PRIVILEGES ON DATABASE allure_inspector_db TO tia_user;

\connect allure_inspector_db

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
