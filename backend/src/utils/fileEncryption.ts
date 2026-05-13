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
    // WHY RANDOM: Ensures identical files produce different ciphertext
    const iv = crypto.randomBytes(IV_LENGTH)

    // Read the plaintext file multer just wrote
    const plaintext = fs.readFileSync(filePath)

    // Create cipher — AES-256-GCM with our master key and fresh IV
    const cipher = crypto.createCipheriv(ALGORITHM, masterKey, iv)

    // Encrypt the data
    // update() processes the data, final() flushes any remaining bytes
    const encrypted = Buffer.concat([
        cipher.update(plaintext),
        cipher.final()
    ])

    // Get the authentication tag — 16 bytes that prove the data wasn't tampered with
    // WHY PREPEND TAG: We need the tag during decryption. Storing it in the file
    // itself (prepended) is simpler than storing it separately in the DB.
    const authTag = cipher.getAuthTag()

    // Write structure: [16 bytes authTag][encrypted data]
    // The IV is stored in the DB — we don't need it in the file itself
    const finalBuffer = Buffer.concat([authTag, encrypted])

    // Overwrite the plaintext file with the encrypted version
    fs.writeFileSync(filePath, finalBuffer)

    console.log(`[Encryption] Encrypted: ${path.basename(filePath)} (${plaintext.length} → ${finalBuffer.length} bytes)`)

    return { iv: iv.toString('hex') }
}

// ─── decryptFile ──────────────────────────────────────────────────────────────
//
// PURPOSE: Read an encrypted file from disk, decrypt it, return as Buffer.
//          Used by download and preview endpoints.
//
// INPUTS:
//   filePath — absolute path to the .enc file on disk
//   ivHex    — the IV stored in the database for this file
//
// OUTPUTS:
//   Buffer of the original plaintext file content
//
// THROWS:
//   Error if the auth tag doesn't match — means file was tampered with

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

    // Encrypt in one pass — update() processes all bytes, final() flushes remainder.
    const encrypted = Buffer.concat([
        cipher.update(plainBuffer),
        cipher.final(),
    ]);

    // getAuthTag() must be called AFTER final() — GCM computes the tag at the end.
    // The tag proves the data wasn't modified between encryption and decryption.
    const authTag = cipher.getAuthTag();

    // Structure: [16 bytes authTag][encrypted data] — matches disk version exactly.
    const encryptedBuffer = Buffer.concat([authTag, encrypted]);

    return {
        encryptedBuffer,
        iv: ivBuffer.toString('hex'), // store this in the DB
    };
}
// THROWS:
//   Error if auth tag doesn't match — file was tampered with on R2.
//   This is GCM's integrity guarantee in action.
//
// WHY THIS IS NEEDED SEPARATELY FROM decryptFile:
//   decryptFile reads from disk (fs.readFileSync).
//   After switching to R2, downloads return a stream/buffer — no file path.
//   decryptBuffer takes that buffer directly, no disk access needed.
export function decryptBuffer(encryptedBuffer: Buffer, ivHex: string): Buffer {
    const masterKey = getMasterKey();
    const iv = Buffer.from(ivHex, 'hex');

    // Parse the structure: [16 bytes authTag][rest is ciphertext]
    const authTag = encryptedBuffer.subarray(0, TAG_LENGTH);
    const ciphertext = encryptedBuffer.subarray(TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, masterKey, iv);

    // setAuthTag must be called BEFORE update/final.
    // GCM verifies the tag during final() — if the bytes were modified,
    // final() throws. This is the tamper detection mechanism.
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
// PURPOSE: Check whether encryption is configured.
//          Used to handle both encrypted and legacy unencrypted files gracefully.
// WHY NEEDED: Files uploaded before encryption was added have no IV in the DB.
//   We check encryption_iv — if null, serve the file directly (backwards compatible).

export function isEncryptionEnabled(): boolean {
    return !!process.env.FILE_ENCRYPTION_KEY
}
