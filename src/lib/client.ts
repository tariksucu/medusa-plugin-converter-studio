import { ConverterStudioError, toErrorCode, type ErrorCode } from './errors';
import type { TargetFormat } from './formats';

/**
 * A small client for Converter Studio's public REST API (https://converter.studio/developers):
 * upload a file, convert it, wait for the result and download it. No dependencies: it uses the
 * `fetch` of Node 20+.
 */

/** The package's version (package.json's, which a unit test holds it to). */
export const VERSION = '1.0.0';
export const USER_AGENT = `medusa-plugin-converter-studio/${VERSION}`;
/** Names this plugin on its API calls (Converter Studio's statistics of its connectors). */
export const CLIENT_HEADER = { 'X-Converter-Studio-Client': `medusa/${VERSION}` };
/** One upload request carries at most this much (the API's `partBytes`). */
export const ONE_GO_BYTES = 95 * 1024 * 1024;

export type ConversionStatus =
  | 'fetching'
  | 'waiting_for_upload'
  | 'measuring'
  | 'quoted'
  | 'queued'
  | 'processing'
  | 'done'
  | 'failed'
  | 'expired'
  | 'canceled';

/** A conversion as the API shows it (`GET /v1/conversions/:id`). */
export interface ConversionView {
  id: string;
  status: ConversionStatus;
  from: string | null;
  to: string | null;
  inputName: string | null;
  inputSize: number | null;
  credits: number | null;
  maxCredits: number | null;
  progress: number | null;
  outputName: string | null;
  outputSize: number | null;
  downloadUrl: string | null;
  expiresAt: string | null;
  error: { code: string; message: string } | null;
  next: string;
}

export interface UploadView {
  id: string;
  uploadUrl: string;
  method: 'PUT';
  maxBytes: number;
  partBytes: number;
  expiresAt: string;
}

/** The account behind the API key (`GET /v1/account`), without its e-mail address. */
export interface AccountView {
  plan: 'guest' | 'pro' | 'premium';
  credits: number;
  allowance: { used: number; limit: number; per: 'day' | 'month' } | null;
  packs: number;
  renewsAt: string | null;
  maxFileBytes: number;
}

export interface ConvertInput {
  bytes: Uint8Array;
  fileName: string;
  to: TargetFormat;
  options?: Record<string, unknown>;
  /** Goes ahead on its own up to this many credits; a dearer conversion is left unconfirmed. */
  maxCredits: number;
  /** The longest the whole conversion may take. */
  timeoutMs: number;
}

export interface ConvertResult {
  bytes: Uint8Array;
  conversion: ConversionView;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ClientOptions {
  apiKey: string;
  /** `https://converter.studio/api`, or the address of a test server. */
  apiUrl: string;
  fetch?: FetchLike;
  /** How often a busy or unreachable API is tried again (default 3). */
  retries?: number;
  /** Waits between tries; replaced in tests. */
  sleep?: (ms: number) => Promise<void>;
}

const SETTLED: ReadonlySet<ConversionStatus> = new Set([
  'done',
  'failed',
  'expired',
  'canceled',
  'quoted',
]);
const RETRY_STATUS = new Set([429, 502, 503, 504]);
const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class ConverterStudioClient {
  private readonly apiKey: string;
  private readonly apiUrl: string;
  private readonly fetch: FetchLike;
  private readonly retries: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: ClientOptions) {
    this.apiKey = options.apiKey;
    this.apiUrl = options.apiUrl.replace(/\/+$/, '');
    this.fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.retries = options.retries ?? 3;
    this.sleep = options.sleep ?? defaultSleep;
  }

  /** The account's plan and credits. */
  async account(): Promise<AccountView> {
    const body = await this.json<AccountView & { email?: string }>('GET', '/v1/account');
    return {
      plan: body.plan,
      credits: body.credits,
      allowance: body.allowance ?? null,
      packs: body.packs ?? 0,
      renewsAt: body.renewsAt ?? null,
      maxFileBytes: body.maxFileBytes,
    };
  }

  /** Converts a file's bytes and returns the result's bytes. */
  async convert(input: ConvertInput): Promise<ConvertResult> {
    if (input.bytes.byteLength > ONE_GO_BYTES)
      throw new ConverterStudioError('sourceTooLarge', 'The image is larger than 95 MB.');
    const deadline = Date.now() + input.timeoutMs;
    const upload = await this.json<UploadView>('POST', '/v1/uploads', {
      fileName: input.fileName,
      size: input.bytes.byteLength,
    });
    await this.send(upload.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: input.bytes as unknown as BodyInit,
    });
    let conversion = await this.json<ConversionView>('POST', '/v1/conversions', {
      uploadId: upload.id,
      to: input.to,
      ...(input.options && Object.keys(input.options).length ? { options: input.options } : {}),
      maxCredits: input.maxCredits,
    });
    while (!SETTLED.has(conversion.status)) {
      const left = deadline - Date.now();
      if (left <= 0)
        throw new ConverterStudioError(
          'timeout',
          `The conversion did not finish in ${Math.round(input.timeoutMs / 1000)} s.`,
        );
      const wait = Math.max(1, Math.min(30, Math.floor(left / 1000)));
      conversion = await this.json<ConversionView>(
        'GET',
        `/v1/conversions/${encodeURIComponent(conversion.id)}?wait=${wait}`,
      );
    }
    if (conversion.status === 'quoted')
      throw new ConverterStudioError(
        'overMaxCredits',
        `The conversion costs ${conversion.credits ?? '?'} credits, more than maxCredits (${input.maxCredits}).`,
      );
    if (conversion.status !== 'done' || !conversion.downloadUrl) {
      const code: ErrorCode =
        conversion.status === 'expired'
          ? 'fileExpired'
          : toErrorCode(conversion.error?.code ?? 'conversionFailed');
      throw new ConverterStudioError(
        code === 'unknown' ? 'conversionFailed' : code,
        conversion.error?.message ?? `The conversion ${conversion.status}.`,
      );
    }
    const response = await this.send(
      conversion.downloadUrl,
      { method: 'GET' },
      'resultDownloadFailed',
    );
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0)
      throw new ConverterStudioError('resultDownloadFailed', 'The converted file was empty.');
    return { bytes, conversion };
  }

  /** A request to the API with the key; its JSON body, or a ConverterStudioError. */
  private async json<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.send(`${this.apiUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: 'application/json',
        ...CLIENT_HEADER,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return (await response.json()) as T;
  }

  /**
   * Sends a request, trying again while the API is busy or unreachable. Upload and download
   * links carry their own token, so the API key only goes to the API's own address.
   */
  private async send(
    url: string,
    init: RequestInit,
    failure: ErrorCode = 'network',
  ): Promise<Response> {
    const headers = {
      'User-Agent': USER_AGENT,
      ...(init.headers as Record<string, string> | undefined),
    };
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await this.fetch(url, { ...init, headers, redirect: 'follow' });
      } catch (cause) {
        if (attempt < this.retries) {
          await this.sleep(1000 * 2 ** attempt);
          continue;
        }
        throw new ConverterStudioError(failure, 'Converter Studio could not be reached.', {
          cause,
        });
      }
      if (response.ok) return response;
      const error = await readError(response);
      // Uploads waiting or left unconverted are counted over hours: trying again soon cannot help.
      const lasting = error.code === 'tooManyPending' || error.code === 'tooManyUnconverted';
      if (RETRY_STATUS.has(response.status) && attempt < this.retries && !lasting) {
        const wait = error.retryAfter !== null ? error.retryAfter * 1000 : 1000 * 2 ** attempt;
        await this.sleep(Math.min(wait, 30_000));
        continue;
      }
      throw error.code === 'unknown' && failure !== 'network'
        ? new ConverterStudioError(failure, error.message, { status: response.status })
        : error;
    }
  }
}

async function readError(response: Response): Promise<ConverterStudioError> {
  const header = response.headers.get('retry-after');
  const retryAfter = header && /^\d+$/.test(header) ? Number(header) : null;
  let code: unknown;
  let message = `Converter Studio answered ${response.status}.`;
  try {
    const body = (await response.json()) as { error?: { code?: unknown; message?: unknown } };
    code = body.error?.code;
    if (typeof body.error?.message === 'string') message = body.error.message;
  } catch {
    // Not JSON (a proxy's error page): the status says enough.
  }
  let errorCode = toErrorCode(code);
  if (errorCode === 'unknown') {
    if (response.status === 401) errorCode = 'invalidApiKey';
    else if (response.status === 402) errorCode = 'notEnoughCredits';
    else if (response.status === 429) errorCode = 'tooManyRequests';
    else if (response.status >= 500) errorCode = 'serverBusy';
  }
  return new ConverterStudioError(errorCode, message, { status: response.status, retryAfter });
}
