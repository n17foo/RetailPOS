import { PaymentServiceInterface } from './PaymentServiceInterface';
import { LoggerFactory } from '../logger/LoggerFactory';
import { USE_MOCK_PAYMENT } from '@env';
import Constants from 'expo-constants';
import { MockPaymentService } from './mock/MockPaymentService';
import { InstoreApiPaymentService } from '../instoreapi/payment/InstoreApiPaymentService';

/**
 * Available payment providers.
 *
 * SDK providers ship a React Native SDK for contactless (tap-to-pay)
 * payments on mobile / tablet.
 *
 * INSTORE_API routes payments through the store-api's payment orchestration
 * layer for PED providers that do NOT have a React Native SDK (Worldpay,
 * Worldline, Global Payments, Nexi, Elavon, Fiserv, and Adyen Terminal API
 * via Cloud). See ADR-015.
 */
export enum PaymentProvider {
  STRIPE_NFC = 'stripe_nfc',
  STRIPE = 'stripe',
  SQUARE = 'square',
  ADYEN = 'adyen',
  TAP_PAYMENTS = 'tap_payments',
  INSTORE_API = 'instore_api',
}

/** Returns true when the app is running inside Expo Go (no native modules). */
function isExpoGo(): boolean {
  return Constants.appOwnership === 'expo';
}

/** Returns true when mock mode is explicitly requested via the environment. */
function isMockMode(): boolean {
  return USE_MOCK_PAYMENT === 'true';
}

/**
 * Singleton factory that resolves the active PaymentServiceInterface
 * implementation based on the configured provider and runtime environment.
 *
 * Resolution order:
 *   1. Expo Go or USE_MOCK_PAYMENT=true  → MockPaymentService (all providers)
 *   2. Production build                  → real SDK service for currentProvider
 *
 * Square, Adyen, and Tap Payments are lazy-loaded via require() to avoid
 * bundling their SDKs on platforms where they are not used.
 */
export class PaymentServiceFactory {
  private static instance: PaymentServiceFactory;
  private currentProvider: PaymentProvider = PaymentProvider.STRIPE_NFC;
  private readonly logger = LoggerFactory.getInstance().createLogger('PaymentServiceFactory');

  private constructor() {}

  public static getInstance(): PaymentServiceFactory {
    if (!PaymentServiceFactory.instance) {
      PaymentServiceFactory.instance = new PaymentServiceFactory();
    }
    return PaymentServiceFactory.instance;
  }

  /**
   * Returns the PaymentServiceInterface implementation for the current provider.
   *
   * @throws {Error} 'Failed to initialize payment service: <message>' when the
   *   provider service cannot be instantiated.
   */
  public getPaymentService(): PaymentServiceInterface {
    this.logger.info(`Resolving payment service (provider=${this.currentProvider}, mock=${isMockMode()}, expoGo=${isExpoGo()})`);

    try {
      // Expo Go and explicit mock mode both use the single MockPaymentService.
      if (isExpoGo() || isMockMode()) {
        this.logger.info('Mock mode active — returning MockPaymentService');
        return MockPaymentService.getInstance();
      }

      switch (this.currentProvider) {
        case PaymentProvider.STRIPE_NFC:
          return require('./StripeNfcService').StripeNfcService.getInstance();

        case PaymentProvider.STRIPE:
          return require('./StripeService').StripeService.getInstance();

        case PaymentProvider.SQUARE:
          return this.loadWithMockFallback(() => require('./SquareService').SquareService.getInstance(), 'Square');

        case PaymentProvider.ADYEN:
          return this.loadWithMockFallback(() => require('./AdyenService').AdyenService.getInstance(), 'Adyen');

        case PaymentProvider.TAP_PAYMENTS:
          return this.loadWithMockFallback(() => require('./TapPaymentsService').TapPaymentsService.getInstance(), 'TapPayments');

        case PaymentProvider.INSTORE_API:
          return this.getInstoreApiPaymentService();

        default: {
          // TypeScript exhaustiveness guard — should never reach here at runtime
          // if callers only pass valid PaymentProvider values.
          const unsupported: never = this.currentProvider;
          throw new Error(`Unsupported payment provider: ${unsupported}`);
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error({ message: 'Failed to initialize payment service' }, error instanceof Error ? error : new Error(msg));
      throw new Error(`Failed to initialize payment service: ${msg}`, { cause: error });
    }
  }

  /**
   * Returns the InstoreApiPaymentService singleton.
   * Used for PED providers routed through the store-api.
   */
  private instoreApiService: InstoreApiPaymentService | null = null;
  private getInstoreApiPaymentService(): PaymentServiceInterface {
    if (!this.instoreApiService) {
      this.instoreApiService = new InstoreApiPaymentService();
    }
    return this.instoreApiService;
  }

  /**
   * Attempts to load a real SDK service via the provided factory function.
   * Falls back to MockPaymentService and logs a warning if the load fails
   * (e.g. native module not available on the current platform).
   */
  private loadWithMockFallback(factory: () => PaymentServiceInterface, providerName: string): PaymentServiceInterface {
    try {
      return factory();
    } catch (error) {
      this.logger.warn(
        { message: `${providerName} SDK not available — falling back to MockPaymentService` },
        error instanceof Error ? error : new Error(String(error))
      );
      return MockPaymentService.getInstance();
    }
  }

  /**
   * Switches the active provider.
   *
   * @throws {Error} 'Unsupported payment provider: <value>' when the value is
   *   not a member of the PaymentProvider enum.
   */
  public setPaymentProvider(provider: PaymentProvider): void {
    if (!Object.values(PaymentProvider).includes(provider)) {
      throw new Error(`Unsupported payment provider: ${provider}`);
    }
    this.currentProvider = provider;
    this.logger.info(`Payment provider set to: ${provider}`);
  }

  /** Returns the currently configured provider. */
  public getCurrentProvider(): PaymentProvider {
    return this.currentProvider;
  }
}
