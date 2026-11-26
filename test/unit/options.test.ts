import {
  apiConversionOptions,
  DEFAULT_API_URL,
  publicOptions,
  resolveOptions,
} from '../../src/lib/options';

describe('resolveOptions', () => {
  it('fills in the defaults', () => {
    const options = resolveOptions({}, {});
    expect(options).toMatchObject({
      apiKey: null,
      format: 'webp',
      sources: ['jpg', 'png', 'heic', 'tiff', 'bmp'],
      quality: 'balanced',
      maxSize: 2560,
      keepMetadata: false,
      maxCredits: 1,
      autoConvert: true,
      onlyIfSmaller: true,
      concurrency: 2,
      timeoutSeconds: 180,
      apiUrl: DEFAULT_API_URL,
    });
  });

  it('shrinks large photos to 2560 px by default; null or 0 keeps every size', () => {
    expect(resolveOptions({}, {}).maxSize).toBe(2560);
    expect(resolveOptions({ maxSize: 1920 }, {}).maxSize).toBe(1920);
    expect(resolveOptions({ maxSize: null }, {}).maxSize).toBeNull();
    expect(resolveOptions({ maxSize: 0 }, {}).maxSize).toBeNull();
    // A size of its own in conversionOptions wins over the default (it did before the default).
    for (const size of [
      { width: '1200' },
      { longSide: '1280' },
      { scale: '50' },
      { resizeWidth: 900 },
      { resizeHeight: 900 },
    ])
      expect(resolveOptions({ conversionOptions: size }, {}).maxSize).toBeNull();
    expect(resolveOptions({ conversionOptions: { maxKb: 300 } }, {}).maxSize).toBe(2560);
  });

  it('takes the key and the address from the environment when the options have none', () => {
    const options = resolveOptions(undefined, {
      CONVERTER_STUDIO_API_KEY: '  cvs_live_x  ',
      CONVERTER_STUDIO_API_URL: 'http://localhost:8080/api/',
    });
    expect(options.apiKey).toBe('cvs_live_x');
    expect(options.apiUrl).toBe('http://localhost:8080/api');
    expect(
      resolveOptions({ apiKey: 'cvs_live_y' }, { CONVERTER_STUDIO_API_KEY: 'cvs_live_x' }).apiKey,
    ).toBe('cvs_live_y');
    expect(resolveOptions({ apiKey: '' }, {}).apiKey).toBeNull();
  });

  it('picks sources to suit the format and never converts a format to itself', () => {
    expect(resolveOptions({ format: 'avif' }, {}).sources).toEqual([
      'jpg',
      'png',
      'heic',
      'tiff',
      'bmp',
      'webp',
    ]);
    expect(resolveOptions({ format: 'jpg' }, {}).sources).toEqual(['heic', 'tiff', 'bmp']);
    expect(
      resolveOptions({ format: 'webp', sources: ['jpeg', 'webp', 'png', 'png'] as never }, {})
        .sources,
    ).toEqual(['jpg', 'png']);
  });

  it('throws on values that cannot be right', () => {
    expect(() => resolveOptions({ format: 'gif' as never }, {})).toThrow(/format/);
    expect(() => resolveOptions({ sources: ['psd'] as never }, {})).toThrow(/sources/);
    expect(() => resolveOptions({ quality: 'best' as never }, {})).toThrow(/quality/);
    expect(() => resolveOptions({ maxSize: 1000 as never }, {})).toThrow(/maxSize/);
    expect(() => resolveOptions({ maxCredits: 0 }, {})).toThrow(/maxCredits/);
    expect(() => resolveOptions({ concurrency: 9 }, {})).toThrow(/concurrency/);
    expect(() => resolveOptions({ autoConvert: 'yes' as never }, {})).toThrow(/autoConvert/);
    expect(() => resolveOptions({ apiUrl: 'ftp://x' }, {})).toThrow(/apiUrl/);
    expect(() => resolveOptions({ conversionOptions: [] as never }, {})).toThrow(
      /conversionOptions/,
    );
  });
});

describe('apiConversionOptions', () => {
  it('sends the quality, the size and EXIF only when asked, plus advanced options', () => {
    expect(apiConversionOptions(resolveOptions({}, {}))).toEqual({
      quality: 'balanced',
      longSide: '2560',
    });
    expect(apiConversionOptions(resolveOptions({ maxSize: null }, {}))).toEqual({
      quality: 'balanced',
    });
    expect(
      apiConversionOptions(resolveOptions({ conversionOptions: { width: '1200' } }, {})),
    ).toEqual({ quality: 'balanced', width: '1200' });
    expect(
      apiConversionOptions(
        resolveOptions(
          {
            quality: 'small',
            maxSize: 1920,
            keepMetadata: true,
            conversionOptions: { maxKb: 300 },
          },
          {},
        ),
      ),
    ).toEqual({ quality: 'small', longSide: '1920', keepMetadata: true, maxKb: 300 });
  });
});

describe('publicOptions', () => {
  it('never shows the key', () => {
    const shown = publicOptions(resolveOptions({ apiKey: 'cvs_live_secret' }, {}));
    expect(JSON.stringify(shown)).not.toContain('cvs_live_secret');
    expect(shown.configured).toBe(true);
  });
});
