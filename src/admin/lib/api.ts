/**
 * Calls to the plugin's admin API routes, signed in the way the dashboard is (its session
 * cookie, or its token when the admin is set to `jwt`).
 */

// Filled in by the app's admin build (`admin.backendUrl`, `admin.authType`…); absent otherwise.
declare const __BACKEND_URL__: string | undefined;
declare const __AUTH_TYPE__: string | undefined;
declare const __JWT_TOKEN_STORAGE_KEY__: string | undefined;

const backend = (
  typeof __BACKEND_URL__ !== 'undefined' && __BACKEND_URL__ ? __BACKEND_URL__ : ''
).replace(/\/+$/, '');
const authType = typeof __AUTH_TYPE__ !== 'undefined' && __AUTH_TYPE__ ? __AUTH_TYPE__ : 'session';
const tokenKey =
  typeof __JWT_TOKEN_STORAGE_KEY__ !== 'undefined' && __JWT_TOKEN_STORAGE_KEY__
    ? __JWT_TOKEN_STORAGE_KEY__
    : 'medusa_auth_token';

function authHeaders(): Record<string, string> {
  if (authType !== 'jwt') return {};
  try {
    const token = window.localStorage.getItem(tokenKey);
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${backend}/admin/converter-studio${path}`, {
    method,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...authHeaders(),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let data: T & { message?: string };
  try {
    data = (text ? JSON.parse(text) : {}) as T & { message?: string };
  } catch {
    throw new ApiError(`Unexpected answer from the server (${response.status})`, response.status);
  }
  if (!response.ok)
    throw new ApiError(data.message || `Request failed (${response.status})`, response.status);
  return data;
}

export type ImageState =
  'converted' | 'processing' | 'pending' | 'failed' | 'kept' | 'restored' | 'ignored';

export interface ImageStatus {
  image_id: string | null;
  target: 'image' | 'thumbnail';
  url: string;
  format: string | null;
  state: ImageState;
  reason: string | null;
  message: string | null;
  original_url: string | null;
  source_size: number | null;
  result_size: number | null;
  credits: number | null;
  updated_at: string | null;
}

export interface PublicOptions {
  configured: boolean;
  format: 'webp' | 'avif' | 'jpg';
  sources: string[];
  quality: string;
  maxSize: number | null;
  keepMetadata: boolean;
  maxCredits: number;
  autoConvert: boolean;
  onlyIfSmaller: boolean;
}

export interface Pause {
  code: string;
  until: string;
}

export interface ProductStatus {
  product_id: string;
  options: PublicOptions;
  pause: Pause | null;
  running: boolean;
  summary: {
    converted: number;
    processing: number;
    pending: number;
    failed: number;
    kept: number;
    restored: number;
    ignored: number;
    convertible: number;
    saved_bytes: number;
    blocked_by: string | null;
  };
  images: ImageStatus[];
}

export interface Account {
  plan: 'guest' | 'pro' | 'premium';
  credits: number;
  allowance: { used: number; limit: number; per: 'day' | 'month' } | null;
  packs: number;
  renewsAt: string | null;
}

export interface Overview {
  options: PublicOptions;
  account: Account | null;
  account_error: { code: string; message: string } | null;
  pause: Pause | null;
}

export interface BulkProgress {
  running: boolean;
  started_at: string | null;
  finished_at: string | null;
  products_total: number;
  products_done: number;
  converted: number;
  skipped: number;
  failed: number;
  credits: number;
  saved_bytes: number;
  stopped_by: string | null;
}

export interface ConversionRow {
  id: string;
  product_id: string;
  image_id: string | null;
  source_url: string;
  result_url: string | null;
  from_format: string | null;
  to_format: string;
  status: 'processing' | 'converted' | 'skipped' | 'failed' | 'restored';
  reason: string | null;
  message: string | null;
  credits: number | null;
  source_size: number | null;
  result_size: number | null;
  trigger: 'auto' | 'manual' | 'bulk';
  created_at: string;
}

export const api = {
  overview: () => call<Overview>('GET', ''),
  product: (id: string) => call<ProductStatus>('GET', `/products/${encodeURIComponent(id)}`),
  convert: (id: string, imageIds?: string[]) =>
    call<{ started: boolean }>(
      'POST',
      `/products/${encodeURIComponent(id)}/convert`,
      imageIds ? { image_ids: imageIds } : {},
    ),
  restore: (id: string, imageIds?: string[]) =>
    call<{ restored: number }>(
      'POST',
      `/products/${encodeURIComponent(id)}/restore`,
      imageIds ? { image_ids: imageIds } : {},
    ),
  bulk: () => call<{ bulk: BulkProgress }>('GET', '/bulk'),
  startBulk: () => call<{ bulk: BulkProgress }>('POST', '/bulk', { action: 'start' }),
  cancelBulk: () => call<{ bulk: BulkProgress }>('POST', '/bulk', { action: 'cancel' }),
  conversions: (limit = 20, offset = 0) =>
    call<{ conversions: ConversionRow[]; count: number }>(
      'GET',
      `/conversions?limit=${limit}&offset=${offset}`,
    ),
};

export const PRICING_URL = 'https://converter.studio/pricing';
export const API_KEYS_URL = 'https://converter.studio/account#api-keys';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** "−62%" for a converted image, or `null`. */
export function savedPercent(source: number | null, result: number | null): string | null {
  if (!source || result === null) return null;
  const percent = Math.round((1 - result / source) * 100);
  return percent > 0 ? `−${percent}%` : `+${-percent}%`;
}

export const CREDIT_CODES = ['notEnoughCredits', 'dailyLimit', 'monthlyLimit'];

export const planName = (plan: Account['plan']) =>
  plan === 'guest' ? 'Free' : plan === 'pro' ? 'Pro' : 'Premium';
