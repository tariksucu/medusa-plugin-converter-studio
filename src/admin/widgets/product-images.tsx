import { defineWidgetConfig } from '@medusajs/admin-sdk';
import { Alert, Button, Container, Heading, StatusBadge, Text, Tooltip, toast } from '@medusajs/ui';
import { useEffect, useRef, useState } from 'react';
import {
  API_KEYS_URL,
  CREDIT_CODES,
  PRICING_URL,
  api,
  formatBytes,
  planName,
  savedPercent,
  type ImageStatus,
} from '../lib/api';
import { useAction, useDashboardQueryClient, usePolled } from '../lib/hooks';

type Props = { data: { id: string } };

const badgeColor = (state: ImageStatus['state']) =>
  ({
    converted: 'green',
    processing: 'blue',
    pending: 'orange',
    failed: 'red',
    kept: 'grey',
    restored: 'grey',
    ignored: 'grey',
  })[state] as 'green' | 'blue' | 'orange' | 'red' | 'grey';

function badgeText(image: ImageStatus, target: string) {
  const format = (image.format ?? 'file').toUpperCase();
  switch (image.state) {
    case 'converted':
      return `${target.toUpperCase()} ${savedPercent(image.source_size, image.result_size) ?? ''}`.trim();
    case 'processing':
      return 'Converting…';
    case 'pending':
      return `${format} · waiting`;
    case 'failed':
      return `${format} · not converted`;
    case 'kept':
      return `${format} · kept`;
    case 'restored':
      return `${format} · original`;
    case 'ignored':
      return format;
  }
}

const ImageRow = ({ image, target }: { image: ImageStatus; target: string }) => {
  const badge = (
    <StatusBadge color={badgeColor(image.state)} className="whitespace-nowrap">
      {badgeText(image, target)}
    </StatusBadge>
  );
  return (
    <div className="flex items-center gap-x-3 py-1.5">
      <div className="bg-ui-bg-subtle h-8 w-8 shrink-0 overflow-hidden rounded-md border">
        <img src={image.url} alt="" className="h-full w-full object-cover" loading="lazy" />
      </div>
      <Text size="small" className="text-ui-fg-subtle min-w-0 flex-1 truncate" title={image.url}>
        {image.target === 'thumbnail' ? 'Thumbnail' : (image.url.split('/').pop() ?? image.url)}
      </Text>
      {image.message ? <Tooltip content={image.message}>{badge}</Tooltip> : badge}
    </div>
  );
};

const Link = ({ href, children }: { href: string; children: string }) => (
  <a href={href} target="_blank" rel="noreferrer" className="text-ui-fg-interactive">
    {children}
  </a>
);

/** Converter Studio on the product page: the state of each image, and convert / restore. */
const ConverterStudioProductWidget = ({ data: product }: Props) => {
  const queryClient = useDashboardQueryClient();
  const status = usePolled(
    `product:${product.id}`,
    () => api.product(product.id),
    (data) => (data?.running ? 2000 : false),
  );
  const overview = usePolled('overview', api.overview, () => false);
  const [needsReload, setNeedsReload] = useState(false);

  // The product's own media section shows the old URLs until the dashboard reloads the product.
  const refreshDashboard = () => {
    if (queryClient) void queryClient.invalidateQueries({ queryKey: ['products'] });
    else setNeedsReload(true);
  };
  // A run (started here, or automatic) is going on: when it ends, refresh the rest of the page.
  const awaitingRun = useRef(false);
  useEffect(() => {
    if (!status.data) return;
    if (status.data.running) awaitingRun.current = true;
    else if (awaitingRun.current) {
      awaitingRun.current = false;
      overview.refresh();
      refreshDashboard();
    }
  }, [status.data]);

  const convert = useAction(async () => {
    try {
      await api.convert(product.id);
      awaitingRun.current = true;
      status.refresh();
    } catch (error) {
      toast.error((error as Error).message);
    }
  });
  const restore = useAction(async () => {
    try {
      const result = await api.restore(product.id);
      toast.success(
        `Restored ${result.restored} original image${result.restored === 1 ? '' : 's'}`,
      );
      status.refresh();
      refreshDashboard();
    } catch (error) {
      toast.error((error as Error).message);
    }
  });

  const data = status.data;
  const account = overview.data?.account;
  const options = data?.options;
  const blockedBy = data?.summary.blocked_by ?? data?.pause?.code ?? null;
  const waitedForCredits = blockedBy !== null && CREDIT_CODES.includes(blockedBy);
  // Out of credits now (paused, or the account says so), or only when these images were tried.
  const outOfCredits =
    waitedForCredits &&
    (Boolean(data?.pause && CREDIT_CODES.includes(data.pause.code)) ||
      (account ? account.credits < 1 : Boolean(overview.data)));
  const badKey =
    blockedBy === 'invalidApiKey' || overview.data?.account_error?.code === 'invalidApiKey';

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">Image optimization</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Converter Studio{options?.configured ? ` · to ${options.format.toUpperCase()}` : ''}
          {account ? ` · ${planName(account.plan)}, ${account.credits} credits left` : ''}
        </Text>
      </div>

      {status.error && !data ? (
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-error">
            {status.error.message}
          </Text>
        </div>
      ) : !data ? (
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle">
            Loading…
          </Text>
        </div>
      ) : (
        <>
          {!data.options.configured && (
            <div className="px-6 py-4">
              <Alert variant="info">
                Add a Converter Studio API key to the plugin's options (or the
                CONVERTER_STUDIO_API_KEY variable) to convert images.{' '}
                <Link href={API_KEYS_URL}>Create a key</Link>
              </Alert>
            </div>
          )}
          {outOfCredits && (
            <div className="px-6 py-4">
              <Alert variant="warning">
                The Converter Studio account is out of credits, so the original images are kept.{' '}
                <Link href={PRICING_URL}>Get more credits</Link>, then convert again.
              </Alert>
            </div>
          )}
          {waitedForCredits && !outOfCredits && (
            <div className="px-6 py-4">
              <Alert variant="info">
                Some images were not converted because the account had run out of credits. There are
                credits again: convert them now.
              </Alert>
            </div>
          )}
          {badKey && (
            <div className="px-6 py-4">
              <Alert variant="error">
                The Converter Studio API key does not work.{' '}
                <Link href={API_KEYS_URL}>Check your keys</Link>
              </Alert>
            </div>
          )}

          <div className="px-6 py-3">
            {data.images.length === 0 ? (
              <Text size="small" className="text-ui-fg-subtle">
                This product has no images yet.
              </Text>
            ) : (
              data.images.map((image) => (
                <ImageRow
                  key={`${image.target}:${image.image_id}:${image.url}`}
                  image={image}
                  target={data.options.format}
                />
              ))
            )}
            {data.summary.saved_bytes > 0 && (
              <Text size="small" className="text-ui-fg-subtle pt-2">
                Saved {formatBytes(data.summary.saved_bytes)} on this product's images.
              </Text>
            )}
            {needsReload && (
              <Text size="small" className="text-ui-fg-subtle pt-2">
                Images changed.{' '}
                <button
                  type="button"
                  className="text-ui-fg-interactive"
                  onClick={() => window.location.reload()}
                >
                  Reload
                </button>{' '}
                to see them in Media.
              </Text>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 px-6 py-4">
            {data.summary.converted > 0 && (
              <Button
                size="small"
                variant="secondary"
                isLoading={restore.busy}
                disabled={data.running}
                onClick={() => void restore.run()}
              >
                Restore originals
              </Button>
            )}
            <Button
              size="small"
              variant="secondary"
              isLoading={convert.busy || data.running}
              disabled={!data.options.configured || data.summary.convertible === 0 || data.running}
              onClick={() => void convert.run()}
            >
              {data.summary.convertible > 0
                ? `Convert ${data.summary.convertible} image${data.summary.convertible === 1 ? '' : 's'}`
                : 'Nothing to convert'}
            </Button>
          </div>
        </>
      )}
    </Container>
  );
};

export const config = defineWidgetConfig({
  zone: 'product.details.side.after',
});

export default ConverterStudioProductWidget;
