/**
 * Why a conversion did not happen, as a fixed list of codes (never free text), so the admin can
 * explain it and the plugin can decide whether to try again.
 */

/** Codes Converter Studio's API sends (`{ error: { code, message } }`) that matter here. */
export const API_ERROR_CODES = [
  'notEnoughCredits',
  'dailyLimit',
  'monthlyLimit',
  'invalidApiKey',
  'fileTooLarge',
  'unsupportedConversion',
  'uploadFailed',
  'conversionFailed',
  'outputEmpty',
  'outputWrongFormat',
  'outputUnreadable',
  'fileExpired',
  'serverBusy',
  'tooManyRequests',
  'tooManyPending',
  'tooManyUnconverted',
  'invalidRequest',
  'notFound',
] as const;

/** Codes of the plugin's own. */
export const PLUGIN_ERROR_CODES = [
  /** No API key in the plugin's options. */
  'notConfigured',
  /** The product image could not be downloaded from its URL. */
  'sourceDownloadFailed',
  /** The product image is larger than one upload request may carry. */
  'sourceTooLarge',
  /** The product image is not a format the plugin converts. */
  'unrecognizedImage',
  /** The conversion costs more credits than `maxCredits` allows; it was left unconfirmed. */
  'overMaxCredits',
  /** The conversion did not finish in time. */
  'timeout',
  /** Converter Studio could not be reached. */
  'network',
  /** The converted file could not be downloaded, or it was not what was asked for. */
  'resultDownloadFailed',
  /** The converted file could not be stored with the store's File Module provider. */
  'storageFailed',
  /** The server stopped while the image was being converted. */
  'interrupted',
  /** Anything else. */
  'unknown',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];
export type PluginErrorCode = (typeof PLUGIN_ERROR_CODES)[number];
export type ErrorCode = ApiErrorCode | PluginErrorCode;

/** Why an image was left as it is although the conversion worked (no error). */
export const SKIP_REASONS = [
  /** The image already is in the target format. */
  'alreadyTarget',
  /** The image's format is not among the `sources` to convert. */
  'notSelected',
  /** The converted file came out larger than the original, so the original stays. */
  'resultLarger',
  /** The image was changed or removed while it was being converted; nothing was replaced. */
  'imageChanged',
] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

const KNOWN = new Set<string>([...API_ERROR_CODES, ...PLUGIN_ERROR_CODES]);

export const toErrorCode = (code: unknown): ErrorCode =>
  typeof code === 'string' && KNOWN.has(code) ? (code as ErrorCode) : 'unknown';

/** What kind of trouble a code means for the rest of a run. */
export type ErrorKind =
  /** The account has no credits left: stop the run, keep the originals. */
  | 'credits'
  /** The API key does not work: stop the run. */
  | 'auth'
  /** Busy or unreachable for now: worth trying again later. */
  | 'transient'
  /** Something about this one image: other images can still go ahead. */
  | 'image';

export function errorKind(code: ErrorCode): ErrorKind {
  switch (code) {
    case 'notEnoughCredits':
    case 'dailyLimit':
    case 'monthlyLimit':
      return 'credits';
    case 'invalidApiKey':
    case 'notConfigured':
      return 'auth';
    case 'serverBusy':
    case 'tooManyRequests':
    case 'tooManyPending':
    case 'tooManyUnconverted':
    case 'network':
    case 'timeout':
    case 'interrupted':
      return 'transient';
    default:
      return 'image';
  }
}

/** An error from Converter Studio or from the plugin's own checks, with a code from the list. */
export class ConverterStudioError extends Error {
  readonly code: ErrorCode;
  readonly status: number | null;
  /** Seconds to wait before trying again, when the server said so (`Retry-After`). */
  readonly retryAfter: number | null;

  constructor(
    code: ErrorCode,
    message: string,
    options: { status?: number | null; retryAfter?: number | null; cause?: unknown } = {},
  ) {
    super(message);
    this.name = 'ConverterStudioError';
    this.code = code;
    this.status = options.status ?? null;
    this.retryAfter = options.retryAfter ?? null;
    if (options.cause !== undefined) (this as { cause?: unknown }).cause = options.cause;
  }

  get kind(): ErrorKind {
    return errorKind(this.code);
  }
}

/** Any thrown value as a ConverterStudioError (unknown ones become `unknown`). */
export function asConverterStudioError(error: unknown): ConverterStudioError {
  if (error instanceof ConverterStudioError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new ConverterStudioError('unknown', message, { cause: error });
}

/** Plain-English words for each code, for logs and the admin. */
export const ERROR_TEXT: Record<ErrorCode | SkipReason, string> = {
  notEnoughCredits: 'Not enough credits left on the Converter Studio account.',
  dailyLimit: "The account's daily credits are used up.",
  monthlyLimit: "The account's monthly credits are used up.",
  invalidApiKey: 'The Converter Studio API key does not work (wrong or deleted).',
  fileTooLarge: "The image is larger than the account's plan allows.",
  unsupportedConversion: 'Converter Studio cannot convert this image to the chosen format.',
  uploadFailed: 'The image could not be uploaded to Converter Studio.',
  conversionFailed: 'The conversion failed; no credits were charged.',
  outputEmpty: 'The conversion produced an empty file; no credits were charged.',
  outputWrongFormat: 'The conversion produced the wrong format; no credits were charged.',
  outputUnreadable: 'The conversion produced a damaged file; no credits were charged.',
  fileExpired: 'The converted file expired before it was downloaded.',
  serverBusy: 'Converter Studio is busy; try again in a few minutes.',
  tooManyRequests: 'Too many requests to Converter Studio; try again in a minute.',
  tooManyPending: 'Too many uploads are waiting at Converter Studio; try again later.',
  tooManyUnconverted: 'Uploads to Converter Studio are paused for a while; try again later.',
  invalidRequest: "Converter Studio did not accept the request (check the plugin's options).",
  notFound: 'Converter Studio no longer has this conversion.',
  notConfigured: "No Converter Studio API key is set in the plugin's options.",
  sourceDownloadFailed: 'The product image could not be downloaded from its URL.',
  sourceTooLarge: 'The product image is larger than 95 MB.',
  unrecognizedImage: 'The file is not an image format the plugin converts.',
  overMaxCredits: 'The conversion costs more credits than maxCredits allows.',
  timeout: 'The conversion did not finish in time.',
  network: 'Converter Studio could not be reached.',
  resultDownloadFailed: 'The converted image could not be downloaded.',
  storageFailed: "The converted image could not be saved with the store's file provider.",
  interrupted: 'The server stopped while the image was being converted.',
  unknown: 'Something went wrong.',
  alreadyTarget: 'Already in the target format.',
  notSelected: 'This format is not among the formats to convert.',
  resultLarger: 'The converted file was larger, so the original was kept.',
  imageChanged: 'The image changed while it was being converted, so nothing was replaced.',
};
