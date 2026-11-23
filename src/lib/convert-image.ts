import { ConverterStudioClient, ONE_GO_BYTES, USER_AGENT, type FetchLike } from './client';
import { ConverterStudioError, type SkipReason } from './errors';
import {
  browserReadable,
  fileNameFromUrl,
  formatFromUrl,
  sniffFormat,
  type KnownFormat,
  type SourceFormat,
  type TargetFormat,
} from './formats';
import { apiConversionOptions, type ResolvedOptions } from './options';

/** What became of one image. */
export type ImageOutcome =
  | {
      status: 'converted';
      bytes: Uint8Array;
      from: KnownFormat;
      to: TargetFormat;
      credits: number | null;
      conversionId: string;
      sourceSize: number;
      resultSize: number;
    }
  | {
      status: 'skipped';
      reason: SkipReason;
      from: KnownFormat | null;
      sourceSize: number;
      resultSize: number | null;
      credits: number | null;
      conversionId: string | null;
    };

export interface ConvertImageDeps {
  client: Pick<ConverterStudioClient, 'convert'>;
  /** Downloads the product image (the global `fetch` by default). */
  fetch?: FetchLike;
}

const SOURCE_TIMEOUT_MS = 60_000;

/** Downloads a product image, at most `ONE_GO_BYTES`. */
export async function downloadSource(
  url: string,
  fetchImpl: FetchLike = (u, i) => fetch(u, i),
): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'image/*,*/*;q=0.5' },
      redirect: 'follow',
      signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new ConverterStudioError(
      'sourceDownloadFailed',
      `The image could not be downloaded from ${url}.`,
      { cause },
    );
  }
  if (!response.ok)
    throw new ConverterStudioError(
      'sourceDownloadFailed',
      `Downloading ${url} answered ${response.status}.`,
      {
        status: response.status,
      },
    );
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > ONE_GO_BYTES)
    throw new ConverterStudioError('sourceTooLarge', 'The product image is larger than 95 MB.');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > ONE_GO_BYTES)
    throw new ConverterStudioError('sourceTooLarge', 'The product image is larger than 95 MB.');
  return bytes;
}

const EXTENSION: Record<KnownFormat, string> = {
  jpg: 'jpg',
  png: 'png',
  heic: 'heic',
  tiff: 'tiff',
  bmp: 'bmp',
  webp: 'webp',
  avif: 'avif',
  gif: 'gif',
  svg: 'svg',
};

/** The name the image is uploaded under: its own, with the extension its bytes call for. */
export function uploadName(url: string, format: KnownFormat): string {
  const name = fileNameFromUrl(url) || 'image';
  const dot = name.lastIndexOf('.');
  const base = (dot > 0 ? name.slice(0, dot) : name).slice(0, 200) || 'image';
  return `${base}.${EXTENSION[format]}`;
}

/**
 * Converts one product image: downloads it, checks what it really is, has Converter Studio
 * convert it and checks the result. Throws a ConverterStudioError when it cannot.
 */
export async function convertImage(
  deps: ConvertImageDeps,
  url: string,
  options: ResolvedOptions,
): Promise<ImageOutcome> {
  const source = await downloadSource(url, deps.fetch);
  const from = sniffFormat(source) ?? formatFromUrl(url);
  const skipped = (reason: SkipReason): ImageOutcome => ({
    status: 'skipped',
    reason,
    from,
    sourceSize: source.byteLength,
    resultSize: null,
    credits: null,
    conversionId: null,
  });
  if (!from || from === 'svg')
    throw new ConverterStudioError(
      'unrecognizedImage',
      'The file is not a raster image the plugin converts.',
    );
  if (from === options.format) return skipped('alreadyTarget');
  if (!options.sources.includes(from as SourceFormat)) return skipped('notSelected');

  const { bytes, conversion } = await deps.client.convert({
    bytes: source,
    fileName: uploadName(url, from),
    to: options.format,
    options: apiConversionOptions(options),
    maxCredits: options.maxCredits,
    timeoutMs: options.timeoutSeconds * 1000,
  });
  if (sniffFormat(bytes) !== options.format)
    throw new ConverterStudioError(
      'resultDownloadFailed',
      `The converted file is not ${options.format.toUpperCase()}.`,
    );
  // A browser can already show the original: keep it unless the new file is smaller.
  if (options.onlyIfSmaller && browserReadable(from) && bytes.byteLength >= source.byteLength)
    return {
      ...skipped('resultLarger'),
      resultSize: bytes.byteLength,
      credits: conversion.credits,
      conversionId: conversion.id,
    };
  return {
    status: 'converted',
    bytes,
    from,
    to: options.format,
    credits: conversion.credits,
    conversionId: conversion.id,
    sourceSize: source.byteLength,
    resultSize: bytes.byteLength,
  };
}

/**
 * Runs `work` over `items`, at most `limit` at a time, in order of start. `stop()` (from inside
 * `work`) lets the running ones finish and starts no more; the rest come back as `undefined`.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T, stop: () => void) => Promise<R>,
): Promise<(R | undefined)[]> {
  const results: (R | undefined)[] = new Array(items.length).fill(undefined);
  let next = 0;
  let stopped = false;
  const stop = () => {
    stopped = true;
  };
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (!stopped && next < items.length) {
      const index = next++;
      results[index] = await work(items[index]!, stop);
    }
  });
  await Promise.all(lanes);
  return results;
}
