/* eslint-disable @typescript-eslint/no-explicit-any -- raw platform API response mapping */
import { LoggerFactory } from '../logger/LoggerFactory';

/**
 * Authentication strategy for platform API clients.
 */
export type AuthStrategy =
  | { type: 'bearer'; token: string }
  | { type: 'header'; headers: Record<string, string> }
  | { type: 'basic'; username: string; password: string }
  | { type: 'none' };

/**
 * Base configuration shared across all platform API clients.
 */
export interface BaseApiClientConfig {
  storeUrl?: string;
  apiVersion?: string;
  [key: string]: string | number | boolean | undefined;
}

/**
 * Abstract base class for all platform API clients.
 *
 * Provides shared HTTP methods (get, post, put, patch, delete), URL normalisation,
 * auth-header injection, timeout handling, and structured error logging.
 * Platform-specific subclasses only need to implement:
 *   - `getAuthStrategy()` — how to authenticate
 *   - `buildApiUrl(path)` — how to construct the full API URL
 */
export abstract class BaseApiClient<TConfig extends BaseApiClientConfig = BaseApiClientConfig> {
  protected config: TConfig = {} as TConfig;
  protected initialized = false;
  protected logger;

  constructor(loggerName: string) {
    this.logger = LoggerFactory.getInstance().createLogger(loggerName);
  }

  // ── Abstract contract ──────────────────────────────────────────────

  /**
   * Return the authentication strategy for this client.
   */
  protected abstract getAuthStrategy(): AuthStrategy;

  /**
   * Build the full API URL for a given resource path.
   * e.g. Shopify: `${storeUrl}/admin/api/${version}/${path}`
   */
  protected abstract buildApiUrl(path: string): string;

  // ── Public API ─────────────────────────────────────────────────────

  public configure(config: TConfig): void {
    this.config = { ...config };
    this.initialized = false;
  }

  public isInitialized(): boolean {
    return this.initialized;
  }

  public getBaseUrl(): string {
    return this.config.storeUrl || '';
  }

  public getApiVersion(): string {
    return (this.config.apiVersion as string) || '';
  }

  /**
   * Authenticated GET request.
   */
  public async get<T = any>(path: string, params?: Record<string, string>): Promise<T> {
    const url = this.appendQueryParams(this.buildApiUrl(path), params);
    return this.request<T>('GET', url);
  }

  /**
   * Authenticated GET request that also returns response headers.
   * Used by services that need pagination cursors from Link headers (e.g. Shopify).
   */
  public async getWithHeaders<T = any>(path: string, params?: Record<string, string>): Promise<{ data: T; headers: Headers }> {
    const url = this.appendQueryParams(this.buildApiUrl(path), params);
    return this.requestWithHeaders<T>('GET', url);
  }

  /**
   * Authenticated POST request.
   */
  public async post<T = any>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', this.buildApiUrl(path), body);
  }

  /**
   * Authenticated PUT request.
   */
  public async put<T = any>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', this.buildApiUrl(path), body);
  }

  /**
   * Authenticated PATCH request.
   */
  public async patch<T = any>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PATCH', this.buildApiUrl(path), body);
  }

  /**
   * Authenticated DELETE request.
   */
  public async delete<T = any>(path: string): Promise<T> {
    return this.request<T>('DELETE', this.buildApiUrl(path));
  }

  // ── Internals ──────────────────────────────────────────────────────

  protected async request<T>(method: string, url: string, body?: unknown): Promise<T> {
    const { data } = await this.requestWithHeaders<T>(method, url, body);
    return data;
  }

  protected async requestWithHeaders<T>(method: string, url: string, body?: unknown): Promise<{ data: T; headers: Headers }> {
    const headers = this.buildHeaders();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`API error ${response.status}: ${text}`);
      }

      // Some DELETE endpoints return 204 with no body
      const contentLength = response.headers.get('content-length');
      if (response.status === 204 || contentLength === '0') {
        return { data: {} as T, headers: response.headers };
      }

      const data = (await response.json()) as T;
      return { data, headers: response.headers };
    } catch (error: any) {
      clearTimeout(timeout);
      if (error.name === 'AbortError') {
        throw new Error(`Request timeout: ${method} ${url}`, { cause: error });
      }
      throw error;
    }
  }

  protected buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    const auth = this.getAuthStrategy();

    switch (auth.type) {
      case 'bearer':
        headers['Authorization'] = `Bearer ${auth.token}`;
        break;
      case 'basic': {
        const encoded = this.base64Encode(`${auth.username}:${auth.password}`);
        headers['Authorization'] = `Basic ${encoded}`;
        break;
      }
      case 'header':
        Object.assign(headers, auth.headers);
        break;
      case 'none':
        break;
    }

    return headers;
  }

  protected normalizeUrl(url: string): string {
    if (!url) return '';
    url = url.replace(/\/+$/, '');
    if (!url.startsWith('http')) {
      url = `https://${url}`;
    }
    return url;
  }

  private appendQueryParams(url: string, params?: Record<string, string>): string {
    if (!params || Object.keys(params).length === 0) return url;
    const qs = new URLSearchParams(params).toString();
    return `${url}?${qs}`;
  }

  /**
   * React-Native-safe base64 encoding (no Buffer dependency).
   */
  private base64Encode(str: string): string {
    if (typeof btoa !== 'undefined') return btoa(str);
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
    let output = '';
    for (let i = 0; i < str.length; i += 3) {
      const c1 = str.charCodeAt(i);
      const c2 = i + 1 < str.length ? str.charCodeAt(i + 1) : NaN;
      const c3 = i + 2 < str.length ? str.charCodeAt(i + 2) : NaN;
      const e1 = c1 >> 2;
      const e2 = ((c1 & 3) << 4) | (isNaN(c2) ? 0 : c2 >> 4);
      const e3 = isNaN(c2) ? 64 : ((c2 & 15) << 2) | (isNaN(c3) ? 0 : c3 >> 6);
      const e4 = isNaN(c3) ? 64 : c3 & 63;
      output += chars.charAt(e1) + chars.charAt(e2) + chars.charAt(e3) + chars.charAt(e4);
    }
    return output;
  }
}
