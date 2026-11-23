import { ERROR_TEXT, errorKind, toErrorCode, type ErrorCode, type SkipReason } from './errors';
import { formatFromUrl } from './formats';
import type { ResolvedOptions } from './options';
import {
  byRank,
  latestRecords,
  recordKey,
  STALE_PROCESSING_MS,
  wantsUrl,
  type ConversionRecord,
  type ProductData,
} from './plan';

/** What the admin shows for one image. */
export type ImageState =
  /** Converted by the plugin; the original is kept and can be put back. */
  | 'converted'
  /** Being converted now. */
  | 'processing'
  /** Will be converted (automatically, or with "Convert images"). */
  | 'pending'
  /** Tried and failed; `reason` says why. */
  | 'failed'
  /** Converted, but the original was kept (`reason` says why). */
  | 'kept'
  /** Put back to the original by hand; automatic conversions leave it alone. */
  | 'restored'
  /** Nothing to do: already a modern format, or a format not chosen. */
  | 'ignored';

export interface ImageStatus {
  image_id: string | null;
  target: 'image' | 'thumbnail';
  url: string;
  format: string | null;
  state: ImageState;
  reason: ErrorCode | SkipReason | null;
  message: string | null;
  original_url: string | null;
  source_size: number | null;
  result_size: number | null;
  credits: number | null;
  updated_at: string | null;
}

const iso = (value: string | Date | undefined | null) =>
  value ? new Date(value).toISOString() : null;

/** The state of each of a product's images (and of a thumbnail of its own), in gallery order. */
export function productImageStatus(
  product: ProductData,
  records: readonly ConversionRecord[],
  options: ResolvedOptions,
  now = Date.now(),
): ImageStatus[] {
  const latest = latestRecords(records);
  const entries: { image_id: string | null; target: 'image' | 'thumbnail'; url: string }[] = byRank(
    product.images,
  ).map((image) => ({ image_id: image.id, target: 'image' as const, url: image.url }));
  if (product.thumbnail && !product.images.some((image) => image.url === product.thumbnail))
    entries.push({ image_id: null, target: 'thumbnail', url: product.thumbnail });

  return entries.map((entry) => {
    const base: ImageStatus = {
      ...entry,
      format: formatFromUrl(entry.url),
      state: 'ignored',
      reason: null,
      message: null,
      original_url: null,
      source_size: null,
      result_size: null,
      credits: null,
      updated_at: null,
    };
    // Showing a converted file of ours?
    const done = records
      .filter(
        (r) =>
          r.status === 'converted' &&
          r.result_url === entry.url &&
          r.target === entry.target &&
          r.image_id === entry.image_id,
      )
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
    if (done)
      return {
        ...base,
        state: 'converted',
        original_url: done.source_url,
        source_size: done.source_size ?? null,
        result_size: done.result_size ?? null,
        credits: done.credits ?? null,
        updated_at: iso(done.updated_at ?? done.created_at),
      };
    const record = latest.get(recordKey(entry.target, entry.image_id, entry.url));
    if (!record) return { ...base, state: wantsUrl(entry.url, options) ? 'pending' : 'ignored' };
    const withRecord = {
      ...base,
      source_size: record.source_size ?? null,
      result_size: record.result_size ?? null,
      credits: record.credits ?? null,
      updated_at: iso(record.updated_at ?? record.created_at),
    };
    switch (record.status) {
      case 'processing': {
        const stale =
          now - new Date(record.updated_at ?? record.created_at).getTime() > STALE_PROCESSING_MS;
        return stale
          ? {
              ...withRecord,
              state: 'failed',
              reason: 'interrupted',
              message: ERROR_TEXT.interrupted,
            }
          : { ...withRecord, state: 'processing' };
      }
      case 'failed': {
        const code = toErrorCode(record.reason);
        return { ...withRecord, state: 'failed', reason: code, message: ERROR_TEXT[code] };
      }
      case 'skipped': {
        const reason = (record.reason ?? 'resultLarger') as SkipReason;
        if (reason === 'alreadyTarget' || reason === 'notSelected')
          return { ...withRecord, state: 'ignored', reason, message: ERROR_TEXT[reason] ?? null };
        if (reason === 'imageChanged')
          return { ...withRecord, state: wantsUrl(entry.url, options) ? 'pending' : 'ignored' };
        return { ...withRecord, state: 'kept', reason, message: ERROR_TEXT[reason] ?? null };
      }
      case 'restored':
        return { ...withRecord, state: 'restored' };
      case 'converted':
        // Converted before, but the image shows the original again (put back outside the plugin).
        return { ...withRecord, state: 'restored' };
    }
  });
}

/** Counts for the admin, and whether the last run stopped for lack of credits or a bad key. */
export function summarize(images: readonly ImageStatus[]) {
  const count = (state: ImageState) => images.filter((i) => i.state === state).length;
  const blocking = images.find(
    (i) =>
      i.state === 'failed' &&
      i.reason &&
      ['credits', 'auth'].includes(errorKind(i.reason as ErrorCode)),
  );
  return {
    converted: count('converted'),
    processing: count('processing'),
    pending: count('pending'),
    failed: count('failed'),
    kept: count('kept'),
    restored: count('restored'),
    ignored: count('ignored'),
    /** Images "Convert images" would try now. */
    convertible: images.filter((i) => ['pending', 'failed', 'restored'].includes(i.state)).length,
    saved_bytes: images
      .filter((i) => i.state === 'converted' && i.source_size !== null && i.result_size !== null)
      .reduce((sum, i) => sum + Math.max(0, i.source_size! - i.result_size!), 0),
    blocked_by: (blocking?.reason as ErrorCode | undefined) ?? null,
  };
}
