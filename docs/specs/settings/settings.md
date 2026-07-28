# Settings – EARS Requirements

> **System**: RetailPOS – Settings & Configuration
> **Actor**: Manager, Admin, System
> **Date**: 2026-04-13
> **Source**: `screens/SettingsScreen.tsx`, `contexts/SettingsProvider.tsx`, `hooks/useSettings.ts`, `utils/roleAccess.ts`, `navigation/MoreNavigator.tsx`

---

## Context

Settings is the configuration hub for the POS. It is accessible from More → Settings and is restricted to `admin` and `manager` roles — cashiers cannot access it.

`SettingsScreen` is a tabbed interface with core tabs and capability-driven advanced tabs. Navigation between tabs adapts to the device form factor: a side nav on desktop, a scrollable tab bar on tablet, and a modal dropdown on mobile. Each tab renders an independent settings component. A `FloatingSaveBar` appears when unsaved changes are pending.

`useSettings` reads and writes all settings to `KeyValueRepository` (SQLite key-value store). `SettingsProvider` wraps the hook in a React context so any child component can read or update settings without prop drilling.

### Tabs

| Tab key         | Label          | Icon | Purpose                                            |
| --------------- | -------------- | ---- | -------------------------------------------------- |
| `generic`       | General        | ⚙️   | Store name, currency, locale                       |
| `pos`           | POS Config     | 🏪   | Tax rate, max sync retries, drawer behaviour       |
| `auth`          | Authentication | 🔐   | Auth methods, primary method, PIN/biometric config |
| `payment`       | Payment        | 💳   | Payment provider, terminal device ID               |
| `printer`       | Printer        | 🖨    | Printer connection, paper width, model             |
| `scanner`       | Scanner        | 📷   | Scanner type, BLE UUIDs, device ID                 |
| `ecommerce`     | E-commerce     | 🛒   | Platform selection, API credentials                |
| `offline`       | Offline        | 📴   | Offline mode management, sync controls             |
| `receipt`       | Receipt        | 🧾   | Header, footer, print options                      |
| `multiregister` | Multi-Register | 🔗   | Local API server config for multi-register setups  |
| `theme`         | Theme          | 🎨   | Color theme selection — aligns POS to brand colors |

Core tabs are always available to authorized roles; advanced tabs and feature actions can be hidden or disabled by selected platform capability profile. The `theme` tab is always available (core tab, no capability gate).

### Role Access

| Role      | Can access Settings             |
| --------- | ------------------------------- |
| `admin`   | Yes                             |
| `manager` | Yes                             |
| `cashier` | No — access denied screen shown |

---

## 1. Ubiquitous Requirements

**1.1** `SettingsScreen` shall only render its content for users with `role === 'admin'` or `role === 'manager'`. A user with `role === 'cashier'` shall see an access-denied message regardless of how the screen is reached.

**1.2** The `Settings` menu item in the More menu shall only be visible to `admin` and `manager` roles — `canAccessMoreMenuItem(role, 'Settings')` returns `false` for `cashier`.

**1.3** `useSettings` shall read all settings from `KeyValueRepository` on mount and expose them as a `Record<string, unknown>` map.

**1.4** `updateSetting(key, value)` shall persist the new value to `KeyValueRepository` immediately and update the in-memory settings map optimistically.

**1.5** If `updateSetting` fails, the system shall re-fetch all settings from storage to restore consistency and re-throw the error to the caller.

**1.6** `SettingsProvider` shall wrap `useSettings` in a React context so child components can call `useSettingsData()` without prop drilling.

**1.7** Settings tab visibility shall be computed using role + platform capability profile. Role access alone is insufficient for advanced feature availability.

**1.8** More menu visibility for setup and management entries shall support capability-aware composition in addition to role-based filtering.

---

## 2. Event-Driven Requirements

### 2.1 Access Control

**2.1.1** When `SettingsScreen` renders and `user.role === 'cashier'`, the system shall render an access-denied view with the message `'Access denied. Settings require manager or admin role.'` and shall not render any tab content.

**2.1.2** When `MoreMenuScreen` renders the menu items, the system shall call `canAccessMoreMenuItem(userRole, 'Settings')` and only include the Settings item when it returns `true`.

### 2.2 Tab Navigation

**2.2.1** When `SettingsScreen` mounts, the system shall default to the `'generic'` tab.

**2.2.2** When the user selects a tab (side nav, tab bar, or dropdown), the system shall set `activeTab` to the selected tab key and render the corresponding settings component.

**2.2.2.a** The list of rendered tabs shall come from capability-aware composition (e.g., `SettingsTabComposer`) so unsupported advanced setup areas are not shown as fully available.

**2.2.3** When the user selects a tab from the mobile dropdown, the system shall close the dropdown modal and update `activeTab`.

### 2.3 Layout — Desktop

**2.3.1** When `isDesktop` is `true`, `SettingsScreen` shall render a side navigation panel (220px wide) listing the currently available tabs with icon and label, and a scrollable content area to the right.

**2.3.2** When a side nav item is active, the system shall render it with a left border accent and highlighted background.

### 2.4 Layout — Tablet

**2.4.1** When `isDesktop` is `false` and `isMobile` is `false` (tablet), `SettingsScreen` shall render a horizontally scrollable tab bar above the content area.

**2.4.2** When a tab is active in the tab bar, the system shall render it with a bottom border accent and primary colour text.

### 2.5 Layout — Mobile

**2.5.1** When `isMobile` is `true`, `SettingsScreen` shall render a single-row dropdown trigger showing the active tab's icon and label.

**2.5.2** When the user taps the dropdown trigger, the system shall open a modal overlay listing the currently available tabs with icon, label, and a checkmark on the active tab.

**2.5.3** When the user taps outside the dropdown modal, the system shall close it without changing the active tab.

### 2.6 Unsaved Changes

**2.6.1** When `saveStatus === 'unsaved'`, the system shall render the `FloatingSaveBar` with Save and Discard actions.

**2.6.2** When the user taps Save on the `FloatingSaveBar`, the system shall set `saveStatus` to `'saved'` and hide the bar.

**2.6.3** When the user taps Discard on the `FloatingSaveBar`, the system shall set `saveStatus` to `'saved'` and hide the bar.

### 2.7 Settings Read / Write

**2.7.1** When `useSettings` mounts, the system shall call `KeyValueRepository.getAllKeys()`, then fetch each value in parallel via `Promise.all`, and populate the `settings` map.

**2.7.2** When `getSetting(key, defaultValue)` is called, the system shall return the value from the in-memory map if the key exists, or `defaultValue` if it does not.

**2.7.3** When `updateSetting(key, value)` is called, the system shall call `KeyValueRepository.setObject(key, value)` and update the in-memory map with the new value.

**2.7.4** When `updateSetting` throws, the system shall call `fetchSettings()` to reload from storage and re-throw the error.

---

## 3. State-Driven Requirements

**3.1** While `isLoading` is `true` in `useSettings`, consumers shall treat the settings map as potentially incomplete — individual tab components should handle missing values gracefully via `getSetting(key, defaultValue)`.

**3.2** While `saveStatus === 'unsaved'`, the `FloatingSaveBar` shall be visible at the bottom of the screen above the keyboard.

**3.3** While `dropdownVisible` is `true` on mobile, the tab selection modal shall be rendered over the screen content.

**3.4** While `user.role === 'cashier'`, the settings tab content shall never be rendered — only the access-denied view.

---

## 4. Optional Feature Requirements

**4.1** Where `onGoBack` is provided to `SettingsScreen`, the header shall render a back button that calls `onGoBack()`. Where it is not provided, the back button shall be hidden and `navigation.goBack()` is used if available.

---

## 5. Unwanted Behaviour / Edge Cases

**5.1** If `user` is `null` (not yet authenticated), `SettingsScreen` shall not crash — `user?.role` evaluates to `undefined`, which is not `'cashier'`, so the screen renders normally. In practice this state should not occur since the navigator requires authentication.

**5.2** If `KeyValueRepository.getAllKeys()` throws during `fetchSettings`, `useSettings` shall set `error` and leave `settings` as an empty map — tab components must handle missing settings via `defaultValue`.

**5.3** If `updateSetting` is called concurrently for the same key, the last write wins — there is no optimistic locking.

**5.4** The `FloatingSaveBar` save/discard handlers currently only reset `saveStatus` — individual tab components are responsible for triggering their own persistence logic before or after calling the save bar.

**5.5** Navigating away from `SettingsScreen` with `saveStatus === 'unsaved'` does not prompt the user — unsaved changes are silently discarded.

---

## 7. More Menu Navigation

The `setup.md` feature doc covers the More menu (MoreNavigator) which is the entry point to Settings and other management screens. This section documents the actual behaviour for completeness.

### 7.1 Role-Based Menu Items

The actual menu access per role (from `utils/roleAccess.ts` + `MoreMenuComposer`):

| Menu Item        | Screen                  | admin | manager | cashier | Capability gate |
| ---------------- | ----------------------- | ----- | ------- | ------- | --------------- |
| Order History    | `OrderHistoryScreen`    | ✅    | ✅      | ✅      | None            |
| Refund           | `RefundScreen`          | ✅    | ✅      | ❌      | `refunds`       |
| Sync Queue       | `SyncQueueScreen`       | ✅    | ✅      | ❌      | `orderSync`     |
| Reports          | `ReportingScreen`       | ✅    | ✅      | ❌      | None            |
| Printer          | `PrinterScreen`         | ✅    | ✅      | ✅      | None            |
| Payment Terminal | `PaymentTerminalScreen` | ✅    | ✅      | ✅      | None            |
| User Management  | `UsersScreen`           | ✅    | ❌      | ❌      | None            |
| Settings         | `SettingsScreen`        | ✅    | ✅      | ❌      | None            |
| Theme            | `ThemeSettingsTab`      | ✅    | ✅      | ✅      | None (always)   |
| Logout           | —                       | ✅    | ✅      | ✅      | None (always)   |

Items with a capability gate are hidden (not just disabled) when the platform marks that feature `not_recommended`. Items with a `custom` capability level are shown as disabled with a reason subtitle unless the adapter is ready.

The More menu also shows:

- A **"Finish setup" banner** at the top when `SetupProgressService.hasDeferredSetup()` returns `true`, linking to Settings.
- A **theme indicator strip** showing the active theme's color swatches and name, linking directly to the Theme screen.

### 7.2 Requirements

**7.2.1** When `MoreMenuScreen` renders, the system shall call `composeMoreMenu({ userRole, platform, capabilities })` and render only items with `status: 'enabled'` or `status: 'disabled'`. Items with `status: 'hidden'` are excluded entirely.

**7.2.2** When the user taps an enabled menu item, the system shall navigate to the corresponding stack screen via `navigation.navigate(key)`.

**7.2.3** When a menu item has `status: 'disabled'`, the system shall render it at reduced opacity with a reason subtitle and a block icon — it shall not be tappable.

**7.2.4** When a stack screen is navigated to, the system shall render a `Suspense` fallback (`ActivityIndicator`) while the lazy-loaded component resolves.

**7.2.5** When `userRole` is `undefined` (not yet resolved), the system shall default to `'cashier'` — the least-privilege role — ensuring no elevated items are shown before role is confirmed.

**7.2.6** When `SetupProgressService.hasDeferredSetup()` returns `true`, the system shall render a "Finish setup" banner above the menu list that navigates to Settings on tap.

**7.2.7** The system shall always render a theme indicator strip showing the active theme's color swatches and name. Tapping it shall navigate to the `Theme` screen.

**7.2.8** Logout shall always be the last item and shall not be subject to role or capability gating.

| Requirement (summary)                         | Component / Service                       | Source File                                  |
| --------------------------------------------- | ----------------------------------------- | -------------------------------------------- |
| Cashier role → access denied view             | `SettingsScreen` role guard               | `screens/SettingsScreen.tsx`                 |
| Settings hidden from cashier in More menu     | `canAccessMoreMenuItem`                   | `utils/roleAccess.ts`                        |
| Default tab `'generic'` on mount              | `SettingsScreen` useState                 | `screens/SettingsScreen.tsx`                 |
| Tab list from `composeSettingsTabs()`         | `SettingsTabComposer`                     | `services/navigation/SettingsTabComposer.ts` |
| Tab selection updates `activeTab`             | `SettingsScreen` tab handlers             | `screens/SettingsScreen.tsx`                 |
| Desktop: side nav 220px + scrollable content  | `SettingsScreen` isDesktop branch         | `screens/SettingsScreen.tsx`                 |
| Tablet: horizontal scrollable tab bar         | `SettingsScreen` tablet branch            | `screens/SettingsScreen.tsx`                 |
| Mobile: dropdown trigger + modal              | `SettingsScreen` isMobile branch          | `screens/SettingsScreen.tsx`                 |
| Dropdown closes on outside tap                | `SettingsScreen` Modal `onRequestClose`   | `screens/SettingsScreen.tsx`                 |
| `FloatingSaveBar` shown when unsaved          | `SettingsScreen` saveStatus guard         | `screens/SettingsScreen.tsx`                 |
| All settings loaded from KV store on mount    | `useSettings.fetchSettings`               | `hooks/useSettings.ts`                       |
| `getSetting(key, default)` with fallback      | `useSettings.getSetting`                  | `hooks/useSettings.ts`                       |
| `updateSetting` persists + updates map        | `useSettings.updateSetting`               | `hooks/useSettings.ts`                       |
| `updateSetting` failure → re-fetch + re-throw | `useSettings.updateSetting` catch         | `hooks/useSettings.ts`                       |
| `SettingsProvider` wraps hook in context      | `SettingsProvider`                        | `contexts/SettingsProvider.tsx`              |
| `useSettingsData()` throws outside provider   | `useSettingsData` guard                   | `contexts/SettingsProvider.tsx`              |
| Theme persisted to `app.theme` KV key         | `ThemeProvider.setTheme`                  | `contexts/ThemeProvider.tsx`                 |
| Theme loaded on startup                       | `ThemeProvider` useEffect                 | `contexts/ThemeProvider.tsx`                 |
| Theme picker UI                               | `ThemeSettingsTab`                        | `screens/settings/ThemeSettingsTab.tsx`      |
| Theme presets registry                        | `THEME_PRESETS`, `getThemePreset`         | `utils/themes.ts`                            |
| `ThemeColors` derived from `lightColors`      | `type ThemeColors = typeof lightColors`   | `utils/themes.ts`                            |
| More menu composed by role + capability       | `composeMoreMenu`                         | `services/navigation/MoreMenuComposer.ts`    |
| More menu capability gating                   | `evaluateCombinedAccess`                  | `utils/menuCapabilityAccess.ts`              |
| Deferred setup banner in More menu            | `MoreMenuScreen` + `SetupProgressService` | `navigation/MoreNavigator.tsx`               |
| Theme indicator strip in More menu            | `MoreMenuScreen` theme banner             | `navigation/MoreNavigator.tsx`               |
| Logout always visible                         | `MoreMenuScreen` menu construction        | `navigation/MoreNavigator.tsx`               |
| Lazy-loaded screens with Suspense fallback    | `MoreNavigator` Stack.Screen wrappers     | `navigation/MoreNavigator.tsx`               |
| `undefined` role defaults to `'cashier'`      | `canAccessMoreMenuItem` effectiveRole     | `utils/roleAccess.ts`                        |
