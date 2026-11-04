import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createGzip } from 'node:zlib';
import { db } from '@pithcharge/db';
import type { Logger } from './logger';
import { isExpired, monthsToEnsure, parsePartitionBounds } from './partitions';

const MONTHS_AHEAD = 3;
const BATCH = 5000;

type PartitionRow = { name: string; bound: string };

export async function ensureFuturePartitions(logger: Logger, at = new Date()) {
  for (const table of ['AuditLog', 'LedgerEntry']) {
    for (const month of monthsToEnsure(at, MONTHS_AHEAD)) {
      await db.$executeRawUnsafe(`SELECT ensure_monthly_partition($1, $2::date)`, table, month.toISOString().slice(0, 10));
    }
  }
  logger.info({ monthsAhead: MONTHS_AHEAD }, 'Partitions ensured');
}

async function listPartitions(table: string): Promise<PartitionRow[]> {
  return db.$queryRawUnsafe<PartitionRow[]>(
    `SELECT c.relname AS name, pg_get_expr(c.relpartbound, c.oid) AS bound
       FROM pg_inherits i
       JOIN pg_class c ON c.oid = i.inhrelid
       JOIN pg_class p ON p.oid = i.inhparent
      WHERE p.relname = $1 AND p.relnamespace = 'public'::regnamespace`,
    table,
  );
}

/** Streams a partition to gzipped NDJSON using keyset pagination; returns the row count written. */
async function archivePartition(name: string, file: string) {
  let count = 0;
  let lastId = '';
  async function* rows() {
    for (;;) {
      const batch = await db.$queryRawUnsafe<{ id: string; doc: unknown }[]>(
        `SELECT id, to_jsonb(t) AS doc FROM "public"."${name}" t WHERE id > $1 ORDER BY id LIMIT ${BATCH}`,
        lastId,
      );
      if (batch.length === 0) return;
      for (const row of batch) {
        count += 1;
        yield `${JSON.stringify(row.doc)}\n`;
      }
      lastId = batch[batch.length - 1]!.id;
    }
  }
  const tmp = `${file}.partial`;
  await pipeline(Readable.from(rows()), createGzip(), createWriteStream(tmp));
  await rename(tmp, file);
  return count;
}

/**
 * Archives then drops audit-log partitions older than the retention window. Disabled unless
 * AUDIT_RETENTION_DAYS is set, and never drops without a verified archive. Ledger data is kept.
 */
export async function enforceAuditRetention(logger: Logger, env = process.env, at = new Date()) {
  const days = Number(env.AUDIT_RETENTION_DAYS);
  if (!Number.isFinite(days) || days <= 0) return { archived: 0, dropped: 0 };
  const archiveDir = env.ARCHIVE_DIR;
  if (!archiveDir) {
    logger.warn({}, 'AUDIT_RETENTION_DAYS is set but ARCHIVE_DIR is not; refusing to drop partitions');
    return { archived: 0, dropped: 0 };
  }
  await mkdir(archiveDir, { recursive: true });

  let dropped = 0;
  for (const partition of await listPartitions('AuditLog')) {
    const bounds = parsePartitionBounds(partition.bound);
    if (!bounds || !isExpired(bounds, days, at)) continue;
    const file = path.join(archiveDir, `${partition.name}.ndjson.gz`);
    try {
      const expected = Number(
        (await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "public"."${partition.name}"`))[0]!.n,
      );
      const written = expected === 0 ? 0 : await archivePartition(partition.name, file);
      if (written !== expected) throw new Error(`archive row mismatch: wrote ${written}, expected ${expected}`);
      await db.$executeRawUnsafe(`ALTER TABLE "public"."AuditLog" DETACH PARTITION "public"."${partition.name}"`);
      await db.$executeRawUnsafe(`DROP TABLE "public"."${partition.name}"`);
      dropped += 1;
      logger.info({ partition: partition.name, rows: written, file }, 'Audit partition archived and dropped');
    } catch (error) {
      await rm(`${file}.partial`, { force: true });
      logger.error({ err: error, partition: partition.name }, 'Audit partition archive failed; partition kept');
    }
  }
  return { archived: dropped, dropped };
}
