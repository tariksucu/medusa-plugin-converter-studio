import { SOURCE_FORMATS, TARGET_FORMATS, type SourceFormat, type TargetFormat } from './formats';

/** The plugin's options, as given in `medusa-config.ts` (all optional). */
export interface ConverterStudioPluginOptions {
  /** A Converter Studio API key (`cvs_live_…`). Default: the `CONVERTER_STUDIO_API_KEY` variable. */
  apiKey?: string;
  /** What product images become: `"webp"` (default), `"avif"` or `"jpg"`. */
  format?: TargetFormat;
  /**
   * Which formats are converted. Default: JPG, PNG, HEIC, TIFF and BMP for WebP; the same plus
   * WebP for AVIF; HEIC, TIFF and BMP for JPG (formats browsers cannot show).
   */
  sources?: SourceFormat[];
  /** How much quality to trade for size: `"high"`, `"balanced"` (default) or `"small"`. */
  quality?: 'high' | 'balanced' | 'small';
  /** Shrink images whose longer side is larger than this many pixels (never enlarged). */
  maxSize?: 2560 | 1920 | 1280 | 800 | null;
  /** Keep the photo's EXIF details (camera, date). Off by default; GPS is never kept. */
  keepMetadata?: boolean;
  /** The most credits one image may cost before the plugin stops and leaves it (default 1). */
  maxCredits?: number;
  /** Convert images when a product is created or updated (default true). */
  autoConvert?: boolean;
  /** Keep the original when the converted JPG/PNG comes out larger (default true). */
  onlyIfSmaller?: boolean;
  /** Images converted at the same time (1–5, default 2). */
  concurrency?: number;
  /** The longest one conversion may take, in seconds (default 180). */
  timeoutSeconds?: number;
  /** Further Converter Studio conversion options, sent as they are (advanced). */
  conversionOptions?: Record<string, unknown>;
  /** The API's address (default `https://converter.studio/api`). */
  apiUrl?: string;
}

/** The options with every default filled in. */
export interface ResolvedOptions {
  readonly apiKey: string | null;
  readonly format: TargetFormat;
  readonly sources: readonly SourceFormat[];
  readonly quality: 'high' | 'balanced' | 'small';
  readonly maxSize: 2560 | 1920 | 1280 | 800 | null;
  readonly keepMetadata: boolean;
  readonly maxCredits: number;
  readonly autoConvert: boolean;
  readonly onlyIfSmaller: boolean;
  readonly concurrency: number;
  readonly timeoutSeconds: number;
  readonly conversionOptions: Readonly<Record<string, unknown>>;
  readonly apiUrl: string;
}

export const DEFAULT_API_URL = 'https://converter.studio/api';
const QUALITIES = ['high', 'balanced', 'small'] as const;
const MAX_SIZES = [2560, 1920, 1280, 800] as const;

export function defaultSources(format: TargetFormat): SourceFormat[] {
  switch (format) {
    case 'webp':
      return ['jpg', 'png', 'heic', 'tiff', 'bmp'];
    case 'avif':
      return ['jpg', 'png', 'heic', 'tiff', 'bmp', 'webp'];
    case 'jpg':
      return ['heic', 'tiff', 'bmp'];
  }
}

class OptionsError extends Error {
  constructor(message: string) {
    super(`medusa-plugin-converter-studio: ${message}`);
    this.name = 'OptionsError';
  }
}

function oneOf<T extends string | number>(name: string, value: unknown, allowed: readonly T[]): T {
  if (!allowed.includes(value as T))
    throw new OptionsError(
      `"${name}" must be one of ${allowed.map((a) => JSON.stringify(a)).join(', ')}`,
    );
  return value as T;
}

function integer(name: string, value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max)
    throw new OptionsError(`"${name}" must be a whole number from ${min} to ${max}`);
  return value;
}

function bool(name: string, value: unknown): boolean {
  if (typeof value !== 'boolean') throw new OptionsError(`"${name}" must be true or false`);
  return value;
}

/**
 * Checks the options and fills in the defaults. Wrong values throw (so a typo shows when Medusa
 * starts); a missing API key does not, it only switches conversions off.
 */
export function resolveOptions(
  input: ConverterStudioPluginOptions | undefined | null,
  env: Record<string, string | undefined> = process.env,
): ResolvedOptions {
  const o = (input ?? {}) as Record<string, unknown>;
  const format = o.format === undefined ? 'webp' : oneOf('format', o.format, TARGET_FORMATS);

  let sources: SourceFormat[];
  if (o.sources === undefined) sources = defaultSources(format);
  else {
    if (!Array.isArray(o.sources)) throw new OptionsError(`"sources" must be a list of formats`);
    sources = o.sources.map((s) => oneOf('sources', s === 'jpeg' ? 'jpg' : s, SOURCE_FORMATS));
  }
  // Converting an image to its own format would only spend credits.
  sources = [...new Set(sources)].filter((s) => s !== format);

  const apiKeyInput = o.apiKey ?? env.CONVERTER_STUDIO_API_KEY;
  if (apiKeyInput !== undefined && apiKeyInput !== null && typeof apiKeyInput !== 'string')
    throw new OptionsError(`"apiKey" must be a string`);
  const apiKey = typeof apiKeyInput === 'string' && apiKeyInput.trim() ? apiKeyInput.trim() : null;

  const apiUrlInput = o.apiUrl ?? env.CONVERTER_STUDIO_API_URL ?? DEFAULT_API_URL;
  if (typeof apiUrlInput !== 'string') throw new OptionsError(`"apiUrl" must be a URL`);
  let apiUrl: string;
  try {
    const url = new URL(apiUrlInput);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('protocol');
    apiUrl = url.toString().replace(/\/+$/, '');
  } catch {
    throw new OptionsError(`"apiUrl" must be an http(s) URL`);
  }

  const conversionOptions = o.conversionOptions ?? {};
  if (
    typeof conversionOptions !== 'object' ||
    conversionOptions === null ||
    Array.isArray(conversionOptions)
  )
    throw new OptionsError(`"conversionOptions" must be an object`);

  return {
    apiKey,
    format,
    sources,
    quality: o.quality === undefined ? 'balanced' : oneOf('quality', o.quality, QUALITIES),
    maxSize:
      o.maxSize === undefined || o.maxSize === null ? null : oneOf('maxSize', o.maxSize, MAX_SIZES),
    keepMetadata: o.keepMetadata === undefined ? false : bool('keepMetadata', o.keepMetadata),
    maxCredits: o.maxCredits === undefined ? 1 : integer('maxCredits', o.maxCredits, 1, 1000),
    autoConvert: o.autoConvert === undefined ? true : bool('autoConvert', o.autoConvert),
    onlyIfSmaller: o.onlyIfSmaller === undefined ? true : bool('onlyIfSmaller', o.onlyIfSmaller),
    concurrency: o.concurrency === undefined ? 2 : integer('concurrency', o.concurrency, 1, 5),
    timeoutSeconds:
      o.timeoutSeconds === undefined ? 180 : integer('timeoutSeconds', o.timeoutSeconds, 10, 3600),
    conversionOptions: conversionOptions as Record<string, unknown>,
    apiUrl,
  };
}

/** The Converter Studio conversion options the plugin's options stand for. */
export function apiConversionOptions(options: ResolvedOptions): Record<string, unknown> {
  return {
    quality: options.quality,
    ...(options.maxSize ? { longSide: String(options.maxSize) } : {}),
    ...(options.keepMetadata ? { keepMetadata: true } : {}),
    ...options.conversionOptions,
  };
}

/** What the admin may see of the options (never the key itself). */
export function publicOptions(options: ResolvedOptions) {
  return {
    configured: options.apiKey !== null,
    format: options.format,
    sources: options.sources,
    quality: options.quality,
    maxSize: options.maxSize,
    keepMetadata: options.keepMetadata,
    maxCredits: options.maxCredits,
    autoConvert: options.autoConvert,
    onlyIfSmaller: options.onlyIfSmaller,
  };
}
