// src/services/storage.service.ts
// PURPOSE: Abstract all R2/S3 operations behind a clean interface.
// Nothing outside this file should know we're using R2 specifically.

import {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';

// R2 uses the S3 protocol but at a different endpoint.
// Format: https://<account_id>.r2.cloudflarestorage.com
const R2_ENDPOINT = `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

// S3Client is configured once at module load time (singleton).
// All function calls reuse this single client — no reconnection overhead.
const s3 = new S3Client({
    region: 'auto',               // R2 uses 'auto' — it has no real AWS regions
    endpoint: R2_ENDPOINT,        // point the S3 client at Cloudflare's endpoint
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
});

const BUCKET = process.env.R2_BUCKET_NAME!;

/**
 * PURPOSE: Upload a file buffer to R2.
 * INPUTS:
 *   buffer   — the file's raw bytes (from Multer memory storage)
 *   key      — the object key / "path" inside the bucket, e.g. "teams/1/files/uuid.pdf"
 *   mimeType — MIME type string, e.g. "application/pdf" (stored as R2 metadata)
 * OUTPUTS: Promise<void> — throws on failure
 * WHY BUFFER not stream: Multer memory storage gives us a Buffer. Converting to
 * a stream adds complexity with no benefit at our file sizes (≤50MB).
 */
export async function uploadFile(
    buffer: Buffer,
    key: string,
    mimeType: string
): Promise<void> {
    const command = new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,           // this is what gets saved to files.storage_path in the DB
        Body: buffer,
        ContentType: mimeType,
    });

    await s3.send(command);
    // If R2 rejects the upload (bad credentials, bucket missing, etc.)
    // the error propagates up to the controller which returns 500 to the client.
}

/**
 * PURPOSE: Get a readable stream for a file stored in R2.
 * INPUTS:  key — the object key (from files.storage_path in the DB)
 * OUTPUTS: Promise<Readable> — a Node.js readable stream
 * WHY STREAM not buffer: We pipe the stream directly into res (the HTTP response).
 * This means we never load the whole file into memory — critical for large files.
 * A 500MB video can stream with only ~1MB of RAM used.
 */
export async function getFileStream(key: string): Promise<Readable> {
    const command = new GetObjectCommand({
        Bucket: BUCKET,
        Key: key,
    });

    const response = await s3.send(command);

    if (!response.Body) {
        throw new Error(`File not found in R2: ${key}`);
    }

    // response.Body is a ReadableStream (Web Streams API).
    // Node.js http.ServerResponse needs a Node.js Readable stream.
    // Readable.fromWeb() converts between the two.
    return Readable.fromWeb(response.Body as any);
}

/**
 * PURPOSE: Permanently delete a file from R2.
 * INPUTS:  key — the object key (from files.storage_path in the DB)
 * OUTPUTS: Promise<void>
 * WHY: Called when a file is permanently deleted (not soft-deleted).
 * Soft delete only sets is_deleted=true in the DB — the R2 object stays.
 * Permanent delete removes both the DB row and the R2 object.
 */
export async function deleteFile(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
        Bucket: BUCKET,
        Key: key,
    });

    await s3.send(command);
}

/**
 * PURPOSE: Generate a consistent, unique object key for a file.
 * INPUTS:
 *   teamId   — organises files by team in the bucket (easy to see in R2 dashboard)
 *   fileId   — the DB file ID (unique, prevents collisions)
 *   filename — the original filename (for human readability in the R2 dashboard)
 * OUTPUTS: string — e.g. "teams/1/files/42-report.pdf"
 * WHY THIS FORMAT: Hierarchical keys let you browse R2 like a folder structure.
 * The fileId prefix guarantees uniqueness even if two teams upload "report.pdf".
 */
export function generateObjectKey(
    teamId: number,
    fileId: number,
    filename: string
): string {
    // Strip anything that's not a letter, digit, dot, dash, or underscore.
    // Spaces and special chars in S3 keys cause URL encoding headaches.
    const safeFilename = filename.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    return `teams/${teamId}/files/${fileId}-${safeFilename}`;
}
