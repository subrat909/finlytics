import { ConfigModule } from "@nestjs/config";
import type { DynamicModule } from "@nestjs/common";

import type { Env } from "./env.schema";

/**
 * Global configuration from an already validated environment (plan D3): `ConfigService<Env, true>` everywhere.
 *
 * - `load: [() => env]`: the values come from the object main.ts (or a test) validated, not from process.env.
 * - `ignoreEnvFile`: only the dev script loads .env (`node --env-file-if-exists`).
 * - `validatePredefined: false`: ConfigModule neither re-reads nor writes back process.env.
 * - `skipProcessEnv`: `get()` never falls back to process.env, so an unvalidated variable can't be read.
 */
export function configModule(env: Env): Promise<DynamicModule> {
  return ConfigModule.forRoot({
    isGlobal: true,
    ignoreEnvFile: true,
    validatePredefined: false,
    skipProcessEnv: true,
    load: [() => env],
  });
}
