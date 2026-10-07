/** DTOs for the brokers module: the Zod contracts from @finlytics/shared, as nestjs-zod classes. */
import {
  BrokerAccountIdSchema,
  BrokerAccountListSchema,
  BrokerAccountViewSchema,
  BrokerAuthRedirectSchema,
  BrokerLimitsSchema,
  ConnectDhanSchema,
  ConnectPaperSchema,
  ConnectUpstoxSchema,
  UpdateBrokerAccountSchema,
} from "@finlytics/shared";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";

export class BrokerAccountViewDto extends createZodDto(BrokerAccountViewSchema) {}
export class BrokerAccountListDto extends createZodDto(BrokerAccountListSchema) {}
export class BrokerAuthRedirectDto extends createZodDto(BrokerAuthRedirectSchema) {}
export class BrokerLimitsDto extends createZodDto(BrokerLimitsSchema) {}
export class ConnectUpstoxDto extends createZodDto(ConnectUpstoxSchema) {}
export class ConnectDhanDto extends createZodDto(ConnectDhanSchema) {}
export class ConnectPaperDto extends createZodDto(ConnectPaperSchema) {}
export class UpdateBrokerAccountDto extends createZodDto(UpdateBrokerAccountSchema) {}
export class BrokerAccountParamsDto extends createZodDto(z.strictObject({ id: BrokerAccountIdSchema })) {}

/**
 * `GET /v1/brokers/upstox/callback`: any query (the browser arrives from Upstox). The service validates it with
 * UpstoxCallbackQuerySchema and answers every problem with a redirect, never a JSON error page.
 */
export class UpstoxCallbackRawQueryDto extends createZodDto(
  // A plain object of optional strings (or arrays, for repeated parameters), so OpenAPI can describe the query;
  // nestjs-zod can't render `unknown` members. Unknown parameters are stripped; the service does the real check.
  z.object({
    code: z.union([z.string(), z.array(z.string())]).optional(),
    state: z.union([z.string(), z.array(z.string())]).optional(),
  }),
) {}
