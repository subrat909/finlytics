-- Run AFTER the first `prisma migrate dev` creates the tables.
-- Converts time-series tables into TimescaleDB hypertables and adds policies/indexes Prisma cannot express.

CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Ticks: 1-day chunks, compress after 2 days, drop after 30 days
SELECT create_hypertable('"Tick"', 'ts', chunk_time_interval => INTERVAL '1 day', if_not_exists => TRUE, migrate_data => TRUE);
ALTER TABLE "Tick" SET (timescaledb.compress, timescaledb.compress_segmentby = '"instrumentKey"', timescaledb.compress_orderby = 'ts DESC');
SELECT add_compression_policy('"Tick"', INTERVAL '2 days', if_not_exists => TRUE);
SELECT add_retention_policy('"Tick"', INTERVAL '30 days', if_not_exists => TRUE);

-- Candles: 7-day chunks, compress after 30 days, keep forever
SELECT create_hypertable('"Candle"', 'ts', chunk_time_interval => INTERVAL '7 days', if_not_exists => TRUE, migrate_data => TRUE);
ALTER TABLE "Candle" SET (timescaledb.compress, timescaledb.compress_segmentby = '"instrumentKey", timeframe', timescaledb.compress_orderby = 'ts DESC');
SELECT add_compression_policy('"Candle"', INTERVAL '30 days', if_not_exists => TRUE);

-- Option chain snapshots: 1-day chunks, compress after 3 days, keep 2 years (backtests)
SELECT create_hypertable('"OptionChainSnapshot"', 'ts', chunk_time_interval => INTERVAL '1 day', if_not_exists => TRUE, migrate_data => TRUE);
ALTER TABLE "OptionChainSnapshot" SET (timescaledb.compress, timescaledb.compress_segmentby = 'underlying, expiry', timescaledb.compress_orderby = 'ts DESC');
SELECT add_compression_policy('"OptionChainSnapshot"', INTERVAL '3 days', if_not_exists => TRUE);
SELECT add_retention_policy('"OptionChainSnapshot"', INTERVAL '730 days', if_not_exists => TRUE);

-- Continuous aggregate: 5-minute candles from 1-minute
CREATE MATERIALIZED VIEW IF NOT EXISTS candle_m5
WITH (timescaledb.continuous) AS
SELECT "instrumentKey",
       time_bucket('5 minutes', ts) AS bucket,
       first(open, ts) AS open, max(high) AS high, min(low) AS low, last(close, ts) AS close,
       sum(volume) AS volume, last(oi, ts) AS oi
FROM "Candle" WHERE timeframe = 'M1'
GROUP BY "instrumentKey", bucket
WITH NO DATA;
SELECT add_continuous_aggregate_policy('candle_m5', start_offset => INTERVAL '1 day', end_offset => INTERVAL '5 minutes', schedule_interval => INTERVAL '5 minutes', if_not_exists => TRUE);

-- Instrument search
CREATE INDEX IF NOT EXISTS instrument_name_trgm ON "Instrument" USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS instrument_symbol_trgm ON "Instrument" USING gin (symbol gin_trgm_ops);

-- Audit log: append-only
CREATE OR REPLACE FUNCTION audit_no_update() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'AuditLog is append-only'; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS audit_log_immutable ON "AuditLog";
CREATE TRIGGER audit_log_immutable BEFORE UPDATE OR DELETE ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION audit_no_update();
