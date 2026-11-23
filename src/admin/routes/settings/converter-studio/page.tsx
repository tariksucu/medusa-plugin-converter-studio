import { defineRouteConfig } from '@medusajs/admin-sdk';
import { Photo } from '@medusajs/icons';
import { Alert, Button, Container, Heading, StatusBadge, Table, Text, toast } from '@medusajs/ui';
import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  API_KEYS_URL,
  CREDIT_CODES,
  PRICING_URL,
  api,
  formatBytes,
  planName,
  savedPercent,
  type ConversionRow,
} from '../../../lib/api';
import { useAction, usePolled } from '../../../lib/hooks';

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="grid grid-cols-2 px-6 py-3">
    <Text size="small" weight="plus" className="text-ui-fg-subtle">
      {label}
    </Text>
    <Text size="small">{value}</Text>
  </div>
);

const statusColor = (status: ConversionRow['status']) =>
  ({ converted: 'green', processing: 'blue', failed: 'red', skipped: 'grey', restored: 'grey' })[
    status
  ] as 'green' | 'blue' | 'red' | 'grey';

/** Settings → Converter Studio: the account, the options in effect, a bulk run and the log. */
const ConverterStudioSettingsPage = () => {
  const overview = usePolled('overview', api.overview, () => false);
  const bulk = usePolled('bulk', api.bulk, (data) => (data?.bulk.running ? 2000 : false));
  const running = bulk.data?.bulk.running ?? false;
  const log = usePolled(
    'conversions',
    () => api.conversions(20, 0),
    () => (running ? 4000 : false),
  );

  // When a bulk run ends, show the final log and the credits left.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running) {
      log.refresh();
      overview.refresh();
    }
    wasRunning.current = running;
  }, [running]);

  const start = useAction(async () => {
    try {
      await api.startBulk();
      bulk.refresh();
    } catch (error) {
      toast.error((error as Error).message);
    }
  });
  const cancel = useAction(async () => {
    await api.cancelBulk().catch((error: Error) => toast.error(error.message));
    bulk.refresh();
  });

  const options = overview.data?.options;
  const account = overview.data?.account;
  const progress = bulk.data?.bulk;
  const stoppedForCredits = progress?.stopped_by && CREDIT_CODES.includes(progress.stopped_by);
  const pausedForCredits = overview.data?.pause && CREDIT_CODES.includes(overview.data.pause.code);

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading level="h1">Converter Studio</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Converts product images to modern formats with your Converter Studio account's credits
            (about one credit an image).{' '}
            <a
              href={PRICING_URL}
              target="_blank"
              rel="noreferrer"
              className="text-ui-fg-interactive"
            >
              Plans and credits
            </a>
          </Text>
        </div>
        {overview.data?.account_error && (
          <div className="px-6 py-4">
            <Alert variant="error">
              {overview.data.account_error.message}{' '}
              <a
                href={API_KEYS_URL}
                target="_blank"
                rel="noreferrer"
                className="text-ui-fg-interactive"
              >
                API keys
              </a>
            </Alert>
          </div>
        )}
        {(pausedForCredits || stoppedForCredits) && (
          <div className="px-6 py-4">
            <Alert variant="warning">
              Out of credits: images wait with their originals until there are credits again.{' '}
              <a
                href={PRICING_URL}
                target="_blank"
                rel="noreferrer"
                className="text-ui-fg-interactive"
              >
                Get more credits
              </a>
            </Alert>
          </div>
        )}
        <Row label="API key" value={options ? (options.configured ? 'Set' : 'Not set') : '…'} />
        <Row
          label="Account"
          value={
            account
              ? `${planName(account.plan)} · ${account.credits} credits left${
                  account.allowance
                    ? ` (${account.allowance.used} of ${account.allowance.limit} this ${account.allowance.per} used)`
                    : ''
                }`
              : options?.configured
                ? '…'
                : '—'
          }
        />
        {options && (
          <>
            <Row
              label="Converts"
              value={`${options.sources.map((s) => s.toUpperCase()).join(', ')} → ${options.format.toUpperCase()}`}
            />
            <Row
              label="Quality"
              value={`${options.quality}${options.maxSize ? `, longest side ${options.maxSize} px` : ''}${options.keepMetadata ? ', keeps EXIF' : ', EXIF removed'}`}
            />
            <Row
              label="Automatic"
              value={
                options.autoConvert
                  ? 'When a product is created or updated'
                  : 'Off (convert by hand)'
              }
            />
            <Row label="Most credits an image" value={String(options.maxCredits)} />
          </>
        )}
      </Container>

      <Container className="divide-y p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <Heading level="h2">Convert all product images</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              Goes through every product; stops by itself when the credits run out. Originals stay
              in storage.
            </Text>
          </div>
          {progress?.running ? (
            <Button
              size="small"
              variant="secondary"
              isLoading={cancel.busy}
              onClick={() => void cancel.run()}
            >
              Stop
            </Button>
          ) : (
            <Button
              size="small"
              variant="secondary"
              disabled={!options?.configured}
              isLoading={start.busy}
              onClick={() => void start.run()}
            >
              Convert all
            </Button>
          )}
        </div>
        {progress?.started_at && (
          <div className="px-6 py-4">
            <Text size="small">
              {progress.running ? 'Running: ' : 'Last run: '}
              {progress.products_done} of {progress.products_total} products, {progress.converted}{' '}
              images converted, {progress.failed} not converted, {progress.credits} credits,{' '}
              {formatBytes(progress.saved_bytes)} saved
              {progress.stopped_by ? ` · stopped (${progress.stopped_by})` : ''}
            </Text>
          </div>
        )}
      </Container>

      <Container className="p-0">
        <div className="px-6 py-4">
          <Heading level="h2">Latest conversions</Heading>
        </div>
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Image</Table.HeaderCell>
              <Table.HeaderCell>Status</Table.HeaderCell>
              <Table.HeaderCell>Size</Table.HeaderCell>
              <Table.HeaderCell>When</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {(log.data?.conversions ?? []).map((row) => (
              <Table.Row key={row.id}>
                <Table.Cell className="max-w-[240px] truncate">
                  <Link
                    to={`/products/${row.product_id}`}
                    className="text-ui-fg-interactive"
                    title={row.source_url}
                  >
                    {row.source_url.split('/').pop()}
                  </Link>
                </Table.Cell>
                <Table.Cell>
                  <StatusBadge color={statusColor(row.status)}>
                    {row.status}
                    {row.reason ? ` · ${row.reason}` : ''}
                  </StatusBadge>
                </Table.Cell>
                <Table.Cell>
                  {row.source_size && row.result_size
                    ? `${formatBytes(row.source_size)} → ${formatBytes(row.result_size)} (${savedPercent(row.source_size, row.result_size)})`
                    : '—'}
                </Table.Cell>
                <Table.Cell>{new Date(row.created_at).toLocaleString()}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
        {log.data && log.data.conversions.length === 0 && (
          <div className="px-6 py-4">
            <Text size="small" className="text-ui-fg-subtle">
              No conversions yet.
            </Text>
          </div>
        )}
      </Container>
    </div>
  );
};

export const config = defineRouteConfig({
  label: 'Converter Studio',
  icon: Photo,
});

export default ConverterStudioSettingsPage;
