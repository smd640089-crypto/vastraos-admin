/**
 * VastraOS Firebase Web Configuration
 * Connected directly to VastraOS's named Cloud Firestore database so all
 * Admin Panel updates sync live into the VastraOS Android application.
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

export const APP_CONFIG_DOC_ID = "vastraos_billing";

export const DEFAULT_APP_CONFIG = {
  ownerUpiId: "vastraos.billing@upi",
  ownerUpiName: "VastraOS Software Technologies",
  ownerUpiQrBase64: "",
  planPriceInr: 299,
  planDays: 30,
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
