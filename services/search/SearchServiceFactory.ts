import { PlatformSearchConfig, PlatformSearchServiceInterface } from './platforms/PlatformSearchServiceInterface';
import { SearchServiceInterface } from './SearchServiceInterface';
import { CompositeSearchService } from './platforms/CompositeSearchService';
import { ShopifySearchService } from './platforms/ShopifySearchService';
import { BigCommerceSearchService } from './platforms/BigCommerceSearchService';
import { WooCommerceSearchService } from './platforms/WooCommerceSearchService';
import { WixSearchService } from './platforms/WixSearchService';
import { SyliusSearchService } from './platforms/SyliusSearchService';
import { MagentoSearchService } from './platforms/MagentoSearchService';
import { OfflineSearchService } from './platforms/OfflineSearchService';
import { CommerceFullSearchService } from './platforms/CommerceFullSearchService';

/**
 * Factory for creating and managing search service instances.
 * This follows the same pattern as PaymentService and RefundService
 * but directly manages search capabilities without dependency on ecommerce service.
 */
export class SearchServiceFactory {
  private static instance: SearchServiceFactory | null = null;
  private service: SearchServiceInterface | null = null;

  private constructor() {
    // No longer depends on ecommerceFactory
  }

  /**
   * Get the singleton instance of the search service factory.
   */
  public static getInstance(): SearchServiceFactory {
    if (!SearchServiceFactory.instance) {
      SearchServiceFactory.instance = new SearchServiceFactory();
    }
    return SearchServiceFactory.instance;
  }

  /**
   * Get the current search service instance.
   * This will create a new instance if one doesn't exist yet.
   */
  public getService(): SearchServiceInterface {
    if (!this.service) {
      // Determine which platform to use based on environment or settings
      const platformServices = this.createPlatformServices();

      // Create a composite service with all available platform services
      this.service = new CompositeSearchService(platformServices);
      this.service.initialize();
    }

    return this.service;
  }

  /**
   * Configure the service with custom API credentials
   * @param platformConfigs Platform-specific configurations
   */
  public configureService(platformConfigs: Record<string, PlatformSearchConfig>): void {
    // Create platform services with the provided configurations
    const platformServices: PlatformSearchServiceInterface[] = [];

    // Create Shopify service if config is provided
    if (platformConfigs.shopify) {
      const shopifyConfig = platformConfigs.shopify || {};
      platformServices.push(new ShopifySearchService(shopifyConfig));
    }

    // Create BigCommerce service if config is provided
    if (platformConfigs.bigcommerce) {
      const bigCommerceConfig = platformConfigs.bigcommerce || {};
      platformServices.push(new BigCommerceSearchService(bigCommerceConfig));
    }

    // Create WooCommerce service if config is provided
    if (platformConfigs.woocommerce) {
      const wooCommerceConfig = platformConfigs.woocommerce || {};
      platformServices.push(new WooCommerceSearchService(wooCommerceConfig));
    }

    // Create Wix service if config is provided
    if (platformConfigs.wix) {
      const wixConfig = platformConfigs.wix || {};
      platformServices.push(new WixSearchService(wixConfig));
    }

    // Create Sylius service if config is provided
    if (platformConfigs.sylius) {
      const syliusConfig = platformConfigs.sylius || {};
      platformServices.push(new SyliusSearchService(syliusConfig));
    }

    // Create Magento service if config is provided
    if (platformConfigs.magento) {
      const magentoConfig = platformConfigs.magento || {};
      platformServices.push(new MagentoSearchService(magentoConfig));
    }

    // PrestaShop and Squarespace use the offline search service (no dedicated search implementation)
    if (platformConfigs.prestashop) {
      platformServices.push(new OfflineSearchService() as unknown as PlatformSearchServiceInterface);
    }

    if (platformConfigs.squarespace) {
      platformServices.push(new OfflineSearchService() as unknown as PlatformSearchServiceInterface);
    }

    // Create CommerceFull service if config is provided
    if (platformConfigs.commercefull) {
      const commerceFullConfig = platformConfigs.commercefull || {};
      platformServices.push(new CommerceFullSearchService(commerceFullConfig));
    }

    // Create Offline service if config is provided
    if (platformConfigs.offline) {
      platformServices.push(new OfflineSearchService() as unknown as PlatformSearchServiceInterface);
    }

    // Create a new composite service with configured platforms
    this.service = new CompositeSearchService(platformServices);
    this.service.initialize();
  }

  /**
   * Create platform-specific search services based on available configuration
   */
  private createPlatformServices() {
    const platformServices: PlatformSearchServiceInterface[] = [];

    // Check for Shopify configuration
    const hasShopifyConfig = process.env.SHOPIFY_API_KEY && process.env.SHOPIFY_ACCESS_TOKEN;
    if (hasShopifyConfig) {
      // Create a configuration object with environment variables
      const shopifyConfig = {
        apiKey: process.env.SHOPIFY_API_KEY || '',
        accessToken: process.env.SHOPIFY_ACCESS_TOKEN || '',
        storeUrl: process.env.SHOPIFY_STORE_URL || '',
      };
      platformServices.push(new ShopifySearchService(shopifyConfig));
    }

    // Check for BigCommerce configuration
    const hasBigCommerceConfig =
      process.env.BIGCOMMERCE_CLIENT_ID && process.env.BIGCOMMERCE_API_TOKEN && process.env.BIGCOMMERCE_STORE_HASH;
    if (hasBigCommerceConfig) {
      // Create a configuration object with environment variables
      const bigCommerceConfig = {
        clientId: process.env.BIGCOMMERCE_CLIENT_ID || '',
        apiToken: process.env.BIGCOMMERCE_API_TOKEN || '',
        storeHash: process.env.BIGCOMMERCE_STORE_HASH || '',
        apiVersion: process.env.BIGCOMMERCE_API_VERSION || 'v3',
      };
      platformServices.push(new BigCommerceSearchService(bigCommerceConfig));
    }

    // Check for WooCommerce configuration
    const hasWooCommerceConfig =
      (process.env.WOOCOMMERCE_CONSUMER_KEY || process.env.WOOCOMMERCE_KEY) &&
      (process.env.WOOCOMMERCE_CONSUMER_SECRET || process.env.WOOCOMMERCE_SECRET);
    if (hasWooCommerceConfig) {
      const wooCommerceConfig = {
        consumerKey: process.env.WOOCOMMERCE_CONSUMER_KEY || process.env.WOOCOMMERCE_KEY || '',
        consumerSecret: process.env.WOOCOMMERCE_CONSUMER_SECRET || process.env.WOOCOMMERCE_SECRET || '',
        storeUrl: process.env.WOOCOMMERCE_URL || '',
      };
      platformServices.push(new WooCommerceSearchService(wooCommerceConfig));
    }

    // Check for Wix configuration
    const hasWixConfig = process.env.WIX_API_KEY && process.env.WIX_SITE_ID;
    if (hasWixConfig) {
      const wixConfig = {
        apiKey: process.env.WIX_API_KEY || '',
        siteId: process.env.WIX_SITE_ID || '',
        accountId: process.env.WIX_ACCOUNT_ID || '',
      };
      platformServices.push(new WixSearchService(wixConfig));
    }

    // Check for Sylius configuration — access token alone is sufficient
    const hasSyliusConfig = process.env.SYLIUS_API_URL && (process.env.SYLIUS_ACCESS_TOKEN || process.env.SYLIUS_API_KEY);
    if (hasSyliusConfig) {
      const syliusConfig = {
        apiUrl: process.env.SYLIUS_API_URL || '',
        accessToken: process.env.SYLIUS_ACCESS_TOKEN || '',
        apiKey: process.env.SYLIUS_API_KEY || '',
        apiSecret: process.env.SYLIUS_API_SECRET || '',
      };
      platformServices.push(new SyliusSearchService(syliusConfig));
    }

    // Check for Magento configuration
    const hasMagentoConfig = process.env.MAGENTO_STORE_URL && process.env.MAGENTO_USERNAME && process.env.MAGENTO_PASSWORD;
    if (hasMagentoConfig) {
      const magentoConfig = {
        storeUrl: process.env.MAGENTO_STORE_URL || '',
        username: process.env.MAGENTO_USERNAME || '',
        password: process.env.MAGENTO_PASSWORD || '',
      };
      platformServices.push(new MagentoSearchService(magentoConfig));
    }

    // PrestaShop and Squarespace don't have dedicated search services;
    // they use the offline search service which searches local product data.

    return platformServices;
  }
}
