-- Taking back the undo-at-the-gate table.
--
-- An undo for gate entries was built as 053_scan_undos.sql and then removed at
-- the department's request before launch. A server that pulled the code in
-- between will have run that migration: this removes its table and its record,
-- so the database matches the code again.
--
-- Safe everywhere. Where 053_scan_undos.sql never ran there is no table and no
-- record, and both statements do nothing.

DROP TABLE IF EXISTS scan_undos;

DELETE FROM schema_migrations WHERE filename = '053_scan_undos.sql';
