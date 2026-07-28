import { ECommercePlatform } from '../../utils/platforms';
import { LoggerFactory } from '../logger/LoggerFactory';
import { keyValueRepository } from '../../repositories/KeyValueRepository';
import { SHOPIFY_API_VERSION, COMMERCEFULL_API_VERSION } from './apiVersions';
import { platformCapabilityService } from '../platform/PlatformCapabilityService';

// NOTE: Factory imports are lazy-loaded inside methods to break require cycles.
// The cycle was: ServiceConfigBridge → factory → platform service → ServiceConfigBridge
import type { PlatformProductConfig } from '../product/platforms/PlatformProductServiceInterface';
import type { PlatformOrderConfig } from '../order/platforms/PlatformOrderServiceInterface';
import type { PlatformSearchConfig } from '../search/platforms/PlatformSearchServiceInterface';

/**
 * E-commerce settings structure stored in SQLite
 */
export interface StoredECommerceSettings {
  enabled: boolean;
  platform: string;
  apiUrl: string;
  apiKey: string;
  syncInventory: boolean;
  shopify: {
    apiKey: string;
    accessToken: string;
    storeUrl: string;
  };
  woocommerce: {
    apiKey: string;
    apiSecret: string;
    storeUrl: string;
  };
  magento: {
    accessToken: string;
    storeUrl: string;
    apiVersion: string;
  };
  bigcommerce: {
    clientId: string;
    accessToken: string;
    storeHash: string;
  };
  sylius: {
    apiToken: string;
    storeUrl: string;
    apiVersion: string;
  };
  wix: {
    apiKey: string;
    siteId: string;
    accountId: string;
  };
  prestashop?: {
    apiKey: string;
    storeUrl: string;
  };
  squarespace?: {
    apiKey: string;
    siteId: string;
  };
  commercefull?: {
    apiKey: string;
    apiSecret: string;
    storeUrl: string;
  };
  offline?: {
    storeName: string;
    lastSync: string;
  };
}
export class ServiceConfigBridge {
  private static instance: ServiceConfigBridge;
  private logger: ReturnType<typeof LoggerFactory.prototype.createLogger>;
  private currentSettings: StoredECommerceSettings | null = null;
  private isConfigured: boolean = false;

  private constructor() {
    this.logger = LoggerFactory.getInstance().createLogger('ServiceConfigBridge');
  }

  /**
   * Get the singleton instance
   */
  public static getInstance(): ServiceConfigBridge {
    if (!ServiceConfigBridge.instance) {
      ServiceConfigBridge.instance = new ServiceConfigBridge();
    }
    return ServiceConfigBridge.instance;
  }

  /**
   * Load settings from storage and configure all service factories
   * @returns Promise resolving to true if configuration was successful
   */
  public async configureFromStorage(): Promise<boolean> {
    try {
      this.logger.info('Loading e-commerce settings from storage');

      const settings = await keyValueRepository.getObject<StoredECommerceSettings>('ecommerceSettings');

      if (!settings) {
        this.logger.warn('No e-commerce settings found in storage');
        return false;
      }

      if (!settings.enabled) {
        this.logger.info('E-commerce is disabled in settings');
        return false;
      }

      this.currentSettings = settings;

      // Configure all services based on the selected platform
      await this.configureServicesForPlatform(settings);

      // Warm up the capability service cache and emit a startup summary
      await platformCapabilityService.loadFromStorage();
      platformCapabilityService.logCapabilitySummary();

      this.isConfigured = true;
      this.logger.info(`Services configured for platform: ${settings.platform}`);

      return true;
    } catch (error) {
      this.logger.error({ message: 'Error configuring services from storage' }, error instanceof Error ? error : new Error(String(error)));
      return false;
    }
  }

  /**
   * Configure all service factories for the specified platform
   */
  private async configureServicesForPlatform(settings: StoredECommerceSettings): Promise<void> {
    const platform = this.mapToPlatformEnum(settings.platform);

    if (!platform) {
      this.logger.warn(`Unknown platform: ${settings.platform}`);
      return;
    }

    const config = this.buildPlatformConfig(settings, platform);

    // Configure each factory with the platform-specific settings
    this.configureProductService(platform, config);
    this.configureOrderService(platform, config);
    this.configureSearchService(platform, config);
    this.configureInventoryService(platform, config);
    this.configureCategoryService(platform, config);
    this.configureCustomerService(platform);
    this.configureSyncService(platform, config);
    this.configureRefundService(platform, config);
  }

  /**
   * Map string platform name to ECommercePlatform enum
   */
  private mapToPlatformEnum(platformName: string): ECommercePlatform | null {
    const platformMap: Record<string, ECommercePlatform> = {
      shopify: ECommercePlatform.SHOPIFY,
      woocommerce: ECommercePlatform.WOOCOMMERCE,
      bigcommerce: ECommercePlatform.BIGCOMMERCE,
      magento: ECommercePlatform.MAGENTO,
      sylius: ECommercePlatform.SYLIUS,
      wix: ECommercePlatform.WIX,
      prestashop: ECommercePlatform.PRESTASHOP,
      squarespace: ECommercePlatform.SQUARESPACE,
      commercefull: ECommercePlatform.COMMERCEFULL,
      offline: ECommercePlatform.OFFLINE,
    };

    return platformMap[platformName.toLowerCase()] || null;
  }

  /**
   * Build platform-specific configuration from stored settings
   */
  private buildPlatformConfig(settings: StoredECommerceSettings, platform: ECommercePlatform): Record<string, unknown> {
    switch (platform) {
      case ECommercePlatform.SHOPIFY:
        return {
          apiKey: settings.shopify.apiKey || settings.apiKey,
          accessToken: settings.shopify.accessToken || settings.apiKey,
          storeUrl: settings.shopify.storeUrl || settings.apiUrl,
          apiVersion: SHOPIFY_API_VERSION,
        };

      case ECommercePlatform.WOOCOMMERCE:
        return {
          consumerKey: settings.woocommerce.apiKey || settings.apiKey,
          consumerSecret: settings.woocommerce.apiSecret,
          storeUrl: settings.woocommerce.storeUrl || settings.apiUrl,
        };

      case ECommercePlatform.BIGCOMMERCE:
        return {
          clientId: settings.bigcommerce.clientId,
          accessToken: settings.bigcommerce.accessToken || settings.apiKey,
          storeHash: settings.bigcommerce.storeHash,
        };

      case ECommercePlatform.MAGENTO:
        return {
          accessToken: settings.magento.accessToken || settings.apiKey,
          storeUrl: settings.magento.storeUrl || settings.apiUrl,
          apiVersion: settings.magento.apiVersion,
        };

      case ECommercePlatform.SYLIUS:
        return {
          apiToken: settings.sylius.apiToken || settings.apiKey,
          accessToken: settings.sylius.apiToken || settings.apiKey,
          storeUrl: settings.sylius.storeUrl || settings.apiUrl,
          apiUrl: settings.sylius.storeUrl || settings.apiUrl,
          apiVersion: settings.sylius.apiVersion,
        };

      case ECommercePlatform.WIX:
        return {
          apiKey: settings.wix.apiKey || settings.apiKey,
          siteId: settings.wix.siteId,
          accountId: settings.wix.accountId,
        };

      case ECommercePlatform.PRESTASHOP:
        return {
          apiKey: settings.prestashop?.apiKey || settings.apiKey,
          storeUrl: settings.prestashop?.storeUrl || settings.apiUrl,
        };

      case ECommercePlatform.SQUARESPACE:
        return {
          apiKey: settings.squarespace?.apiKey || settings.apiKey,
          siteId: settings.squarespace?.siteId,
        };

      case ECommercePlatform.COMMERCEFULL:
        return {
          apiKey: settings.commercefull?.apiKey || settings.apiKey,
          apiSecret: settings.commercefull?.apiSecret,
          storeUrl: settings.commercefull?.storeUrl || settings.apiUrl,
          apiVersion: COMMERCEFULL_API_VERSION,
        };

      case ECommercePlatform.OFFLINE:
        return {
          storeName: settings.offline?.storeName,
        };

      default:
        return {
          apiKey: settings.apiKey,
          storeUrl: settings.apiUrl,
        };
    }
  }

  /**
   * Configure ProductServiceFactory with platform settings
   */
  private configureProductService(platform: ECommercePlatform, config: Record<string, unknown>): void {
    const { ProductServiceFactory } = require('../product/ProductServiceFactory');
    const factory = ProductServiceFactory.getInstance();
    factory.configureService(platform, config as PlatformProductConfig);
    this.logger.info(`ProductService configured for ${platform}`);
  }

  /**
   * Configure OrderServiceFactory with platform settings
   */
  private configureOrderService(platform: ECommercePlatform, config: Record<string, unknown>): void {
    const { OrderServiceFactory } = require('../order/OrderServiceFactory');
    const factory = OrderServiceFactory.getInstance();
    factory.configureService(platform, config as PlatformOrderConfig);
    this.logger.info(`OrderService configured for ${platform}`);
  }

  /**
   * Configure SearchServiceFactory with platform settings
   */
  private configureSearchService(platform: ECommercePlatform, config: Record<string, unknown>): void {
    const { SearchServiceFactory } = require('../search/SearchServiceFactory');
    const factory = SearchServiceFactory.getInstance();

    // Build platform-specific search config
    const searchConfigs: Record<string, PlatformSearchConfig> = {};
    searchConfigs[platform] = config as PlatformSearchConfig;

    factory.configureService(searchConfigs);
    this.logger.info(`SearchService configured for ${platform}`);
  }

  /**
   * Configure CategoryServiceFactory — invalidates cached instance so next
   * getService() call picks up the new env-based config.
   */
  private configureCategoryService(platform: ECommercePlatform, config: Record<string, unknown>): void {
    try {
      const { CategoryServiceFactory } = require('../category/CategoryServiceFactory');
      const factory = CategoryServiceFactory.getInstance();
      // Reset the cached instance for this platform so it re-initialises with
      // the correct credentials on next access.
      if (typeof factory.resetService === 'function') {
        factory.resetService(platform);
      }
      this.logger.info(`CategoryService cache cleared for ${platform}`);
    } catch (err) {
      this.logger.warn({ message: `Could not reset CategoryService for ${platform}`, ...(err as Record<string, unknown>) });
    }
    void config; // config used by the service's own initialize() via process.env
  }

  /**
   * Warm up CustomerServiceFactory for the active platform so the first
   * customer lookup doesn't pay the initialisation cost.
   */
  private configureCustomerService(platform: ECommercePlatform): void {
    try {
      const { CustomerServiceFactory } = require('../customer/CustomerServiceFactory');
      CustomerServiceFactory.getInstance().getService(platform);
      this.logger.info(`CustomerService warmed up for ${platform}`);
    } catch (err) {
      this.logger.warn({ message: `Could not warm up CustomerService for ${platform}`, ...(err as Record<string, unknown>) });
    }
  }

  /**
   * Configure InventoryServiceFactory with platform settings
   */
  private configureInventoryService(platform: ECommercePlatform, config: Record<string, unknown>): void {
    const { InventoryServiceFactory } = require('../inventory/InventoryServiceFactory');
    const factory = InventoryServiceFactory.getInstance();
    factory.configureService(platform, config);
    this.logger.info(`InventoryService configured for ${platform}`);
  }

  /**
   * Configure SyncServiceFactory with platform settings
   */
  private configureSyncService(platform: ECommercePlatform, config: Record<string, unknown>): void {
    const { SyncServiceFactory } = require('../sync/SyncServiceFactory');
    const factory = SyncServiceFactory.getInstance();
    factory.configureService(platform, config);
    this.logger.info(`SyncService configured for ${platform}`);
  }

  /**
   * Configure refund service within ReturnService with platform settings
   */
  private configureRefundService(platform: ECommercePlatform, config: Record<string, unknown>): void {
    const { ReturnService } = require('../refunds/RefundService');
    ReturnService.getInstance().configurePlatformRefund(platform, config);
    this.logger.info(`RefundService configured for ${platform}`);
  }

  /**
   * Get the current platform from settings
   */
  public getCurrentPlatform(): ECommercePlatform | null {
    if (!this.currentSettings?.platform) {
      return null;
    }
    return this.mapToPlatformEnum(this.currentSettings.platform);
  }

  /**
   * Get the current settings
   */
  public getCurrentSettings(): StoredECommerceSettings | null {
    return this.currentSettings;
  }

  /**
   * Check if services are configured
   */
  public isServicesConfigured(): boolean {
    return this.isConfigured;
  }

  /**
   * Test connection to the current platform
   * @returns Promise resolving to connection test result
   */
  public async testConnection(): Promise<{ success: boolean; message: string }> {
    if (!this.currentSettings || !this.isConfigured) {
      return {
        success: false,
        message: 'Services are not configured. Please save your settings first.',
      };
    }

    const platform = this.getCurrentPlatform();
    if (!platform) {
      return {
        success: false,
        message: 'Unknown platform configured',
      };
    }

    try {
      // Use the product service to test connection (it has testConnection in the base)
      const { ProductServiceFactory } = require('../product/ProductServiceFactory');
      const productFactory = ProductServiceFactory.getInstance();
      const service = productFactory.getService(platform);

      // Try to fetch a single product as a connection test
      const result = await service.getProducts({ limit: 1 });

      if (result && result.products !== undefined) {
        return {
          success: true,
          message: `Successfully connected to ${platform}. Found ${result.pagination?.totalItems || 0} products.`,
        };
      }

      return {
        success: false,
        message: 'Connection test returned unexpected result',
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error({ message: 'Connection test failed' }, error instanceof Error ? error : new Error(String(error)));

      return {
        success: false,
        message: `Connection failed: ${errorMessage}`,
      };
    }
  }

  /**
   * Reset the configuration
   */
  public reset(): void {
    this.currentSettings = null;
    this.isConfigured = false;
    this.logger.info('ServiceConfigBridge reset');
  }
}
