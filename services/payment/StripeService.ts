import { PaymentRequest, PaymentResponse, PaymentServiceInterface } from './PaymentServiceInterface';
import { LoggerFactory } from '../logger/LoggerFactory';

/**
 * Stripe Payment Terminal Service
 * Implements integration with the Stripe Terminal SDK via the StripeTerminalBridgeManager
 */
export class StripeService implements PaymentServiceInterface {
  private static instance: StripeService;
  private isConnected: boolean = false;
  private deviceId: string | null = null;
  private connectedDevice: unknown = null;
  private logger = LoggerFactory.getInstance().createLogger('StripeService');

  // Store discovered readers cache
  private discoveredReaders: Array<{ id: string; name: string }> = [];

  private constructor() {
    this.logger.info('Stripe payment service created');
  }

  public static getInstance(): StripeService {
    if (!StripeService.instance) {
      StripeService.instance = new StripeService();
    }
    return StripeService.instance;
  }

  /**
   * Connect to a Stripe terminal reader
   * Uses the StripeTerminalBridgeManager to connect to the terminal
   */
  public async connectToTerminal(deviceId: string): Promise<boolean> {
    try {
      this.logger.info(`Connecting to Stripe terminal: ${deviceId}`);

      // Import the bridge manager dynamically to avoid circular dependencies
      const { StripeTerminalBridgeManager } = await import('../../contexts/StripeTerminalBridge');
      const bridgeManager = StripeTerminalBridgeManager.getInstance();

      // Check if bridge is initialized
      if (!bridgeManager.isTerminalInitialized()) {
        this.logger.error('Stripe Terminal Bridge is not initialized');
        return false;
      }

      // Connect to the reader via the bridge
      const connected = await bridgeManager.connectToReader(deviceId);

      if (connected) {
        // Update local state
        this.isConnected = true;
        this.deviceId = deviceId;
        this.connectedDevice = bridgeManager.getConnectedReader();
        this.logger.info(`Successfully connected to Stripe terminal: ${deviceId}`);
      } else {
        this.logger.error(`Failed to connect to Stripe terminal: ${deviceId}`);
      }

      return connected;
    } catch (error) {
      this.logger.error('Error connecting to Stripe terminal:', error instanceof Error ? error : new Error(String(error)));
      return false;
    }
  }

  /**
   * Process payment with Stripe Terminal
   * Uses the StripeTerminalBridgeManager to process the payment
   */
  public async processPayment(request: PaymentRequest): Promise<PaymentResponse> {
    if (!this.isConnected || !this.deviceId) {
      throw new Error('Not connected to payment terminal');
    }

    try {
      this.logger.info(`Processing payment of ${request.amount.toFixed(2)} via Stripe terminal ${this.deviceId}`);

      // Import the bridge manager dynamically to avoid circular dependencies
      const { StripeTerminalBridgeManager } = await import('../../contexts/StripeTerminalBridge');
      const bridgeManager = StripeTerminalBridgeManager.getInstance();

      // Check if bridge is initialized and reader is connected
      if (!bridgeManager.isReaderConnected()) {
        throw new Error('Stripe terminal is not connected');
      }

      // Process payment via the bridge
      const result = await bridgeManager.processPayment({
        amount: request.amount,
        currency: request.currency || 'usd',
        description: `Order ${request.orderId || request.reference}`,
        metadata: {
          reference: request.reference,
          orderId: request.orderId || '',
          customerName: request.customerName || '',
        },
      });

      this.logger.info(`Payment processing result: ${result.success ? 'success' : 'failed'}`);
      return result;
    } catch (error) {
      this.logger.error('Error processing payment:', error instanceof Error ? error : new Error(String(error)));
      return {
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Payment processing failed',
        timestamp: new Date(),
      };
    }
  }

  /**
   * Get available Stripe readers
   * Uses the StripeTerminalBridgeManager to discover readers
   */
  public async getAvailableTerminals(): Promise<Array<{ id: string; name: string }>> {
    try {
      this.logger.info('Discovering available Stripe terminals');

      // Import the bridge manager dynamically to avoid circular dependencies
      const { StripeTerminalBridgeManager } = await import('../../contexts/StripeTerminalBridge');
      const bridgeManager = StripeTerminalBridgeManager.getInstance();

      // Check if bridge is initialized
      if (!bridgeManager.isTerminalInitialized()) {
        this.logger.warn('Stripe Terminal Bridge is not initialized, returning cached readers');
        return this.discoveredReaders;
      }

      // Discover readers via the bridge
      // Use bluetoothScan as the default discovery method
      const readers = await bridgeManager.discoverReaders({
        discoveryMethod: 'bluetoothScan',
        simulated: false,
      });

      // Map the readers to our format
      this.discoveredReaders = readers.map(reader => ({
        id: reader.serialNumber,
        name: reader.label || reader.deviceType || reader.serialNumber,
      }));

      this.logger.info(`Discovered ${this.discoveredReaders.length} Stripe terminals`);
      return this.discoveredReaders;
    } catch (error) {
      this.logger.error('Error discovering Stripe terminals:', error instanceof Error ? error : new Error(String(error)));
      // Return cached readers on error
      return this.discoveredReaders;
    }
  }

  /**
   * Disconnect from the Stripe reader
   * Uses the StripeTerminalBridgeManager to disconnect from the terminal
   */
  public async disconnect(): Promise<void> {
    if (!this.isConnected || !this.deviceId) {
      this.logger.info('No active Stripe terminal connection to disconnect');
      return;
    }

    try {
      this.logger.info(`Disconnecting from Stripe terminal: ${this.deviceId}`);

      // Import the bridge manager dynamically to avoid circular dependencies
      const { StripeTerminalBridgeManager } = await import('../../contexts/StripeTerminalBridge');
      const bridgeManager = StripeTerminalBridgeManager.getInstance();

      // Disconnect via the bridge
      const disconnected = await bridgeManager.disconnectReader();

      if (disconnected) {
        // Reset local state
        this.isConnected = false;
        this.deviceId = null;
        this.connectedDevice = null;
        this.logger.info('Successfully disconnected from Stripe terminal');
      } else {
        this.logger.error('Failed to disconnect from Stripe terminal');
      }
    } catch (error) {
      this.logger.error('Error disconnecting from Stripe terminal:', error instanceof Error ? error : new Error(String(error)));
      // Reset local state even on error to avoid stuck state
      this.isConnected = false;
      this.deviceId = null;
      this.connectedDevice = null;
    }
  }

  /**
   * Check if connected to a Stripe terminal
   */
  public isTerminalConnected(): boolean {
    return this.isConnected;
  }

  /**
   * Get connected device ID
   */
  public getConnectedDeviceId(): string | null {
    return this.deviceId;
  }

  /**
   * Get transaction status
   * Note: Stripe Terminal SDK doesn't provide direct transaction status queries
   * This would need to be implemented via Stripe API calls
   */
  public async getTransactionStatus(transactionId: string): Promise<PaymentResponse> {
    this.logger.info(`Getting transaction status for ${transactionId}`);
    // This would require calling the Stripe API directly
    // For now, return a not implemented response
    return {
      success: false,
      errorMessage: 'Transaction status queries not implemented - use Stripe API directly',
      timestamp: new Date(),
    };
  }

  /**
   * Void/cancel a transaction
   * Note: Stripe Terminal SDK uses cancelPaymentIntent for this
   */
  public async voidTransaction(transactionId: string): Promise<PaymentResponse> {
    try {
      this.logger.info(`Voiding transaction ${transactionId}`);

      // Import the bridge manager dynamically
      const { StripeTerminalBridgeManager } = await import('../../contexts/StripeTerminalBridge');
      const bridgeManager = StripeTerminalBridgeManager.getInstance();

      // Use the bridge's cancelPayment method
      const success = await bridgeManager.bridge?.actions.cancelPayment(transactionId);

      return {
        success: success || false,
        errorMessage: success ? undefined : 'Failed to void transaction',
        timestamp: new Date(),
      };
    } catch (error) {
      this.logger.error('Error voiding transaction:', error instanceof Error ? error : new Error(String(error)));
      return {
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Void transaction failed',
        timestamp: new Date(),
      };
    }
  }

  /**
   * Issue a refund
   * Note: Refunds are handled through the Stripe API, not the Terminal SDK
   */
  public async refundTransaction(transactionId: string, amount: number): Promise<PaymentResponse> {
    try {
      this.logger.info(`Refunding transaction ${transactionId} for amount ${amount.toFixed(2)}`);

      // Import the bridge manager dynamically
      const { StripeTerminalBridgeManager } = await import('../../contexts/StripeTerminalBridge');
      const bridgeManager = StripeTerminalBridgeManager.getInstance();

      // Use the bridge's refundPayment method
      const success = await bridgeManager.bridge?.actions.refundPayment(transactionId, amount);

      return {
        success: success || false,
        errorMessage: success ? undefined : 'Failed to refund transaction',
        timestamp: new Date(),
        amount: success ? amount : undefined,
      };
    } catch (error) {
      this.logger.error('Error refunding transaction:', error instanceof Error ? error : new Error(String(error)));
      return {
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Refund transaction failed',
        timestamp: new Date(),
      };
    }
  }
}
