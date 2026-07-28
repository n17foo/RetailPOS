import { CustomerServiceInterface } from './CustomerServiceInterface';
import { ShopifyCustomerService } from './platforms/ShopifyCustomerService';
import { WooCommerceCustomerService } from './platforms/WooCommerceCustomerService';
import { BigCommerceCustomerService } from './platforms/BigCommerceCustomerService';
import { MagentoCustomerService } from './platforms/MagentoCustomerService';
import { SyliusCustomerService } from './platforms/SyliusCustomerService';
import { WixCustomerService } from './platforms/WixCustomerService';
import { PrestaShopCustomerService } from './platforms/PrestaShopCustomerService';
import { SquarespaceCustomerService } from './platforms/SquarespaceCustomerService';
import { CommerceFullCustomerService } from './platforms/CommerceFullCustomerService';
import { ECommercePlatform, isOnlinePlatform } from '../../utils/platforms';
import { LoggerFactory } from '../logger/LoggerFactory';

/**
 * Factory for creating platform-specific customer service instances.
 * Customer data lives on the platform — the POS only reads it.
 * Returns null for offline mode (no customer service needed).
 */
export class CustomerServiceFactory {
  private static instance: CustomerServiceFactory;
  private logger = LoggerFactory.getInstance().createLogger('CustomerServiceFactory');

  private services: Map<ECommercePlatform, CustomerServiceInterface> = new Map();

  private constructor() {}

  static getInstance(): CustomerServiceFactory {
    if (!CustomerServiceFactory.instance) {
      CustomerServiceFactory.instance = new CustomerServiceFactory();
    }
    return CustomerServiceFactory.instance;
  }

  /**
   * Get a customer service for the given platform.
   * Returns null for offline or unsupported platforms.
   */
  getService(platform?: ECommercePlatform): CustomerServiceInterface | null {
    if (!platform || !isOnlinePlatform(platform)) {
      return null;
    }

    if (this.services.has(platform)) {
      return this.services.get(platform)!;
    }

    let service: CustomerServiceInterface | null;

    switch (platform) {
      case ECommercePlatform.SHOPIFY:
        service = new ShopifyCustomerService();
        break;
      case ECommercePlatform.WOOCOMMERCE:
        service = new WooCommerceCustomerService();
        break;
      case ECommercePlatform.BIGCOMMERCE:
        service = new BigCommerceCustomerService();
        break;
      case ECommercePlatform.MAGENTO:
        service = new MagentoCustomerService();
        break;
      case ECommercePlatform.SYLIUS:
        service = new SyliusCustomerService();
        break;
      case ECommercePlatform.WIX:
        service = new WixCustomerService();
        break;
      case ECommercePlatform.PRESTASHOP:
        service = new PrestaShopCustomerService();
        break;
      case ECommercePlatform.SQUARESPACE:
        service = new SquarespaceCustomerService();
        break;
      case ECommercePlatform.COMMERCEFULL:
        service = new CommerceFullCustomerService();
        break;
      default:
        return null;
    }

    if (service) {
      service.initialize().catch(err => {
        this.logger.error(
          { message: `Failed to initialize ${platform} customer service` },
          err instanceof Error ? err : new Error(String(err))
        );
      });
      this.services.set(platform, service);
    }

    return service;
  }

  /** Reset all cached service instances (for tests). */
  reset(): void {
    this.services.clear();
  }
}

export const customerServiceFactory = CustomerServiceFactory.getInstance();
