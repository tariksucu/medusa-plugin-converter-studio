import { randomUUID } from 'node:crypto';

/**
 * Products whose images are being converted in this process right now, so the admin can show
 * it (rows marked "processing" cover other processes).
 */
const running = new Map<string, number>();

export function startRun(productId: string): void {
  running.set(productId, (running.get(productId) ?? 0) + 1);
}

export function endRun(productId: string): void {
  const count = (running.get(productId) ?? 1) - 1;
  if (count > 0) running.set(productId, count);
  else running.delete(productId);
}

export const isRunning = (productId: string): boolean => running.has(productId);

/** The start of the event group ids of the plugin's own workflow runs. */
const OWN_EVENT_GROUP = 'converter-studio-';

/**
 * The context of one of the plugin's own workflow runs. The events its product update emits
 * (`product.updated`) carry this event group id, so the automatic conversion skips them: putting
 * a converted or restored image in place must not start converting the product's other images
 * (a sample, or one image converted by hand, would otherwise spend credits on all of them).
 * The id travels with the event, so this holds with Redis and separate worker processes too.
 */
export const ownRunContext = () => ({ eventGroupId: `${OWN_EVENT_GROUP}${randomUUID()}` });

/** Whether an event comes from one of the plugin's own runs. */
export const isOwnEvent = (metadata: { eventGroupId?: unknown } | null | undefined): boolean =>
  typeof metadata?.eventGroupId === 'string' && metadata.eventGroupId.startsWith(OWN_EVENT_GROUP);
