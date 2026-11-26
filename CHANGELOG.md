# Changelog

## 1.1.0

- **`maxSize` is now 2560 by default** (it was off). Phone and camera photos, often 4000–6000
  pixels and 5–10 MB, were converted to WebP at full size, so they stayed large and slowed the
  storefront and the admin's product pages. Now their longer side is scaled down to 2560 px,
  which still fills a sharp product page and its zoom; smaller images are never enlarged. To keep
  every image at its size as before, set `maxSize: null` (or `0`). A size of its own in
  `conversionOptions` (`width`, `longSide`, `scale`, `resizeWidth`, `resizeHeight`) still decides,
  as it did before.
- **Settings → Converter Studio shows what _Convert all_ would cost before it starts**: the images
  it would send and in how many products, the most credits that can take (one an image), the
  images it leaves alone for free (already in the target format, a format not chosen, originals
  kept after an earlier try), and a warning when the account has fewer credits than that. New
  admin route: `GET /admin/converter-studio/bulk/estimate`.
- **Try 10 images first**: converts a sample and shows how many images were converted, how many
  kept their original, the credits spent (and how many of them on kept originals, since a JPG or
  PNG that would come out larger keeps its original but its credit is spent) and the space saved.
  _Convert all_ then goes on with the rest without sending an image twice.
  `POST /admin/converter-studio/bulk` takes `limit` (1–1000) for that.
- **The plugin's own product update no longer starts an automatic conversion.** Putting a
  converted or restored image in place updates the product, and that update used to start the
  automatic conversion of every other image of the product that had not been converted yet. So
  _Convert images_ on one image, _Restore originals_, or a sample could convert, and charge, the
  product's other images too. Now the plugin's runs mark their updates (by event group), and the
  automatic conversion skips them; changes made in the admin or by other code are converted as
  before.
- The README says 25 free credits a day, as the website does (the 1.0.0 package on npm said 13).

## 1.0.0

First release.

- Converts product images (JPG, PNG, HEIC, TIFF, BMP; GIF and WebP when chosen) to WebP, AVIF or
  JPG in the background when a product is created or updated, keeping image ids, order, the
  product thumbnail and variant thumbnails. The original stays in storage and its URL in the
  image's metadata.
- Product widget with each image's state, _Convert images_ and _Restore originals_; Settings →
  Converter Studio with the plan, credits left, _Convert all_ and the latest conversions.
- Out of credits: stops, keeps the originals and pauses automatic runs for 30 minutes.
