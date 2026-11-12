-- Migrations owner (runs migrations, owns the tables)
CREATE ROLE hesba_migrator LOGIN PASSWORD 'change-me-local' CREATEDB;

-- Application role: must NOT be superuser and must NOT bypass RLS.
-- If it could, Row Level Security would not protect shops.
CREATE ROLE hesba_app LOGIN PASSWORD 'change-me-local' NOSUPERUSER NOBYPASSRLS;

-- Background-job role (ADR-0024, QA-34): ONLY the catalog-promotion cron connects with it.
-- Not superuser, no BYPASSRLS; it gets narrow grants/policies from the migrations.
CREATE ROLE hesba_service LOGIN PASSWORD 'change-me-local' NOSUPERUSER NOBYPASSRLS;

CREATE DATABASE hesba OWNER hesba_migrator;
