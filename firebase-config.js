/**
 * My Shop Admin — Firebase Web Configuration
 * Connected directly to the named Cloud Firestore database so all
 * My Shop & Public Storefront updates sync live without changing existing schema.
 */
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCr-trujUZHUzux-gODezY4_r0i6oIojG8",
  authDomain: "gen-lang-client-0802920972.firebaseapp.com",
  projectId: "gen-lang-client-0802920972",
  storageBucket: "gen-lang-client-0802920972.firebasestorage.app",
  messagingSenderId: "782758944496",
};

export const FIRESTORE_DATABASE_ID =
  "ai-studio-android-vastraos-68e6eb3f-251f-4e69-99b1-158305af5e1e";

export const ALLOWED_ADMIN_EMAIL = "smd640089@gmail.com";
export const AUTHORIZED_ADMIN_LABEL = "Sarfu Techno";

// Preserve existing live Firestore document & collection identifiers
export const APP_CONFIG_DOC_ID = "vastraos_billing";
export const PUBLIC_RELEASES_COLLECTION = "publicReleases";

export const DEFAULT_APP_CONFIG = {
  ownerUpiId: "vastraos.billing@upi",
  ownerUpiName: "My Shop Software Technologies",
  ownerUpiQrBase64: "",
  planPriceInr: 299,
  planDays: 30,
  trialDays: 7,
  instructions:
    "Pay ₹299 to My Shop UPI ID using any UPI app, then enter the 12-digit UTR / Reference number below. Admin verification activates your plan until the 1st of next month.",
  maintenanceMode: false,
  maintenanceMessage:
    "My Shop is currently undergoing scheduled maintenance. Please check back shortly.",
  latestAppVersionCode: 1,
  latestAppVersionName: "1.0",
  minSupportedVersionCode: 1,
  updateUrl: "",
  updateNotes: "",
  telegramWebhookUrl: "",
  adminPanelUrl: "",
  notifyOnNewAccount: true,
  notifyOnUtrSubmit: true,
};
