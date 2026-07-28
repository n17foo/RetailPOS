/**
 * MoreMenuComposer
 *
 * Generates the ordered list of More menu items with their status
 * (enabled / disabled / hidden) based on:
 *   1. User role
 *   2. Selected platform capabilities
 *   3. Custom adapter readiness
 *   4. Action-level permissions (custom permission sets)
 *
 * This is a pure composition service — it has no side effects and
 * does not navigate. The output is consumed by MoreNavigator.
 *
 * See: docs/specs/onboarding-menu-capability-implementation.md §3, §4.3
 *      docs/specs/auth/permissions.md §2.1.3
 */

import type { UserRole } from '../../repositories/UserRepository';
import type { PlatformCapabilities } from '../../utils/platformCapabilities';
import { getUnavailableReason } from '../../utils/platformCapabilities';
import { canAccessMoreMenuItem } from '../../utils/roleAccess';
import { evaluateCombinedAccess, evaluateRoleOnlyAccess, MenuItemStatus } from '../../utils/menuCapabilityAccess';
import type { MoreStackParamList } from '../../navigation/types';
import { getPlatformDisplayName } from '../../utils/platforms';
import type { ECommercePlatform } from '../../utils/platforms';
import { permissionService } from '../permissions/PermissionService';

/** Capability features that can gate a menu item — excludes basketMode which is not a CapabilityLevel */
type CapabilityFeatureKey = Exclude<keyof PlatformCapabilities, 'basketMode'>;

export type MoreMenuKey = keyof typeof MORE_MENU_DEFINITIONS;

export interface ComposedMenuItem {
  key: string;
  label: string;
  icon: string;
  /** Navigation route in MoreStackParamList */
  route: keyof MoreStackParamList;
  /** Computed status for this user + platform combination */
  status: MenuItemStatus;
  /** Shown as subtitle when status is 'disabled' */
  reason?: string;
  /** Visual grouping for section headers */
  setupGroup: 'core' | 'advanced' | 'optional';
  /** Colour hint for the icon */
  color: string;
}

/**
 * Static definition registry for all possible More menu items.
 * capabilityKey is optional — items without one are role-gated only.
 * actionKey is optional — items with one are also gated by action-level permissions.
 */
const MORE_MENU_DEFINITIONS = {
  OrderHistory: {
    label: 'Order History',
    icon: 'receipt-long',
    route: 'OrderHistory' as keyof MoreStackParamList,
    setupGroup: 'core' as const,
    color: '#2196F3',
    capabilityKey: undefined as CapabilityFeatureKey | undefined,
    requiresAdapterReady: false,
    actionKey: undefined as string | undefined,
  },
  Settings: {
    label: 'Settings',
    icon: 'settings',
    route: 'Settings' as keyof MoreStackParamList,
    setupGroup: 'core' as const,
    color: '#6200EE',
    capabilityKey: undefined as CapabilityFeatureKey | undefined,
    requiresAdapterReady: false,
    actionKey: 'settings:view' as string | undefined,
  },
  Users: {
    label: 'User Management',
    icon: 'people',
    route: 'Users' as keyof MoreStackParamList,
    setupGroup: 'core' as const,
    color: '#03DAC6',
    capabilityKey: undefined as CapabilityFeatureKey | undefined,
    requiresAdapterReady: false,
    actionKey: 'user:edit' as string | undefined,
  },
  Refund: {
    label: 'Refund',
    icon: 'receipt-long',
    route: 'Refund' as keyof MoreStackParamList,
    setupGroup: 'advanced' as const,
    color: '#FF9800',
    capabilityKey: 'refunds' as CapabilityFeatureKey,
    requiresAdapterReady: true,
    actionKey: 'refund:process' as string | undefined,
  },
  Printer: {
    label: 'Printer',
    icon: 'print',
    route: 'Printer' as keyof MoreStackParamList,
    setupGroup: 'core' as const,
    color: '#2196F3',
    capabilityKey: undefined as CapabilityFeatureKey | undefined,
    requiresAdapterReady: false,
    actionKey: undefined as string | undefined,
  },
  PaymentTerminal: {
    label: 'Payment Terminal',
    icon: 'payment',
    route: 'PaymentTerminal' as keyof MoreStackParamList,
    setupGroup: 'core' as const,
    color: '#4CAF50',
    capabilityKey: undefined as CapabilityFeatureKey | undefined,
    requiresAdapterReady: false,
    actionKey: undefined as string | undefined,
  },
  SyncQueue: {
    label: 'Sync Queue',
    icon: 'sync',
    route: 'SyncQueue' as keyof MoreStackParamList,
    setupGroup: 'advanced' as const,
    color: '#2196F3',
    capabilityKey: 'orderSync' as CapabilityFeatureKey,
    requiresAdapterReady: false,
    actionKey: 'sync:retry' as string | undefined,
  },
  Reports: {
    label: 'Reports',
    icon: 'bar-chart',
    route: 'Reports' as keyof MoreStackParamList,
    setupGroup: 'core' as const,
    color: '#03DAC6',
    capabilityKey: undefined as CapabilityFeatureKey | undefined,
    requiresAdapterReady: false,
    actionKey: 'report:view' as string | undefined,
  },
  Exchange: {
    label: 'Exchange',
    icon: 'swap-horiz',
    route: 'Exchange' as keyof MoreStackParamList,
    setupGroup: 'advanced' as const,
    color: '#FF9800',
    capabilityKey: 'refunds' as CapabilityFeatureKey,
    requiresAdapterReady: false,
    actionKey: 'exchange:process' as string | undefined,
  },
  Customers: {
    label: 'Customers',
    icon: 'people-outline',
    route: 'Customers' as keyof MoreStackParamList,
    setupGroup: 'core' as const,
    color: '#9C27B0',
    capabilityKey: undefined as CapabilityFeatureKey | undefined,
    requiresAdapterReady: false,
    actionKey: 'customer:edit' as string | undefined,
  },
  Procurement: {
    label: 'Procurement',
    icon: 'inventory',
    route: 'Procurement' as keyof MoreStackParamList,
    setupGroup: 'advanced' as const,
    color: '#795548',
    capabilityKey: 'inventory' as CapabilityFeatureKey,
    requiresAdapterReady: false,
    actionKey: 'inventory:adjust' as string | undefined,
  },
} as const;

/** Stable display order for menu items */
const MENU_ORDER: Array<keyof typeof MORE_MENU_DEFINITIONS> = [
  'OrderHistory',
  'Refund',
  'Exchange',
  'Customers',
  'Procurement',
  'SyncQueue',
  'Reports',
  'Printer',
  'PaymentTerminal',
  'Users',
  'Settings',
];

export interface MoreMenuComposerInput {
  userRole: UserRole | undefined;
  userId?: string;
  platform: ECommercePlatform | string;
  capabilities: PlatformCapabilities;
  /**
   * Map of capability keys to adapter readiness.
   * If a key is absent, readiness is assumed false for 'custom' features.
   */
  adapterReadiness?: Partial<Record<CapabilityFeatureKey, boolean>>;
}

/**
 * Compose the ordered list of More menu items for the given user + platform context.
 * Items with status 'hidden' are excluded from the output.
 *
 * NOTE: This function uses synchronous role-based permission checks.
 * For full async permission resolution including custom permission sets,
 * the calling screen should additionally check permissionService.can(userId, actionKey).
 */
export function composeMoreMenu(input: MoreMenuComposerInput): ComposedMenuItem[] {
  const { userRole, userId: _userId, platform, capabilities, adapterReadiness = {} } = input;
  const platformName = getPlatformDisplayName(platform);

  const items: ComposedMenuItem[] = [];

  for (const key of MENU_ORDER) {
    const def = MORE_MENU_DEFINITIONS[key];
    const roleAllowed = canAccessMoreMenuItem(userRole, key as Parameters<typeof canAccessMoreMenuItem>[1]);

    let result;

    if (!def.capabilityKey) {
      // Role-only gating
      result = evaluateRoleOnlyAccess(roleAllowed);
    } else {
      const capLevel = capabilities[def.capabilityKey];
      const adapterReady = def.requiresAdapterReady ? (adapterReadiness[def.capabilityKey] ?? false) : true;
      const reason = getUnavailableReason(capabilities, def.capabilityKey, platformName);
      result = evaluateCombinedAccess(roleAllowed, capLevel, adapterReady, reason);
    }

    // Additional action-level permission check (synchronous role-based only)
    // Spec requirement 2.1.3: Check action-level permissions
    if (def.actionKey && result.status !== 'hidden') {
      const hasActionPermission = permissionService.canByRole(userRole, def.actionKey);
      if (!hasActionPermission) {
        result = { status: 'disabled', reason: 'Insufficient permissions for this action' };
      }
    }

    if (result.status === 'hidden') continue;

    items.push({
      key,
      label: def.label,
      icon: def.icon,
      route: def.route,
      status: result.status as MenuItemStatus,
      reason: result.reason,
      setupGroup: def.setupGroup,
      color: def.color,
    });
  }

  return items;
}
