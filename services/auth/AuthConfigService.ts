import { KeyValueRepository, keyValueRepository } from '../../repositories/KeyValueRepository';
import { AuthMethodType, AuthMode, ALL_AUTH_METHODS } from './AuthMethodInterface';
import { LoggerFactory } from '../logger/LoggerFactory';

// ── Storage keys ────────────────────────────────────────────────────

const KEYS = {
  primaryMethod: 'auth.primaryMethod',
  allowedMethods: 'auth.allowedMethods',
  authMode: 'auth.mode',
  /** Per-method config stored as auth.config.<method> */
  methodConfig: (method: AuthMethodType) => `auth.config.${method}`,
};

/**
 * Manages which authentication methods are enabled and which is the
 * primary (default) method shown on the login screen.
 *
 * Persisted to KeyValueRepository so it survives app restarts.
 * PIN is always the default and cannot be disabled.
 */
export class AuthConfigService {
  private static instance: AuthConfigService;
  private logger = LoggerFactory.getInstance().createLogger('AuthConfigService');

  private primary: AuthMethodType = 'pin';
  private allowed: AuthMethodType[] = ['pin'];
  private mode: AuthMode = 'offline';
  private loaded = false;

  constructor(private kv: KeyValueRepository) {}

  static getInstance(): AuthConfigService {
    if (!AuthConfigService.instance) {
      AuthConfigService.instance = new AuthConfigService(keyValueRepository);
    }
    return AuthConfigService.instance;
  }

  /** Reset the singleton (used by tests). */
  static resetInstance(): void {
    AuthConfigService.instance = undefined as unknown as AuthConfigService;
  }

  /** Load persisted auth config from DB. Call once at app startup. */
  async load(): Promise<void> {
    try {
      const storedPrimary = await this.kv.getObject<AuthMethodType>(KEYS.primaryMethod);
      const storedAllowed = await this.kv.getObject<AuthMethodType[]>(KEYS.allowedMethods);
      const storedMode = await this.kv.getObject<AuthMode>(KEYS.authMode);

      if (storedPrimary && ALL_AUTH_METHODS.includes(storedPrimary)) {
        this.primary = storedPrimary;
      }

      if (storedAllowed && Array.isArray(storedAllowed)) {
        // Ensure PIN is always in the allowed list
        const valid = storedAllowed.filter(m => ALL_AUTH_METHODS.includes(m));
        this.allowed = valid.includes('pin') ? valid : ['pin', ...valid];
      }

      if (storedMode === 'online' || storedMode === 'offline') {
        this.mode = storedMode;
      }
    } catch (err) {
      this.logger.error(
        '[AuthConfigService] Failed to parse persisted config, using defaults:',
        err instanceof Error ? err : new Error(String(err))
      );
    }

    this.loaded = true;
  }

  /** The primary auth method shown by default on the login screen */
  get primaryMethod(): AuthMethodType {
    return this.primary;
  }

  /** All auth methods the user has enabled */
  get allowedMethods(): AuthMethodType[] {
    return [...this.allowed];
  }

  /** Whether the POS is running in online (e-commerce) or offline (local SQLite) mode */
  get authMode(): AuthMode {
    return this.mode;
  }

  get isLoaded(): boolean {
    return this.loaded;
  }

  /** Set the auth mode (online or offline). Called during onboarding based on platform selection. */
  async setAuthMode(mode: AuthMode): Promise<void> {
    this.mode = mode;
    await this.kv.setObject(KEYS.authMode, mode);
  }

  /** Set the primary auth method */
  async setPrimaryMethod(method: AuthMethodType): Promise<void> {
    this.primary = method;
    // Ensure primary is also in allowed
    if (!this.allowed.includes(method)) {
      this.allowed.push(method);
      await this.kv.setObject(KEYS.allowedMethods, this.allowed);
    }
    await this.kv.setObject(KEYS.primaryMethod, method);
  }

  /** Set the full list of allowed auth methods */
  async setAllowedMethods(methods: AuthMethodType[]): Promise<void> {
    // PIN is always required
    const withPin = methods.includes('pin') ? methods : ['pin' as AuthMethodType, ...methods];
    this.allowed = withPin;
    await this.kv.setObject(KEYS.allowedMethods, this.allowed);

    // If primary is no longer allowed, fall back to PIN
    if (!this.allowed.includes(this.primary)) {
      await this.setPrimaryMethod('pin');
    }
  }

  /** Enable a single auth method */
  async enableMethod(method: AuthMethodType): Promise<void> {
    if (!this.allowed.includes(method)) {
      this.allowed.push(method);
      await this.kv.setObject(KEYS.allowedMethods, this.allowed);
    }
  }

  /** Disable a single auth method (PIN cannot be disabled) */
  async disableMethod(method: AuthMethodType): Promise<void> {
    if (method === 'pin') return; // PIN is always enabled
    this.allowed = this.allowed.filter(m => m !== method);
    await this.kv.setObject(KEYS.allowedMethods, this.allowed);

    // If we just disabled the primary, fall back to PIN
    if (this.primary === method) {
      await this.setPrimaryMethod('pin');
    }
  }

  /** Store per-method configuration (e.g. card reader device ID) */
  async setMethodConfig<T>(method: AuthMethodType, config: T): Promise<void> {
    await this.kv.setObject(KEYS.methodConfig(method), config);
  }

  /** Retrieve per-method configuration */
  async getMethodConfig<T>(method: AuthMethodType): Promise<T | null> {
    return this.kv.getObject<T>(KEYS.methodConfig(method));
  }
}

export const authConfig = AuthConfigService.getInstance();
