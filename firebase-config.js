/**
 * Sarfu Admin — Firebase Web Configuration
 * Connected directly to the named Cloud Firestore database so all
 * Sarfu Admin updates (VastraOS, Public Releases, and future projects) sync live.
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

export const APP_CONFIG_DOC_ID = "vastraos_billing";
export const MC_APP_CONFIG_DOC_ID = "memecircle_billing";
export const PUBLIC_RELEASES_COLLECTION = "publicReleases";

export const MC_USERS_COLLECTION = "mcUsers";
export const MC_SUBSCRIPTIONS_COLLECTION = "mcSubscriptions";
export const MC_REQUESTS_COLLECTION = "mcSubscriptionRequests";
export const MC_NOTIFICATIONS_COLLECTION = "mcNotifications";

export const DEFAULT_APP_CONFIG = {
  ownerUpiId: "vastraos.billing@upi",
  ownerUpiName: "VastraOS Software Technologies",
  ownerUpiQrBase64: "",
  planPriceInr: 299,
  planDays: 30,
  trialDays: 7,
  instructions:
    "Pay ₹299 to VastraOS UPI ID using any UPI app, then enter the 12-digit UTR / Reference number below. Admin verification activates your plan until the 1st of next month.",
  maintenanceMode: false,
  maintenanceMessage:
    "VastraOS is currently undergoing scheduled maintenance. Please check back shortly.",
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

export const DEFAULT_MC_APP_CONFIG = {
  ownerUpiId: "vastraos.billing@upi",
  ownerUpiName: "Sarfu Techno",
  ownerUpiQrBase64: "",
  planPriceInr: 30,
  planDays: 10,
  trialDays: 1,
  instructions:
    "Pay ₹30 via any UPI app to unlock 10 days of Meme Circle Pro (custom images, custom sound effects & 1080p HD video export). Enter your 12-digit UTR below for fast Admin approval.",
  maintenanceMode: false,
  maintenanceMessage:
    "Meme Circle is undergoing quick maintenance. Please check back in a few minutes.",
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

