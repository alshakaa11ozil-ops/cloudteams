// =============================================================================
// src/utils/hash.ts
// PURPOSE: Calculate the SHA-256 hash of a file stored on disk.
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
// WHY STREAMING (not fs.readFileSync)?
//   readFileSync loads the ENTIRE file into RAM before processing.
//   A 50MB upload = 50MB of RAM consumed during hashing.
//   The stream approach reads in small chunks (~64KB each), feeds each chunk
//   to the hash function, then discards it. RAM usage stays near zero.
//   This matters when handling multiple concurrent uploads.
// =============================================================================

import crypto from "crypto"; // Node.js built-in — no npm install needed
import fs from "fs"; // Node.js built-in file system module

// ---------------------------------------------------------------------------
// calculateFileHash
// ---------------------------------------------------------------------------
// PURPOSE: Read a file from disk in streaming chunks and compute its SHA-256
//          hash, returning the result as a 64-character hex string.
//
// INPUTS:
//   filePath (string) — absolute or relative path to the file on disk.
//                       Example: "uploads/1710000000000-report.pdf"
//
// OUTPUTS:
//   Promise<string>   — resolves to a 64-character hex string.
//                       Example: "a3f5c2d1e8b4...64 hex chars total"
//                       Rejects with an Error if the file cannot be read.
//
// WHY A PROMISE?
//   File I/O in Node.js is asynchronous. Wrapping in a Promise lets the caller
//   use `await calculateFileHash(path)` without blocking the event loop.
//   If we used synchronous I/O, no other requests could be handled while
//   hashing a large file — the server would freeze.
//
// WHY THIS APPROACH vs crypto.createHash + readFileSync?
//   The streaming approach handles files of any size with constant memory use.
//   readFileSync would load the whole file into a Buffer first — fine for
//   small files, dangerous for 50MB uploads under concurrent load.
// ---------------------------------------------------------------------------
export const calculateFileHash = (filePath: string): Promise<string> => {
    return new Promise((resolve, reject) => {
        // crypto.createHash('sha256') creates a Hash object.
        // Think of it as a blender: you feed it chunks of data,
        // and at the end you press "blend" to get the final digest.
        const hash = crypto.createHash("sha256");

        // fs.createReadStream opens the file and reads it in chunks.
        // Default chunk (highWaterMark) size is 64KB.
        // The stream emits events: 'data' (chunk ready), 'end' (done), 'error'.
        const stream = fs.createReadStream(filePath);

        // 'data' event fires for each chunk read from disk.
        // hash.update(chunk) feeds that chunk into the SHA-256 computation.
        // The hash function maintains internal state between updates —
        // you can call update() as many times as you like.
        stream.on("data", (chunk: Buffer) => {
            hash.update(chunk); // feed this chunk into the ongoing hash computation
        });

        // 'end' event fires when the entire file has been read.
        // hash.digest('hex') finalises the computation and returns the result
        // as a lowercase hex string (64 characters for SHA-256).
        // 'hex' means each byte of the 32-byte hash is represented as 2 hex chars.
        // Alternative: 'base64' (shorter but less conventional for file hashing).
        stream.on("end", () => {
            const hexHash = hash.digest("hex"); // finalise → 64-char hex string
            resolve(hexHash);
        });

        // 'error' event fires if the file doesn't exist, permissions are wrong, etc.
        // We reject the Promise so the caller can handle it with try/catch.
        stream.on("error", (err: Error) => {
            reject(err);
        });
    });
};