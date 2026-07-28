/**
 * InstoreApiTransport
 *
 * HTTP transport layer for InstoreApiServer using react-native-http-bridge.
 * Binds the server route logic to an actual HTTP listener on mobile/tablet.
 */

import { Platform } from 'react-native';
import { instoreApiConfig } from './InstoreApiConfig';
import { instoreApiServer } from './InstoreApiServer';
import { LoggerFactory } from '../logger/LoggerFactory';

// Import react-native-http-bridge only on native platforms
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let httpBridge: any = null;
if (Platform.OS !== 'web') {
  try {
    httpBridge = require('react-native-http-bridge');
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('react-native-http-bridge not available:', error);
  }
}

export class InstoreApiTransport {
  private static instance: InstoreApiTransport;
  private logger = LoggerFactory.getInstance().createLogger('InstoreApiTransport');
  private listening = false;

  private constructor() {}

  static getInstance(): InstoreApiTransport {
    if (!InstoreApiTransport.instance) {
      InstoreApiTransport.instance = new InstoreApiTransport();
    }
    return InstoreApiTransport.instance;
  }

  get isListening(): boolean {
    return this.listening;
  }

  /**
   * Start the HTTP server transport
   */
  async start(): Promise<void> {
    if (this.listening) {
      this.logger.warn('HTTP transport already listening');
      return;
    }

    if (!instoreApiConfig.isServer) {
      this.logger.warn('Cannot start HTTP transport — not in server mode');
      return;
    }

    // Web platform uses different approach (would need Express or similar)
    if (Platform.OS === 'web') {
      this.logger.warn('HTTP transport not supported on web platform');
      return;
    }

    if (!httpBridge) {
      this.logger.error('react-native-http-bridge not available');
      throw new Error('HTTP bridge not available');
    }

    try {
      const port = instoreApiConfig.current.port;

      // Start the HTTP bridge server
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      httpBridge.start(port, 'http_service', (request: any) => {
        this.handleHttpRequest(request);
      });

      this.listening = true;
      this.logger.info(`HTTP transport started on port ${port}`);
    } catch (error) {
      this.logger.error('Failed to start HTTP transport:', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Stop the HTTP server transport
   */
  async stop(): Promise<void> {
    if (!this.listening) {
      return;
    }

    if (Platform.OS === 'web' || !httpBridge) {
      this.listening = false;
      return;
    }

    try {
      httpBridge.stop();
      this.listening = false;
      this.logger.info('HTTP transport stopped');
    } catch (error) {
      this.logger.error('Failed to stop HTTP transport:', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Handle incoming HTTP request from react-native-http-bridge
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async handleHttpRequest(request: any): Promise<void> {
    try {
      const { requestId, method, url, headers, data } = request;

      // Parse URL and extract path
      const urlObj = new URL(url, 'http://localhost');
      const path = urlObj.pathname;

      // Parse request body
      let body: unknown = undefined;
      if (data && method !== 'GET') {
        try {
          body = JSON.parse(data);
        } catch {
          // If JSON parsing fails, use raw data
          body = data;
        }
      }

      // Handle query parameters for GET requests
      if (method === 'GET' && urlObj.search) {
        const queryParams: Record<string, unknown> = {};
        urlObj.searchParams.forEach((value, key) => {
          queryParams[key] = value;
        });
        if (Object.keys(queryParams).length > 0) {
          body = queryParams;
        }
      }

      // Call the server logic
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await instoreApiServer.handleRequest(method as any, path, body, headers);

      // Send response back through the bridge
      httpBridge.respond(requestId, response.status, 'application/json', JSON.stringify(response.body));

      this.logger.debug(`${method} ${path} → ${response.status}`);
    } catch (error) {
      this.logger.error('Error handling HTTP request:', error instanceof Error ? error : new Error(String(error)));

      // Send error response
      try {
        const errorResponse = {
          error: 'Internal server error',
          message: error instanceof Error ? error.message : 'Unknown error',
        };
        httpBridge.respond(request.requestId, 500, 'application/json', JSON.stringify(errorResponse));
      } catch (responseError) {
        this.logger.error(
          'Failed to send error response:',
          responseError instanceof Error ? responseError : new Error(String(responseError))
        );
      }
    }
  }
}

export const instoreApiTransport = InstoreApiTransport.getInstance();
