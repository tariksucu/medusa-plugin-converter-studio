# Converter Studio for Medusa

Smaller, faster product images for your [Medusa](https://medusajs.com) v2 store. This plugin
converts product images to **WebP**, **AVIF** or **JPG** with the
[Converter Studio](https://converter.studio) API. It runs on its own when you add images to a
product, and you can also start it from the admin.

- **Automatic.** When a product is created or updated, its JPG, PNG, HEIC, TIFF and BMP images
  are converted in the background. The converted file takes the original's place in the
  product's gallery, thumbnail and variant thumbnails.
- **HEIC from phones just works.** Browsers other than Safari cannot show HEIC photos. The plugin
  turns them into WebP or JPG.
- **Originals are kept.** The original file stays in your storage, and its URL is saved in the
  image's metadata (`converter_studio_original_url`). You can put the originals back with one
  click.
- **Safe for credits.** Each image goes ahead only up to `maxCredits` (default 1). If a converted
  JPG or PNG comes out larger than the original, the original stays. When the account runs out
  of credits, the plugin stops, keeps the originals and tells you in the admin.
- **Admin.** A product page widget shows each image's state and has _Convert images_ and _Restore
  originals_ buttons. A settings page (Settings → Converter Studio) shows your plan and
  remaining credits, can convert the whole catalog, and lists the latest conversions.
- **Works with any file provider.** Local, S3, MinIO, R2 and others: the plugin saves converted
  files through Medusa's File Module, so your storage setup stays the same.
- **Privacy.** EXIF details (camera, date, GPS location) are removed by default.

## Requirements

- Medusa v2.11.2 or later (tested with 2.22.7 and 2.23.0)
- Node.js 20 or later
- A Converter Studio account and an API key. Create a key on your
  [account page](https://converter.studio/account#api-keys). A free account is enough to start.

## Install

```bash
npm install medusa-plugin-converter-studio
```

Add the plugin to `medusa-config.ts`:

```ts
module.exports = defineConfig({
  // ...
  plugins: [
    {
      resolve: 'medusa-plugin-converter-studio',
      options: {
        apiKey: process.env.CONVERTER_STUDIO_API_KEY,
        format: 'webp', // or "avif", or "jpg"
      },
    },
  ],
});
```

Put the key in your environment (for example `.env`), not in the code:

```bash
CONVERTER_STUDIO_API_KEY=cvs_live_...
```

Then create the plugin's table, and restart Medusa:

```bash
npx medusa db:migrate
```

New product images are now converted automatically. To convert the images you already have, open
**Settings → Converter Studio** and click **Convert all**, or use **Convert images** on a
product's page.

## Options

All options are optional.

| Option              | Default                        | What it does                                                                                                                                                                                              |
| ------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apiKey`            | `CONVERTER_STUDIO_API_KEY`     | Your Converter Studio API key. Without one, the plugin does nothing and logs a warning.                                                                                                                   |
| `format`            | `"webp"`                       | What images become: `"webp"`, `"avif"` or `"jpg"`.                                                                                                                                                        |
| `sources`           | depends on `format`            | Formats to convert. WebP: `jpg`, `png`, `heic`, `tiff`, `bmp`. AVIF: the same plus `webp`. JPG: `heic`, `tiff`, `bmp` (only formats browsers cannot show). `gif` can be added, but animation is not kept. |
| `quality`           | `"balanced"`                   | `"high"`, `"balanced"` or `"small"`.                                                                                                                                                                      |
| `maxSize`           | `null`                         | Shrinks images whose longer side is larger: `2560`, `1920`, `1280` or `800` pixels. Images are never made larger.                                                                                         |
| `keepMetadata`      | `false`                        | Keeps EXIF details (camera, date). The GPS location is still removed.                                                                                                                                     |
| `maxCredits`        | `1`                            | The most credits one image may cost. A more expensive conversion is skipped and the original kept.                                                                                                        |
| `autoConvert`       | `true`                         | Converts images when products are created or updated. Set to `false` to convert only from the admin.                                                                                                      |
| `onlyIfSmaller`     | `true`                         | Keeps a JPG or PNG original when the converted file would be larger. HEIC, TIFF and BMP are always converted.                                                                                             |
| `concurrency`       | `2`                            | Images converted at the same time (1–5).                                                                                                                                                                  |
| `timeoutSeconds`    | `180`                          | The longest one conversion may take.                                                                                                                                                                      |
| `conversionOptions` | `{}`                           | Further [Converter Studio options](https://converter.studio/developers), passed on unchanged (for example `{ "maxKb": 300 }` or `{ "lossless": true }`).                                                  |
| `apiUrl`            | `https://converter.studio/api` | The API's address. Change it only for testing.                                                                                                                                                            |

## Credits and pricing

Conversions use your Converter Studio account's credits, the same credits as on the website. Most
images cost **1 credit**. Free accounts get 13 credits a day, and paid plans include more credits
each month. See [converter.studio/pricing](https://converter.studio/pricing).

When the credits run out:

- the image that could not be converted, and the ones after it, keep their originals;
- the admin widget and the settings page say so, with a link to get more credits;
- automatic conversions pause for 30 minutes, then try again on the next product change. Click
  **Convert images** (or **Convert all**) once you have credits again.

A failed conversion costs nothing. Converting an image whose result turns out larger (and is
therefore not used) still costs its credit.

## How it works

1. A product is created or updated. A subscriber (`product.created`, `product.updated`) starts the
   `converter-studio-convert-product-images` workflow in the background. The product itself is
   saved right away, with the originals.
2. The workflow locks the product, so only one run works on it at a time. It then picks the images
   that need converting.
3. Each image is downloaded from its URL and sent to Converter Studio
   (`POST /v1/uploads`, `POST /v1/conversions`). When the result is ready, it is downloaded and
   saved with your File Module provider.
4. The workflow reads the product again and swaps the URLs of images that have not changed in the
   meantime, using Medusa's `updateProductsWorkflow`. Image ids stay the same, so variant images
   are kept.
5. Every attempt is recorded in the `converter_studio_image_conversion` table, which the admin
   reads.

A few seconds pass between saving a product and its converted images appearing. Storefronts
showing the product in that time get the original.

The workflows are exported for your own code:

```ts
import {
  convertProductImagesWorkflow,
  restoreProductImagesWorkflow,
} from 'medusa-plugin-converter-studio/workflows';

await convertProductImagesWorkflow(container).run({ input: { product_id, trigger: 'manual' } });
```

### Admin API routes

All routes require an admin login.

| Route                                               | Purpose                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------ |
| `GET /admin/converter-studio`                       | Options in effect (without the key), plan and credits              |
| `GET /admin/converter-studio/products/:id`          | Each image's state                                                 |
| `POST /admin/converter-studio/products/:id/convert` | Convert the product's images (`{ image_ids? }`), in the background |
| `POST /admin/converter-studio/products/:id/restore` | Put the originals back (`{ image_ids? }`)                          |
| `GET /admin/converter-studio/conversions`           | Latest conversions (`limit`, `offset`, `status`)                   |
| `GET`/`POST /admin/converter-studio/bulk`           | Convert every product's images (`{ action: "start" \| "cancel" }`) |

## Good to know

- **Product feeds.** Some marketplaces and ad catalogs accept only JPG or PNG. If you send product
  feeds, use `format: "jpg"`, or read the original from the image's `converter_studio_original_url`
  metadata.
- **Demo data.** With the plugin active, seeding demo products converts their images too, which
  uses credits. Set `autoConvert: false` while seeding if you don't want that.
- **Changing `format` later** (for example from WebP to AVIF) converts the images again from their
  originals, not from the earlier result.
- **Restored images** are left alone by automatic conversions. _Convert images_ converts them
  again.
- **Several servers.** Converting is safe across servers and workers (a lock per product). The
  progress of _Convert all_ is kept by the server that runs it.
- **Storage.** Converted files are stored next to the originals. Restoring deletes the converted
  file.

## Privacy

Product images are sent to Converter Studio to be converted, and that is their only use.
Uploads are deleted after conversion, and results after 6 hours. See the
[privacy policy](https://converter.studio/privacy) and [terms](https://converter.studio/terms).
Mention Converter Studio in your store's privacy policy as a service that processes product images.

## Support

Write to [support@converter.studio](mailto:support@converter.studio), or report a problem at
[github.com/tariksucu/medusa-plugin-converter-studio/issues](https://github.com/tariksucu/medusa-plugin-converter-studio/issues).
API documentation: [converter.studio/developers](https://converter.studio/developers).

## Development and releases

```bash
npm ci
npm run typecheck
npm test            # unit tests, no network
npm run build       # .medusa/server
```

`npm run test:integration` runs the conversion code against a Converter Studio API: set
`CONVERTER_STUDIO_TEST_API_URL` (for example `https://converter.studio/api`) and
`CONVERTER_STUDIO_TEST_API_KEY_FILE` (a file holding an API key). It spends a few credits.

Releases are published to npm by this repository's GitHub Actions workflow
(`.github/workflows/publish.yml`) when a version tag is pushed, with an
[npm provenance statement](https://docs.npmjs.com/generating-provenance-statements): the package
page on npm shows the commit and the workflow each version was built from.

## License

MIT
