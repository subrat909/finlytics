import { Global, Module } from "@nestjs/common";

import { VaultService } from "./vault.service";

/** The broker credential vault, one per process (it holds the master key). */
@Global()
@Module({
  providers: [VaultService],
  exports: [VaultService],
})
export class VaultModule {}
