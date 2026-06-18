# iOS Shipping Checklist

## App Store Connect

- Create the iOS app with bundle ID `com.ziyadalrubian.barbellz`.
- Create subscription group `Barbellz Pro`.
- Create products for monthly and yearly subscriptions.
- Add a 30-day introductory free trial in App Store Connect if users should get the trial through Apple billing.
- Fill pricing, localization, review screenshots, privacy policy URL, and support URL.

## RevenueCat

- Create an iOS app using the same bundle ID.
- Connect App Store Connect API credentials.
- Import the monthly and yearly products.
- Create entitlement `pro`.
- Attach both products to entitlement `pro`.
- Create an offering with the monthly and yearly packages.
- Copy the RevenueCat iOS public SDK key into `.env`:

```bash
EXPO_PUBLIC_REVENUECAT_IOS_API_KEY=appl_xxxxxxxxxxxxxxxxx
EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID=pro
```

## Build

- Do not test real purchases in Expo Go.
- Use an EAS development build or TestFlight build.
- Log in to Expo before starting cloud builds:

```bash
npx eas-cli login
```

- For internal iPhone testing:

```bash
npx eas-cli build --platform ios --profile preview
```

- For production:

```bash
npx eas-cli build --platform ios --profile production
npx eas-cli submit --platform ios --profile production
```

## Current Local Preflight

- Expo Doctor: `18/18 checks passed`.
- iOS export: passed.
- App config is iOS-only.
- Camera permission text is configured.
- Photo library permission text is configured.
- No Supabase service-role key is present in the app.
- RevenueCat iOS SDK key is still empty in `.env`; real purchases will not work until this is added.
- EAS CLI is not logged in on this machine yet.

## Before Review

- Test purchase monthly.
- Test purchase yearly.
- Test restore purchases.
- Test expired trial/paywall lock.
- Confirm Supabase public food search works.
- Confirm barcode scanner opens on a real iPhone.
