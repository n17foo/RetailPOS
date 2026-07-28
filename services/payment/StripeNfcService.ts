import { PaymentRequest, PaymentResponse, PaymentServiceInterface } from './PaymentServiceInterface';
import { Platform } from 'react-native';
import { keyValueRepository } from '../../repositories/KeyValueRepository';
import { StripeTerminalBridgeManager } from '../../contexts/StripeTerminalBridge';
import { LoggerFactory } from '../logger/LoggerFactory';
import { StripeApiClient } from '../clients/stripe/StripeApiClient';

/**
 * Implementation of Stripe NFC Tap to Pay service
 * Uses Stripe's mobile SDK for contactless NFC payments
 */
export class StripeNfcService implements PaymentServiceInterface {
  private static instance: StripeNfcService;
  private isConnected: boolean = false;
  private deviceId: string | null = null;
  private currentTransactionId: string | null = null;
  private isInitialized: boolean = false;
  private logger = LoggerFactory.getInstance().createLogger('StripeNfcService');

  private constructor() {
    this.logger.info('Stripe NFC Tap to Pay service initialized');
    // Only initialize on supported platforms (iOS 15.4+ or Android 11+)
    if (this.isPlatformSupported()) {
      this.initializeStripeSDK();
    } else {
      this.logger.warn('Stripe NFC is not supported on this device');
    }
  }

  /**
   * Check if the current platform supports NFC payments
   */
  private isPlatformSupported(): boolean {
    if (Platform.OS === 'ios') {
      const iosVersion = parseInt(Platform.Version, 10);
      return iosVersion >= 15.4; // iOS 15.4+ supports tap to pay
    } else if (Platform.OS === 'android') {
      return Platform.Version >= 30; // Android 11+ (API 30)
    }
    return false;
  }

  public static getInstance(): StripeNfcService {
    if (!StripeNfcService.instance) {
      StripeNfcService.instance = new StripeNfcService();
    }
    return StripeNfcService.instance;
  }

  /**
   * Initialize the Stripe SDK with API keys
   */
  private initializeStripeSDK = async (): Promise<boolean> => {
    try {
      this.logger.info('Initializing Stripe Terminal SDK...');

      // Check if the bridge is initialized and available
      const bridgeManager = StripeTerminalBridgeManager.getInstance();

      if (!bridgeManager.bridge) {
        this.logger.warn('Stripe Terminal Bridge is not yet initialized in React context');
        this.logger.warn('Make sure StripeTerminalBridgeProvider is added to your App component');
        throw new Error('Stripe Terminal Bridge not available');
      }

      // Use the bridge to initialize the SDK
      // The actual SDK initialization happens in the React component via the Provider
      if (bridgeManager.isTerminalInitialized()) {
        this.logger.info('Stripe Terminal SDK already initialized');
        this.isInitialized = true;
        return true;
      }

      // If not initialized, try to initialize it
      const initSuccess = await bridgeManager.bridge.actions.initialize();
      this.isInitialized = initSuccess;
      return initSuccess;
    } catch (error) {
      this.logger.error('Failed to initialize Stripe Terminal SDK:', error instanceof Error ? error : new Error(String(error)));
      this.isInitialized = false;
      return false;
    }
  };

  /**
   * Test connection to the terminal using the current settings
   * Used by the Test Connection button in the settings UI
   */
  public async testTerminalConnection(): Promise<{ success: boolean; message?: string }> {
    try {
      this.logger.info('Testing Stripe NFC terminal connection...');

      // First check if Stripe NFC is enabled in settings
      const enableNfc = (await keyValueRepository.getItem('stripe_nfc_enableNfc')) === 'true';
      if (!enableNfc) {
        return {
          success: false,
          message: 'Stripe NFC is not enabled in settings',
        };
      }

      // Check if platform is supported
      if (!this.isPlatformSupported()) {
        return {
          success: false,
          message: 'This device does not support Stripe NFC Tap to Pay',
        };
      }

      // Try to initialize the SDK
      const initSuccess = await this.initializeStripeSDK();
      if (!initSuccess) {
        return {
          success: false,
          message: 'Failed to initialize Stripe Terminal SDK',
        };
      }

      // Get settings
      const useSimulatedReader = (await keyValueRepository.getItem('stripe_nfc_useSimulatedReader')) === 'true';
      const discoveryMethod = useSimulatedReader ? 'simulated' : 'bluetooth';

      // Try to discover readers
      const bridgeManager = StripeTerminalBridgeManager.getInstance();
      const readers = await bridgeManager.discoverReaders({
        discoveryMethod,
        simulated: useSimulatedReader,
      });

      if (readers && readers.length > 0) {
        return {
          success: true,
          message: `Successfully discovered ${readers.length} reader(s)`,
        };
      } else {
        // No readers found, but we were able to search, which means the SDK is working
        return {
          success: true,
          message: 'Connection test successful but no readers found. Make sure a reader is powered on and nearby.',
        };
      }
    } catch (error: unknown) {
      this.logger.error('Test connection error:', error as Error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'An unknown error occurred while testing the terminal connection',
      };
    }
  }

  /**
   * Connect to a specific NFC terminal
   * @param deviceId ID of the device to connect to
   * @returns Promise that resolves to true if connected successfully
   */
  async connectToTerminal(deviceId: string): Promise<boolean> {
    try {
      this.logger.info(`Connecting to Stripe NFC reader: ${deviceId}`);

      // Ensure the SDK is initialized
      if (!this.isInitialized) {
        const initSuccess = await this.initializeStripeSDK();
        if (!initSuccess) {
          throw new Error('Failed to initialize Stripe Terminal SDK');
        }
      }

      // Use the bridge manager to connect to the reader
      const bridgeManager = StripeTerminalBridgeManager.getInstance();
      const success = await bridgeManager.connectToReader(deviceId);

      if (success) {
        this.deviceId = deviceId;
        this.isConnected = true;
        this.logger.info(`Connected to NFC reader: ${deviceId}`);
      } else {
        throw new Error('Failed to connect to reader');
      }

      return success;
    } catch (error) {
      this.logger.error('Error connecting to Stripe NFC reader:', error instanceof Error ? error : new Error(String(error)));
      this.isConnected = false;
      this.deviceId = null;
      return false;
    }
  }

  /**
   * Process a payment using Stripe NFC
   * @param request Payment request details
   * @returns Promise with payment response
   */
  async processPayment(request: PaymentRequest): Promise<PaymentResponse> {
    try {
      this.logger.info('Processing payment via Stripe NFC:', request);

      // Check if Stripe NFC is enabled
      const enableNfc = (await keyValueRepository.getItem('stripe_nfc_enableNfc')) === 'true';
      if (!enableNfc) {
        throw new Error('Stripe NFC is not enabled in settings');
      }

      // First check platform support
      if (!this.isPlatformSupported()) {
        throw new Error('This device does not support Stripe NFC Tap to Pay');
      }

      // Ensure the reader is connected, or try to connect if a previous connection exists
      if (!this.isConnected) {
        // If we have a known device ID, try to reconnect to it
        if (this.deviceId) {
          this.logger.info(`Attempting to reconnect to previous NFC reader: ${this.deviceId}`);
          const reconnectSuccess = await this.connectToTerminal(this.deviceId);
          if (!reconnectSuccess) {
            throw new Error('Failed to reconnect to NFC reader');
          }
        } else {
          // Try to discover and connect to the first available reader
          this.logger.info('No reader connected, attempting to discover and connect');

          // Ensure the SDK is initialized
          if (!this.isInitialized) {
            const initSuccess = await this.initializeStripeSDK();
            if (!initSuccess) {
              throw new Error('Failed to initialize Stripe Terminal SDK');
            }
          }

          // Get settings
          const useSimulatedReader = (await keyValueRepository.getItem('stripe_nfc_useSimulatedReader')) === 'true';
          const discoveryMethod = useSimulatedReader ? 'simulated' : 'bluetooth';

          // Try to discover readers
          const bridgeManager = StripeTerminalBridgeManager.getInstance();
          const readers = await bridgeManager.discoverReaders({
            discoveryMethod,
            simulated: useSimulatedReader,
          });

          if (readers && readers.length > 0) {
            // Connect to the first reader
            const connectSuccess = await this.connectToTerminal(String(readers[0].id));
            if (!connectSuccess) {
              throw new Error('Failed to connect to discovered reader');
            }
          } else {
            throw new Error('No NFC readers discovered');
          }
        }
      }

      // At this point, we should be connected to a reader
      if (!this.isConnected || !this.deviceId) {
        throw new Error('NFC reader connection failed');
      }

      // Prepare payment request with proper metadata
      const paymentRequest = {
        amount: request.amount,
        currency: request.currency || 'usd',
        description: request.reference ? `Order ${request.reference}` : 'RetailPOS Payment',
        metadata: {
          reference: request.reference || '',
          orderId: request.orderId || '',
          customerName: request.customerName || '',
          items: request.itemCount?.toString() || '0',
        },
      };

      this.logger.info('Sending payment request to terminal:', paymentRequest);

      // Use the bridge manager to process the payment
      const bridgeManager = StripeTerminalBridgeManager.getInstance();
      // Explicitly type the result as our enhanced PaymentResponse
      const result: PaymentResponse = await bridgeManager.processPayment(paymentRequest);

      // Check for common errors and handle them appropriately
      if (!result.success) {
        if (result.errorCode === 'card_declined') {
          const response: PaymentResponse = {
            success: false,
            errorMessage: 'Card was declined. Please try another payment method.',
            errorCode: 'card_declined',
            timestamp: new Date(),
          };
          return response;
        } else if (result.errorCode === 'connection_error') {
          // Connection issue - set state to disconnected
          this.isConnected = false;
          this.deviceId = null;
          throw new Error('Lost connection to terminal during payment');
        } else {
          throw new Error(result.errorMessage || 'Payment processing failed');
        }
      }

      // Store the transaction ID for future reference
      this.currentTransactionId = result.transactionId || null;

      // Return a successful payment response with proper type
      return {
        success: true,
        transactionId: result.transactionId!,
        timestamp: new Date(), // Timestamp is required by the interface
        receiptNumber: result.receiptNumber || `RCPT-${Date.now().toString().slice(-8)}`,
        paymentMethod: result.paymentMethod || 'contactless',
        cardBrand: result.cardBrand || 'unknown',
        last4: result.last4 || 'xxxx',
        amount: request.amount,
      } as PaymentResponse; // Explicitly cast to ensure TypeScript recognizes the type
    } catch (error: unknown) {
      this.logger.error('Error processing Stripe NFC payment:', error as Error);
      const errMsg = error instanceof Error ? error.message : '';

      // Check if this is a terminal connection error
      if (errMsg.includes('connect') || errMsg.includes('terminal') || errMsg.includes('reader')) {
        // Reset connection state on terminal errors
        this.isConnected = false;
        this.deviceId = null;
      }

      // Determine if this was a connection error for more specific error code
      const isConnectionError =
        errMsg.includes('connect') || errMsg.includes('terminal') || errMsg.includes('reader') || errMsg.includes('network');

      // Create a properly formatted error response using our enhanced interface
      return {
        success: false,
        errorMessage: errMsg || 'Failed to process payment',
        errorCode: isConnectionError ? 'connection_error' : 'payment_error',
        timestamp: new Date(),
      };
    }
  }

  /**
   * Disconnect from the NFC reader
   */
  disconnect(): void {
    if (this.isConnected) {
      this.logger.info('Disconnecting from Stripe NFC reader...');

      // Use the bridge manager to disconnect the reader
      try {
        const bridgeManager = StripeTerminalBridgeManager.getInstance();
        bridgeManager.disconnectReader();
      } catch (error) {
        this.logger.error('Error disconnecting from reader:', error as Error);
      } finally {
        this.isConnected = false;
        this.deviceId = null;
        this.logger.info('Disconnected from NFC reader');
      }
    }
  }

  /**
   * Check if connected to an NFC terminal
   */
  isTerminalConnected(): boolean {
    // First check our local state for performance
    if (!this.isConnected) {
      return false;
    }

    // Then double-check with the bridge if available
    try {
      const bridgeManager = StripeTerminalBridgeManager.getInstance();
      return bridgeManager.isReaderConnected();
    } catch (error) {
      this.logger.error('Error checking NFC reader connection:', error as Error);
      // If there's an error accessing the bridge, fall back to our local state
      return this.isConnected;
    }
  }

  /**
   * Get ID of the connected NFC terminal
   */
  getConnectedDeviceId(): string | null {
    return this.deviceId;
  }

  /**
   * Get available NFC terminals
   * @returns Array of terminals { id, name }
   */
  async getAvailableTerminals(): Promise<Array<{ id: string; name: string }>> {
    try {
      // Check platform support first
      if (!this.isPlatformSupported()) {
        this.logger.warn('This device does not support NFC payments');
        return [];
      }

      this.logger.info('Discovering NFC terminals...');

      // Ensure the SDK is initialized
      if (!this.isInitialized) {
        const initSuccess = await this.initializeStripeSDK();
        if (!initSuccess) {
          throw new Error('Failed to initialize Stripe Terminal SDK');
        }
      }

      // Use the bridge manager to discover readers
      const bridgeManager = StripeTerminalBridgeManager.getInstance();
      const readers = await bridgeManager.discoverReaders({
        discoveryMethod: 'bluetoothScan',
        simulated: false,
      });

      // Map the Stripe reader format to our expected format
      return readers.map(reader => ({
        id: reader.serialNumber || '',
        name: reader.deviceType || `NFC Reader ${reader.serialNumber || 'Unknown'}`,
      }));
    } catch (error) {
      this.logger.error('Error discovering NFC readers:', error as Error);
      return [];
    }
  }

  /**
   * Configure the Stripe API client with current settings.
   */
  private async configureStripeClient(): Promise<StripeApiClient> {
    const apiKey = await keyValueRepository.getItem('stripe_nfc_apiKey');
    if (!apiKey) {
      throw new Error('Stripe API key not configured');
    }
    const backendUrl = (await keyValueRepository.getItem('stripe_nfc_backendUrl')) || undefined;
    const client = StripeApiClient.getInstance();
    client.configure({ apiKey, backendUrl, storeUrl: 'https://api.stripe.com' });
    return client;
  }

  /**
   * Get raw transaction data from Stripe API (internal use)
   */
  private async getRawTransactionStatus(transactionId: string): Promise<Record<string, unknown>> {
    const client = await this.configureStripeClient();

    const bridgeManager = StripeTerminalBridgeManager.getInstance();
    if (bridgeManager.bridge && bridgeManager.isTerminalInitialized()) {
      try {
        return await client.getFromBackend<Record<string, unknown>>(
          `stripe/payment_intent/${transactionId}`,
          `v1/payment_intents/${transactionId}`
        );
      } catch (bridgeError) {
        this.logger.warn('Bridge transaction status check failed, falling back to Stripe API', bridgeError);
      }
    }

    return client.get<Record<string, unknown>>(`v1/payment_intents/${transactionId}`);
  }

  /**
   * Get transaction status by ID
   * @param transactionId ID of transaction to check
   */
  async getTransactionStatus(transactionId: string): Promise<PaymentResponse> {
    try {
      this.logger.info(`Checking status of transaction: ${transactionId}`);
      const raw = await this.getRawTransactionStatus(transactionId);
      return {
        success: raw.status === 'succeeded',
        transactionId: String(raw.id || transactionId),
        timestamp: new Date(),
      };
    } catch (error) {
      this.logger.error('Error checking transaction status:', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Void/cancel a transaction
   * @param transactionId ID of transaction to void
   */
  async voidTransaction(transactionId: string): Promise<PaymentResponse> {
    try {
      this.logger.info(`Voiding transaction: ${transactionId}`);

      // Ensure the SDK is initialized
      if (!this.isInitialized) {
        const initSuccess = await this.initializeStripeSDK();
        if (!initSuccess) {
          throw new Error('Failed to initialize Stripe Terminal SDK');
        }
      }

      // First try using the bridge manager to cancel the payment
      const bridgeManager = StripeTerminalBridgeManager.getInstance();

      // Check if the payment intent is still in a cancelable state
      const rawStatus = await this.getRawTransactionStatus(transactionId);

      // Only proceed with cancellation if the payment is in a cancellable state
      if (
        rawStatus &&
        typeof rawStatus.status === 'string' &&
        ['requires_payment_method', 'requires_confirmation', 'requires_action'].includes(rawStatus.status)
      ) {
        if (bridgeManager.bridge?.actions?.cancelPayment) {
          const success = await bridgeManager.bridge.actions.cancelPayment(transactionId);

          if (success) {
            return {
              success: true,
              transactionId: transactionId,
              timestamp: new Date(),
            };
          }
        }
      }

      // If bridge doesn't work or payment is already processed, try API cancellation
      const client = await this.configureStripeClient();
      const result = await client.postToBackend<{ success?: boolean; status?: string }>(
        'stripe/void_payment',
        `v1/payment_intents/${transactionId}/cancel`,
        { paymentIntentId: transactionId }
      );

      return {
        success: result.success === true || result.status === 'canceled',
        transactionId,
        timestamp: new Date(),
      };
    } catch (error: unknown) {
      this.logger.error('Error voiding transaction:', error as Error);
      return {
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Failed to void transaction',
        timestamp: new Date(),
      };
    }
  }

  /**
   * Process a refund for a transaction
   * @param transactionId ID of the transaction to refund
   * @param amount Amount to refund
   */
  async refundTransaction(transactionId: string, amount: number): Promise<PaymentResponse> {
    try {
      this.logger.info(`Refunding ${amount} for transaction: ${transactionId}`);

      // Ensure the SDK is initialized
      if (!this.isInitialized) {
        const initSuccess = await this.initializeStripeSDK();
        if (!initSuccess) {
          throw new Error('Failed to initialize Stripe Terminal SDK');
        }
      }

      // First try using the bridge manager to process refund
      const bridgeManager = StripeTerminalBridgeManager.getInstance();
      let success = false;
      let refundId = '';

      if (bridgeManager.bridge?.actions?.refundPayment) {
        try {
          success = await bridgeManager.bridge.actions.refundPayment(transactionId, amount);

          if (success) {
            // Generate a temporary refund ID until we get the actual one from the API
            refundId = `rfnd_${transactionId.substring(0, 8)}_${Date.now().toString().slice(-6)}`;
            return {
              success: true,
              transactionId: refundId,
              timestamp: new Date(),
              amount: amount,
            };
          }
        } catch (bridgeError) {
          this.logger.warn('Bridge refund failed, trying API', bridgeError);
        }
      }

      // If bridge doesn't work, try API refund
      const client = await this.configureStripeClient();
      const result = await client.postToBackend<{ success?: boolean; refundId?: string; status?: string; id?: string }>(
        'stripe/refund',
        'v1/refunds',
        { payment_intent: transactionId, amount: Math.round(amount * 100) }
      );

      return {
        success: result.success === true || result.status === 'succeeded',
        transactionId: result.refundId || result.id || transactionId,
        timestamp: new Date(),
        amount,
      };
    } catch (error: unknown) {
      this.logger.error('Error refunding transaction:', error as Error);
      return {
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Failed to process refund',
        timestamp: new Date(),
      };
    }
  }
}
