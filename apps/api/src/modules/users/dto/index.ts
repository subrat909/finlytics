/** DTOs for the users module: the Zod contracts from @finlytics/shared, as nestjs-zod classes. */
import { MeSchema } from "@finlytics/shared";
import { createZodDto } from "nestjs-zod";

/** `GET /v1/me`. */
export class MeDto extends createZodDto(MeSchema) {}
