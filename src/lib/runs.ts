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
