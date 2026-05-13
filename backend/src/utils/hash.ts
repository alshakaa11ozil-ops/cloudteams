// src/utils/hash.ts
// PURPOSE: Calculate the SHA-256 hash of a file buffer in memory.
//          Used by the upload service to fingerprint every uploaded file
//          before checking for duplicates in the database.
//
// WHY SHA-256 (not MD5, not SHA-1)?
//   MD5:  Fast but has known collision attacks. Two different files can produce
//         the same MD5 hash. This would break deduplication — the system would
//         incorrectly believe two different files are the same.
//   SHA-1: Also has demonstrated collision attacks (Google's SHAttered, 2017).
//   SHA-256: No known collisions. Part of the SHA-2 family. Industry standard
//            for content-addressable storage (Git uses SHA-1 internally but
//            is migrating to SHA-256 for exactly this reason).
//
// WHY BUFFER (not streaming from disk)?
//   Previously we streamed from disk to avoid loading large files into RAM.
//   With Multer memoryStorage, the file is ALREADY in RAM as a Buffer —
//   it was never written to disk at all. Streaming from disk would require
//   a path that doesn't exist. Since the buffer is already in memory,
//   we hash it synchronously in one pass — no I/O, no Promise needed.
//   Memory cost is the same either way: the buffer already exists.

import crypto from 'crypto'; // Node.js built-in — no npm install needed

// ---------------------------------------------------------------------------
// calculateFileHash
// ---------------------------------------------------------------------------
// PURPOSE: Compute SHA-256 hash of a file buffer already in memory.
//
// INPUTS:
//   buffer (Buffer) — the raw file bytes from multerFile.buffer
//
// OUTPUTS:
//   string — 64-character hex string
//   Example: "a3f5c2d1e8b4...64 hex chars total"
//
// WHY SYNCHRONOUS (not Promise)?
//   The original async version was needed because disk I/O is async.
//   Buffer hashing is pure CPU computation — no I/O, no waiting.
//   Synchronous is correct here. Wrapping in a Promise would add
//   overhead with zero benefit.
// ---------------------------------------------------------------------------
export function calculateFileHash(buffer: Buffer): string {
    // crypto.createHash('sha256') creates a Hash object.
    // .update(buffer) feeds ALL bytes in one call — no chunking needed
    // because the buffer is already fully in RAM.
    // .digest('hex') finalises and returns the 64-char hex string.
    return crypto
        .createHash('sha256')
        .update(buffer)
        .digest('hex');
}
