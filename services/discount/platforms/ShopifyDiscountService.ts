import { BaseDiscountService } from '../BaseDiscountService';
import { DiscountValidationResult } from '../DiscountServiceInterface';
import { createAuthenticatedApiClient } from '../../token/TokenIntegration';
import { ECommercePlatform } from '../../../utils/platforms';

/**
 * Shopify Discount Service
 * Validates discount codes against Shopify API
 */
export class ShopifyDiscountService extends BaseDiscountService {
  private storeUrl?: string;

  constructor() {
    super('ShopifyDiscountService');
  }

  async initialize(storeUrl?: string): Promise<void> {
    this.storeUrl = storeUrl || process.env.SHOPIFY_STORE_URL;
    await super.initialize();
  }

  async validateDiscount(code: string, subtotal: number): Promise<DiscountValidationResult> {
    try {
      if (!this.storeUrl) {
        this.logger.warn({ message: 'Shopify store URL not configured, cannot validate discount' });
        return this.createInvalidResult(code, 'Discount validation not available');
      }

      // Create authenticated API client
      const client = await createAuthenticatedApiClient(ECommercePlatform.SHOPIFY, this.storeUrl, {});

      if (!client) {
        this.logger.error({ message: 'Failed to create Shopify API client' });
        return this.createInvalidResult(code, 'Unable to validate discount code');
      }

      // Query Shopify for discount code
      // Note: Shopify Admin API doesn't have a direct "validate discount" endpoint
      // We need to use the PriceRule and DiscountCode APIs
      const response = await client.get(`/admin/api/2024-01/discount_codes/lookup.json`, {
        code: code,
      });

      if (!response.success || !response.data) {
        this.logger.warn({ message: `Discount code not found in Shopify: ${code}` });
        return this.createInvalidResult(code, 'Invalid discount code');
      }

      interface ShopifyDiscountCodeResponse {
        discount_code?: {
          price_rule_id?: string;
        };
      }

      const discountData = response.data as ShopifyDiscountCodeResponse;
      const priceRuleId = discountData.discount_code?.price_rule_id;

      if (!priceRuleId) {
        return this.createInvalidResult(code, 'Invalid discount code');
      }

      // Fetch price rule details
      const priceRuleResponse = await client.get(`/admin/api/2024-01/price_rules/${priceRuleId}.json`);

      if (!priceRuleResponse.success || !priceRuleResponse.data) {
        return this.createInvalidResult(code, 'Unable to validate discount code');
      }

      interface ShopifyPriceRuleResponse {
        price_rule: {
          title?: string;
          value_type?: string;
          value?: string;
          starts_at?: string;
          ends_at?: string;
          prerequisite_subtotal_range?: {
            greater_than_or_equal_to?: string;
          };
        };
      }

      const priceRuleData = priceRuleResponse.data as ShopifyPriceRuleResponse;
      const priceRule = priceRuleData.price_rule;

      // Check if price rule is active
      const now = new Date();
      const startsAt = priceRule.starts_at ? new Date(priceRule.starts_at) : null;
      const endsAt = priceRule.ends_at ? new Date(priceRule.ends_at) : null;

      if (startsAt && now < startsAt) {
        return this.createInvalidResult(code, 'Discount code is not yet active');
      }

      if (endsAt && now > endsAt) {
        return this.createInvalidResult(code, 'Discount code has expired');
      }

      // Check minimum purchase requirement (in cents)
      const minimumPurchase = priceRule.prerequisite_subtotal_range?.greater_than_or_equal_to
        ? parseFloat(priceRule.prerequisite_subtotal_range.greater_than_or_equal_to) * 100
        : 0;

      if (minimumPurchase > 0 && subtotal < minimumPurchase) {
        return this.createInvalidResult(code, `Minimum purchase of $${(minimumPurchase / 100).toFixed(2)} required`);
      }

      // Calculate discount amount
      let discountAmount = 0;
      let discountType: 'fixed' | 'percentage' = 'fixed';
      let discountValue = 0;

      if (priceRule.value_type === 'fixed_amount') {
        discountType = 'fixed';
        discountValue = Math.round(parseFloat(priceRule.value || '0') * 100); // Convert to cents
        discountAmount = this.calculateDiscountAmount(discountType, discountValue, subtotal);
      } else if (priceRule.value_type === 'percentage') {
        discountType = 'percentage';
        discountValue = Math.abs(parseFloat(priceRule.value || '0')); // Shopify uses negative values
        discountAmount = this.calculateDiscountAmount(discountType, discountValue, subtotal);
      }

      this.logger.info({ message: `Shopify discount validated: ${code}`, amount: discountAmount });

      return {
        valid: true,
        discountAmount,
        discountType,
        discountValue,
        code,
        description: priceRule.title,
        minimumPurchase: minimumPurchase > 0 ? minimumPurchase : undefined,
        expiresAt: endsAt ?? undefined,
      };
    } catch (error) {
      this.logger.error(
        { message: `Error validating Shopify discount: ${code}` },
        error instanceof Error ? error : new Error(String(error))
      );
      return this.createInvalidResult(code, 'Error validating discount code');
    }
  }
}
