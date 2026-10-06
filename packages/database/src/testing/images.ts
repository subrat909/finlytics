/**
 * The TimescaleDB image the integration tests run on: the tag pinned for the `postgres` service in docker-compose.yml,
 * so tests and local development use the same PostgreSQL and TimescaleDB versions (Phase 0 plan D18). Bump both
 * together: src/__tests__/timescale-image.test.ts fails when they differ.
 */
export const TIMESCALE_IMAGE = "timescale/timescaledb-ha:pg16.15-ts2.30.2";
