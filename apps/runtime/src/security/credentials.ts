import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { EncryptedText } from "@qpilot/shared";

const ALGORITHM = "aes-256-gcm";

export const encryptText = (plainText: string, masterKeyHex: string): EncryptedText => {
  const key = Buffer.from(masterKeyHex, "hex");
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64")
  };
};

export const decryptText = (payload: EncryptedText, masterKeyHex: string): string => {
  const key = Buffer.from(masterKeyHex, "hex");
  const iv = Buffer.from(payload.iv, "base64");
  const tag = Buffer.from(payload.tag, "base64");
  const encrypted = Buffer.from(payload.ciphertext, "base64");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
};
