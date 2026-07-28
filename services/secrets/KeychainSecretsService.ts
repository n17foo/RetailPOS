import { Platform } from 'react-native';
import { SecretsServiceInterface } from './SecretsServiceInterface';
import { LoggerFactory } from '../logger/LoggerFactory';

// Define an interface for the keychain module to avoid using 'any'
interface ReactNativeKeychain {
  setGenericPassword: (username: string, password: string, options?: unknown) => Promise<boolean>;
  getGenericPassword: (options?: unknown) => Promise<{ username: string; password: string } | false>;
  resetGenericPassword: (options?: unknown) => Promise<boolean>;
}

/**
 * Implementation of SecretsServiceInterface using React Native Keychain
 * for secure storage of sensitive information
 */
export class KeychainSecretsService implements SecretsServiceInterface {
  private static instance: KeychainSecretsService;
  private keychain: ReactNativeKeychain | null = null;
  private initialized: boolean = false;
  private logger = LoggerFactory.getInstance().createLogger('KeychainSecretsService');

  private constructor() {
    // We'll dynamically import keychain to avoid loading native modules in Expo Go
    this.initializeKeychain();
  }

  /**
   * Gets the singleton instance of KeychainSecretsService
   */
  public static getInstance(): KeychainSecretsService {
    if (!KeychainSecretsService.instance) {
      KeychainSecretsService.instance = new KeychainSecretsService();
    }
    return KeychainSecretsService.instance;
  }

  /**
   * Initialize the keychain module (only outside of Expo Go)
   */
  private async initializeKeychain(): Promise<void> {
    try {
      // Check if we're in Expo Go - if so, don't even try to load the native module
      const isExpoGo = process.env.EXPO_RUNTIME === 'expo' || (global as Record<string, unknown>).__expo !== undefined;
      if (isExpoGo) {
        this.logger.info('Running in Expo Go - not loading native keychain module');
        this.initialized = false;
        return;
      }

      // Only try to load the module if we're not in Expo Go
      this.keychain = require('react-native-keychain');
      this.initialized = true;
      this.logger.info('Successfully initialized React Native Keychain');
    } catch (error) {
      this.logger.error(
        { message: 'Failed to initialize React Native Keychain' },
        error instanceof Error ? error : new Error(String(error))
      );
      this.initialized = false;
    }
  }

  /**
   * Stores a secret value securely using the keychain
   * @param key The identifier for the secret
   * @param value The secret value to store
   * @returns A promise that resolves to true if successful
   */
  public async storeSecret(key: string, value: string): Promise<boolean> {
    if (!this.initialized || !this.keychain) {
      this.logger.error('Cannot store secret: Keychain not initialized');
      return false;
    }

    try {
      // Store the secret in the device's secure storage
      await this.keychain.setGenericPassword(key, value, {
        service: key,
        accessGroup: Platform.OS === 'ios' ? 'com.commercefull.retailpos' : undefined,
      });
      return true;
    } catch (error) {
      this.logger.error({ message: 'Error storing secret' }, error instanceof Error ? error : new Error(String(error)));
      return false;
    }
  }

  /**
   * Stores multiple secrets at once
   * @param secrets Object containing key-value pairs of secrets to store
   * @returns A promise that resolves when all secrets are stored
   */
  public async storeSecrets(secrets: Record<string, string>): Promise<void> {
    if (!this.initialized || !this.keychain) {
      this.logger.error('Cannot store secrets: Keychain not initialized');
      return;
    }

    try {
      this.logger.debug(`Storing ${Object.keys(secrets).length} secrets in batch`);

      const promises = Object.entries(secrets).map(([key, value]) => this.storeSecret(key, value));

      await Promise.all(promises);
    } catch (error) {
      this.logger.error({ message: 'Error storing secrets batch' }, error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Retrieves a secret value from the keychain
   * @param key The identifier for the secret to retrieve
   * @returns The secret value, or null if not found or error occurred
   */
  public async getSecret(key: string): Promise<string | null> {
    if (!this.initialized || !this.keychain) {
      this.logger.error('Cannot get secret: Keychain not initialized');
      return null;
    }

    try {
      // Retrieve the secret from the device's secure storage
      const credentials = await this.keychain.getGenericPassword({
        service: key,
        accessGroup: Platform.OS === 'ios' ? 'com.commercefull.retailpos' : undefined,
      });

      if (credentials) {
        return credentials.password;
      }
      return null;
    } catch (error) {
      this.logger.error({ message: 'Error retrieving secret' }, error instanceof Error ? error : new Error(String(error)));
      return null;
    }
  }

  /**
   * Deletes a secret value from the keychain
   * @param key The identifier for the secret to delete
   * @returns A promise that resolves to true if successful
   */
  public async deleteSecret(key: string): Promise<boolean> {
    if (!this.initialized || !this.keychain) {
      this.logger.error('Cannot delete secret: Keychain not initialized');
      return false;
    }

    try {
      // Delete the secret from the device's secure storage
      await this.keychain.resetGenericPassword({
        service: key,
        accessGroup: Platform.OS === 'ios' ? 'com.commercefull.retailpos' : undefined,
      });
      return true;
    } catch (error) {
      this.logger.error({ message: 'Error deleting secret' }, error instanceof Error ? error : new Error(String(error)));
      return false;
    }
  }

  /**
   * Checks if a secret exists in the keychain
   * @param key The identifier for the secret to check
   * @returns A promise that resolves to true if the secret exists
   */
  public async hasSecret(key: string): Promise<boolean> {
    const value = await this.getSecret(key);
    return value !== null;
  }
}
