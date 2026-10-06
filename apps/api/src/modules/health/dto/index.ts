/** DTOs for the health probes: the Zod contracts from @finlytics/shared, as nestjs-zod classes. */
import { HealthLiveSchema, HealthReadySchema } from "@finlytics/shared";
import { createZodDto } from "nestjs-zod";

/** `GET /health/live`. */
export class HealthLiveDto extends createZodDto(HealthLiveSchema) {}

/** `GET /health/ready`, with status 200 or 503. */
export class HealthReadyDto extends createZodDto(HealthReadySchema) {}
