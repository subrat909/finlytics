/**
 * The broker credential vault (plan P3; docs/06 "Crypto design"; security.md "Broker credentials & tokens"). The only
 * place that encrypts or decrypts broker secrets.
 *
 * AES-256-GCM envelope encryption:
 * - Each BrokerAccount row has its own random 256-bit **data key**, stored wrapped by the **master key** (MASTER_KEY,
 *   base64 32 bytes; KMS later): `encKeyWrapped` = ciphertext || tag, with its own 96-bit IV (`encKeyIv`) and AAD
 *   `userId:brokerAccountId:dataKey`.
 * - Every field (credentials, client id, app credentials) is encrypted under the data key with a **fresh 96-bit IV per
 *   ciphertext**, its 16-byte tag appended, and AAD `userId:brokerAccountId:<field>`. A ciphertext copied to another
 *   user, another account or another field fails authentication.
 * - Rotation: a new master key version re-wraps the data keys (`encKeyVersion`); field ciphertexts never change.
 *
 * Any failure to decrypt (wrong key, AAD or tampering) is a {@link VaultError} that says nothing about the data.
 * Plaintext keys are zeroed after use. Nothing here logs a value.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

import { credentialsFromJson, credentialsToJson } from "@finlytics/broker-sdk";
import type { BrokerCredentials } from "@finlytics/broker-sdk";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PinoLogger } from "nestjs-pino";

import type { Env } from "../../config/env.schema";

/** The encrypted fields of a BrokerAccount. */
export const VAULT_FIELDS = Object.freeze(["credentials", "clientId", "appCredentials"] as const);
export type VaultField = (typeof VAULT_FIELDS)[number];

/** The AAD field name of the wrapped data key. */
const DATA_KEY_FIELD = "dataKey";
const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
/** The master key version this build wraps with. */
export const MASTER_KEY_VERSION = 1;

/** Whose secret a ciphertext is: part of every AAD. */
export interface VaultScope {
  readonly userId: string;
  readonly brokerAccountId: string;
}

/** A data key as stored: wrapped by the master key. */
export interface WrappedDataKey {
  /** Ciphertext || tag (48 bytes). */
  readonly wrapped: Uint8Array<ArrayBuffer>;
  readonly iv: Uint8Array<ArrayBuffer>;
  readonly version: number;
}

/** One encrypted field as stored. */
export interface SealedValue {
  /** Ciphertext || tag. */
  readonly ciphertext: Uint8Array<ArrayBuffer>;
  readonly iv: Uint8Array<ArrayBuffer>;
}

/** Decryption failed: wrong key, wrong scope or field, or tampered data. Says nothing about the data. */
export class VaultError extends Error {
  override readonly name = "VaultError";
}

const ID_SEGMENT = /^[^:\s]{1,128}$/;

/** `userId:brokerAccountId:<field>`. @throws {TypeError} for an id that is empty or contains `:` or whitespace. */
export function vaultAad(scope: VaultScope, field: VaultField | typeof DATA_KEY_FIELD): Buffer {
  if (!ID_SEGMENT.test(scope.userId) || !ID_SEGMENT.test(scope.brokerAccountId)) {
    throw new TypeError("Invalid vault scope");
  }
  return Buffer.from(`${scope.userId}:${scope.brokerAccountId}:${field}`, "utf8");
}

/** A copy as a plain Uint8Array (what Prisma's Bytes columns take). */
function bytes(buffer: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(buffer);
}

function encrypt(key: Uint8Array, plaintext: Uint8Array, aad: Buffer): SealedValue {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  return { ciphertext: bytes(ciphertext), iv: bytes(iv) };
}

function decrypt(key: Uint8Array, sealed: SealedValue, aad: Buffer): Buffer {
  if (sealed.iv.length !== IV_BYTES || sealed.ciphertext.length < TAG_BYTES)
    throw new VaultError("Vault decryption failed");
  const body = sealed.ciphertext.subarray(0, sealed.ciphertext.length - TAG_BYTES);
  const tag = sealed.ciphertext.subarray(sealed.ciphertext.length - TAG_BYTES);
  try {
    const decipher = createDecipheriv(ALGORITHM, key, sealed.iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    throw new VaultError("Vault decryption failed");
  }
}

/** The master key from MASTER_KEY, or (outside production, unset) a random one for this process only. */
export function masterKeyFrom(value: string | undefined): { key: Buffer; ephemeral: boolean } {
  if (value === undefined) return { key: randomBytes(KEY_BYTES), ephemeral: true };
  const key = Buffer.from(value, "base64");
  if (key.length !== KEY_BYTES) throw new TypeError("MASTER_KEY must be 32 bytes");
  return { key, ephemeral: false };
}

@Injectable()
export class VaultService {
  readonly #masterKey: Buffer;

  constructor(config: ConfigService<Env, true>, logger: PinoLogger) {
    logger.setContext(VaultService.name);
    const { key, ephemeral } = masterKeyFrom(config.get("MASTER_KEY", { infer: true }));
    this.#masterKey = key;
    if (ephemeral) {
      // Production requires MASTER_KEY (env.schema.ts), so this is development or test only.
      logger.warn("MASTER_KEY is not set: using a per-process key; broker accounts won't decrypt after a restart");
    }
  }

  /** A new random data key for one account, wrapped by the master key. */
  createDataKey(scope: VaultScope): WrappedDataKey {
    const dataKey = randomBytes(KEY_BYTES);
    try {
      const sealed = encrypt(this.#masterKey, dataKey, vaultAad(scope, DATA_KEY_FIELD));
      return { wrapped: sealed.ciphertext, iv: sealed.iv, version: MASTER_KEY_VERSION };
    } finally {
      dataKey.fill(0);
    }
  }

  /** Encrypts one field's plaintext under the account's data key, with a fresh IV. */
  seal(scope: VaultScope, dataKey: WrappedDataKey, field: VaultField, plaintext: string): SealedValue {
    return this.#withDataKey(scope, dataKey, (key) =>
      encrypt(key, Buffer.from(plaintext, "utf8"), vaultAad(scope, field)),
    );
  }

  /** Decrypts one field. @throws {VaultError} for the wrong scope, field or key, or tampered data. */
  open(scope: VaultScope, dataKey: WrappedDataKey, field: VaultField, sealed: SealedValue): string {
    return this.#withDataKey(scope, dataKey, (key) => {
      const plaintext = decrypt(key, sealed, vaultAad(scope, field));
      try {
        return plaintext.toString("utf8");
      } finally {
        plaintext.fill(0);
      }
    });
  }

  /** Encrypts a JSON value. */
  sealJson(scope: VaultScope, dataKey: WrappedDataKey, field: VaultField, value: unknown): SealedValue {
    return this.seal(scope, dataKey, field, JSON.stringify(value));
  }

  /** Decrypts a JSON value. @throws {VaultError} as {@link open}, or when the plaintext isn't JSON. */
  openJson(scope: VaultScope, dataKey: WrappedDataKey, field: VaultField, sealed: SealedValue): unknown {
    const text = this.open(scope, dataKey, field, sealed);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new VaultError("Vault plaintext is not JSON");
    }
  }

  /** Encrypts broker credentials (field `credentials`). */
  sealCredentials(scope: VaultScope, dataKey: WrappedDataKey, creds: BrokerCredentials): SealedValue {
    return this.sealJson(scope, dataKey, "credentials", credentialsToJson(creds));
  }

  /** Decrypts broker credentials into Secret-wrapped values. @throws {VaultError} on any failure. */
  openCredentials(scope: VaultScope, dataKey: WrappedDataKey, sealed: SealedValue): BrokerCredentials {
    const json = this.openJson(scope, dataKey, "credentials", sealed);
    try {
      return credentialsFromJson(json);
    } catch {
      throw new VaultError("Vault credentials are malformed");
    }
  }

  /**
   * A 32-byte key for another purpose (the OAuth state HMAC), derived from the master key with HKDF-SHA256, so no second
   * secret is needed and the master key itself never signs anything.
   */
  deriveKey(purpose: string): Buffer {
    if (!/^[a-z][a-z0-9-]{0,40}$/.test(purpose)) throw new TypeError("Invalid key purpose");
    return Buffer.from(hkdfSync("sha256", this.#masterKey, "finlytics-vault", `finlytics/${purpose}/v1`, KEY_BYTES));
  }

  #withDataKey<T>(scope: VaultScope, dataKey: WrappedDataKey, use: (key: Buffer) => T): T {
    if (dataKey.version !== MASTER_KEY_VERSION) throw new VaultError("Unknown master key version");
    const key = decrypt(
      this.#masterKey,
      { ciphertext: dataKey.wrapped, iv: dataKey.iv },
      vaultAad(scope, DATA_KEY_FIELD),
    );
    try {
      return use(key);
    } finally {
      key.fill(0);
    }
  }
}
