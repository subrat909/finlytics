-- TimescaleDB: hypertables, columnstore (compression), retention and the candle_m5 continuous aggregate.
-- Hand-written; Prisma generates none of this DDL. Prisma >= 7.4 runs migration.sql statement by statement and not
-- atomically, so every statement is idempotent: after a partial failure, fix the SQL, run
-- `prisma migrate resolve --rolled-back <migration>` and re-apply.
-- create_default_indexes => FALSE: the default ts index is not in schema.prisma, so Prisma would see drift (plan D6).

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Tick: 1-day chunks, columnstore after 2 days, drop after 30 days
SELECT create_hypertable('"Tick"', by_range('ts', INTERVAL '1 day'), create_default_indexes => FALSE, if_not_exists => TRUE);
ALTER TABLE "Tick" SET (timescaledb.enable_columnstore, timescaledb.segmentby = '"instrumentKey"', timescaledb.orderby = 'ts DESC');
SELECT add_compression_policy('"Tick"', INTERVAL '2 days', if_not_exists => TRUE);
SELECT add_retention_policy('"Tick"', INTERVAL '30 days', if_not_exists => TRUE);

-- Candle: 7-day chunks, columnstore after 30 days, keep forever
SELECT create_hypertable('"Candle"', by_range('ts', INTERVAL '7 days'), create_default_indexes => FALSE, if_not_exists => TRUE);
ALTER TABLE "Candle" SET (timescaledb.enable_columnstore, timescaledb.segmentby = '"instrumentKey", timeframe', timescaledb.orderby = 'ts DESC');
SELECT add_compression_policy('"Candle"', INTERVAL '30 days', if_not_exists => TRUE);

-- OptionChainSnapshot: 1-day chunks, columnstore after 3 days, keep 2 years (backtests)
SELECT create_hypertable('"OptionChainSnapshot"', by_range('ts', INTERVAL '1 day'), create_default_indexes => FALSE, if_not_exists => TRUE);
ALTER TABLE "OptionChainSnapshot" SET (timescaledb.enable_columnstore, timescaledb.segmentby = 'underlying, expiry', timescaledb.orderby = 'ts DESC');
SELECT add_compression_policy('"OptionChainSnapshot"', INTERVAL '3 days', if_not_exists => TRUE);
SELECT add_retention_policy('"OptionChainSnapshot"', INTERVAL '730 days', if_not_exists => TRUE);

-- 5-minute candles from M1. WITH NO DATA keeps this valid inside an implicit transaction.
CREATE MATERIALIZED VIEW IF NOT EXISTS candle_m5 WITH (timescaledb.continuous) AS
SELECT "instrumentKey", time_bucket('5 minutes', ts) AS bucket,
       first(open, ts) AS open, max(high) AS high, min(low) AS low, last(close, ts) AS close,
       sum(volume) AS volume, last(oi, ts) AS oi
FROM "Candle" WHERE timeframe = 'M1'
GROUP BY "instrumentKey", bucket
WITH NO DATA;
SELECT add_continuous_aggregate_policy('candle_m5', start_offset => INTERVAL '1 day', end_offset => INTERVAL '5 minutes',
                                       schedule_interval => INTERVAL '5 minutes', if_not_exists => TRUE);
