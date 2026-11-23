import { errorKind, toErrorCode } from './errors';
import { formatFromUrl, type SourceFormat } from './formats';
import type { ResolvedOptions } from './options';

/**
 * Which of a product's images to convert now, and how to put the results in place. Pure
 * functions over plain data, so the rules can be tested without Medusa.
 */

export type Trigger = 'auto' | 'manual' | 'bulk';
export type RecordStatus = 'processing' | 'converted' | 'skipped' | 'failed' | 'restored';

export interface ProductImageData {
  id: string;
  url: string;
  rank?: number | null;
  metadata?: Record<string, unknown> | null;
}

/** The images in the order the product shows them (an update sets each rank by position). */
export const byRank = (images: readonly ProductImageData[]) =>
  [...images].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));

export interface ProductData {
  id: string;
  thumbnail: string | null;
  images: ProductImageData[];
  variants?: { id: string; thumbnail?: string | null }[];
}

/** A row of `converter_studio_image_conversion`, as far as planning needs it. */
export interface ConversionRecord {
  id: string;
  image_id: string | null;
  target: 'image' | 'thumbnail';
  source_url: string;
  result_url: string | null;
  result_file_id?: string | null;
  status: RecordStatus;
  reason: string | null;
  source_size?: number | null;
  result_size?: number | null;
  credits?: number | null;
  created_at: string | Date;
  updated_at?: string | Date;
}

/** An image (or a thumbnail of its own) to convert. */
export interface Candidate {
  image_id: string | null;
  target: 'image' | 'thumbnail';
  url: string;
  /**
   * Where to read the image from: the very first original when the image was converted before
   * (a change of `format` then converts from the original, not from the earlier result).
   */
  download_url: string;
}

/** The first original of an image converted before, from its metadata. */
export function originalUrl(image: ProductImageData): string | null {
  const value = image.metadata?.[ORIGINAL_URL_KEY];
  return typeof value === 'string' && /^https?:\/\//i.test(value) ? value : null;
}

/** A row still "processing" after this long belongs to a run that stopped. */
export const STALE_PROCESSING_MS = 15 * 60_000;
/** Automatic runs try again after running out of credits, but not sooner than this. */
export const CREDITS_RETRY_MS = 60 * 60_000;
/** Automatic runs try again after a busy or unreachable API, but not sooner than this. */
export const TRANSIENT_RETRY_MS = 10 * 60_000;

const time = (value: string | Date | undefined) => (value ? new Date(value).getTime() : 0);

/** The newest record for each image (or thumbnail) and source URL. */
export function latestRecords(records: readonly ConversionRecord[]): Map<string, ConversionRecord> {
  const latest = new Map<string, ConversionRecord>();
  for (const record of records) {
    const key = recordKey(record.target, record.image_id, record.source_url);
    const seen = latest.get(key);
    if (!seen || time(record.created_at) >= time(seen.created_at)) latest.set(key, record);
  }
  return latest;
}

export const recordKey = (target: 'image' | 'thumbnail', imageId: string | null, url: string) =>
  `${target}:${imageId ?? ''}:${url}`;

/** Whether a URL's file is one to convert, going by its name (unknown names are tried). */
export function wantsUrl(url: string, options: ResolvedOptions): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  const format = formatFromUrl(url);
  if (format === null) return true;
  if (format === 'svg' || format === options.format) return false;
  return options.sources.includes(format as SourceFormat);
}

/** Whether an earlier try at this image means it should be tried again now. */
export function shouldRetry(record: ConversionRecord, trigger: Trigger, now: number): boolean {
  const age = now - time(record.updated_at ?? record.created_at);
  if (record.status === 'processing') return age > STALE_PROCESSING_MS;
  // Kept originals (larger result, wrong format) would come out the same again.
  if (record.status === 'skipped') return false;
  if (trigger !== 'auto') return true;
  // Automatic runs never undo what someone did by hand, nor repeat what failed for this image.
  if (record.status !== 'failed') return false;
  const kind = errorKind(toErrorCode(record.reason));
  if (kind === 'credits') return age > CREDITS_RETRY_MS;
  if (kind === 'transient' || kind === 'auth') return age > TRANSIENT_RETRY_MS;
  return false;
}

/** The images (and own thumbnail) of a product to convert now. */
export function planConversions(input: {
  product: ProductData;
  records: readonly ConversionRecord[];
  options: ResolvedOptions;
  trigger: Trigger;
  /** Only these images (and no separate thumbnail), when given. */
  imageIds?: readonly string[] | null;
  now?: number;
}): Candidate[] {
  const { product, options, trigger } = input;
  const now = input.now ?? Date.now();
  const latest = latestRecords(input.records);
  const only = input.imageIds?.length ? new Set(input.imageIds) : null;
  const candidates: Candidate[] = [];
  const take = (candidate: Candidate) => {
    if (!wantsUrl(candidate.url, options)) return;
    const record = latest.get(recordKey(candidate.target, candidate.image_id, candidate.url));
    if (record && !shouldRetry(record, trigger, now)) return;
    candidates.push(candidate);
  };
  for (const image of product.images) {
    if (only && !only.has(image.id)) continue;
    take({
      image_id: image.id,
      target: 'image',
      url: image.url,
      download_url: originalUrl(image) ?? image.url,
    });
  }
  // A thumbnail that is not one of the images is converted on its own.
  const thumbnail = product.thumbnail;
  if (!only && thumbnail && !product.images.some((image) => image.url === thumbnail))
    take({ image_id: null, target: 'thumbnail', url: thumbnail, download_url: thumbnail });
  return candidates;
}

/** A conversion that worked: the image's URL becomes `result_url`. */
export interface Replacement {
  record_id: string;
  image_id: string | null;
  target: 'image' | 'thumbnail';
  source_url: string;
  result_url: string;
}

export const ORIGINAL_URL_KEY = 'converter_studio_original_url';

/**
 * The product's update that puts converted images in place, from its state now. An image is
 * replaced only while it still has the URL that was converted (someone may have changed it).
 */
export function buildImageUpdate(product: ProductData, replacements: readonly Replacement[]) {
  const byUrl = new Map<string, string>();
  const applied = new Set<string>();
  const images = byRank(product.images).map((image) => {
    const replacement = replacements.find(
      (r) => r.target === 'image' && r.image_id === image.id && r.source_url === image.url,
    );
    if (!replacement) return { id: image.id, url: image.url };
    byUrl.set(replacement.source_url, replacement.result_url);
    applied.add(replacement.record_id);
    return {
      id: image.id,
      url: replacement.result_url,
      metadata: {
        ...(image.metadata ?? {}),
        [ORIGINAL_URL_KEY]: originalUrl(image) ?? replacement.source_url,
      },
    };
  });
  for (const r of replacements)
    if (r.target === 'thumbnail' && product.thumbnail === r.source_url) {
      byUrl.set(r.source_url, r.result_url);
      applied.add(r.record_id);
    }
  const thumbnail =
    product.thumbnail && byUrl.has(product.thumbnail) ? byUrl.get(product.thumbnail)! : undefined;
  const variants = (product.variants ?? [])
    .filter((v) => v.thumbnail && byUrl.has(v.thumbnail))
    .map((v) => ({ id: v.id, thumbnail: byUrl.get(v.thumbnail!)! }));
  return {
    changed: applied.size > 0,
    /** All the product's images in their order (left out ones would be deleted), new URLs in. */
    images,
    thumbnail,
    variants,
    /** Records whose result was put in place. */
    applied,
  };
}

/** A converted image to put back as it was. */
export interface Restoration {
  record_id: string;
  image_id: string | null;
  target: 'image' | 'thumbnail';
  source_url: string;
  result_url: string;
}

/** The records of a product that can be undone now (the image still shows the result). */
export function planRestorations(
  product: ProductData,
  records: readonly ConversionRecord[],
  imageIds?: readonly string[] | null,
): Restoration[] {
  const only = imageIds?.length ? new Set(imageIds) : null;
  const restorations: Restoration[] = [];
  for (const record of latestRecords(records).values()) {
    if (record.status !== 'converted' || !record.result_url) continue;
    if (only && (!record.image_id || !only.has(record.image_id))) continue;
    const shows =
      record.target === 'image'
        ? product.images.some((i) => i.id === record.image_id && i.url === record.result_url)
        : product.thumbnail === record.result_url;
    if (!shows) continue;
    restorations.push({
      record_id: record.id,
      image_id: record.image_id,
      target: record.target,
      source_url: record.source_url,
      result_url: record.result_url,
    });
  }
  return restorations;
}

/** The product's update that puts the originals back. */
export function buildRestoreUpdate(product: ProductData, restorations: readonly Restoration[]) {
  const byUrl = new Map<string, string>();
  const images = byRank(product.images).map((image) => {
    const r = restorations.find(
      (x) => x.target === 'image' && x.image_id === image.id && x.result_url === image.url,
    );
    if (!r) return { id: image.id, url: image.url };
    byUrl.set(r.result_url, r.source_url);
    const metadata = { ...(image.metadata ?? {}) };
    delete metadata[ORIGINAL_URL_KEY];
    return { id: image.id, url: r.source_url, metadata };
  });
  for (const r of restorations)
    if (r.target === 'thumbnail' && product.thumbnail === r.result_url)
      byUrl.set(r.result_url, r.source_url);
  const thumbnail =
    product.thumbnail && byUrl.has(product.thumbnail) ? byUrl.get(product.thumbnail)! : undefined;
  const variants = (product.variants ?? [])
    .filter((v) => v.thumbnail && byUrl.has(v.thumbnail))
    .map((v) => ({ id: v.id, thumbnail: byUrl.get(v.thumbnail!)! }));
  return {
    changed: byUrl.size > 0,
    images,
    thumbnail,
    variants,
  };
}
