import { Global, Module } from "@nestjs/common";

import { PrismaService } from "./prisma.service";

/** One Prisma client per process, for every module. */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
