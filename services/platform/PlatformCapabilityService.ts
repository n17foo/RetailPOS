/**
 * PlatformCapabilityService
 *
 * Runtime facade for reading the selected platform's capability profile.
 * Reads the persisted e-commerce settings to determine the active platform,
 * then exposes typed capability helpers used by navigation composers and
 * service guards.
 *
 * This is a singleton — call PlatformCapabilityService.getInstance().
 */

import { ECommercePlatform } from '../../utils/platforms';
import {
  PlatformCapabilities,
  CapabilityLevel,
  getPlatformCapabilities,
  supportsStrict,
  supportsWithCustom,
  isNotRecommended,
  getUnavailableReason,
} from '../../utils/platformCapabilities';
import { getPlatformDisplayName } from '../../utils/platforms';
import { keyValueRepository } from '../../repositories/KeyValueRepository';
import { LoggerFactory } from '../logger/LoggerFactory';

const ECOMMERCE_SETTINGS_KEY = 'ecommerceSettings';
type CapabilityFeature = Exclude<keyof PlatformCapabilities, 'basketMode'>;

export class PlatformCapabilityService {
  private static instance: PlatformCapabilityService;
  private logger = LoggerFactory.getInstance().createLogger('PlatformCapabilityService');

  /** Cached platform resolved from storage. Null until first load. */
  private cachedPlatform: ECommercePlatform | null = null;

  /** Loading flag — true during initial load, false after completion */
  private isLoading = true;

  private constructor() {}

  public static getInstance(): PlatformCapabilityService {
    if (!PlatformCapabilityService.instance) {
      PlatformCapabilityService.instance = new PlatformCapabilityService();
    }
    return PlatformCapabilityService.instance;
  }

  /**
   * Load the active platform from persisted e-commerce settings.
   * Call this once at app startup (e.g. in ServiceConfigBridge.configureFromStorage).
   */
  public async loadFromStorage(): Promise<void> {
    this.isLoading = true;
    try {
      const settings = await keyValueRepository.getObject<{ platform?: string }>(ECOMMERCE_SETTINGS_KEY);
      const platform = (settings?.platform ?? ECommercePlatform.OFFLINE) as ECommercePlatform;
      this.cachedPlatform = platform;
      this.logger.info({ message: `Platform capability loaded: ${platform}` });
    } catch (err) {
      this.logger.warn({ message: 'Failed to load platform from storage, defaulting to offline', ...(err as Record<string, unknown>) });
      this.cachedPlatform = ECommercePlatform.OFFLINE;
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Override the cached platform (e.g. after the user changes platform in settings).
   */
  public setPlatform(platform: ECommercePlatform | string): void {
    this.cachedPlatform = platform as ECommercePlatform;
    this.isLoading = false; // Mark as loaded when explicitly set
  }

  /**
   * Returns true while the initial load is in progress.
   * While loading, getPlatform() returns OFFLINE as a least-privilege default.
   */
  public getIsLoading(): boolean {
    return this.isLoading;
  }

  /**
   * The currently active platform.
   * Returns OFFLINE while loading (least-privilege default per spec §3.7).
   */
  public getPlatform(): ECommercePlatform {
    if (this.isLoading) {
      return ECommercePlatform.OFFLINE;
    }
    return this.cachedPlatform ?? ECommercePlatform.OFFLINE;
  }

  /**
   * Full capability profile for the active platform.
   */
  public getCapabilities(): PlatformCapabilities {
    return getPlatformCapabilities(this.getPlatform());
  }

  /**
   * Capability level for a specific feature.
   */
  public getFeatureLevel(feature: CapabilityFeature): CapabilityLevel {
    return this.getCapabilities()[feature];
  }

  /**
   * True only when the feature is fully supported (no custom adapter needed).
   */
  public supportsStrict(feature: CapabilityFeature): boolean {
    return supportsStrict(this.getCapabilities(), feature);
  }

  /**
   * True when the feature is supported or available via a custom adapter.
   */
  public supportsWithCustom(feature: CapabilityFeature): boolean {
    return supportsWithCustom(this.getCapabilities(), feature);
  }

  /**
   * True when the feature is explicitly not recommended for this platform.
   */
  public isNotRecommended(feature: CapabilityFeature): boolean {
    return isNotRecommended(this.getCapabilities(), feature);
  }

  /**
   * Human-readable reason string for why a feature is unavailable.
   */
  public getUnavailableReason(feature: CapabilityFeature): string {
    return getUnavailableReason(this.getCapabilities(), feature, getPlatformDisplayName(this.getPlatform()));
  }

  /**
   * Emit a startup summary of enabled/disabled features for the active platform.
   * Call this after loadFromStorage() to aid debugging.
   */
  public logCapabilitySummary(): void {
    const caps = this.getCapabilities();
    const platform = this.getPlatform();
    const summary = Object.entries(caps)
      .map(([k, v]) => `  ${k}: ${v}`)
      .join('\n');
    this.logger.info({ message: `Capability summary for ${platform}:\n${summary}` });
  }
}

/** Convenience singleton export */
export const platformCapabilityService = PlatformCapabilityService.getInstance();
