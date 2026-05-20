// src/utils/fileEncryption.ts
//
// PURPOSE: AES-256-GCM encryption and decryption for files stored on disk.
//
// WHY AES-256-GCM:
//   AES-256 = 256-bit key, unbreakable with current computing.
//   GCM mode = Galois/Counter Mode. Unlike CBC, GCM also generates
//   an authentication tag — if anyone tampers with the encrypted file
//   on disk, decryption fails with an error. This is "authenticated
//   encryption" — both confidentiality AND integrity in one operation.
//
// WHY IV (Initialization Vector):
//   If two files have identical content, AES without an IV would produce
//   identical ciphertext — revealing that the files are the same.
//   A random IV ensures two encryptions of the same file produce
//   completely different ciphertext. The IV is not secret — it's stored
//   in the database alongside the file record.
//
// KEY STORAGE:
//   The master key lives ONLY in the environment variable FILE_ENCRYPTION_KEY.
//   It is never stored in the database or logged anywhere.
//   Without it, the encrypted files on disk are computationally unreadable.

import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

// AES-256-GCM constants
const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16   // 128-bit IV — standard for GCM
const TAG_LENGTH = 16   // 128-bit auth tag — GCM standard

// Load and validate the master encryption key
// WHY VALIDATE AT MODULE LOAD: Fail fast — better to crash at startup
// than to discover a missing key when the first user uploads a file.
function getMasterKey(): Buffer {
    const keyHex = process.env.FILE_ENCRYPTION_KEY;
    if (!keyHex) {
        throw new Error('[Encryption] FILE_ENCRYPTION_KEY is not set in environment variables');
    }
    if (keyHex.length !== 64) {
        throw new Error('[Encryption] FILE_ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
    }
    return Buffer.from(keyHex, 'hex');
}

// ─── encryptFile ──────────────────────────────────────────────────────────────
//
// PURPOSE: Read a plaintext file from disk, encrypt it, write encrypted
//          version back to disk (replacing the original).
//
// INPUTS:
//   filePath — absolute path to the file on disk (written by multer)
//
// OUTPUTS:
//   iv — hex string of the random IV used (store this in the DB)
//
// WHY REPLACE IN PLACE:
//   Multer writes the file to disk first. We encrypt it immediately after.
//   Replacing in place means the plaintext never persists beyond milliseconds.

export async function encryptFile(filePath: string): Promise<{ iv: string }> {
    const masterKey = getMasterKey()
    // Generate a fresh random IV for this specific file
    const iv = crypto.randomBytes(IV_LENGTH)
    // Read the plaintext file multer just wrote
    const plaintext = fs.readFileSync(filePath)
    // Create cipher — AES-256-GCM with our master key and fresh IV
    const cipher = crypto.createCipheriv(ALGORITHM, masterKey, iv)
    const encrypted = Buffer.concat([
        cipher.update(plaintext),
        cipher.final()
    ])
    // Get the authentication tag — 16 bytes that prove the data wasn't tampered with
    const authTag = cipher.getAuthTag()

    const finalBuffer = Buffer.concat([authTag, encrypted])

    fs.writeFileSync(filePath, finalBuffer)
    console.log(`[Encryption] Encrypted: ${path.basename(filePath)} (${plaintext.length} → ${finalBuffer.length} bytes)`)
    return { iv: iv.toString('hex') }
}

// ─── decryptFile ──────────────────────────────────────────────────────────────

export function decryptFile(filePath: string, ivHex: string): Buffer {
    const masterKey = getMasterKey()
    const iv = Buffer.from(ivHex, 'hex')

    // Read encrypted file
    const encryptedBuffer = fs.readFileSync(filePath)

    // Extract auth tag (first 16 bytes) and ciphertext (rest)
    const authTag = encryptedBuffer.subarray(0, TAG_LENGTH)
    const ciphertext = encryptedBuffer.subarray(TAG_LENGTH)

    // Create decipher
    const decipher = crypto.createDecipheriv(ALGORITHM, masterKey, iv)

    // Set the auth tag — GCM will verify this during decryption
    // If the file was modified on disk, this throws an error — that's correct behavior
    decipher.setAuthTag(authTag)

    try {
        const decrypted = Buffer.concat([
            decipher.update(ciphertext),
            decipher.final()   // ← throws if auth tag verification fails
        ])
        return decrypted
    } catch {
        throw new Error(`[Encryption] Auth tag verification failed for ${path.basename(filePath)} — file may have been tampered with`)
    }
}


export function encryptBuffer(plainBuffer: Buffer): {
    encryptedBuffer: Buffer;
    iv: string;
} {
    const masterKey = getMasterKey();

    // Fresh random IV for every new file.
    // WHY RANDOM: Same content encrypted twice must produce different ciphertext.
    // If IV were fixed, two users uploading the same file would reveal
    // that the content is identical — an information leak.
    const ivBuffer = crypto.randomBytes(IV_LENGTH);

    const cipher = crypto.createCipheriv(ALGORITHM, masterKey, ivBuffer);

    const encrypted = Buffer.concat([
        cipher.update(plainBuffer),
        cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    const encryptedBuffer = Buffer.concat([authTag, encrypted]);

    return {
        encryptedBuffer,
        iv: ivBuffer.toString('hex'), // store this in the DB
    };
}

//
export function decryptBuffer(encryptedBuffer: Buffer, ivHex: string): Buffer {
    const masterKey = getMasterKey();
    const iv = Buffer.from(ivHex, 'hex');

    // Parse the structure: [16 bytes authTag][rest is ciphertext]
    const authTag = encryptedBuffer.subarray(0, TAG_LENGTH);
    const ciphertext = encryptedBuffer.subarray(TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, masterKey, iv);

    decipher.setAuthTag(authTag);

    try {
        return Buffer.concat([
            decipher.update(ciphertext),
            decipher.final(), // ← throws if auth tag verification fails
        ]);
    } catch {
        throw new Error(
            '[Encryption] Auth tag verification failed — file may have been tampered with on R2'
        );
    }
}

// ─── isEncryptionEnabled ──────────────────────────────────────────────────────
//
//

export function isEncryptionEnabled(): boolean {
    return !!process.env.FILE_ENCRYPTION_KEY
}
