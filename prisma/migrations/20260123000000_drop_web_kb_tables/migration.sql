-- Cleanup: remove unused Web KB tables.
-- Safe because application no longer uses web-kb module or endpoints.

DROP TABLE IF EXISTS "WebChunk" CASCADE;
DROP TABLE IF EXISTS "WebPage" CASCADE;
DROP TABLE IF EXISTS "WebSite" CASCADE;
