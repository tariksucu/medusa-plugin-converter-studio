/**
 * Image formats the plugin knows about: how to recognise them (by a URL's extension or by the
 * file's first bytes) and what to call them when the converted file is stored.
 */

/** Formats a product image can be converted from. */
export const SOURCE_FORMATS = ['jpg', 'png', 'heic', 'tiff', 'bmp', 'webp', 'avif', 'gif'] as const;
export type SourceFormat = (typeof SOURCE_FORMATS)[number];

/** Formats a product image can be converted to. */
export const TARGET_FORMATS = ['webp', 'avif', 'jpg'] as const;
export type TargetFormat = (typeof TARGET_FORMATS)[number];

/** Any format the plugin recognises (including ones it never converts, such as SVG). */
export type KnownFormat = SourceFormat | 'svg';

const EXTENSIONS: Record<string, KnownFormat> = {
  jpg: 'jpg',
  jpeg: 'jpg',
  jpe: 'jpg',
  jfif: 'jpg',
  png: 'png',
  heic: 'heic',
  heif: 'heic',
  tif: 'tiff',
  tiff: 'tiff',
  bmp: 'bmp',
  webp: 'webp',
  avif: 'avif',
  gif: 'gif',
  svg: 'svg',
};

const MIME_TYPES: Record<TargetFormat, string> = {
  webp: 'image/webp',
  avif: 'image/avif',
  jpg: 'image/jpeg',
};

/** Browsers show these as they are; the others (HEIC, TIFF, BMP) need converting to be seen. */
const BROWSER_FORMATS: ReadonlySet<KnownFormat> = new Set([
  'jpg',
  'png',
  'webp',
  'avif',
  'gif',
  'svg',
]);

export const mimeType = (format: TargetFormat): string => MIME_TYPES[format];

/** Whether a browser can show a file of this format without converting it first. */
export const browserReadable = (format: KnownFormat): boolean => BROWSER_FORMATS.has(format);

/** The file name at the end of a URL's path, decoded (`""` when there is none). */
export function fileNameFromUrl(url: string): string {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    path = url.split(/[?#]/)[0] ?? '';
  }
  const last = path.split('/').pop() ?? '';
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/** The format a URL's file name says it has, or `null` when it names none we know. */
export function formatFromUrl(url: string): KnownFormat | null {
  const name = fileNameFromUrl(url);
  const dot = name.lastIndexOf('.');
  if (dot < 0) return null;
  return EXTENSIONS[name.slice(dot + 1).toLowerCase()] ?? null;
}

const ascii = (bytes: Uint8Array, start: number, end: number) =>
  String.fromCharCode(...bytes.subarray(start, end));

/** The format a file's first bytes say it has, or `null` when they match none we know. */
export function sniffFormat(bytes: Uint8Array): KnownFormat | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes[0] === 0x89 && ascii(bytes, 1, 4) === 'PNG') return 'png';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'webp';
  if (ascii(bytes, 0, 3) === 'GIF') return 'gif';
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return 'bmp';
  if (
    (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) ||
    (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a)
  )
    return 'tiff';
  if (ascii(bytes, 4, 8) === 'ftyp') {
    // The major brand, then (after the minor version) the compatible brands, to the box's end.
    const boxEnd = Math.min(
      bytes.length,
      (bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!,
    );
    const brands = [ascii(bytes, 8, 12)];
    for (let at = 16; at + 4 <= boxEnd; at += 4) brands.push(ascii(bytes, at, at + 4));
    if (brands.some((b) => b === 'avif' || b === 'avis')) return 'avif';
    if (
      brands.some((b) =>
        ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(b),
      )
    )
      return 'heic';
  }
  const head = ascii(bytes, 0, Math.min(bytes.length, 256)).trimStart().toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'svg';
  return null;
}

/**
 * The name the converted file is stored under: the original's name without the timestamp the
 * local file provider puts in front (it adds a new one), a short `unique` part and the new
 * extension. Without the unique part, `shirt.png` and `shirt.heic` converted in the same
 * millisecond would get one name, and the local provider would write both to one file.
 */
export function convertedFileName(
  sourceUrl: string,
  format: TargetFormat,
  unique?: string,
): string {
  const name = fileNameFromUrl(sourceUrl);
  const dot = name.lastIndexOf('.');
  const base = (dot > 0 ? name.slice(0, dot) : name).replace(/^\d{10,}-/, '');
  const safe =
    base
      .replace(/[^\p{L}\p{N}._-]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 120) || 'image';
  return unique ? `${safe}-${unique}.${format}` : `${safe}.${format}`;
}
