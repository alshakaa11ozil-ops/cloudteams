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
export function calculateFileHash(buffer: Buffer): string {
    return crypto
        .createHash('sha256')
        .update(buffer)
        .digest('hex');
}
