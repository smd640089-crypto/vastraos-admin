/**
 * Sarfu Admin — Meme Circle 1-Click Master Build Prompt Generator
 * Produces a complete, copy-ready prompt for launching the standalone Meme Circle app
 * in a fresh AI Studio project already wired to the live Sarfu Techno Firestore backend.
 */

export function buildMemeCircleMasterPrompt({
  firebaseConfig,
  databaseId,
  mcConfig,
  telegramWebhookUrl,
}) {
  const price = Number(mcConfig?.planPriceInr || 30);
  const days = Number(mcConfig?.planDays || 10);
  const trialDays = Number(mcConfig?.trialDays ?? 1);
  const upiId = mcConfig?.ownerUpiId || "vastraos.billing@upi";
  const upiName = mcConfig?.ownerUpiName || "Sarfu Techno";
  const tgUrl = (telegramWebhookUrl || mcConfig?.telegramWebhookUrl || "").trim();

  return `Build a standalone mobile-first vertical (9:16) Android / web-hybrid creator app named "Meme Circle" by Sarfu Techno, pre-wired to my live Sarfu Techno Admin Panel and Cloud Firestore database.

========================================================
1. CORE GAMEPLAY & VIRAL NEON FLASK MERGE PHYSICS (9:16)
========================================================
- Visual Theme: Ultra-crisp dark studio canvas (#0A0F1A background) designed specifically for viral Instagram Reels & YouTube Shorts.
- Arena Geometry:
  - Large glowing neon-green circular flask/container (#22FF88 with outer neon bloom glow) centered in the 9:16 frame.
  - Narrow vertical glass drop tube at the top opening cleanly into the circular flask.
  - Clean bold bottom caption overlay (customizable by user, default: "will the ball merge into final form ?").
- 2D Physics Simulation:
  - Smooth 60fps 2D physics (gravity, realistic restitution/bounce, rotation, wall containment inside the circular flask, and circle-to-circle collisions).
  - Circular meme balls drop continuously or on-tap from the top vertical tube into the circle, bounce, roll, and collide.
  - Progressive Merge System: Include 7 progressive meme ball tiers (Tier 1 tiny -> Tier 2 -> Tier 3 -> Tier 4 -> Tier 5 -> Tier 6 -> Tier 7 GIANT FINAL FORM).
  - When two identical-tier balls collide, they merge cleanly into the next larger tier ball at the midpoint with:
    * Expanding neon shockwave ring & spark burst animation.
    * Punchy comedic sound effect (pitch-shifted per tier + celebration climax audio when Final Form is reached).
    * Subtle hit-stop / screen-shake micro-juice for oddly satisfying viral watch-time.
  - Include Play / Pause, Auto-Drop Speed toggle, Instant Reset, and "Final Form Reached!" celebration banner.

========================================================
2. CREATOR STUDIO DRAWER & 1080p HD VIDEO EXPORT
========================================================
- Clean collapsible bottom/side Studio Control Drawer where creators can customize:
  1. Custom Images per Ball Tier (Tier 1 to Tier 7): pick photos/memes from device (auto circle-cropped with crisp glowing ring borders) + built-in funny starter meme pack so it works immediately on first launch.
  2. Custom Audio / Sound Effects: upload/pick custom drop SFX, merge SFX per tier, and final-form victory sound + built-in synth/comedic sound bank.
  3. Bottom Caption Text, Font Style, Drop Rate, and Container Neon Glow Color (Neon Green, Cyber Cyan, Electric Pink, Solar Gold, Plasma Purple).
  4. Save & Load custom Meme Packs locally per user account so their creations are never lost.
- 1080p HD Recording & Direct Export:
  - Prominent "Record & Export 1080p" button that renders/captures the 9:16 simulation canvas at crisp 1080x1920 resolution (30fps/60fps) WITH full synchronized game/meme audio included.
  - Live red REC indicator + timer overlay (excluded from the exported video frame so the output Reel is spotless!).
  - When stopped or when Final Form completes, show instant preview + "Download / Save to Gallery" and "Share to Instagram Reels / WhatsApp" buttons.

========================================================
3. AUTHENTICATION, DATA SAFETY & IN-APP OTP PASSWORD RESET
========================================================
- Hybrid Zero-Trust Login Flow (never lose user data!):
  - Step 1: Authenticate via Google Sign-In (Firebase Auth) so Firestore security rules protect each user's UID cleanly.
  - Step 2: Complete/verify the user's Meme Circle Profile: Full Name, Mobile Number, and App Password / 4-6 digit PIN (stored hashed as \`pinHash\` in Firestore \`mcUsers/{uid}\`).
  - Returning users can unlock with Mobile Number + Password/PIN seamlessly while backed by their Firebase UID, restoring their saved profile, subscription status, and custom packs intact.
- In-App Notification "Forgot Password / PIN" Recovery:
  - On "Forgot Password", verify the registered Mobile Number, generate a secure 6-digit OTP inside the app, and deliver it immediately via an **In-App Local Notification** (Android NotificationChannel / in-app notification banner) + log an \`OTP_RESET\` entry to \`mcNotifications\`.
  - User enters the 6-digit OTP to set a new Password/PIN (\`pinHash\` updated in \`mcUsers/{uid}\`).
  - CRITICAL: Old account UID, saved meme packs, and remaining trial/subscription days MUST remain 100% intact—never create a duplicate ID or wipe data.

========================================================
4. MONETIZATION: ${trialDays}-DAY FULL TRIAL -> ₹${price} / ${days}-DAY PRO PLAN
========================================================
- New Account ${trialDays}-Day Full Trial:
  - Every new user gets ${trialDays} full day(s) of unrestricted access (custom images, custom voices/SFX, 1080p HD export).
  - Read \`trialDays\`, \`planPriceInr\`, \`planDays\`, \`ownerUpiId\`, \`ownerUpiName\`, \`ownerUpiQrBase64\`, and \`instructions\` live from Firestore \`appConfig/memecircle_billing\`.
  - Anti-duplicate trial enforcement: \`mcUsers/{uid}.trialUsed\` is set \`true\` permanently and cannot be reset.
- Paywall & Rolling ${days}-Day UPI Subscription (₹${price}):
  - When the ${trialDays}-day trial expires (or subscription expires/suspends), lock Pro features (custom image/audio upload & 1080p export) and display the live UPI QR Paywall screen showing \`ownerUpiQrBase64\`, \`ownerUpiId\` ("${upiId}"), \`ownerUpiName\` ("${upiName}"), Amount ₹${price}, Validity ${days} Days (rolling from approval timestamp), and a 12-digit UTR / Reference Number submission form (+ optional payment screenshot compressed Base64).
  - Submitting UTR writes a \`PENDING\` document to \`mcSubscriptionRequests\` and sets \`mcSubscriptions/{uid}.status = "PAYMENT_PENDING"\`.
  - The moment Sarfu Admin approves the UTR in Sarfu Techno Admin, the app's live \`onSnapshot\` listener on \`mcSubscriptions/{uid}\` unlocks Pro immediately!

========================================================
5. LIVE SARFU TECHNO ADMIN & FIREBASE BACKEND CONTRACT
========================================================
Connect directly to the EXISTING live Firebase project & named Firestore database (do NOT create a separate database or overwrite existing VastraOS rules):
- Firebase Project ID: "${firebaseConfig.projectId}"
- Auth Domain: "${firebaseConfig.authDomain}"
- Storage Bucket: "${firebaseConfig.storageBucket}"
- Messaging Sender ID: "${firebaseConfig.messagingSenderId}"
- Named Firestore Database ID: "${databaseId}"

Use these EXACT isolated Firestore collections (already deployed & secured with zero-trust rules):
1. \`appConfig/memecircle_billing\` (read-only for signed-in users):
   - Fields: \`ownerUpiId\`, \`ownerUpiName\`, \`ownerUpiQrBase64\`, \`planPriceInr\` (default ${price}), \`planDays\` (default ${days}), \`trialDays\` (default ${trialDays}), \`instructions\`, \`maintenanceMode\`, \`maintenanceMessage\`, \`latestAppVersionCode\`, \`latestAppVersionName\`, \`minSupportedVersionCode\`, \`updateUrl\`, \`updateNotes\`, \`telegramWebhookUrl\`, \`notifyOnNewAccount\`, \`notifyOnUtrSubmit\`.
   - Enforce live Maintenance Mode screen (when \`maintenanceMode == true\`) and Force/Optional App Update dialog (comparing \`latestAppVersionCode\` & \`minSupportedVersionCode\`).
2. \`mcUsers/{uid}\`:
   - Required fields: \`uid\`, \`name\`, \`mobileNumber\`, \`email\`, \`pinHash\`, \`trialUsed\` (bool), \`phoneVerified\` (bool), \`createdAt\`, \`updatedAt\`.
3. \`mcSubscriptions/{uid}\`:
   - Required fields: \`uid\`, \`userName\`, \`mobileNumber\`, \`status\` (\`TRIAL_ACTIVE\` | \`TRIAL_EXPIRED\` | \`PAYMENT_PENDING\` | \`ACTIVE\` | \`EXPIRING_SOON\` | \`EXPIRED\` | \`SUSPENDED\`), \`planPriceInr\`, \`planDays\`, \`trialStartMillis\`, \`trialExpiryMillis\`, \`paidStartMillis\`, \`paidExpiryMillis\`, \`lastApprovedUtr\`, \`createdAt\`, \`updatedAt\`.
4. \`mcSubscriptionRequests/{requestId}\`:
   - Required fields: \`uid\`, \`userName\`, \`mobileNumber\`, \`amountInr\`, \`utrNumber\`, \`receiptBase64\` (optional), \`status\` (\`PENDING\` | \`APPROVED\` | \`REJECTED\`), \`adminNote\`, \`reviewedBy\`, \`createdAt\`, \`updatedAt\`.
5. \`mcNotifications/{notificationId}\`:
   - Required fields: \`uid\`, \`type\` (\`SUBSCRIPTION_EXPIRING\` | \`SUBSCRIPTION_EXPIRED\` | \`SUBSCRIPTION_APPROVED\` | \`SUBSCRIPTION_REJECTED\` | \`ADMIN_NOTICE\` | \`OTP_RESET\`), \`title\`, \`message\`, \`referenceId\`, \`read\`, \`createdAt\`.
${
  tgUrl
    ? `
6. Shared 24/7 Sarfu Telegram Admin Alerts:
   - Read \`telegramWebhookUrl\` live from \`appConfig/memecircle_billing\` (fallback: "${tgUrl}").
   - On new user signup (if \`notifyOnNewAccount\`) and on UTR submission (if \`notifyOnUtrSubmit\`), POST JSON to \`telegramWebhookUrl\` with \`{ event: "NEW_ACCOUNT" | "UTR_SUBMITTED", projectName: "Meme Circle", shopName: userName, ownerName: userName, ownerMobile: mobileNumber, amountInr, utrNumber }\`.`
    : `
6. Shared 24/7 Sarfu Telegram Admin Alerts:
   - Read \`telegramWebhookUrl\` live from \`appConfig/memecircle_billing\`. If non-empty, POST JSON on new account signup (\`notifyOnNewAccount\`) and UTR submission (\`notifyOnUtrSubmit\`) with \`projectName: "Meme Circle"\`.`
}

Deliver a polished, addictive, zero-lag UI with Material 3 dark neon aesthetics, smooth 60fps canvas physics, reliable 1080p audio+video recording, and seamless live sync with Sarfu Techno Admin.`;
}
