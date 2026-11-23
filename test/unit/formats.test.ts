import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  browserReadable,
  convertedFileName,
  fileNameFromUrl,
  formatFromUrl,
  sniffFormat,
} from '../../src/lib/formats';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(join(__dirname, '..', 'fixtures', name)));

/** The first bytes of an ISO-BMFF file (`ftyp` box) with these brands. */
function ftyp(major: string, compatible: string[]): Uint8Array {
  const size = 16 + compatible.length * 4;
  const bytes = new Uint8Array(size);
  new DataView(bytes.buffer).setUint32(0, size);
  bytes.set(Buffer.from('ftyp' + major + '\0\0\0\0' + compatible.join(''), 'latin1'), 4);
  return bytes;
}

describe('formatFromUrl', () => {
  it("reads the extension of the URL's file, ignoring query and case", () => {
    expect(formatFromUrl('https://cdn.example.com/a/b/shirt.PNG?v=3#x')).toBe('png');
    expect(formatFromUrl('http://localhost:9000/static/1732-photo.jpeg')).toBe('jpg');
    expect(formatFromUrl('https://x.test/IMG_0001.HEIF')).toBe('heic');
    expect(formatFromUrl('https://x.test/scan.tif')).toBe('tiff');
    expect(formatFromUrl('https://x.test/logo.svg')).toBe('svg');
  });

  it('returns null for names without a known extension', () => {
    expect(formatFromUrl('https://images.example.com/abc123')).toBeNull();
    expect(formatFromUrl('https://x.test/file.psd')).toBeNull();
    expect(formatFromUrl('https://x.test/')).toBeNull();
  });

  it('decodes the file name', () => {
    expect(fileNameFromUrl('https://x.test/a/T%C3%BCr%20k.png')).toBe('Tür k.png');
  });
});

describe('sniffFormat', () => {
  it('recognises the sample files by their bytes', () => {
    expect(sniffFormat(fixture('sample.png'))).toBe('png');
    expect(sniffFormat(fixture('sample.jpg'))).toBe('jpg');
    expect(sniffFormat(fixture('sample.heic'))).toBe('heic');
  });

  it('tells AVIF from HEIC by the brands, also when the major brand is mif1', () => {
    expect(sniffFormat(ftyp('avif', ['mif1', 'miaf']))).toBe('avif');
    expect(sniffFormat(ftyp('mif1', ['avif', 'miaf']))).toBe('avif');
    expect(sniffFormat(ftyp('mif1', ['heic', 'miaf']))).toBe('heic');
    expect(sniffFormat(ftyp('heic', ['mif1']))).toBe('heic');
    expect(sniffFormat(ftyp('isom', ['mp41']))).toBeNull();
  });

  it('recognises WebP, GIF, BMP, TIFF and SVG', () => {
    expect(sniffFormat(Buffer.from('RIFF\x10\0\0\0WEBPVP8 ', 'latin1'))).toBe('webp');
    expect(sniffFormat(Buffer.from('GIF89a\x01\0\x01\0\0\0', 'latin1'))).toBe('gif');
    expect(sniffFormat(Buffer.from('BM\0\0\0\0\0\0\0\0\0\0', 'latin1'))).toBe('bmp');
    expect(sniffFormat(Buffer.from('II*\0\x08\0\0\0\0\0\0\0', 'latin1'))).toBe('tiff');
    expect(sniffFormat(Buffer.from('<?xml version="1.0"?><svg xmlns="x"></svg>', 'latin1'))).toBe(
      'svg',
    );
    expect(sniffFormat(Buffer.from('hello world, not an image', 'latin1'))).toBeNull();
    expect(sniffFormat(new Uint8Array(4))).toBeNull();
  });
});

describe('convertedFileName', () => {
  it("swaps the extension and drops the local provider's timestamp", () => {
    expect(
      convertedFileName('http://localhost:9000/static/1732112233445-shirt-front.png', 'webp'),
    ).toBe('shirt-front.webp');
    expect(convertedFileName('https://x.test/IMG 0001.HEIC', 'jpg')).toBe('IMG-0001.jpg');
    expect(convertedFileName('https://x.test/', 'avif')).toBe('image.avif');
  });

  it('adds the unique part, so two sources with one name never share a file', () => {
    expect(
      convertedFileName('http://s.test/static/1732112233445-sample.png', 'webp', 'a1b2c3d4'),
    ).toBe('sample-a1b2c3d4.webp');
    expect(
      convertedFileName('http://s.test/static/1732112233445-sample.heic', 'webp', 'e5f6a7b8'),
    ).toBe('sample-e5f6a7b8.webp');
  });
});

describe('browserReadable', () => {
  it('knows which formats need converting to be seen at all', () => {
    expect(browserReadable('jpg')).toBe(true);
    expect(browserReadable('png')).toBe(true);
    expect(browserReadable('heic')).toBe(false);
    expect(browserReadable('tiff')).toBe(false);
  });
});
