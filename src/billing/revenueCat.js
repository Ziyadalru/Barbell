import { Platform } from 'react-native';
import Purchases, { LOG_LEVEL } from 'react-native-purchases';

const IOS_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY;
export const REVENUECAT_ENTITLEMENT_ID = process.env.EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID || 'pro';

let configured = false;

export function isRevenueCatConfigured() {
  return Boolean(IOS_API_KEY);
}

export function configureRevenueCat() {
  if (configured || !isRevenueCatConfigured() || Platform.OS !== 'ios') return false;
  Purchases.setLogLevel(__DEV__ ? LOG_LEVEL.INFO : LOG_LEVEL.WARN);
  Purchases.configure({ apiKey: IOS_API_KEY });
  configured = true;
  return true;
}

export function hasActiveEntitlement(customerInfo, entitlementId = REVENUECAT_ENTITLEMENT_ID) {
  return Boolean(customerInfo?.entitlements?.active?.[entitlementId]);
}

export async function getCustomerAccess() {
  if (!configureRevenueCat()) return { configured: false, active: false, customerInfo: null };
  const customerInfo = await Purchases.getCustomerInfo();
  return { configured: true, active: hasActiveEntitlement(customerInfo), customerInfo };
}

export async function getPaywallPackages() {
  if (!configureRevenueCat()) return [];
  const offerings = await Purchases.getOfferings();
  return offerings.current?.availablePackages || [];
}

export async function purchaseRevenueCatPackage(pkg) {
  if (!configureRevenueCat()) throw new Error('RevenueCat is not configured.');
  const { customerInfo } = await Purchases.purchasePackage(pkg);
  return { active: hasActiveEntitlement(customerInfo), customerInfo };
}

export async function restoreRevenueCatPurchases() {
  if (!configureRevenueCat()) throw new Error('RevenueCat is not configured.');
  const customerInfo = await Purchases.restorePurchases();
  return { active: hasActiveEntitlement(customerInfo), customerInfo };
}
