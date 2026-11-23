import type { Logger } from '@medusajs/framework/types';
import { MedusaService } from '@medusajs/framework/utils';
import { ConverterStudioClient, type AccountView } from '../../lib/client';
import { convertImage, type ImageOutcome } from '../../lib/convert-image';
import { ConverterStudioError, ERROR_TEXT, type ErrorCode } from '../../lib/errors';
import {
  publicOptions,
  resolveOptions,
  type ConverterStudioPluginOptions,
  type ResolvedOptions,
} from '../../lib/options';
import ImageConversion from './models/image-conversion';

type InjectedDependencies = { logger: Logger };

/** After running out of credits, automatic conversions wait this long before trying again. */
export const CREDITS_PAUSE_MS = 30 * 60_000;
/** After a key that does not work, automatic conversions wait this long. */
export const AUTH_PAUSE_MS = 10 * 60_000;

/** Why automatic conversions are paused for now, if they are. */
export interface Pause {
  code: ErrorCode;
  until: string;
}

/**
 * The Converter Studio module: the plugin's options, the API client, and the record of every
 * image conversion (`converter_studio_image_conversion`).
 */
export default class ConverterStudioModuleService extends MedusaService({ ImageConversion }) {
  protected readonly options_: ResolvedOptions;
  protected readonly logger_: Logger;
  protected client_: ConverterStudioClient | null;
  private pause_: { code: ErrorCode; until: number } | null = null;

  constructor(container: InjectedDependencies, options?: ConverterStudioPluginOptions) {
    // eslint-disable-next-line prefer-rest-params
    super(...arguments);
    this.logger_ = container.logger;
    this.options_ = resolveOptions(options);
    this.client_ = this.options_.apiKey
      ? new ConverterStudioClient({ apiKey: this.options_.apiKey, apiUrl: this.options_.apiUrl })
      : null;
    if (!this.client_)
      this.logger_.warn(
        "Converter Studio: no API key (set CONVERTER_STUDIO_API_KEY or the plugin's apiKey option); images are not converted.",
      );
  }

  getOptions(): ResolvedOptions {
    return this.options_;
  }

  /** The options as the admin may see them (without the key). */
  getPublicOptions() {
    return publicOptions(this.options_);
  }

  isConfigured(): boolean {
    return this.client_ !== null;
  }

  /** The account's plan and credits. */
  async getAccount(): Promise<AccountView> {
    if (!this.client_) throw new ConverterStudioError('notConfigured', ERROR_TEXT.notConfigured);
    try {
      const account = await this.client_.account();
      if (this.pause_?.code === 'invalidApiKey') this.pause_ = null;
      return account;
    } catch (error) {
      if (error instanceof ConverterStudioError) this.notePause(error.code);
      throw error;
    }
  }

  /** Converts one image by its URL (the bytes of the result are not stored here). */
  async convertImageUrl(url: string): Promise<ImageOutcome> {
    if (!this.client_) throw new ConverterStudioError('notConfigured', ERROR_TEXT.notConfigured);
    return convertImage({ client: this.client_ }, url, this.options_);
  }

  /** Remembers that the account is out of credits or the key fails, so automatic runs wait. */
  notePause(code: ErrorCode): void {
    const now = Date.now();
    if (code === 'notEnoughCredits' || code === 'dailyLimit' || code === 'monthlyLimit') {
      if (!this.pause_ || this.pause_.until < now)
        this.logger_.warn(
          `Converter Studio: ${ERROR_TEXT[code]} Originals are kept; automatic conversions pause for 30 minutes. More credits: https://converter.studio/pricing`,
        );
      this.pause_ = { code, until: now + CREDITS_PAUSE_MS };
    } else if (code === 'invalidApiKey') {
      if (!this.pause_ || this.pause_.until < now)
        this.logger_.error(
          `Converter Studio: ${ERROR_TEXT.invalidApiKey} Create a key at https://converter.studio/account#api-keys`,
        );
      this.pause_ = { code, until: now + AUTH_PAUSE_MS };
    }
  }

  /** Clears the pause (a conversion went through). */
  clearPause(): void {
    this.pause_ = null;
  }

  /** Why automatic conversions are paused, or `null`. */
  getPause(): Pause | null {
    if (!this.pause_ || this.pause_.until < Date.now()) return null;
    return { code: this.pause_.code, until: new Date(this.pause_.until).toISOString() };
  }
}
