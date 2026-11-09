import {safeStorage} from "electron";

const PREFIX = "enc:v1:";

/**
 * Keeps secrets (API keys, tokens) out of the project file in plain text. They are encrypted with the
 * operating system's key store through Electron, so only this user on this computer can read them.
 * The page can encrypt, but only the main process can decrypt.
 */
export class SecretModel {
    get available(): boolean {
        try {
            return safeStorage.isEncryptionAvailable();
        } catch {
            return false;
        }
    }

    /** Returns "" when the system key store is not available: a secret is never saved as plain text. */
    encrypt(plain: string): string {
        if (plain === "") {
            return "";
        }
        if (!this.available) {
            return "";
        }
        return PREFIX + safeStorage.encryptString(plain.slice(0, 4000)).toString("base64");
    }

    /** The plain secret, or "" for an empty, damaged or foreign value. */
    decrypt(stored: string): string {
        if (!stored.startsWith(PREFIX) || !this.available) {
            return "";
        }
        try {
            return safeStorage.decryptString(Buffer.from(stored.slice(PREFIX.length), "base64"));
        } catch {
            return "";
        }
    }
}
