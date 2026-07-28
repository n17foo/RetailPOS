import { ECommercePlatform } from '../../utils/platforms';
import { UnifiedProduct, UnifiedProductVariant, UnifiedProductOption, UnifiedProductImage, UnifiedProductStatus } from './types';

/**
 * ============================================================================
 * PRODUCT MAPPERS
 * ============================================================================
 * These mappers convert platform-specific product data to the unified schema.
 * Each platform has its own mapping function.
 * ============================================================================
 */

/**
 * Generate a unique app ID for a product
 */
function generateProductId(platform: ECommercePlatform, platformId: string): string {
  return `${platform}-${platformId}`;
}

/**
 * Generate a unique app ID for a variant
 */
function generateVariantId(platform: ECommercePlatform, platformId: string, variantId: string): string {
  return `${platform}-${platformId}-${variantId}`;
}

// ============================================================================
// SHOPIFY MAPPER
// ============================================================================

interface ShopifyProduct {
  id: number | string;
  title: string;
  body_html?: string;
  vendor?: string;
  product_type?: string;
  tags?: string | string[];
  handle?: string;
  status?: string;
  options?: Array<{
    id: number | string;
    name: string;
    values: string[];
    position: number;
  }>;
  variants?: Array<{
    id: number | string;
    title?: string;
    sku?: string;
    barcode?: string;
    price: string | number;
    compare_at_price?: string | number | null;
    inventory_quantity?: number;
    weight?: number;
    weight_unit?: string;
    requires_shipping?: boolean;
    taxable?: boolean;
    option1?: string;
    option2?: string;
    option3?: string;
    image_id?: number | string | null;
    position?: number;
    inventory_policy?: string;
    inventory_management?: string;
  }>;
  images?: Array<{
    id: number | string;
    src: string;
    alt?: string;
    position?: number;
    width?: number;
    height?: number;
  }>;
  created_at?: string;
  updated_at?: string;
}

export function mapShopifyProduct(data: ShopifyProduct): UnifiedProduct {
  const platformId = String(data.id);
  const platform = ECommercePlatform.SHOPIFY;

  // Map images
  const images: UnifiedProductImage[] = (data.images || []).map((img, index) => ({
    id: String(img.id),
    url: img.src,
    alt: img.alt,
    position: img.position ?? index,
    width: img.width,
    height: img.height,
    isPrimary: (img.position ?? index) === 0,
  }));

  // Map options
  const options: UnifiedProductOption[] = (data.options || []).map(opt => ({
    id: String(opt.id),
    name: opt.name,
    values: opt.values,
    position: opt.position,
  }));

  // Map variants
  const variants: UnifiedProductVariant[] = (data.variants || []).map((v, index) => {
    const optionValues: string[] = [];
    if (v.option1) optionValues.push(v.option1);
    if (v.option2) optionValues.push(v.option2);
    if (v.option3) optionValues.push(v.option3);

    return {
      id: generateVariantId(platform, platformId, String(v.id)),
      title: v.title || optionValues.join(' / ') || 'Default',
      sku: v.sku,
      barcode: v.barcode,
      price: typeof v.price === 'string' ? parseFloat(v.price) : v.price,
      compareAtPrice: v.compare_at_price
        ? typeof v.compare_at_price === 'string'
          ? parseFloat(v.compare_at_price)
          : v.compare_at_price
        : undefined,
      costPrice: undefined,
      inventoryQuantity: v.inventory_quantity ?? 0,
      trackInventory: v.inventory_management === 'shopify',
      allowBackorder: v.inventory_policy === 'continue',
      weight: v.weight,
      weightUnit: (v.weight_unit as 'g' | 'kg' | 'oz' | 'lb') || 'g',
      requiresShipping: v.requires_shipping ?? true,
      taxable: v.taxable ?? true,
      taxCode: undefined,
      optionValues,
      imageId: v.image_id ? String(v.image_id) : undefined,
      isAvailable: (v.inventory_quantity ?? 0) > 0 || v.inventory_policy === 'continue',
      position: v.position ?? index,
    };
  });

  // Parse tags
  const tags =
    typeof data.tags === 'string'
      ? data.tags
          .split(',')
          .map(t => t.trim())
          .filter(Boolean)
      : data.tags || [];

  // Map status
  let status: UnifiedProductStatus = 'active';
  if (data.status === 'draft') status = 'draft';
  else if (data.status === 'archived') status = 'archived';

  return {
    id: generateProductId(platform, platformId),
    platformId,
    platform,
    title: data.title,
    shortDescription: undefined,
    description: data.body_html,
    vendor: data.vendor,
    productType: data.product_type,
    categoryIds: [], // Shopify uses collections, mapped separately
    tags,
    options,
    variants,
    images,
    status,
    isFeatured: false,
    handle: data.handle,
    // Shopify: if any variant is non-taxable, mark product as exempt
    taxCode: variants.some(v => !v.taxable) ? 'exempt' : undefined,
    createdAt: data.created_at ? new Date(data.created_at) : new Date(),
    updatedAt: data.updated_at ? new Date(data.updated_at) : new Date(),
    syncedAt: new Date(),
  };
}

// ============================================================================
// WOOCOMMERCE MAPPER
// ============================================================================

interface WooCommerceProduct {
  id: number;
  name: string;
  slug?: string;
  description?: string;
  short_description?: string;
  sku?: string;
  price?: string;
  regular_price?: string;
  sale_price?: string;
  stock_quantity?: number;
  stock_status?: string;
  manage_stock?: boolean;
  backorders?: string;
  weight?: string;
  categories?: Array<{ id: number; name: string; slug: string }>;
  tags?: Array<{ id: number; name: string; slug: string }>;
  images?: Array<{
    id: number;
    src: string;
    alt?: string;
  }>;
  attributes?: Array<{
    id: number;
    name: string;
    options: string[];
    variation?: boolean;
  }>;
  variations?: Array<{
    id: number;
    sku?: string;
    price?: string;
    regular_price?: string;
    sale_price?: string;
    stock_quantity?: number;
    stock_status?: string;
    attributes?: Array<{ name: string; option: string }>;
    image?: { id: number; src: string; alt?: string };
  }>;
  status?: string;
  featured?: boolean;
  date_created?: string;
  date_modified?: string;
  tax_status?: string;
  tax_class?: string;
}

export function mapWooCommerceProduct(data: WooCommerceProduct): UnifiedProduct {
  const platformId = String(data.id);
  const platform = ECommercePlatform.WOOCOMMERCE;

  // Map images
  const images: UnifiedProductImage[] = (data.images || []).map((img, index) => ({
    id: String(img.id),
    url: img.src,
    alt: img.alt,
    position: index,
    isPrimary: index === 0,
  }));

  // Map options from attributes
  const options: UnifiedProductOption[] = (data.attributes || [])
    .filter(attr => attr.variation)
    .map((attr, index) => ({
      id: String(attr.id),
      name: attr.name,
      values: attr.options,
      position: index,
    }));

  // Map variants
  let variants: UnifiedProductVariant[];

  if (data.variations && data.variations.length > 0) {
    variants = data.variations.map((v, index) => {
      const optionValues = (v.attributes || []).map(a => a.option);
      return {
        id: generateVariantId(platform, platformId, String(v.id)),
        title: optionValues.join(' / ') || 'Default',
        sku: v.sku,
        barcode: undefined,
        price: parseFloat(v.price || v.regular_price || '0'),
        compareAtPrice: v.sale_price && v.regular_price ? parseFloat(v.regular_price) : undefined,
        costPrice: undefined,
        inventoryQuantity: v.stock_quantity ?? 0,
        trackInventory: true,
        allowBackorder: false,
        weight: undefined,
        weightUnit: 'g' as const,
        requiresShipping: true,
        taxable: true,
        optionValues,
        imageId: v.image ? String(v.image.id) : undefined,
        isAvailable: v.stock_status !== 'outofstock',
        position: index,
      };
    });
  } else {
    // Simple product - create single variant
    variants = [
      {
        id: generateVariantId(platform, platformId, 'default'),
        title: 'Default',
        sku: data.sku,
        barcode: undefined,
        price: parseFloat(data.price || data.regular_price || '0'),
        compareAtPrice: data.sale_price && data.regular_price ? parseFloat(data.regular_price) : undefined,
        costPrice: undefined,
        inventoryQuantity: data.stock_quantity ?? 0,
        trackInventory: data.manage_stock ?? false,
        allowBackorder: data.backorders === 'yes' || data.backorders === 'notify',
        weight: data.weight ? parseFloat(data.weight) : undefined,
        weightUnit: 'g',
        requiresShipping: true,
        taxable: data.tax_status !== 'none',
        taxCode: data.tax_class,
        optionValues: [],
        isAvailable: data.stock_status !== 'outofstock',
        position: 0,
      },
    ];
  }

  // Map status
  let status: UnifiedProductStatus = 'active';
  if (data.status === 'draft' || data.status === 'pending') status = 'draft';
  else if (data.status === 'trash') status = 'archived';

  return {
    id: generateProductId(platform, platformId),
    platformId,
    platform,
    title: data.name,
    shortDescription: data.short_description,
    description: data.description,
    vendor: undefined,
    productType: data.categories?.[0]?.name,
    categoryIds: (data.categories || []).map(c => `${platform}-${c.id}`),
    tags: (data.tags || []).map(t => t.name),
    options,
    variants,
    images,
    status,
    isFeatured: data.featured ?? false,
    handle: data.slug,
    // WooCommerce: map tax_class to taxCode for TaxProfileService resolution
    taxCode: data.tax_class || undefined,
    createdAt: data.date_created ? new Date(data.date_created) : new Date(),
    updatedAt: data.date_modified ? new Date(data.date_modified) : new Date(),
    syncedAt: new Date(),
  };
}

// ============================================================================
// BIGCOMMERCE MAPPER
// ============================================================================

interface BigCommerceProduct {
  id: number;
  name: string;
  sku?: string;
  description?: string;
  price: number;
  sale_price?: number;
  retail_price?: number;
  cost_price?: number;
  inventory_level?: number;
  inventory_tracking?: string;
  weight?: number;
  categories?: number[];
  images?: Array<{
    id: number;
    url_standard: string;
    description?: string;
    sort_order?: number;
    is_thumbnail?: boolean;
  }>;
  variants?: Array<{
    id: number;
    sku?: string;
    upc?: string;
    price?: number;
    sale_price?: number;
    inventory_level?: number;
    option_values?: Array<{ option_display_name: string; label: string }>;
    image_url?: string;
  }>;
  is_visible?: boolean;
  is_featured?: boolean;
  date_created?: string;
  date_modified?: string;
  custom_url?: { url: string };
}

export function mapBigCommerceProduct(data: BigCommerceProduct): UnifiedProduct {
  const platformId = String(data.id);
  const platform = ECommercePlatform.BIGCOMMERCE;

  // Map images
  const images: UnifiedProductImage[] = (data.images || []).map((img, index) => ({
    id: String(img.id),
    url: img.url_standard,
    alt: img.description,
    position: img.sort_order ?? index,
    isPrimary: img.is_thumbnail ?? index === 0,
  }));

  // Map variants
  let variants: UnifiedProductVariant[];

  if (data.variants && data.variants.length > 0) {
    variants = data.variants.map((v, index) => {
      const optionValues = (v.option_values || []).map(ov => ov.label);
      return {
        id: generateVariantId(platform, platformId, String(v.id)),
        title: optionValues.join(' / ') || 'Default',
        sku: v.sku,
        barcode: v.upc,
        price: v.price ?? data.price,
        compareAtPrice: v.sale_price ? v.price : undefined,
        costPrice: data.cost_price,
        inventoryQuantity: v.inventory_level ?? 0,
        trackInventory: data.inventory_tracking === 'variant',
        allowBackorder: false,
        weight: data.weight,
        weightUnit: 'lb' as const,
        requiresShipping: true,
        taxable: true,
        optionValues,
        imageId: undefined,
        isAvailable: (v.inventory_level ?? 0) > 0,
        position: index,
      };
    });
  } else {
    variants = [
      {
        id: generateVariantId(platform, platformId, 'default'),
        title: 'Default',
        sku: data.sku,
        barcode: undefined,
        price: data.sale_price || data.price,
        compareAtPrice: data.sale_price ? data.price : undefined,
        costPrice: data.cost_price,
        inventoryQuantity: data.inventory_level ?? 0,
        trackInventory: data.inventory_tracking === 'product',
        allowBackorder: false,
        weight: data.weight,
        weightUnit: 'lb',
        requiresShipping: true,
        taxable: true,
        optionValues: [],
        isAvailable: (data.inventory_level ?? 0) > 0,
        position: 0,
      },
    ];
  }

  return {
    id: generateProductId(platform, platformId),
    platformId,
    platform,
    title: data.name,
    description: data.description,
    vendor: undefined,
    productType: undefined,
    categoryIds: (data.categories || []).map(c => `${platform}-${c}`),
    tags: [],
    options: [],
    variants,
    images,
    status: data.is_visible ? 'active' : 'draft',
    isFeatured: data.is_featured ?? false,
    handle: data.custom_url?.url,
    createdAt: data.date_created ? new Date(data.date_created) : new Date(),
    updatedAt: data.date_modified ? new Date(data.date_modified) : new Date(),
    syncedAt: new Date(),
  };
}

// ============================================================================
// GENERIC/OFFLINE MAPPER
// ============================================================================

interface GenericProduct {
  id: string | number;
  name?: string;
  title?: string;
  description?: string;
  price?: number;
  sku?: string;
  barcode?: string;
  stock?: number;
  image?: string;
  images?: Array<string | { id?: string; url: string; alt?: string; position?: number }>;
  category?: string;
  categoryId?: string;
  productType?: string;
  tags?: string[];
  vendor?: string;
  taxProfileId?: string;
  taxCode?: string;
  variants?: Array<{
    id: string;
    title?: string;
    sku?: string;
    barcode?: string;
    price: number;
    compareAtPrice?: number;
    inventoryQuantity: number;
    weight?: number;
    weightUnit?: string;
    options?: string[];
  }>;
}

export function mapGenericProduct(data: GenericProduct, platform: ECommercePlatform = ECommercePlatform.OFFLINE): UnifiedProduct {
  const platformId = String(data.id);

  // Handle images - support both string arrays and image objects
  let images: UnifiedProductImage[] = [];
  if (data.images && data.images.length > 0) {
    images = data.images.map((img, index) => {
      if (typeof img === 'string') {
        return {
          id: `img-${index}`,
          url: img,
          position: index,
          isPrimary: index === 0,
        };
      }
      return {
        id: img.id || `img-${index}`,
        url: img.url,
        alt: img.alt,
        position: img.position ?? index,
        isPrimary: index === 0,
      };
    });
  } else if (data.image) {
    images = [
      {
        id: 'img-0',
        url: data.image,
        position: 0,
        isPrimary: true,
      },
    ];
  }

  // Handle variants - use provided variants or create default
  let variants: UnifiedProductVariant[];
  if (data.variants && data.variants.length > 0) {
    variants = data.variants.map((v, index) => ({
      id: generateVariantId(platform, platformId, v.id),
      title: v.title || 'Default',
      sku: v.sku,
      barcode: v.barcode,
      price: v.price ?? 0,
      compareAtPrice: v.compareAtPrice,
      inventoryQuantity: v.inventoryQuantity ?? 0,
      weight: v.weight,
      weightUnit: (v.weightUnit as 'g' | 'kg' | 'oz' | 'lb') || 'g',
      trackInventory: true,
      allowBackorder: false,
      requiresShipping: true,
      taxable: true,
      optionValues: v.options || [],
      isAvailable: (v.inventoryQuantity ?? 0) > 0,
      position: index,
    }));
  } else {
    // Create default variant from product-level data
    variants = [
      {
        id: generateVariantId(platform, platformId, 'default'),
        title: 'Default',
        sku: data.sku,
        barcode: data.barcode,
        price: data.price ?? 0,
        inventoryQuantity: data.stock ?? 0,
        trackInventory: true,
        allowBackorder: false,
        weightUnit: 'g',
        requiresShipping: true,
        taxable: true,
        optionValues: [],
        isAvailable: (data.stock ?? 0) > 0,
        position: 0,
      },
    ];
  }

  const categoryIds = data.categoryId ? [`${platform}-${data.categoryId}`] : [];

  return {
    id: generateProductId(platform, platformId),
    platformId,
    platform,
    title: data.title || data.name || 'Unnamed Product',
    description: data.description,
    vendor: data.vendor,
    productType: data.productType || data.category,
    categoryIds,
    tags: data.tags || [],
    options: [],
    variants,
    images,
    status: 'active',
    isFeatured: false,
    taxProfileId: data.taxProfileId,
    taxCode: data.taxCode,
    createdAt: new Date(),
    updatedAt: new Date(),
    syncedAt: new Date(),
  };
}

// ============================================================================
// MAIN MAPPER FUNCTION
// ============================================================================

/**
 * Map any platform product data to unified format
 */
export function mapToUnifiedProduct(data: unknown, platform: ECommercePlatform): UnifiedProduct {
  switch (platform) {
    case ECommercePlatform.SHOPIFY:
      return mapShopifyProduct(data as ShopifyProduct);
    case ECommercePlatform.WOOCOMMERCE:
      return mapWooCommerceProduct(data as WooCommerceProduct);
    case ECommercePlatform.BIGCOMMERCE:
      return mapBigCommerceProduct(data as BigCommerceProduct);
    case ECommercePlatform.OFFLINE:
    default:
      return mapGenericProduct(data as GenericProduct, platform);
  }
}

/**
 * Map multiple products
 */
export function mapToUnifiedProducts(data: unknown[], platform: ECommercePlatform): UnifiedProduct[] {
  return data.map(item => mapToUnifiedProduct(item, platform));
}
