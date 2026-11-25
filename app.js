import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  onSnapshot,
  setDoc,
  updateDoc,
  deleteDoc,
  runTransaction,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import {
  FIREBASE_CONFIG,
  FIRESTORE_DATABASE_ID,
  ALLOWED_ADMIN_EMAIL,
  AUTHORIZED_ADMIN_LABEL,
  APP_CONFIG_DOC_ID,
  PUBLIC_RELEASES_COLLECTION,
  DEFAULT_APP_CONFIG,
} from "./firebase-config.js";
import { createMemeCircleController } from "./meme-circle-controller.js";

const DAY_MS = 86_400_000;
const IST_OFFSET_MS = 330 * 60 * 1000; // UTC+05:30 (Asia/Kolkata)
const MAX_QR_BASE64_LEN = 340_000; // Safely below 450,000 firestore.rules cap
const MAX_ICON_BASE64_LEN = 160_000; // Safely below 220,000 firestore.rules cap
const VASTRAOS_TABS = new Set(["overview", "approvals", "billing", "shops", "system"]);
const MEMECIRCLE_TABS = new Set([
  "mc-overview",
  "mc-approvals",
  "mc-billing",
  "mc-users",
  "mc-system",
]);

// Initialize Firebase App + Named Firestore Database
const firebaseApp = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp, FIRESTORE_DATABASE_ID);
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

// Application State
const state = {
  user: null,
  viewingStorefront: false,
  activeTab: "hub",
  appConfig: { ...DEFAULT_APP_CONFIG },
  appConfigLoaded: false,
  pendingQrBase64: "",
  requests: [],
  shops: [],
  subscriptions: new Map(), // shopId -> sub doc
  users: new Map(), // uid -> user doc
  publicReleases: [],
  storeFilter: "ALL",
  storeSearch: "",
  utrFilter: "PENDING",
  utrSearch: "",
  shopFilter: "ALL",
  shopSearch: "",
  extendShopId: null,
  manageMode: "monthly", // "monthly" | "paid-days" | "trial-days"
  pendingReleaseIconBase64: "",
  pendingConfirmAction: null,
  unsubscribers: [],
  publicUnsubscriber: null,
};
let memeCircleCtrl = null;

// DOM References
const $ = (id) => document.getElementById(id);

const els = {
  // Top-Level Views & Public Storefront
  publicView: $("public-view"),
  appShell: $("app-shell"),
  openAdminLoginBtn: $("open-admin-login-btn"),
  returnAdminBtn: $("return-admin-btn"),
  sidebarViewStoreBtn: $("sidebar-view-store-btn"),
  topbarViewStoreBtn: $("topbar-view-store-btn"),
  storeTotalCount: $("store-total-count"),
  storeFilterPills: $("store-filter-pills"),
  storeCountAll: $("store-count-all"),
  storeCountApp: $("store-count-app"),
  storeCountGame: $("store-count-game"),
  storeCountTool: $("store-count-tool"),
  storeSearchInput: $("store-search-input"),
  publicReleasesGrid: $("public-releases-grid"),
  storeYear: $("store-year"),

  // Admin Login Modal
  adminLoginModal: $("admin-login-modal"),
  authErrorBox: $("auth-error-box"),
  unauthorizedDomainGuide: $("unauthorized-domain-guide"),
  currentHostnameCode: $("current-hostname-code"),
  copyHostnameBtn: $("copy-hostname-btn"),
  googleSigninBtn: $("google-signin-btn"),
  googleSigninLabel: $("google-signin-label"),

  // Shell & Topbar
  signoutBtn: $("signout-btn"),
  topbarBackHubBtn: $("topbar-back-hub-btn"),
  vastraosSubnav: $("vastraos-subnav"),
  memecircleSubnav: $("memecircle-subnav"),
  subnavPendingBadge: $("subnav-pending-badge"),
  pageTitle: $("page-title"),
  topbarMaintChip: $("topbar-maint-chip"),
  navPendingBadge: $("nav-pending-badge"),
  mobilePendingBadge: $("mobile-pending-badge"),
  navShopsCount: $("nav-shops-count"),
  navReleasesCount: $("nav-releases-count"),
  navTgDot: $("nav-tg-dot"),
  navMaintDot: $("nav-maint-dot"),
  adminAvatar: $("admin-avatar"),
  adminDisplayName: $("admin-display-name"),
  adminEmailLabel: $("admin-email-label"),
  toastContainer: $("toast-container"),

  // Sarfu Hub
  hubTotalEarnings: $("hub-total-earnings"),
  hubEarningsSub: $("hub-earnings-sub"),
  hubTelegramChip: $("hub-telegram-chip"),
  hubTgDot: $("hub-tg-dot"),
  hubTgLabel: $("hub-tg-label"),
  hubMetricPending: $("hub-metric-pending"),
  hubMetricPaid: $("hub-metric-paid"),
  hubMetricTrial: $("hub-metric-trial"),
  hubMetricReleases: $("hub-metric-releases"),
  slotVastraShops: $("slot-vastra-shops"),
  slotVastraPending: $("slot-vastra-pending"),
  slotVastraTrial: $("slot-vastra-trial"),
  slotReleasesLive: $("slot-releases-live"),

  // VastraOS Overview
  kpiPending: $("kpi-pending"),
  kpiActivePaid: $("kpi-active-paid"),
  kpiActiveTrial: $("kpi-active-trial"),
  kpiTrialSub: $("kpi-trial-sub"),
  kpiExpired: $("kpi-expired"),
  kpiRevenue: $("kpi-revenue"),
  kpiRevenueSub: $("kpi-revenue-sub"),
  overviewPendingList: $("overview-pending-list"),
  overviewConfigSummary: $("overview-config-summary"),

  // UTR Approvals
  utrFilterPills: $("utr-filter-pills"),
  utrSearchInput: $("utr-search-input"),
  utrRequestsList: $("utr-requests-list"),
  countReqPending: $("count-req-pending"),
  countReqApproved: $("count-req-approved"),
  countReqRejected: $("count-req-rejected"),
  countReqAll: $("count-req-all"),

  // Billing, Trial & QR
  billingForm: $("billing-form"),
  cfgUpiId: $("cfg-upi-id"),
  cfgUpiName: $("cfg-upi-name"),
  cfgPlanPrice: $("cfg-plan-price"),
  cfgTrialDays: $("cfg-trial-days"),
  cfgInstructions: $("cfg-instructions"),
  qrDropzone: $("qr-dropzone"),
  qrFileInput: $("qr-file-input"),
  qrPickBtn: $("qr-pick-btn"),
  qrClearBtn: $("qr-clear-btn"),
  qrUploadPreviewWrap: $("qr-upload-preview-wrap"),
  qrUploadPreviewImg: $("qr-upload-preview-img"),
  qrSizeHint: $("qr-size-hint"),
  billingLastUpdated: $("billing-last-updated"),
  saveBillingBtn: $("save-billing-btn"),
  previewPriceTitle: $("preview-price-title"),
  previewTrialLabel: $("preview-trial-label"),
  previewPayeeName: $("preview-payee-name"),
  previewUpiId: $("preview-upi-id"),
  previewQrImg: $("preview-qr-img"),
  previewQrEmpty: $("preview-qr-empty"),
  previewInstructions: $("preview-instructions"),

  // Shops
  shopFilterPills: $("shop-filter-pills"),
  shopSearchInput: $("shop-search-input"),
  shopsTableBody: $("shops-table-body"),
  shopsEmptyState: $("shops-empty-state"),
  countShopAll: $("count-shop-all"),
  countShopActive: $("count-shop-active"),
  countShopTrial: $("count-shop-trial"),
  countShopPending: $("count-shop-pending"),
  countShopExpired: $("count-shop-expired"),
  countShopSuspended: $("count-shop-suspended"),

  // System & Updates
  systemForm: $("system-form"),
  sysMaintToggle: $("sys-maint-toggle"),
  maintWarningBanner: $("maint-warning-banner"),
  sysMaintMsg: $("sys-maint-msg"),
  sysLatestCode: $("sys-latest-code"),
  sysLatestName: $("sys-latest-name"),
  sysMinCode: $("sys-min-code"),
  sysUpdateUrl: $("sys-update-url"),
  sysUpdateNotes: $("sys-update-notes"),
  saveSystemBtn: $("save-system-btn"),

  // Global Releases & Instant APK Link Publisher
  releaseForm: $("release-form"),
  releaseFormTitle: $("release-form-title"),
  releaseResetBtn: $("release-reset-btn"),
  relEditId: $("rel-edit-id"),
  relProjectSlot: $("rel-project-slot"),
  relCategory: $("rel-category"),
  relAppName: $("rel-app-name"),
  relFileSize: $("rel-file-size"),
  relVersionName: $("rel-version-name"),
  relVersionCode: $("rel-version-code"),
  relDownloadUrl: $("rel-download-url"),
  relUrlHint: $("rel-url-hint"),
  relIconFileInput: $("rel-icon-file-input"),
  relIconPreview: $("rel-icon-preview"),
  relIconPickBtn: $("rel-icon-pick-btn"),
  relIconClearBtn: $("rel-icon-clear-btn"),
  relNotes: $("rel-notes"),
  relPublishedToggle: $("rel-published-toggle"),
  relSyncVastraRow: $("rel-sync-vastra-row"),
  relSyncTitle: $("rel-sync-title"),
  relSyncHelp: $("rel-sync-help"),
  relSyncVastraToggle: $("rel-sync-vastra-toggle"),
  relSaveBtn: $("rel-save-btn"),
  adminReleasesList: $("admin-releases-list"),

  // Shared Telegram Bot 24/7 Drawer
  heroTelegramChip: $("hero-telegram-chip"),
  heroTgDot: $("hero-tg-dot"),
  heroTgLabel: $("hero-tg-label"),
  tgTriggerStatusPill: $("tg-trigger-status-pill"),
  tgDrawerTabs: $("tg-drawer-tabs"),
  telegramForm: $("telegram-form"),
  tgStatusPill: $("tg-status-pill"),
  tgWebhookUrl: $("tg-webhook-url"),
  tgAdminUrl: $("tg-admin-url"),
  tgNotifyNewAccount: $("tg-notify-new-account"),
  tgNotifyUtrSubmit: $("tg-notify-utr-submit"),
  tgTestBtn: $("tg-test-btn"),
  saveTelegramBtn: $("save-telegram-btn"),
  tgGenToken: $("tg-gen-token"),
  tgToggleTokenBtn: $("tg-toggle-token-btn"),
  tgGenChatId: $("tg-gen-chat-id"),
  tgCopyScriptBtn: $("tg-copy-script-btn"),
  tgPreviewScriptBtn: $("tg-preview-script-btn"),
  tgScriptPreviewWrap: $("tg-script-preview-wrap"),
  tgScriptPreview: $("tg-script-preview"),

  // Modals
  receiptModal: $("receipt-modal"),
  receiptModalImg: $("receipt-modal-img"),
  receiptModalMeta: $("receipt-modal-meta"),
  extendModal: $("extend-modal"),
  extendShopForm: $("extend-shop-form"),
  extendShopDesc: $("extend-shop-desc"),
  extendCurrentSummary: $("extend-current-summary"),
  shopManageTabs: $("shop-manage-tabs"),
  extendMonthsInput: $("extend-months-input"),
  paidExactDaysInput: $("paid-exact-days-input"),
  paidExpireNowBtn: $("paid-expire-now-btn"),
  trialExactDaysInput: $("trial-exact-days-input"),
  extendExpiryPreview: $("extend-expiry-preview"),
  extendNoteInput: $("extend-note-input"),
  confirmExtendBtn: $("confirm-extend-btn"),
  confirmModal: $("confirm-modal"),
  confirmModalTitle: $("confirm-modal-title"),
  confirmModalMessage: $("confirm-modal-message"),
  confirmModalOk: $("confirm-modal-ok"),
};

if (els.storeYear) {
  els.storeYear.textContent = String(new Date().getFullYear());
}

// ============================================================================
// Utilities
// ============================================================================

function showToast(message, type = "success") {
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  els.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(-8px)";
    toast.style.transition = "opacity 0.2s, transform 0.2s";
    setTimeout(() => toast.remove(), 220);
  }, type === "error" ? 4400 : 2900);
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toBase64ImageSrc(raw) {
  if (!raw || typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("data:image/")) return trimmed;
  const mime = trimmed.startsWith("iVBOR") ? "image/png" : "image/jpeg";
  return `data:${mime};base64,${trimmed}`;
}

function toMillis(ts) {
  if (!ts) return 0;
  if (typeof ts === "number") return ts;
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (ts.seconds) return ts.seconds * 1000;
  return 0;
}

function formatDateTime(ms) {
  if (!ms) return "—";
  try {
    return new Date(ms).toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function formatDateShortIst(ms) {
  if (!ms) return "—";
  try {
    return new Date(ms).toLocaleDateString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

function formatFileSize(bytes) {
  if (!bytes || bytes <= 0) return "";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatFirestoreError(err) {
  const code = String(err?.code || "").toLowerCase();
  const msg = String(err?.message || "");
  if (
    code.includes("resource-exhausted") ||
    /resource_exhausted|quota|daily write units/i.test(msg)
  ) {
    return "Firebase Spark daily free write quota was reached earlier. It automatically resets daily at 1:30 PM IST (link-based APK publishing now uses almost 0 quota).";
  }
  if (code.includes("permission-denied") || /missing or insufficient permissions/i.test(msg)) {
    return "Permission denied — please sign out & sign back in with your authorized Sarfu Techno admin account.";
  }
  if (code.includes("unavailable") || /network|offline/i.test(msg)) {
    return "Network unavailable — check your internet connection and try again.";
  }
  return msg || "Unexpected sync error. Please retry.";
}

/**
 * Normalizes Google Drive & Dropbox share URLs into 1-tap direct APK downloads
 * and strictly enforces https:// links.
 */
function normalizeDirectDownloadUrl(rawUrl) {
  const url = String(rawUrl || "").trim();
  if (!url) return "";

  // Google Drive: /file/d/<ID>, /open?id=<ID>, /uc?id=<ID>
  const driveFileMatch = url.match(/^https:\/\/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/i);
  if (driveFileMatch?.[1]) {
    return `https://drive.usercontent.google.com/download?id=${driveFileMatch[1]}&export=download&confirm=t`;
  }
  const driveOpenMatch = url.match(/^https:\/\/drive\.google\.com\/(?:open|uc)\?.*id=([a-zA-Z0-9_-]+)/i);
  if (driveOpenMatch?.[1]) {
    return `https://drive.usercontent.google.com/download?id=${driveOpenMatch[1]}&export=download&confirm=t`;
  }

  // Dropbox: convert preview dl=0 to direct download dl=1
  if (/^https:\/\/(?:www\.)?dropbox\.com\//i.test(url)) {
    try {
      const parsed = new URL(url);
      parsed.searchParams.delete("raw");
      parsed.searchParams.set("dl", "1");
      return parsed.toString();
    } catch {
      return url;
    }
  }

  return url;
}

function isSafeHttpsUrl(rawUrl) {
  const url = String(rawUrl || "").trim();
  if (!url || !url.startsWith("https://")) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function nextFirstOfMonthIstMillis(baseMillis = Date.now(), monthsToAdd = 1) {
  const safeMonths = Math.max(1, Math.min(120, Math.round(Number(monthsToAdd) || 1)));
  const ist = new Date(baseMillis + IST_OFFSET_MS);
  return Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() + safeMonths, 1, 0, 0, 0) - IST_OFFSET_MS;
}

function formatInr(amount) {
  const n = Number(amount) || 0;
  return `₹${n.toLocaleString("en-IN")}`;
}

function clampTrialDays(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 7;
  return Math.max(0, Math.min(90, n));
}

function computeEffectiveStatus(sub, now = Date.now()) {
  if (!sub) return "NO_SUB";
  if (sub.status === "SUSPENDED") return "SUSPENDED";
  if (sub.status === "PAYMENT_PENDING") return "PAYMENT_PENDING";
  const paidExp = Number(sub.paidExpiryMillis || 0);
  const trialExp = Number(sub.trialExpiryMillis || 0);
  if (paidExp > now) {
    const daysLeft = Math.floor((paidExp - now) / DAY_MS);
    return daysLeft <= 3 ? "EXPIRING_SOON" : "ACTIVE";
  }
  if (paidExp > 0 && paidExp <= now) return "EXPIRED";
  if (trialExp > now) {
    const daysLeft = Math.floor((trialExp - now) / DAY_MS);
    return daysLeft <= 2 ? "EXPIRING_SOON" : "TRIAL_ACTIVE";
  }
  return "TRIAL_EXPIRED";
}

function statusPillHtml(status) {
  const label = String(status || "UNKNOWN").replace(/_/g, " ");
  let cls = "pill-neutral";
  if (status === "ACTIVE" || status === "APPROVED") cls = "pill-success";
  else if (status === "TRIAL_ACTIVE") cls = "pill-primary";
  else if (status === "PAYMENT_PENDING" || status === "PENDING" || status === "EXPIRING_SOON")
    cls = "pill-warning";
  else if (status === "EXPIRED" || status === "TRIAL_EXPIRED" || status === "SUSPENDED" || status === "REJECTED")
    cls = "pill-danger";
  return `<span class="pill ${cls}">${escapeHtml(label)}</span>`;
}

function computeFallbackStatus(sub, now = Date.now()) {
  const paidExp = Number(sub?.paidExpiryMillis || 0);
  const trialExp = Number(sub?.trialExpiryMillis || 0);
  if (paidExp > now) return "ACTIVE";
  if (paidExp > 0) return "EXPIRED";
  if (trialExp > now) return "TRIAL_ACTIVE";
  return "TRIAL_EXPIRED";
}

function slugifyId(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

// ============================================================================
// Theme Toggle
// ============================================================================

function toggleTheme() {
  const cur = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  const next = cur === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try {
    localStorage.setItem("vastraos_admin_theme", next);
  } catch {}
}

document.querySelectorAll(".theme-toggle-btn").forEach((btn) => {
  btn.addEventListener("click", toggleTheme);
});

// ============================================================================
// View Switching (Public Storefront <-> Sarfu Admin) & Tab Navigation
// ============================================================================

const TAB_TITLES = {
  hub: "Sarfu Hub",
  releases: "App & Game Releases",
  overview: "VastraOS Overview",
  approvals: "VastraOS UTR Approvals",
  billing: "VastraOS Billing & Trial",
  shops: "VastraOS All Shops",
  system: "VastraOS System & Updates",
  "mc-overview": "Meme Circle Overview",
  "mc-approvals": "Meme Circle UTR Approvals",
  "mc-billing": "Meme Circle Billing & Trial",
  "mc-users": "Meme Circle Users",
  "mc-system": "Meme Circle System & Updates",
};

function syncMainViewVisibility() {
  const isAdmin = Boolean(state.user);
  const showAdmin = isAdmin && !state.viewingStorefront;

  els.publicView.classList.toggle("hidden", showAdmin);
  els.appShell.classList.toggle("hidden", !showAdmin);
  els.openAdminLoginBtn.classList.toggle("hidden", isAdmin);
  els.returnAdminBtn.classList.toggle("hidden", !isAdmin);
}

function switchTab(tab) {
  const safeTab = TAB_TITLES[tab] ? tab : "hub";
  state.activeTab = safeTab;
  els.pageTitle.textContent = TAB_TITLES[safeTab];

  document.querySelectorAll(".tab-panel").forEach((el) => el.classList.remove("active"));
  const target = $(`tab-${safeTab}`);
  if (target) target.classList.add("active");

  const inVastra = VASTRAOS_TABS.has(safeTab);
  const inMemeCircle = MEMECIRCLE_TABS.has(safeTab);
  els.vastraosSubnav.classList.toggle("hidden", !inVastra);
  if (els.memecircleSubnav) els.memecircleSubnav.classList.toggle("hidden", !inMemeCircle);
  els.topbarBackHubBtn.classList.toggle("hidden", safeTab === "hub");

  document.querySelectorAll(".sidebar-nav [data-tab], .project-subnav [data-tab]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === safeTab);
  });

  document.querySelectorAll(".mobile-nav [data-tab]").forEach((btn) => {
    const t = btn.dataset.tab;
    const isActive =
      t === safeTab ||
      (t === "overview" && inVastra) ||
      (t === "mc-overview" && inMemeCircle);
    btn.classList.toggle("active", isActive);
  });

  if (window.innerWidth <= 820) {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

document.querySelectorAll("[data-tab]").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

document.querySelectorAll("[data-goto-tab]").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.gotoTab));
});

els.topbarBackHubBtn.addEventListener("click", () => switchTab("hub"));

els.openAdminLoginBtn.addEventListener("click", () => {
  clearAuthErrors();
  openModal("admin-login-modal");
});

els.returnAdminBtn.addEventListener("click", () => {
  state.viewingStorefront = false;
  syncMainViewVisibility();
});

[els.sidebarViewStoreBtn, els.topbarViewStoreBtn].forEach((btn) => {
  if (!btn) return;
  btn.addEventListener("click", () => {
    state.viewingStorefront = true;
    syncMainViewVisibility();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
});

// Interactive Overview KPI tiles jump straight to filtered tabs
document.querySelectorAll("[data-kpi-jump]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const [tab, filter] = String(btn.dataset.kpiJump || "").split(":");
    if (tab === "approvals" && filter) {
      state.utrFilter = filter;
      state.utrSearch = "";
      els.utrSearchInput.value = "";
      syncUtrFilterPills();
      renderUtrRequests();
      switchTab("approvals");
    } else if (tab === "shops" && filter) {
      state.shopFilter = filter;
      state.shopSearch = "";
      els.shopSearchInput.value = "";
      els.shopFilterPills.querySelectorAll(".filter-pill").forEach((b) => {
        b.classList.toggle("active", b.dataset.shopFilter === state.shopFilter);
      });
      renderShops();
      switchTab("shops");
    }
  });
});

// ============================================================================
// Modals & Shared Telegram Drawer
// ============================================================================

function syncBodyModalLock() {
  const anyOpen = Array.from(document.querySelectorAll(".modal-backdrop")).some(
    (el) => !el.classList.contains("hidden")
  );
  document.body.classList.toggle("modal-open", anyOpen);
}

function openModal(id) {
  const el = $(id);
  if (el) {
    el.classList.remove("hidden");
    syncBodyModalLock();
  }
}

function closeModal(id) {
  const el = $(id);
  if (el) {
    el.classList.add("hidden");
    syncBodyModalLock();
  }
}

function switchTelegramDrawerTab(subTab = "settings") {
  if (!els.tgDrawerTabs) return;
  els.tgDrawerTabs.querySelectorAll("[data-tg-tab]").forEach((btn) => {
    const active = btn.dataset.tgTab === subTab;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });
  document.querySelectorAll("[data-tg-pane]").forEach((pane) => {
    pane.classList.toggle("active", pane.dataset.tgPane === subTab);
  });
}

function openTelegramDrawer(subTab = "settings") {
  switchTelegramDrawerTab(subTab);
  openModal("telegram-modal");
}

document.querySelectorAll("[data-open-telegram]").forEach((btn) => {
  btn.addEventListener("click", () => openTelegramDrawer("settings"));
});

[els.hubTelegramChip, els.heroTelegramChip].forEach((chip) => {
  if (!chip) return;
  chip.addEventListener("click", () => {
    const connected = Boolean(
      state.appConfig.telegramWebhookUrl &&
        state.appConfig.telegramWebhookUrl.trim().startsWith("https://")
    );
    openTelegramDrawer(connected ? "settings" : "script");
  });
});

els.tgDrawerTabs.querySelectorAll("[data-tg-tab]").forEach((btn) => {
  btn.addEventListener("click", () => switchTelegramDrawerTab(btn.dataset.tgTab));
});

document.querySelectorAll("[data-close-modal]").forEach((btn) => {
  btn.addEventListener("click", () => closeModal(btn.dataset.closeModal));
});

document.querySelectorAll(".modal-backdrop").forEach((backdrop) => {
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) {
      backdrop.classList.add("hidden");
      syncBodyModalLock();
    }
  });
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    document.querySelectorAll(".modal-backdrop:not(.hidden)").forEach((el) => {
      el.classList.add("hidden");
    });
    syncBodyModalLock();
  }
});

function askConfirm({ title, message, okLabel = "Confirm", okClass = "btn-danger", onConfirm }) {
  els.confirmModalTitle.textContent = title;
  els.confirmModalMessage.textContent = message;
  els.confirmModalOk.textContent = okLabel;
  els.confirmModalOk.className = `btn ${okClass}`;
  state.pendingConfirmAction = onConfirm;
  openModal("confirm-modal");
}

els.confirmModalOk.addEventListener("click", async () => {
  const fn = state.pendingConfirmAction;
  closeModal("confirm-modal");
  state.pendingConfirmAction = null;
  if (typeof fn === "function") await fn();
});

// ============================================================================
// PUBLIC RELEASES STOREFRONT (Zero Login Required — Live Real-Time Sync)
// ============================================================================

function startPublicReleasesListener() {
  if (state.publicUnsubscriber) {
    try {
      state.publicUnsubscriber();
    } catch {}
  }
  state.publicUnsubscriber = onSnapshot(
    collection(db, PUBLIC_RELEASES_COLLECTION),
    (snap) => {
      state.publicReleases = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => {
          const timeDiff = toMillis(b.updatedAt || b.createdAt) - toMillis(a.updatedAt || a.createdAt);
          if (timeDiff !== 0) return timeDiff;
          return Number(b.versionCode || 0) - Number(a.versionCode || 0);
        });
      renderPublicStorefront();
      renderAdminReleases();
      renderHub();
    },
    (err) => {
      if (els.publicReleasesGrid) {
        els.publicReleasesGrid.innerHTML = `<div class="panel empty-state" style="grid-column:1/-1">Could not load releases right now. Please refresh in a moment.</div>`;
      }
      console.error("Public releases sync error:", err);
    }
  );
}

els.storeFilterPills.querySelectorAll(".filter-pill").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.storeFilter = btn.dataset.storeFilter || "ALL";
    els.storeFilterPills.querySelectorAll(".filter-pill").forEach((b) => {
      b.classList.toggle("active", b.dataset.storeFilter === state.storeFilter);
    });
    renderPublicStorefront();
  });
});

els.storeSearchInput.addEventListener("input", (e) => {
  state.storeSearch = e.target.value.trim().toLowerCase();
  renderPublicStorefront();
});

function categoryLabel(cat) {
  if (cat === "GAME") return "Android Game";
  if (cat === "TOOL") return "Utility / Tool";
  return "Android App";
}

function slotLabel(slot) {
  if (slot === "VASTRAOS") return "VastraOS";
  if (slot === "MEME_CIRCLE") return "Meme Circle";
  if (slot === "GAMES") return "Sarfu Games";
  return "Sarfu Apps";
}

function renderPublicStorefront() {
  const published = state.publicReleases.filter(
    (r) => r.published !== false && isSafeHttpsUrl(normalizeDirectDownloadUrl(r.downloadUrl))
  );

  const appCount = published.filter((r) => (r.category || "APP") === "APP").length;
  const gameCount = published.filter((r) => r.category === "GAME").length;
  const toolCount = published.filter((r) => r.category === "TOOL").length;

  els.storeTotalCount.textContent = String(published.length);
  els.storeCountAll.textContent = String(published.length);
  els.storeCountApp.textContent = String(appCount);
  els.storeCountGame.textContent = String(gameCount);
  els.storeCountTool.textContent = String(toolCount);

  let items = published;
  if (state.storeFilter !== "ALL") {
    items = items.filter((r) => (r.category || "APP") === state.storeFilter);
  }
  if (state.storeSearch) {
    const q = state.storeSearch;
    items = items.filter(
      (r) =>
        (r.appName || "").toLowerCase().includes(q) ||
        (r.versionName || "").toLowerCase().includes(q) ||
        (r.releaseNotes || "").toLowerCase().includes(q) ||
        (r.projectSlot || "").toLowerCase().includes(q)
    );
  }

  if (items.length === 0) {
    els.publicReleasesGrid.innerHTML = `<div class="panel empty-state" style="grid-column:1/-1">${
      published.length === 0
        ? "No official releases published yet. Check back shortly for the latest VastraOS &amp; Sarfu Techno APK updates."
        : "No apps or games match your search filter."
    }</div>`;
    return;
  }

  els.publicReleasesGrid.innerHTML = items
    .map((rel) => {
      const safeUrl = normalizeDirectDownloadUrl(rel.downloadUrl);
      const iconSrc = toBase64ImageSrc(rel.iconBase64);
      const initial = escapeHtml((rel.appName || "S").trim().charAt(0).toUpperCase() || "S");
      const iconCls =
        rel.category === "GAME" ? "icon-game" : rel.category === "TOOL" ? "icon-tool" : "";
      const updatedMs = toMillis(rel.updatedAt || rel.createdAt);
      const fileSlug = `${slugifyId(rel.appName || "app")}-v${slugifyId(rel.versionName || "1")}.apk`;
      const dlIconSvg = `
            <svg class="btn-svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>`;

      return `
      <article class="store-card anim-rise" data-release-card="${escapeHtml(rel.id)}">
        <div class="store-card-head">
          <div class="store-app-icon ${iconCls}">
            ${iconSrc ? `<img src="${iconSrc}" alt="${escapeHtml(rel.appName)} icon" />` : initial}
          </div>
          <div class="store-card-title-wrap">
            <div class="store-card-title">${escapeHtml(rel.appName)}</div>
            <div class="store-card-badges">
              <span class="pill pill-primary pill-compact mono">v${escapeHtml(rel.versionName)} (#${Number(rel.versionCode || 1)})</span>
              <span class="pill pill-neutral pill-compact">${escapeHtml(categoryLabel(rel.category))}</span>
              ${rel.fileSizeLabel ? `<span class="pill pill-success pill-compact mono">${escapeHtml(rel.fileSizeLabel)}</span>` : ""}
            </div>
          </div>
        </div>

        <div class="store-card-notes">${escapeHtml(
          rel.releaseNotes || "Official latest verified Android APK release by Sarfu Techno."
        )}</div>

        <div class="store-card-meta">
          <span>${escapeHtml(slotLabel(rel.projectSlot))}</span>
          <span>Updated ${escapeHtml(updatedMs ? formatDateShortIst(updatedMs) : "Recently")}</span>
        </div>

        <div class="store-card-actions">
          <a
            href="${escapeHtml(safeUrl)}"
            download="${escapeHtml(fileSlug)}"
            target="_blank"
            rel="noopener noreferrer"
            class="btn btn-primary btn-download-apk"
          >
            ${dlIconSvg}
            <span>Download APK</span>
          </a>
        </div>
      </article>`;
    })
    .join("");
}

// Start public storefront stream immediately without auth
startPublicReleasesListener();

// ============================================================================
// Authentication (Strictly Verified Owner — Publicly Labeled "Sarfu Techno")
// ============================================================================

function showAuthError(msg) {
  els.authErrorBox.textContent = msg;
  els.authErrorBox.classList.remove("hidden");
}

function clearAuthErrors() {
  els.authErrorBox.classList.add("hidden");
  els.unauthorizedDomainGuide.classList.add("hidden");
}

function showUnauthorizedDomainHelp() {
  els.currentHostnameCode.textContent = window.location.hostname || "your-domain";
  els.unauthorizedDomainGuide.classList.remove("hidden");
}

els.copyHostnameBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(window.location.hostname);
    showToast("Domain copied to clipboard!");
  } catch {
    showToast("Copy manually from the box above.", "error");
  }
});

els.googleSigninBtn.addEventListener("click", async () => {
  clearAuthErrors();
  els.googleSigninBtn.disabled = true;
  els.googleSigninLabel.textContent = "Signing in...";
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (err) {
    const code = err?.code || "";
    if (code === "auth/unauthorized-domain") {
      showUnauthorizedDomainHelp();
    } else if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment") {
      try {
        await signInWithRedirect(auth, googleProvider);
        return;
      } catch (rErr) {
        showAuthError(rErr?.message || "Google Sign-In redirect failed.");
      }
    } else if (code !== "auth/popup-closed-by-user" && code !== "auth/cancelled-popup-request") {
      showAuthError(err?.message || "Google Sign-In failed. Please try again.");
    }
  } finally {
    els.googleSigninBtn.disabled = false;
    els.googleSigninLabel.textContent = "Sign in with Google";
  }
});

els.signoutBtn.addEventListener("click", async () => {
  stopAdminListeners();
  state.viewingStorefront = false;
  await signOut(auth);
  showToast("Signed out of Sarfu Admin safely.");
});

getRedirectResult(auth).catch((err) => {
  if (err?.code === "auth/unauthorized-domain") {
    openModal("admin-login-modal");
    showUnauthorizedDomainHelp();
  } else if (err?.message) {
    openModal("admin-login-modal");
    showAuthError(err.message);
  }
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    stopAdminListeners();
    state.user = null;
    state.viewingStorefront = false;
    syncMainViewVisibility();
    return;
  }

  const email = (user.email || "").toLowerCase();
  if (email !== ALLOWED_ADMIN_EMAIL.toLowerCase() || !user.emailVerified) {
    stopAdminListeners();
    await signOut(auth);
    state.user = null;
    state.viewingStorefront = false;
    syncMainViewVisibility();
    openModal("admin-login-modal");
    showAuthError(
      `Access denied. Only the authorized ${AUTHORIZED_ADMIN_LABEL} owner account can enter Sarfu Admin.`
    );
    return;
  }

  clearAuthErrors();
  closeModal("admin-login-modal");
  state.user = user;
  state.viewingStorefront = false;
  els.adminDisplayName.textContent = AUTHORIZED_ADMIN_LABEL;
  els.adminEmailLabel.textContent = "Authorized Owner";
  els.adminAvatar.textContent = "S";

  syncMainViewVisibility();
  switchTab(state.activeTab || "hub");
  startAdminListeners();
});

// ============================================================================
// Live Admin Firestore Listeners (Owner Only)
// ============================================================================

function stopAdminListeners() {
  state.unsubscribers.forEach((unsub) => {
    try {
      unsub();
    } catch {}
  });
  state.unsubscribers = [];
  memeCircleCtrl?.stopListeners();
}

function startAdminListeners() {
  stopAdminListeners();
  memeCircleCtrl?.startListeners();

  // 1. Live appConfig/vastraos_billing
  const cfgRef = doc(db, "appConfig", APP_CONFIG_DOC_ID);
  state.unsubscribers.push(
    onSnapshot(
      cfgRef,
      (snap) => {
        const data = snap.exists() ? snap.data() : {};
        state.appConfig = {
          ...DEFAULT_APP_CONFIG,
          ...data,
        };
        if (!state.appConfigLoaded) {
          state.appConfigLoaded = true;
          populateConfigForms();
        } else {
          // Keep non-focused system & billing controls synced live with Firestore
          const activeEl = document.activeElement;
          if (activeEl !== els.sysMaintToggle) {
            els.sysMaintToggle.checked = Boolean(state.appConfig.maintenanceMode);
            els.maintWarningBanner.classList.toggle("hidden", !state.appConfig.maintenanceMode);
          }
          if (!activeEl || !els.billingForm.contains(activeEl)) {
            els.cfgTrialDays.value = clampTrialDays(state.appConfig.trialDays);
            updateBillingPreview();
          }
          syncFormIndicators();
        }
        renderHub();
        renderOverview();
      },
      (err) => showToast(`Config sync error: ${formatFirestoreError(err)}`, "error")
    )
  );

  // 2. Live subscriptionRequests
  state.unsubscribers.push(
    onSnapshot(
      collection(db, "subscriptionRequests"),
      (snap) => {
        state.requests = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
        renderHub();
        renderOverview();
        renderUtrRequests();
      },
      (err) => showToast(`Requests sync error: ${formatFirestoreError(err)}`, "error")
    )
  );

  // 3. Live shops
  state.unsubscribers.push(
    onSnapshot(
      collection(db, "shops"),
      (snap) => {
        state.shops = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
        renderHub();
        renderOverview();
        renderShops();
      },
      (err) => showToast(`Shops sync error: ${formatFirestoreError(err)}`, "error")
    )
  );

  // 4. Live subscriptions
  state.unsubscribers.push(
    onSnapshot(
      collection(db, "subscriptions"),
      (snap) => {
        const map = new Map();
        snap.docs.forEach((d) => map.set(d.id, { id: d.id, ...d.data() }));
        state.subscriptions = map;
        renderHub();
        renderOverview();
        renderShops();
      },
      (err) => showToast(`Subscriptions sync error: ${formatFirestoreError(err)}`, "error")
    )
  );

  // 5. Live users (for owner email enrichment)
  state.unsubscribers.push(
    onSnapshot(
      collection(db, "users"),
      (snap) => {
        const map = new Map();
        snap.docs.forEach((d) => map.set(d.id, { id: d.id, ...d.data() }));
        state.users = map;
        renderShops();
      },
      () => {}
    )
  );
}

// ============================================================================
// Render: Sarfu Hub (Earnings Hero ON TOP + Clickable Project Slots BELOW)
// ============================================================================

function computePortfolioMetrics() {
  const now = Date.now();
  const pendingReqs = state.requests.filter((r) => r.status === "PENDING");
  const approvedReqs = state.requests.filter((r) => r.status === "APPROVED");
  const totalRevenue = approvedReqs.reduce((acc, r) => acc + (Number(r.amountInr) || 0), 0);

  let activePaid = 0;
  let activeTrial = 0;
  let expiredOrSuspended = 0;

  state.shops.forEach((shop) => {
    const sub = state.subscriptions.get(shop.shopId || shop.id);
    const eff = computeEffectiveStatus(sub, now);
    if (eff === "ACTIVE" || (eff === "EXPIRING_SOON" && Number(sub?.paidExpiryMillis || 0) > now)) {
      activePaid++;
    } else if (eff === "TRIAL_ACTIVE" || eff === "EXPIRING_SOON") {
      activeTrial++;
    } else if (eff === "EXPIRED" || eff === "TRIAL_EXPIRED" || eff === "SUSPENDED") {
      expiredOrSuspended++;
    }
  });

  const publishedReleases = state.publicReleases.filter(
    (r) => r.published !== false && isSafeHttpsUrl(normalizeDirectDownloadUrl(r.downloadUrl))
  );

  return {
    pendingReqs,
    approvedReqs,
    totalRevenue,
    activePaid,
    activeTrial,
    expiredOrSuspended,
    publishedReleasesCount: publishedReleases.length,
  };
}

function renderHub() {
  const m = computePortfolioMetrics();
  const mc = memeCircleCtrl?.getMetrics() || {
    totalRevenue: 0,
    approvedReqs: [],
    pendingReqs: [],
    activePaid: 0,
    activeTrial: 0,
  };
  const trialDays = clampTrialDays(state.appConfig.trialDays);

  const combinedRevenue = m.totalRevenue + mc.totalRevenue;
  const combinedApproved = m.approvedReqs.length + mc.approvedReqs.length;
  const combinedPending = m.pendingReqs.length + mc.pendingReqs.length;
  const combinedPaid = m.activePaid + mc.activePaid;
  const combinedTrial = m.activeTrial + mc.activeTrial;

  els.hubTotalEarnings.textContent = formatInr(combinedRevenue);
  els.hubEarningsSub.textContent = `${combinedApproved} approved payment${
    combinedApproved === 1 ? "" : "s"
  } (VastraOS ${formatInr(m.totalRevenue)} • Meme Circle ${formatInr(mc.totalRevenue)})`;
  els.hubMetricPending.textContent = String(combinedPending);
  els.hubMetricPaid.textContent = String(combinedPaid);
  els.hubMetricTrial.textContent = String(combinedTrial);
  els.hubMetricReleases.textContent = String(m.publishedReleasesCount);

  els.slotVastraShops.textContent = String(state.shops.length);
  els.slotVastraPending.textContent = String(m.pendingReqs.length);
  els.slotVastraTrial.textContent = trialDays === 0 ? "Off" : `${trialDays}d`;
  els.slotReleasesLive.textContent = String(m.publishedReleasesCount);
  els.navReleasesCount.textContent = String(state.publicReleases.length);
}

// ============================================================================
// Render: VastraOS Overview
// ============================================================================

function renderOverview() {
  const m = computePortfolioMetrics();
  const trialDays = clampTrialDays(state.appConfig.trialDays);

  els.kpiPending.textContent = String(m.pendingReqs.length);
  els.kpiActivePaid.textContent = String(m.activePaid);
  els.kpiActiveTrial.textContent = String(m.activeTrial);
  els.kpiTrialSub.textContent = trialDays === 0 ? "Free trial disabled (0d)" : `${trialDays}-day default trial`;
  els.kpiExpired.textContent = String(m.expiredOrSuspended);
  els.kpiRevenue.textContent = formatInr(m.totalRevenue);
  els.kpiRevenueSub.textContent = `${m.approvedReqs.length} approved renewal${
    m.approvedReqs.length === 1 ? "" : "s"
  }`;

  // Navigation badges
  els.navShopsCount.textContent = String(state.shops.length);
  const pendingCount = m.pendingReqs.length;
  [els.navPendingBadge, els.mobilePendingBadge, els.subnavPendingBadge].forEach((badge) => {
    if (!badge) return;
    if (pendingCount > 0) {
      badge.textContent = String(pendingCount);
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }
  });

  const maintOn = Boolean(state.appConfig.maintenanceMode);
  els.topbarMaintChip.classList.toggle("hidden", !maintOn);
  els.navMaintDot.classList.toggle("hidden", !maintOn);

  // Recent pending list
  if (m.pendingReqs.length === 0) {
    els.overviewPendingList.innerHTML = `<div class="empty-state">All caught up! No pending UTR requests right now.</div>`;
  } else {
    els.overviewPendingList.innerHTML = m.pendingReqs
      .slice(0, 5)
      .map(
        (req) => `
      <div class="mini-req-card">
        <div>
          <div class="mini-req-title">${escapeHtml(req.shopName)} &middot; ${formatInr(req.amountInr)}</div>
          <div class="mini-req-sub">UTR: <code class="mono">${escapeHtml(req.utrNumber)}</code> &middot; ${escapeHtml(req.ownerName)} (${escapeHtml(req.ownerMobile)})</div>
        </div>
        <button type="button" class="btn btn-primary btn-sm" data-review-req="${escapeHtml(req.id)}">Review</button>
      </div>`
      )
      .join("");

    els.overviewPendingList.querySelectorAll("[data-review-req]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.utrFilter = "PENDING";
        els.utrSearchInput.value = "";
        state.utrSearch = "";
        syncUtrFilterPills();
        renderUtrRequests();
        switchTab("approvals");
      });
    });
  }

  // Config snapshot
  const cfg = state.appConfig;
  const tgConnected = Boolean(cfg.telegramWebhookUrl && cfg.telegramWebhookUrl.startsWith("https://"));
  els.overviewConfigSummary.innerHTML = `
    <div class="config-row"><span>Owner UPI ID</span><strong class="mono">${escapeHtml(cfg.ownerUpiId)}</strong></div>
    <div class="config-row"><span>Payee Name</span><strong>${escapeHtml(cfg.ownerUpiName)}</strong></div>
    <div class="config-row"><span>UPI QR Code</span><strong>${cfg.ownerUpiQrBase64 ? "Uploaded &amp; Live ✓" : "Not uploaded (UPI ID fallback)"}</strong></div>
    <div class="config-row"><span>Plan Price &amp; Cycle</span><strong>${formatInr(cfg.planPriceInr)} / month (renews on 1st)</strong></div>
    <div class="config-row"><span>Default Free Trial</span><strong>${trialDays === 0 ? "Disabled (0 days)" : `${trialDays} day${trialDays === 1 ? "" : "s"}`}</strong></div>
    <div class="config-row"><span>Maintenance Mode</span><strong>${cfg.maintenanceMode ? '<span class="pill pill-danger">ON</span>' : '<span class="pill pill-success">OFF</span>'}</strong></div>
    <div class="config-row config-row-clickable" data-open-tg-row="true" role="button" tabindex="0"><span>Shared Telegram 24/7</span><strong>${tgConnected ? '<span class="pill pill-success">Connected 24/7 ✓</span>' : '<span class="pill pill-warning">Not Configured</span>'}</strong></div>
    <div class="config-row"><span>App Version Policy</span><strong class="mono">Latest v${escapeHtml(cfg.latestAppVersionName || "1.0")} (#${Number(cfg.latestAppVersionCode || 1)}) &middot; Min #${Number(cfg.minSupportedVersionCode || 1)}</strong></div>
  `;
  const tgRow = els.overviewConfigSummary.querySelector("[data-open-tg-row]");
  if (tgRow) {
    tgRow.addEventListener("click", () => openTelegramDrawer("settings"));
  }
}

// ============================================================================
// Render & Actions: UTR Approvals
// ============================================================================

function syncUtrFilterPills() {
  els.utrFilterPills.querySelectorAll(".filter-pill").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.filter === state.utrFilter);
  });
}

els.utrFilterPills.querySelectorAll(".filter-pill").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.utrFilter = btn.dataset.filter;
    syncUtrFilterPills();
    renderUtrRequests();
  });
});

els.utrSearchInput.addEventListener("input", (e) => {
  state.utrSearch = e.target.value.trim().toLowerCase();
  renderUtrRequests();
});

function renderUtrRequests() {
  const pending = state.requests.filter((r) => r.status === "PENDING");
  const approved = state.requests.filter((r) => r.status === "APPROVED");
  const rejected = state.requests.filter((r) => r.status === "REJECTED");

  els.countReqPending.textContent = String(pending.length);
  els.countReqApproved.textContent = String(approved.length);
  els.countReqRejected.textContent = String(rejected.length);
  els.countReqAll.textContent = String(state.requests.length);

  let filtered = state.requests;
  if (state.utrFilter !== "ALL") {
    filtered = filtered.filter((r) => r.status === state.utrFilter);
  }
  if (state.utrSearch) {
    const q = state.utrSearch;
    filtered = filtered.filter(
      (r) =>
        (r.utrNumber || "").toLowerCase().includes(q) ||
        (r.shopName || "").toLowerCase().includes(q) ||
        (r.ownerName || "").toLowerCase().includes(q) ||
        (r.ownerMobile || "").toLowerCase().includes(q) ||
        (r.shopId || "").toLowerCase().includes(q)
    );
  }

  if (filtered.length === 0) {
    els.utrRequestsList.innerHTML = `<div class="panel empty-state" style="grid-column:1/-1">No subscription requests found in this filter.</div>`;
    return;
  }

  const now = Date.now();
  els.utrRequestsList.innerHTML = filtered
    .map((req) => {
      const receiptSrc = toBase64ImageSrc(req.receiptBase64);
      const isPending = req.status === "PENDING";
      const sub = state.subscriptions.get(req.shopId) || null;
      const baseMs = Math.max(
        now,
        Number(sub?.paidExpiryMillis || 0),
        Number(sub?.trialExpiryMillis || 0)
      );
      const targetExpiryMs = nextFirstOfMonthIstMillis(baseMs, 1);
      return `
      <article class="req-card" data-req-card="${escapeHtml(req.id)}">
        <div class="req-head">
          <div>
            <div class="req-shop">${escapeHtml(req.shopName)}</div>
            <div class="req-owner">${escapeHtml(req.ownerName)} &middot; ${escapeHtml(req.ownerMobile)}</div>
          </div>
          ${statusPillHtml(req.status)}
        </div>

        <div class="req-utr-box">
          <div>
            <div class="req-utr-label">UTR / Reference</div>
            <div class="req-utr-value mono">${escapeHtml(req.utrNumber)}</div>
          </div>
          <div class="req-amount">${formatInr(req.amountInr)}</div>
        </div>

        ${
          receiptSrc
            ? `<div class="req-receipt-thumb" data-open-receipt="${escapeHtml(req.id)}">
                 <img src="${receiptSrc}" alt="Payment receipt" />
                 <div class="req-receipt-info">
                   Payment Screenshot Attached
                   <small>Tap to zoom full receipt</small>
                 </div>
               </div>`
            : `<div class="muted-note">No receipt image attached (UTR text only)</div>`
        }

        <div class="req-meta-row">
          <span>Submitted: ${formatDateTime(toMillis(req.createdAt))}</span>
          <span class="mono">${escapeHtml(req.shopId)}</span>
        </div>

        ${
          isPending
            ? `<div class="field">
                 <input type="text" class="input" data-note-for="${escapeHtml(req.id)}" maxlength="240" placeholder="Optional admin note (shown to shopkeeper)..." />
               </div>
               <div class="req-actions">
                 <button type="button" class="btn btn-emerald" data-approve-req="${escapeHtml(req.id)}">Approve (Till ${escapeHtml(formatDateShortIst(targetExpiryMs))})</button>
                 <button type="button" class="btn btn-ghost-danger" data-reject-req="${escapeHtml(req.id)}">Reject</button>
               </div>`
            : req.adminNote
            ? `<div class="muted-note"><strong>Admin Note:</strong> ${escapeHtml(req.adminNote)}</div>`
            : ""
        }
      </article>`;
    })
    .join("");

  els.utrRequestsList.querySelectorAll("[data-open-receipt]").forEach((el) => {
    el.addEventListener("click", () => {
      const req = state.requests.find((r) => r.id === el.dataset.openReceipt);
      if (!req) return;
      els.receiptModalImg.src = toBase64ImageSrc(req.receiptBase64);
      els.receiptModalMeta.textContent = `${req.shopName} • UTR: ${req.utrNumber} • ${formatInr(req.amountInr)}`;
      openModal("receipt-modal");
    });
  });

  els.utrRequestsList.querySelectorAll("[data-approve-req]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const reqId = btn.dataset.approveReq;
      const req = state.requests.find((r) => r.id === reqId);
      if (!req) return;
      const noteEl = els.utrRequestsList.querySelector(`[data-note-for="${CSS.escape(reqId)}"]`);
      const note = noteEl ? noteEl.value.trim() : "";
      approveUtrRequest(req, note, btn);
    });
  });

  els.utrRequestsList.querySelectorAll("[data-reject-req]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const reqId = btn.dataset.rejectReq;
      const req = state.requests.find((r) => r.id === reqId);
      if (!req) return;
      const noteEl = els.utrRequestsList.querySelector(`[data-note-for="${CSS.escape(reqId)}"]`);
      const note = noteEl ? noteEl.value.trim() : "";
      askConfirm({
        title: "Reject Subscription Request?",
        message: `Reject UTR ${req.utrNumber} for "${req.shopName}"? The shopkeeper will be notified immediately.`,
        okLabel: "Reject Request",
        okClass: "btn-danger",
        onConfirm: () => rejectUtrRequest(req, note, btn),
      });
    });
  });
}

async function approveUtrRequest(req, note, btn) {
  if (!state.user) return;
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Approving...";

  const planPrice = Math.max(1, Math.min(100000, Math.round(Number(state.appConfig.planPriceInr) || 299)));
  const now = Date.now();
  let approvedUntilLabel = "";

  try {
    await runTransaction(db, async (tx) => {
      const reqRef = doc(db, "subscriptionRequests", req.id);
      const subRef = doc(db, "subscriptions", req.shopId);
      const shopRef = doc(db, "shops", req.shopId);

      const reqSnap = await tx.get(reqRef);
      if (!reqSnap.exists()) throw new Error("Request no longer exists.");
      if (reqSnap.data().status !== "PENDING") {
        throw new Error(`Request already processed (${reqSnap.data().status}).`);
      }

      const subSnap = await tx.get(subRef);
      const shopSnap = await tx.get(shopRef);

      const shopData = shopSnap.exists() ? shopSnap.data() : null;
      const existingSub = subSnap.exists() ? subSnap.data() : null;
      const memberUids =
        (existingSub && Array.isArray(existingSub.memberUids) && existingSub.memberUids.length
          ? existingSub.memberUids
          : shopData?.memberUids) || [req.ownerUid];

      const currentPaidExp = Number(existingSub?.paidExpiryMillis || 0);
      const currentTrialExp = Number(existingSub?.trialExpiryMillis || 0);
      const baseMillis = Math.max(now, currentPaidExp, currentTrialExp);
      const newExpiryMillis = nextFirstOfMonthIstMillis(baseMillis, 1);
      const effectiveDays = Math.max(1, Math.min(3650, Math.round((newExpiryMillis - now) / DAY_MS)));
      approvedUntilLabel = formatDateShortIst(newExpiryMillis);
      const cleanNote = (note || `Approved — Valid until ${approvedUntilLabel}`).slice(0, 240);

      tx.update(reqRef, {
        status: "APPROVED",
        adminNote: cleanNote,
        reviewedBy: state.user.uid,
        updatedAt: serverTimestamp(),
      });

      if (subSnap.exists()) {
        tx.update(subRef, {
          status: "ACTIVE",
          planPriceInr: planPrice,
          planDays: effectiveDays,
          paidStartMillis: Number(existingSub.paidStartMillis || 0) > 0 ? existingSub.paidStartMillis : now,
          paidExpiryMillis: newExpiryMillis,
          lastApprovedUtr: String(req.utrNumber || "").slice(0, 64),
          updatedAt: serverTimestamp(),
        });
      } else {
        tx.set(subRef, {
          shopId: req.shopId,
          ownerUid: req.ownerUid,
          memberUids,
          status: "ACTIVE",
          planPriceInr: planPrice,
          planDays: effectiveDays,
          trialStartMillis: now,
          trialExpiryMillis: now,
          paidStartMillis: now,
          paidExpiryMillis: newExpiryMillis,
          lastApprovedUtr: String(req.utrNumber || "").slice(0, 64),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      const notifRef = doc(collection(db, "notifications"));
      tx.set(notifRef, {
        shopId: req.shopId,
        ownerUid: req.ownerUid,
        memberUids,
        type: "SUBSCRIPTION_APPROVED",
        title: "Subscription Activated!",
        message: `Your payment (UTR ${req.utrNumber}) is verified. Monthly plan active until ${approvedUntilLabel} (1st of month).`.slice(
          0,
          400
        ),
        referenceId: req.id,
        read: false,
        createdAt: serverTimestamp(),
      });
    });

    showToast(`Approved ${req.shopName}! Active until ${approvedUntilLabel}.`);
  } catch (err) {
    showToast(`Approve failed: ${formatFirestoreError(err)}`, "error");
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

async function rejectUtrRequest(req, note, btn) {
  if (!state.user) return;
  btn.disabled = true;
  const cleanNote = (note || "UTR could not be verified. Please check and resubmit.").slice(0, 240);
  const now = Date.now();

  try {
    await runTransaction(db, async (tx) => {
      const reqRef = doc(db, "subscriptionRequests", req.id);
      const subRef = doc(db, "subscriptions", req.shopId);
      const shopRef = doc(db, "shops", req.shopId);

      const reqSnap = await tx.get(reqRef);
      if (!reqSnap.exists()) throw new Error("Request not found.");
      if (reqSnap.data().status !== "PENDING") {
        throw new Error(`Request already processed (${reqSnap.data().status}).`);
      }

      const subSnap = await tx.get(subRef);
      const shopSnap = await tx.get(shopRef);
      const existingSub = subSnap.exists() ? subSnap.data() : null;
      const memberUids =
        (existingSub && Array.isArray(existingSub.memberUids) && existingSub.memberUids.length
          ? existingSub.memberUids
          : shopSnap.exists()
          ? shopSnap.data().memberUids
          : null) || [req.ownerUid];

      tx.update(reqRef, {
        status: "REJECTED",
        adminNote: cleanNote,
        reviewedBy: state.user.uid,
        updatedAt: serverTimestamp(),
      });

      if (subSnap.exists() && existingSub.status !== "SUSPENDED") {
        tx.update(subRef, {
          status: computeFallbackStatus(existingSub, now),
          updatedAt: serverTimestamp(),
        });
      }

      const notifRef = doc(collection(db, "notifications"));
      tx.set(notifRef, {
        shopId: req.shopId,
        ownerUid: req.ownerUid,
        memberUids,
        type: "SUBSCRIPTION_REJECTED",
        title: "Subscription Request Rejected",
        message: `UTR ${req.utrNumber} was not approved. Note: ${cleanNote}`.slice(0, 400),
        referenceId: req.id,
        read: false,
        createdAt: serverTimestamp(),
      });
    });

    showToast(`Rejected request for ${req.shopName}.`);
  } catch (err) {
    showToast(`Reject failed: ${formatFirestoreError(err)}`, "error");
    btn.disabled = false;
  }
}

// ============================================================================
// Billing, Dynamic Free Trial Days & UPI QR Editor + Live Preview
// ============================================================================

function populateConfigForms() {
  const cfg = state.appConfig;
  els.cfgUpiId.value = cfg.ownerUpiId || "";
  els.cfgUpiName.value = cfg.ownerUpiName || "";
  els.cfgPlanPrice.value = Number(cfg.planPriceInr) || 299;
  els.cfgTrialDays.value = clampTrialDays(cfg.trialDays);
  els.cfgInstructions.value = cfg.instructions || "";
  state.pendingQrBase64 = cfg.ownerUpiQrBase64 || "";

  // System & Updates fields
  els.sysMaintToggle.checked = Boolean(cfg.maintenanceMode);
  els.maintWarningBanner.classList.toggle("hidden", !cfg.maintenanceMode);
  els.sysMaintMsg.value = cfg.maintenanceMessage || DEFAULT_APP_CONFIG.maintenanceMessage;
  els.sysLatestCode.value = Number(cfg.latestAppVersionCode) || 1;
  els.sysLatestName.value = cfg.latestAppVersionName || "1.0";
  els.sysMinCode.value = Number(cfg.minSupportedVersionCode) || 1;
  els.sysUpdateUrl.value = cfg.updateUrl || "";
  els.sysUpdateNotes.value = cfg.updateNotes || "";

  // Shared Telegram Bot 24/7 Alerts fields
  els.tgWebhookUrl.value = cfg.telegramWebhookUrl || "";
  const detectedAdminUrl =
    window.location.origin && window.location.origin.startsWith("https://")
      ? `${window.location.origin}${window.location.pathname}`
      : "";
  els.tgAdminUrl.value = cfg.adminPanelUrl || detectedAdminUrl;
  els.tgNotifyNewAccount.checked = cfg.notifyOnNewAccount !== false;
  els.tgNotifyUtrSubmit.checked = cfg.notifyOnUtrSubmit !== false;

  syncFormIndicators();
  updateBillingPreview();
  refreshTelegramScriptPreview();
}

function syncFormIndicators() {
  const updatedMs = toMillis(state.appConfig.updatedAt);
  els.billingLastUpdated.textContent = updatedMs
    ? `Last synced: ${formatDateTime(updatedMs)}`
    : "Using default config (click Publish to initialize)";

  const tgLive = Boolean(
    state.appConfig.telegramWebhookUrl &&
      state.appConfig.telegramWebhookUrl.trim().startsWith("https://")
  );
  const pillText = tgLive ? "Connected (24/7 Live)" : "Not Configured";
  const pillCls = `pill pill-compact ${tgLive ? "pill-success" : "pill-warning"}`;
  els.tgStatusPill.textContent = pillText;
  els.tgStatusPill.className = pillCls;
  els.tgTriggerStatusPill.textContent = tgLive ? "Connected 24/7" : "Not Configured";
  els.tgTriggerStatusPill.className = pillCls;

  const dotCls = tgLive ? "status-dot-emerald" : "status-dot-amber";
  els.heroTgDot.className = dotCls;
  els.heroTgLabel.textContent = tgLive ? "Telegram 24/7" : "Setup Telegram";
  els.hubTgDot.className = dotCls;
  els.hubTgLabel.textContent = tgLive ? "Global Telegram 24/7" : "Setup Telegram";
  els.navTgDot.className = dotCls;
  memeCircleCtrl?.syncIndicators();
}

function updateBillingPreview() {
  const upiId = els.cfgUpiId.value.trim() || "vastraos.billing@upi";
  const upiName = els.cfgUpiName.value.trim() || "VastraOS Software Technologies";
  const price = Math.max(1, Math.round(Number(els.cfgPlanPrice.value) || 299));
  const trialDays = clampTrialDays(els.cfgTrialDays.value);
  const nextFirstLabel = formatDateShortIst(nextFirstOfMonthIstMillis(Date.now(), 1));
  const instructions = els.cfgInstructions.value.trim();
  const qrSrc = toBase64ImageSrc(state.pendingQrBase64);

  els.previewPriceTitle.textContent = `Pay ₹${price} • Monthly (Till ${nextFirstLabel})`;
  els.previewTrialLabel.textContent =
    trialDays === 0
      ? "Free trial disabled — paid subscription required"
      : `New shops get ${trialDays}-day free trial`;
  els.previewPayeeName.textContent = upiName;
  els.previewUpiId.textContent = `UPI ID: ${upiId}`;
  els.previewInstructions.textContent = instructions;

  if (qrSrc) {
    els.previewQrImg.src = qrSrc;
    els.previewQrImg.classList.remove("hidden");
    els.previewQrEmpty.classList.add("hidden");
    els.qrUploadPreviewImg.src = qrSrc;
    els.qrUploadPreviewWrap.classList.remove("hidden");
    els.qrClearBtn.classList.remove("hidden");
    const kb = Math.round((state.pendingQrBase64.length * 3) / 4 / 1024);
    els.qrSizeHint.textContent = `QR ready (~${kb} KB raw Base64) — compatible with Android app`;
  } else {
    els.previewQrImg.classList.add("hidden");
    els.previewQrEmpty.classList.remove("hidden");
    els.qrUploadPreviewWrap.classList.add("hidden");
    els.qrClearBtn.classList.add("hidden");
    els.qrSizeHint.textContent = "PNG/JPG auto-resized to ≤512px & saved as raw Base64 (Android compatible)";
  }
}

[els.cfgUpiId, els.cfgUpiName, els.cfgPlanPrice, els.cfgTrialDays, els.cfgInstructions].forEach((input) => {
  input.addEventListener("input", updateBillingPreview);
});

document.querySelectorAll(".cfg-trial-chip").forEach((btn) => {
  btn.addEventListener("click", () => {
    els.cfgTrialDays.value = btn.dataset.trialDays;
    updateBillingPreview();
  });
});

async function compressImageToRawBase64(file, maxDim, maxBase64Len, whiteBg = true) {
  if (!file || !file.type.startsWith("image/")) {
    throw new Error("Please select a valid PNG or JPG image.");
  }

  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read image file."));
    reader.readAsDataURL(file);
  });

  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Invalid image format."));
    i.src = dataUrl;
  });

  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (whiteBg) {
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, w, h);
  }
  ctx.drawImage(img, 0, 0, w, h);

  let outDataUrl = canvas.toDataURL("image/png");
  let rawBase64 = outDataUrl.split(",")[1] || "";

  if (rawBase64.length > maxBase64Len) {
    for (const q of [0.88, 0.78, 0.65, 0.5]) {
      outDataUrl = canvas.toDataURL("image/jpeg", q);
      rawBase64 = outDataUrl.split(",")[1] || "";
      if (rawBase64.length <= maxBase64Len) break;
    }
  }

  if (rawBase64.length > maxBase64Len) {
    throw new Error("Image is still too large after compression. Please use a simpler image.");
  }

  return rawBase64;
}

async function handleQrFile(file) {
  try {
    const rawBase64 = await compressImageToRawBase64(file, 512, MAX_QR_BASE64_LEN, true);
    state.pendingQrBase64 = rawBase64;
    updateBillingPreview();
    showToast("QR compressed & ready! Click 'Publish Live to All Apps' to sync.");
  } catch (err) {
    showToast(err.message, "error");
  }
}

els.qrPickBtn.addEventListener("click", () => els.qrFileInput.click());
els.qrFileInput.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (file) handleQrFile(file);
  e.target.value = "";
});

els.qrClearBtn.addEventListener("click", () => {
  state.pendingQrBase64 = "";
  updateBillingPreview();
  showToast("QR cleared from draft. Click Publish to apply.");
});

["dragenter", "dragover"].forEach((evt) => {
  els.qrDropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    els.qrDropzone.classList.add("dragover");
  });
});
["dragleave", "drop"].forEach((evt) => {
  els.qrDropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    els.qrDropzone.classList.remove("dragover");
  });
});
els.qrDropzone.addEventListener("drop", (e) => {
  const file = e.dataTransfer?.files?.[0];
  if (file) handleQrFile(file);
});

function buildFullAppConfigPayload(overrides = {}) {
  const cur = state.appConfig;
  return {
    ownerUpiId: String(overrides.ownerUpiId ?? cur.ownerUpiId ?? DEFAULT_APP_CONFIG.ownerUpiId).trim().slice(0, 100),
    ownerUpiName: String(overrides.ownerUpiName ?? cur.ownerUpiName ?? DEFAULT_APP_CONFIG.ownerUpiName).trim().slice(0, 100),
    ownerUpiQrBase64: String(overrides.ownerUpiQrBase64 ?? cur.ownerUpiQrBase64 ?? ""),
    planPriceInr: Math.max(1, Math.min(100000, Math.round(Number(overrides.planPriceInr ?? cur.planPriceInr ?? 299)))),
    planDays: Math.max(1, Math.min(3650, Math.round(Number(overrides.planDays ?? cur.planDays ?? 30)))),
    trialDays: clampTrialDays(overrides.trialDays ?? cur.trialDays ?? 7),
    instructions: String(overrides.instructions ?? cur.instructions ?? DEFAULT_APP_CONFIG.instructions).trim().slice(0, 600),
    maintenanceMode: Boolean(overrides.maintenanceMode ?? cur.maintenanceMode ?? false),
    maintenanceMessage: String(overrides.maintenanceMessage ?? cur.maintenanceMessage ?? DEFAULT_APP_CONFIG.maintenanceMessage).trim().slice(0, 400),
    latestAppVersionCode: Math.max(1, Math.min(100000, Math.round(Number(overrides.latestAppVersionCode ?? cur.latestAppVersionCode ?? 1)))),
    latestAppVersionName: String(overrides.latestAppVersionName ?? cur.latestAppVersionName ?? "1.0").trim().slice(0, 40),
    minSupportedVersionCode: Math.max(1, Math.min(100000, Math.round(Number(overrides.minSupportedVersionCode ?? cur.minSupportedVersionCode ?? 1)))),
    updateUrl: String(overrides.updateUrl ?? cur.updateUrl ?? "").trim().slice(0, 500),
    updateNotes: String(overrides.updateNotes ?? cur.updateNotes ?? "").trim().slice(0, 500),
    telegramWebhookUrl: String(overrides.telegramWebhookUrl ?? cur.telegramWebhookUrl ?? "").trim().slice(0, 500),
    adminPanelUrl: String(overrides.adminPanelUrl ?? cur.adminPanelUrl ?? "").trim().slice(0, 500),
    notifyOnNewAccount: Boolean(overrides.notifyOnNewAccount ?? (cur.notifyOnNewAccount !== false)),
    notifyOnUtrSubmit: Boolean(overrides.notifyOnUtrSubmit ?? (cur.notifyOnUtrSubmit !== false)),
    updatedAt: serverTimestamp(),
  };
}

els.billingForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const upiId = els.cfgUpiId.value.trim();
  const upiName = els.cfgUpiName.value.trim();
  const price = Math.round(Number(els.cfgPlanPrice.value));
  const trialDays = Math.round(Number(els.cfgTrialDays.value));
  const instructions = els.cfgInstructions.value.trim();

  if (upiId.length < 3) return showToast("UPI ID must be at least 3 characters.", "error");
  if (!upiName) return showToast("Beneficiary name is required.", "error");
  if (!Number.isInteger(price) || price < 1 || price > 100000)
    return showToast("Plan price must be between ₹1 and ₹100,000.", "error");
  if (!Number.isInteger(trialDays) || trialDays < 0 || trialDays > 90)
    return showToast("Free trial days must be between 0 and 90.", "error");
  if (!instructions) return showToast("Payment instructions are required.", "error");

  els.saveBillingBtn.disabled = true;
  els.saveBillingBtn.textContent = "Publishing...";
  try {
    const payload = buildFullAppConfigPayload({
      ownerUpiId: upiId,
      ownerUpiName: upiName,
      ownerUpiQrBase64: state.pendingQrBase64,
      planPriceInr: price,
      planDays: 30,
      trialDays,
      instructions,
    });
    await setDoc(doc(db, "appConfig", APP_CONFIG_DOC_ID), payload);
    showToast(`Synced! Default Free Trial = ${trialDays} day${trialDays === 1 ? "" : "s"} & UPI QR live.`);
  } catch (err) {
    showToast(`Failed to publish: ${formatFirestoreError(err)}`, "error");
  } finally {
    els.saveBillingBtn.disabled = false;
    els.saveBillingBtn.textContent = "Publish Live to All Apps";
  }
});

// ============================================================================
// Render & Actions: All Registered Shops + 3-Mode Manage Modal (Increase/Decrease Days)
// ============================================================================

els.shopFilterPills.querySelectorAll(".filter-pill").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.shopFilter = btn.dataset.shopFilter;
    els.shopFilterPills.querySelectorAll(".filter-pill").forEach((b) => {
      b.classList.toggle("active", b.dataset.shopFilter === state.shopFilter);
    });
    renderShops();
  });
});

els.shopSearchInput.addEventListener("input", (e) => {
  state.shopSearch = e.target.value.trim().toLowerCase();
  renderShops();
});

function renderShops() {
  const now = Date.now();
  const enriched = state.shops.map((shop) => {
    const shopId = shop.shopId || shop.id;
    const sub = state.subscriptions.get(shopId) || null;
    const user = state.users.get(shop.ownerUid) || null;
    const effStatus = computeEffectiveStatus(sub, now);
    const expiryMs = sub ? Math.max(Number(sub.paidExpiryMillis || 0), Number(sub.trialExpiryMillis || 0)) : 0;
    const daysLeft = expiryMs > now ? Math.ceil((expiryMs - now) / DAY_MS) : 0;
    return { shop, shopId, sub, user, effStatus, expiryMs, daysLeft };
  });

  els.countShopAll.textContent = String(enriched.length);
  els.countShopActive.textContent = String(
    enriched.filter((x) => x.effStatus === "ACTIVE" || (x.effStatus === "EXPIRING_SOON" && Number(x.sub?.paidExpiryMillis || 0) > now)).length
  );
  els.countShopTrial.textContent = String(
    enriched.filter((x) => x.effStatus === "TRIAL_ACTIVE" || (x.effStatus === "EXPIRING_SOON" && Number(x.sub?.paidExpiryMillis || 0) <= now)).length
  );
  els.countShopPending.textContent = String(enriched.filter((x) => x.effStatus === "PAYMENT_PENDING").length);
  els.countShopExpired.textContent = String(enriched.filter((x) => x.effStatus === "EXPIRED" || x.effStatus === "TRIAL_EXPIRED").length);
  els.countShopSuspended.textContent = String(enriched.filter((x) => x.effStatus === "SUSPENDED").length);

  let rows = enriched;
  if (state.shopFilter === "ACTIVE") {
    rows = rows.filter((x) => x.effStatus === "ACTIVE" || (x.effStatus === "EXPIRING_SOON" && Number(x.sub?.paidExpiryMillis || 0) > now));
  } else if (state.shopFilter === "TRIAL") {
    rows = rows.filter((x) => x.effStatus === "TRIAL_ACTIVE" || (x.effStatus === "EXPIRING_SOON" && Number(x.sub?.paidExpiryMillis || 0) <= now));
  } else if (state.shopFilter === "PAYMENT_PENDING") {
    rows = rows.filter((x) => x.effStatus === "PAYMENT_PENDING");
  } else if (state.shopFilter === "EXPIRED") {
    rows = rows.filter((x) => x.effStatus === "EXPIRED" || x.effStatus === "TRIAL_EXPIRED" || x.effStatus === "NO_SUB");
  } else if (state.shopFilter === "SUSPENDED") {
    rows = rows.filter((x) => x.effStatus === "SUSPENDED");
  }

  if (state.shopSearch) {
    const q = state.shopSearch;
    rows = rows.filter(
      (x) =>
        (x.shop.shopName || "").toLowerCase().includes(q) ||
        (x.shop.ownerName || "").toLowerCase().includes(q) ||
        (x.shop.mobileNumber || "").toLowerCase().includes(q) ||
        (x.user?.email || "").toLowerCase().includes(q) ||
        x.shopId.toLowerCase().includes(q)
    );
  }

  if (rows.length === 0) {
    els.shopsTableBody.innerHTML = "";
    els.shopsEmptyState.classList.remove("hidden");
    return;
  }

  els.shopsEmptyState.classList.add("hidden");
  els.shopsTableBody.innerHTML = rows
    .map(({ shop, shopId, sub, user, effStatus, expiryMs, daysLeft }) => {
      const isSuspended = effStatus === "SUSPENDED";
      return `
      <tr>
        <td>
          <div class="cell-title">${escapeHtml(shop.shopName || "Unnamed Shop")}</div>
          <div class="cell-sub mono">${escapeHtml(shopId)}</div>
        </td>
        <td>
          <div class="cell-title">${escapeHtml(shop.ownerName || "—")}</div>
          <div class="cell-sub">${escapeHtml(shop.mobileNumber || "—")}${user?.email ? ` &middot; ${escapeHtml(user.email)}` : ""}</div>
        </td>
        <td>${statusPillHtml(effStatus)}</td>
        <td>
          <div class="cell-title">${expiryMs ? formatDateShortIst(expiryMs) : "—"}</div>
          <div class="cell-sub">${daysLeft > 0 ? `${daysLeft} day${daysLeft === 1 ? "" : "s"} left` : "Expired / Locked"}</div>
        </td>
        <td class="mono">${escapeHtml(sub?.lastApprovedUtr || "—")}</td>
        <td class="text-right">
          <div class="row-actions">
            <button type="button" class="btn btn-primary btn-sm" data-extend-shop="${escapeHtml(shopId)}">Manage Plan / Days</button>
            ${
              isSuspended
                ? `<button type="button" class="btn btn-emerald btn-sm" data-unsuspend-shop="${escapeHtml(shopId)}">Reactivate</button>`
                : `<button type="button" class="btn btn-ghost-danger btn-sm" data-suspend-shop="${escapeHtml(shopId)}">Suspend</button>`
            }
          </div>
        </td>
      </tr>`;
    })
    .join("");

  els.shopsTableBody.querySelectorAll("[data-extend-shop]").forEach((btn) => {
    btn.addEventListener("click", () => openShopManageModal(btn.dataset.extendShop));
  });

  els.shopsTableBody.querySelectorAll("[data-suspend-shop]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const shopId = btn.dataset.suspendShop;
      const shop = state.shops.find((s) => (s.shopId || s.id) === shopId);
      if (!shop) return;
      askConfirm({
        title: `Suspend "${shop.shopName}"?`,
        message: "This will immediately pause access for this shop in the Android app until you reactivate it.",
        okLabel: "Suspend Shop",
        okClass: "btn-danger",
        onConfirm: () => setShopSuspended(shop, true),
      });
    });
  });

  els.shopsTableBody.querySelectorAll("[data-unsuspend-shop]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const shopId = btn.dataset.unsuspendShop;
      const shop = state.shops.find((s) => (s.shopId || s.id) === shopId);
      if (!shop) return;
      setShopSuspended(shop, false);
    });
  });
}

function setShopManageMode(mode) {
  state.manageMode = mode;
  els.shopManageTabs.querySelectorAll("[data-manage-mode]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.manageMode === mode);
  });
  document.querySelectorAll("[data-manage-pane]").forEach((pane) => {
    pane.classList.toggle("active", pane.dataset.managePane === mode);
  });
  updateExtendExpiryPreview();
}

function openShopManageModal(shopId) {
  const shop = state.shops.find((s) => (s.shopId || s.id) === shopId);
  if (!shop) return;
  const sub = state.subscriptions.get(shopId) || null;
  const now = Date.now();
  const paidExp = Number(sub?.paidExpiryMillis || 0);
  const trialExp = Number(sub?.trialExpiryMillis || 0);
  const paidDaysLeft = paidExp > now ? Math.ceil((paidExp - now) / DAY_MS) : 0;
  const trialDaysLeft = trialExp > now ? Math.ceil((trialExp - now) / DAY_MS) : 0;
  const effStatus = computeEffectiveStatus(sub, now);

  state.extendShopId = shopId;
  els.extendShopDesc.textContent = `Manage monthly validity, increase or decrease paid days, or adjust free trial days for "${shop.shopName}" (${shop.ownerName}).`;
  els.extendCurrentSummary.innerHTML = `
    <div><strong>Current Status:</strong> ${escapeHtml(effStatus.replace(/_/g, " "))}</div>
    <div><strong>Paid Expiry:</strong> ${paidExp > 0 ? `${escapeHtml(formatDateShortIst(paidExp))} (${paidDaysLeft}d left)` : "None"}</div>
    <div><strong>Trial Expiry:</strong> ${trialExp > 0 ? `${escapeHtml(formatDateShortIst(trialExp))} (${trialDaysLeft}d left)` : "None"}</div>
  `;

  els.extendMonthsInput.value = 1;
  els.paidExactDaysInput.value = paidDaysLeft;
  els.trialExactDaysInput.value = trialDaysLeft > 0 ? Math.min(90, trialDaysLeft) : clampTrialDays(state.appConfig.trialDays);
  els.extendNoteInput.value = "";

  setShopManageMode("monthly");
  openModal("extend-modal");
}

els.shopManageTabs.querySelectorAll("[data-manage-mode]").forEach((btn) => {
  btn.addEventListener("click", () => setShopManageMode(btn.dataset.manageMode));
});

function updateExtendExpiryPreview() {
  if (!els.extendExpiryPreview) return;
  const shopId = state.extendShopId;
  const sub = shopId ? state.subscriptions.get(shopId) : null;
  const now = Date.now();

  els.extendExpiryPreview.classList.remove("preview-danger");

  if (state.manageMode === "monthly") {
    const months = Math.max(1, Math.min(36, Math.round(Number(els.extendMonthsInput.value) || 1)));
    const baseMillis = Math.max(
      now,
      Number(sub?.paidExpiryMillis || 0),
      Number(sub?.trialExpiryMillis || 0)
    );
    const targetMillis = nextFirstOfMonthIstMillis(baseMillis, months);
    els.extendExpiryPreview.textContent = `Monthly Plan: Will stay active until ${formatDateShortIst(targetMillis)} (12:00 AM IST)`;
  } else if (state.manageMode === "paid-days") {
    const days = Math.max(0, Math.min(3650, Math.round(Number(els.paidExactDaysInput.value) || 0)));
    if (days === 0) {
      els.extendExpiryPreview.classList.add("preview-danger");
      els.extendExpiryPreview.textContent =
        "0 paid days: Will immediately EXPIRE paid plan and lock the shop's VastraOS app (unless active trial remains).";
    } else {
      const targetMillis = now + days * DAY_MS;
      els.extendExpiryPreview.textContent = `Paid Days Adjusted: Active for ${days} day${days === 1 ? "" : "s"} — expires ${formatDateShortIst(targetMillis)} IST`;
    }
  } else {
    const days = clampTrialDays(els.trialExactDaysInput.value);
    if (days === 0) {
      els.extendExpiryPreview.classList.add("preview-danger");
      els.extendExpiryPreview.textContent =
        "0 trial days: Will immediately END free trial for this shop.";
    } else {
      const targetMillis = now + days * DAY_MS;
      els.extendExpiryPreview.textContent = `Free Trial Adjusted: ${days} day${days === 1 ? "" : "s"} left — trial ends ${formatDateShortIst(targetMillis)} IST`;
    }
  }
}

document.querySelectorAll(".quick-months-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    els.extendMonthsInput.value = btn.dataset.months;
    updateExtendExpiryPreview();
  });
});

document.querySelectorAll(".paid-delta-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const delta = Number(btn.dataset.delta || 0);
    const cur = Math.max(0, Math.round(Number(els.paidExactDaysInput.value) || 0));
    els.paidExactDaysInput.value = Math.max(0, Math.min(3650, cur + delta));
    updateExtendExpiryPreview();
  });
});

els.paidExpireNowBtn.addEventListener("click", () => {
  els.paidExactDaysInput.value = 0;
  updateExtendExpiryPreview();
});

document.querySelectorAll(".trial-quick-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    els.trialExactDaysInput.value = clampTrialDays(btn.dataset.trial);
    updateExtendExpiryPreview();
  });
});

[els.extendMonthsInput, els.paidExactDaysInput, els.trialExactDaysInput].forEach((input) => {
  input.addEventListener("input", updateExtendExpiryPreview);
});

els.extendShopForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const shopId = state.extendShopId;
  const shop = state.shops.find((s) => (s.shopId || s.id) === shopId);
  if (!shop) return;

  const mode = state.manageMode;
  const refNote = (els.extendNoteInput.value.trim() || "ADMIN_ADJUSTED").slice(0, 64);
  const planPrice = Math.max(1, Math.min(100000, Math.round(Number(state.appConfig.planPriceInr) || 299)));
  const now = Date.now();
  let successSummary = "";

  els.confirmExtendBtn.disabled = true;
  els.confirmExtendBtn.textContent = "Syncing...";

  try {
    await runTransaction(db, async (tx) => {
      const subRef = doc(db, "subscriptions", shopId);
      const subSnap = await tx.get(subRef);
      const existingSub = subSnap.exists() ? subSnap.data() : null;
      const memberUids =
        (existingSub && Array.isArray(existingSub.memberUids) && existingSub.memberUids.length
          ? existingSub.memberUids
          : shop.memberUids) || [shop.ownerUid];

      const existingTrialStart = Number(existingSub?.trialStartMillis || 0) || now;
      const existingTrialExp = Number(existingSub?.trialExpiryMillis || 0);
      const existingPaidStart = Number(existingSub?.paidStartMillis || 0);
      const existingPaidExp = Number(existingSub?.paidExpiryMillis || 0);

      let updatePayload = {};
      let notifType = "SUBSCRIPTION_APPROVED";
      let notifTitle = "Subscription Updated by Admin";
      let notifMsg = "";

      if (mode === "monthly") {
        const months = Math.round(Number(els.extendMonthsInput.value));
        if (!Number.isInteger(months) || months < 1 || months > 36) {
          throw new Error("Enter valid months between 1 and 36.");
        }
        const baseMillis = Math.max(now, existingPaidExp, existingTrialExp);
        const newExpiryMillis = nextFirstOfMonthIstMillis(baseMillis, months);
        const effectiveDays = Math.max(1, Math.min(3650, Math.round((newExpiryMillis - now) / DAY_MS)));
        const label = formatDateShortIst(newExpiryMillis);
        updatePayload = {
          status: "ACTIVE",
          planPriceInr: planPrice,
          planDays: effectiveDays,
          paidStartMillis: existingPaidStart > 0 ? existingPaidStart : now,
          paidExpiryMillis: newExpiryMillis,
          lastApprovedUtr: refNote,
        };
        notifTitle = "Subscription Extended by Admin";
        notifMsg = `Admin activated your VastraOS monthly plan (${months} month${months === 1 ? "" : "s"}). Valid until ${label} (1st of month).`;
        successSummary = `Activated "${shop.shopName}" until ${label}!`;
      } else if (mode === "paid-days") {
        const days = Math.round(Number(els.paidExactDaysInput.value));
        if (!Number.isInteger(days) || days < 0 || days > 3650) {
          throw new Error("Enter valid paid days between 0 and 3650.");
        }
        if (days === 0) {
          const expiredPaidMs = Math.max(1, now - 1000);
          const nextStatus = existingTrialExp > now ? "TRIAL_ACTIVE" : "EXPIRED";
          updatePayload = {
            status: nextStatus,
            planPriceInr: planPrice,
            planDays: Math.max(1, Number(existingSub?.planDays || 30)),
            paidStartMillis: existingPaidStart > 0 ? existingPaidStart : expiredPaidMs,
            paidExpiryMillis: expiredPaidMs,
            lastApprovedUtr: refNote,
          };
          notifType = "SUBSCRIPTION_EXPIRED";
          notifTitle = "Subscription Validity Updated";
          notifMsg = "Your VastraOS paid subscription validity was updated by Admin. Please renew to continue full access.";
          successSummary = `Paid plan expired immediately for "${shop.shopName}".`;
        } else {
          const newExpiryMillis = now + days * DAY_MS;
          const label = formatDateShortIst(newExpiryMillis);
          updatePayload = {
            status: "ACTIVE",
            planPriceInr: planPrice,
            planDays: Math.max(1, Math.min(3650, days)),
            paidStartMillis: existingPaidStart > 0 ? existingPaidStart : now,
            paidExpiryMillis: newExpiryMillis,
            lastApprovedUtr: refNote,
          };
          notifTitle = "Subscription Days Updated";
          notifMsg = `Admin updated your VastraOS paid subscription to ${days} day${days === 1 ? "" : "s"} remaining (valid until ${label}).`;
          successSummary = `Updated "${shop.shopName}" paid validity to ${days}d (till ${label}).`;
        }
      } else {
        const days = Math.round(Number(els.trialExactDaysInput.value));
        if (!Number.isInteger(days) || days < 0 || days > 90) {
          throw new Error("Enter valid trial days between 0 and 90.");
        }
        const paidStillActive = existingPaidExp > now;
        if (days === 0) {
          const endTrialMs = Math.max(existingTrialStart, now - 1000);
          updatePayload = {
            status: paidStillActive ? "ACTIVE" : "TRIAL_EXPIRED",
            trialStartMillis: existingTrialStart,
            trialExpiryMillis: endTrialMs,
          };
          notifType = paidStillActive ? "SUBSCRIPTION_APPROVED" : "SUBSCRIPTION_EXPIRED";
          notifTitle = "Free Trial Ended";
          notifMsg = "Your VastraOS free trial period was updated by Admin. Subscribe anytime to continue.";
          successSummary = `Ended free trial for "${shop.shopName}".`;
        } else {
          const newTrialExp = now + days * DAY_MS;
          const label = formatDateShortIst(newTrialExp);
          updatePayload = {
            status: paidStillActive ? "ACTIVE" : "TRIAL_ACTIVE",
            trialStartMillis: existingTrialStart,
            trialExpiryMillis: newTrialExp,
          };
          notifTitle = "Free Trial Updated by Admin";
          notifMsg = `Admin set your VastraOS free trial to ${days} day${days === 1 ? "" : "s"} remaining (ends ${label}).`;
          successSummary = `Updated "${shop.shopName}" free trial to ${days}d (till ${label}).`;
        }
      }

      if (subSnap.exists()) {
        tx.update(subRef, {
          ...updatePayload,
          updatedAt: serverTimestamp(),
        });
      } else {
        tx.set(subRef, {
          shopId,
          ownerUid: shop.ownerUid,
          memberUids,
          status: updatePayload.status || "TRIAL_EXPIRED",
          planPriceInr: planPrice,
          planDays: updatePayload.planDays || 30,
          trialStartMillis: updatePayload.trialStartMillis ?? now,
          trialExpiryMillis: updatePayload.trialExpiryMillis ?? now,
          paidStartMillis: updatePayload.paidStartMillis ?? 0,
          paidExpiryMillis: updatePayload.paidExpiryMillis ?? 0,
          lastApprovedUtr: updatePayload.lastApprovedUtr ?? refNote,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      const notifRef = doc(collection(db, "notifications"));
      tx.set(notifRef, {
        shopId,
        ownerUid: shop.ownerUid,
        memberUids,
        type: notifType,
        title: notifTitle,
        message: notifMsg.slice(0, 400),
        referenceId: refNote,
        read: false,
        createdAt: serverTimestamp(),
      });
    });

    closeModal("extend-modal");
    showToast(successSummary);
  } catch (err) {
    showToast(`Update failed: ${formatFirestoreError(err)}`, "error");
  } finally {
    els.confirmExtendBtn.disabled = false;
    els.confirmExtendBtn.textContent = "Apply Changes Now";
  }
});

async function setShopSuspended(shop, suspend) {
  const shopId = shop.shopId || shop.id;
  const sub = state.subscriptions.get(shopId);
  const now = Date.now();
  const planPrice = Math.max(1, Math.min(100000, Math.round(Number(state.appConfig.planPriceInr) || 299)));
  const planDays = Math.max(1, Math.min(3650, Math.round(Number(state.appConfig.planDays) || 30)));
  const memberUids = (sub?.memberUids?.length ? sub.memberUids : shop.memberUids) || [shop.ownerUid];

  try {
    const subRef = doc(db, "subscriptions", shopId);
    if (sub) {
      await updateDoc(subRef, {
        status: suspend ? "SUSPENDED" : computeFallbackStatus(sub, now),
        planPriceInr: Number(sub.planPriceInr) >= 1 ? Math.round(Number(sub.planPriceInr)) : planPrice,
        planDays: Number(sub.planDays) >= 1 ? Math.round(Number(sub.planDays)) : planDays,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(subRef, {
        shopId,
        ownerUid: shop.ownerUid,
        memberUids,
        status: suspend ? "SUSPENDED" : "TRIAL_EXPIRED",
        planPriceInr: planPrice,
        planDays,
        trialStartMillis: now,
        trialExpiryMillis: now,
        paidStartMillis: 0,
        paidExpiryMillis: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    await setDoc(doc(collection(db, "notifications")), {
      shopId,
      ownerUid: shop.ownerUid,
      memberUids,
      type: suspend ? "SUBSCRIPTION_EXPIRED" : "SUBSCRIPTION_APPROVED",
      title: suspend ? "Account Suspended by Admin" : "Account Reactivated",
      message: suspend
        ? "Your VastraOS shop access has been paused by Admin. Please contact support."
        : "Your VastraOS shop access has been restored by Admin.",
      referenceId: shopId,
      read: false,
      createdAt: serverTimestamp(),
    });

    showToast(suspend ? `"${shop.shopName}" suspended.` : `"${shop.shopName}" reactivated!`);
  } catch (err) {
    showToast(`Action failed: ${formatFirestoreError(err)}`, "error");
  }
}

// ============================================================================
// System, Maintenance Mode & App Version Control (VastraOS)
// ============================================================================

els.sysMaintToggle.addEventListener("change", () => {
  els.maintWarningBanner.classList.toggle("hidden", !els.sysMaintToggle.checked);
});

els.systemForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const maintMode = els.sysMaintToggle.checked;
  const maintMsg = els.sysMaintMsg.value.trim() || DEFAULT_APP_CONFIG.maintenanceMessage;
  const latestCode = Math.round(Number(els.sysLatestCode.value));
  const latestName = els.sysLatestName.value.trim();
  const minCode = Math.round(Number(els.sysMinCode.value));
  const updateUrl = normalizeDirectDownloadUrl(els.sysUpdateUrl.value.trim());
  const updateNotes = els.sysUpdateNotes.value.trim();

  if (!Number.isInteger(latestCode) || latestCode < 1 || latestCode > 100000) {
    return showToast("Latest version code must be a positive integer.", "error");
  }
  if (!Number.isInteger(minCode) || minCode < 1 || minCode > 100000) {
    return showToast("Minimum supported version code must be a positive integer.", "error");
  }
  if (minCode > latestCode) {
    return showToast("Minimum supported version code cannot exceed Latest version code.", "error");
  }
  if (!latestName) {
    return showToast("Latest version name is required.", "error");
  }
  if (updateUrl && !/^https?:\/\//i.test(updateUrl)) {
    return showToast("Download URL must start with https://", "error");
  }

  const doSave = async () => {
    els.saveSystemBtn.disabled = true;
    els.saveSystemBtn.textContent = "Syncing...";
    try {
      const payload = buildFullAppConfigPayload({
        maintenanceMode: maintMode,
        maintenanceMessage: maintMsg,
        latestAppVersionCode: latestCode,
        latestAppVersionName: latestName,
        minSupportedVersionCode: minCode,
        updateUrl,
        updateNotes,
      });
      await setDoc(doc(db, "appConfig", APP_CONFIG_DOC_ID), payload);
      showToast(
        maintMode
          ? "Maintenance Mode ENABLED & synced to all apps!"
          : "System & App Update controls synced live!"
      );
    } catch (err) {
      showToast(`Failed to save system config: ${formatFirestoreError(err)}`, "error");
    } finally {
      els.saveSystemBtn.disabled = false;
      els.saveSystemBtn.textContent = "Save & Sync System Controls";
    }
  };

  if (maintMode && !state.appConfig.maintenanceMode) {
    askConfirm({
      title: "Enable Maintenance Mode?",
      message:
        "This will immediately lock all online VastraOS Android users behind the Maintenance Screen until you turn it back off.",
      okLabel: "Enable Maintenance Mode",
      okClass: "btn-danger",
      onConfirm: doSave,
    });
  } else {
    await doSave();
  }
});

// ============================================================================
// Global Releases & APK Upload Publisher (Firebase Storage + Direct Link)
// ============================================================================

function syncReleaseVastraToggleVisibility() {
  const slot = els.relProjectSlot.value;
  const syncable = slot === "VASTRAOS" || slot === "MEME_CIRCLE";
  els.relSyncVastraRow.classList.toggle("hidden", !syncable);
  if (els.relSyncTitle) {
    els.relSyncTitle.textContent =
      slot === "MEME_CIRCLE"
        ? "Also Sync to Meme Circle In-App Updater"
        : "Also Sync to VastraOS In-App Updater";
  }
}

els.relProjectSlot.addEventListener("change", () => {
  if (els.relProjectSlot.value === "GAMES") {
    els.relCategory.value = "GAME";
  } else if (els.relProjectSlot.value === "VASTRAOS") {
    els.relCategory.value = "APP";
    if (!els.relAppName.value.trim()) els.relAppName.value = "VastraOS POS";
  } else if (els.relProjectSlot.value === "MEME_CIRCLE") {
    els.relCategory.value = "APP";
    if (!els.relAppName.value.trim()) els.relAppName.value = "Meme Circle";
  }
  syncReleaseVastraToggleVisibility();
});

function updateReleaseIconPreview() {
  const src = toBase64ImageSrc(state.pendingReleaseIconBase64);
  if (src) {
    els.relIconPreview.innerHTML = `<img src="${src}" alt="App icon preview" />`;
    els.relIconClearBtn.classList.remove("hidden");
  } else {
    els.relIconPreview.innerHTML = `<span>No Icon</span>`;
    els.relIconClearBtn.classList.add("hidden");
  }
}

els.relIconPickBtn.addEventListener("click", () => els.relIconFileInput.click());
els.relIconFileInput.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  try {
    state.pendingReleaseIconBase64 = await compressImageToRawBase64(file, 192, MAX_ICON_BASE64_LEN, false);
    updateReleaseIconPreview();
    showToast("App icon compressed & ready!");
  } catch (err) {
    showToast(err.message, "error");
  }
});

els.relIconClearBtn.addEventListener("click", () => {
  state.pendingReleaseIconBase64 = "";
  updateReleaseIconPreview();
});

// ============================================================================
// Instant Zero-Quota APK Link Publisher (Google Drive / MediaFire / Dropbox)
// ============================================================================

function updateReleaseUrlHint() {
  if (!els.relUrlHint) return;
  const raw = (els.relDownloadUrl?.value || "").trim();
  els.relUrlHint.classList.remove("hint-success", "hint-warn");

  if (!raw) {
    els.relUrlHint.textContent =
      "Supports Google Drive share links (auto-converted), Dropbox links (auto-converted to direct download), MediaFire, and direct .apk HTTPS URLs.";
    return;
  }
  if (!isSafeHttpsUrl(raw)) {
    els.relUrlHint.classList.add("hint-warn");
    els.relUrlHint.textContent = "Link must start with https:// (paste full Google Drive, MediaFire, or Dropbox URL).";
    return;
  }
  if (/drive\.google\.com|drive\.usercontent\.google\.com/i.test(raw)) {
    els.relUrlHint.classList.add("hint-success");
    els.relUrlHint.textContent = "Google Drive link detected — auto-converted to 1-tap direct APK download ✓";
    return;
  }
  if (/dropbox\.com/i.test(raw)) {
    els.relUrlHint.classList.add("hint-success");
    els.relUrlHint.textContent = "Dropbox link detected — auto-converted to direct download (dl=1) ✓";
    return;
  }
  if (/mediafire\.com/i.test(raw)) {
    els.relUrlHint.classList.add("hint-success");
    els.relUrlHint.textContent = "MediaFire link ready ✓";
    return;
  }
  if (/\.apk(\?|$)/i.test(raw)) {
    els.relUrlHint.classList.add("hint-success");
    els.relUrlHint.textContent = "Direct HTTPS .APK link ready ✓";
    return;
  }
  els.relUrlHint.textContent = "Valid HTTPS download link ready ✓";
}

if (els.relDownloadUrl) {
  els.relDownloadUrl.addEventListener("input", updateReleaseUrlHint);
}

function resetReleaseForm() {
  els.relEditId.value = "";
  els.releaseFormTitle.textContent = "Publish New App / Game Update";
  els.releaseResetBtn.classList.add("hidden");
  els.relSaveBtn.textContent = "Publish Release Live";
  els.relProjectSlot.value = "VASTRAOS";
  els.relCategory.value = "APP";
  els.relAppName.value = "";
  els.relFileSize.value = "";
  els.relVersionName.value = "";
  els.relVersionCode.value = "2";
  els.relDownloadUrl.value = "";
  els.relNotes.value = "";
  els.relPublishedToggle.checked = true;
  els.relSyncVastraToggle.checked = true;
  state.pendingReleaseIconBase64 = "";
  updateReleaseIconPreview();
  updateReleaseUrlHint();
  syncReleaseVastraToggleVisibility();
}

els.releaseResetBtn.addEventListener("click", resetReleaseForm);

function loadReleaseIntoForm(rel) {
  els.relEditId.value = rel.id;
  els.releaseFormTitle.textContent = `Edit Release: ${rel.appName}`;
  els.releaseResetBtn.classList.remove("hidden");
  els.relSaveBtn.textContent = "Save Release Changes";
  els.relProjectSlot.value = rel.projectSlot || "APPS";
  els.relCategory.value = rel.category || "APP";
  els.relAppName.value = rel.appName || "";
  els.relFileSize.value = rel.fileSizeLabel || "";
  els.relVersionName.value = rel.versionName || "";
  els.relVersionCode.value = Number(rel.versionCode || 1);
  els.relDownloadUrl.value = rel.downloadUrl || "";
  els.relNotes.value = rel.releaseNotes || "";
  els.relPublishedToggle.checked = rel.published !== false;
  els.relSyncVastraToggle.checked = rel.projectSlot === "VASTRAOS" || rel.projectSlot === "MEME_CIRCLE";
  state.pendingReleaseIconBase64 = rel.iconBase64 || "";
  updateReleaseIconPreview();
  updateReleaseUrlHint();
  syncReleaseVastraToggleVisibility();
  switchTab("releases");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

els.releaseForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!state.user) return;

  const editId = els.relEditId.value.trim();
  const projectSlot = els.relProjectSlot.value || "APPS";
  const category = els.relCategory.value || "APP";
  const appName = els.relAppName.value.trim().slice(0, 100);
  const fileSizeLabel = els.relFileSize.value.trim().slice(0, 40);
  const versionName = els.relVersionName.value.trim().slice(0, 40);
  const versionCode = Math.round(Number(els.relVersionCode.value));
  const downloadUrl = normalizeDirectDownloadUrl(els.relDownloadUrl.value.trim()).slice(0, 1000);
  const releaseNotes = els.relNotes.value.trim().slice(0, 1000);
  const published = els.relPublishedToggle.checked;
  const syncVastra = projectSlot === "VASTRAOS" && els.relSyncVastraToggle.checked;
  const syncMemeCircle = projectSlot === "MEME_CIRCLE" && els.relSyncVastraToggle.checked;

  if (!appName) return showToast("App or Game name is required.", "error");
  if (!versionName) return showToast("Version name is required (e.g. 1.2.0).", "error");
  if (!Number.isInteger(versionCode) || versionCode < 1 || versionCode > 100000) {
    return showToast("Version code must be between 1 and 100000.", "error");
  }
  if (!isSafeHttpsUrl(downloadUrl)) {
    return showToast("Paste a valid https:// Google Drive, MediaFire, Dropbox, or direct APK link.", "error");
  }

  els.relSaveBtn.disabled = true;
  els.relSaveBtn.textContent = "Publishing...";

  try {
    const docId = editId || `${slugifyId(appName) || "release"}-${Date.now().toString(36)}`;
    const existing = state.publicReleases.find((r) => r.id === docId);

    const payload = {
      releaseId: docId,
      deliveryType: "URL",
      projectSlot,
      category,
      appName,
      versionName,
      versionCode,
      downloadUrl,
      fileSizeLabel,
      releaseNotes,
      iconBase64: state.pendingReleaseIconBase64 || "",
      published,
      featured: projectSlot === "VASTRAOS" || projectSlot === "MEME_CIRCLE",
      createdAt: existing?.createdAt || serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    await setDoc(doc(db, PUBLIC_RELEASES_COLLECTION, docId), payload);

    // Optional 1-click sync to VastraOS or Meme Circle In-App Updater
    if (syncVastra) {
      const cfgPayload = buildFullAppConfigPayload({
        latestAppVersionCode: versionCode,
        latestAppVersionName: versionName,
        updateUrl: downloadUrl.slice(0, 500),
        updateNotes: releaseNotes.slice(0, 500),
      });
      await setDoc(doc(db, "appConfig", APP_CONFIG_DOC_ID), cfgPayload);
      els.sysLatestCode.value = versionCode;
      els.sysLatestName.value = versionName;
      els.sysUpdateUrl.value = downloadUrl.slice(0, 500);
      els.sysUpdateNotes.value = releaseNotes.slice(0, 500);
    } else if (syncMemeCircle) {
      await memeCircleCtrl.syncReleaseUpdate({
        versionCode,
        versionName,
        downloadUrl,
        releaseNotes,
      });
    }

    // Fire optional shared Telegram notification on new live release
    if (published && state.appConfig.telegramWebhookUrl?.startsWith("https://")) {
      fetch(state.appConfig.telegramWebhookUrl.trim(), {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          event: "NEW_RELEASE_PUBLISHED",
          projectName: appName,
          versionName,
          versionCode,
          category: categoryLabel(category),
          downloadUrl,
          adminPanelUrl: state.appConfig.adminPanelUrl || "",
          timestampIst: formatDateTime(Date.now()) + " IST",
        }),
      }).catch(() => {});
    }

    showToast(
      published
        ? `${appName} v${versionName} is now LIVE on the Public Downloads Storefront!`
        : `${appName} v${versionName} saved as hidden draft.`
    );
    resetReleaseForm();
  } catch (err) {
    showToast(`Failed to publish release: ${formatFirestoreError(err)}`, "error");
  } finally {
    els.relSaveBtn.disabled = false;
    els.relSaveBtn.textContent = els.relEditId.value ? "Save Release Changes" : "Publish Release Live";
  }
});

function renderReleaseAdminCards(container, releases, emptyText) {
  if (!container) return;
  if (!releases.length) {
    container.innerHTML = `<div class="empty-state">${escapeHtml(emptyText)}</div>`;
    return;
  }

  container.innerHTML = releases
    .map((rel) => {
      const iconSrc = toBase64ImageSrc(rel.iconBase64);
      const initial = escapeHtml((rel.appName || "S").charAt(0).toUpperCase());
      const isLive = rel.published !== false && isSafeHttpsUrl(normalizeDirectDownloadUrl(rel.downloadUrl));
      return `
      <div class="release-admin-card">
        <div class="release-admin-head">
          <div class="release-admin-left">
            <div class="release-mini-icon">
              ${iconSrc ? `<img src="${iconSrc}" alt="${escapeHtml(rel.appName)}" />` : initial}
            </div>
            <div>
              <div class="mini-req-title">${escapeHtml(rel.appName)} <span class="mono">v${escapeHtml(rel.versionName)}</span></div>
              <div class="mini-req-sub">${escapeHtml(slotLabel(rel.projectSlot))} &middot; ${escapeHtml(categoryLabel(rel.category))}${
        rel.fileSizeLabel ? ` &middot; ${escapeHtml(rel.fileSizeLabel)}` : ""
      }</div>
            </div>
          </div>
          <span class="pill pill-compact ${isLive ? "pill-success" : "pill-neutral"}">${isLive ? "LIVE" : "DRAFT"}</span>
        </div>
        <div class="release-admin-actions">
          <button type="button" class="btn btn-secondary btn-sm" data-edit-rel="${escapeHtml(rel.id)}">Edit</button>
          <button type="button" class="btn btn-secondary btn-sm" data-toggle-rel="${escapeHtml(rel.id)}">${
        rel.published !== false ? "Hide" : "Publish"
      }</button>
          <button type="button" class="btn btn-secondary btn-sm" data-copy-rel="${escapeHtml(rel.id)}">Copy APK Link</button>
          <button type="button" class="btn btn-ghost-danger btn-sm" data-del-rel="${escapeHtml(rel.id)}">Delete</button>
        </div>
      </div>`;
    })
    .join("");

  container.querySelectorAll("[data-edit-rel]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const rel = state.publicReleases.find((r) => r.id === btn.dataset.editRel);
      if (rel) loadReleaseIntoForm(rel);
    });
  });

  container.querySelectorAll("[data-toggle-rel]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const rel = state.publicReleases.find((r) => r.id === btn.dataset.toggleRel);
      if (!rel) return;
      try {
        await updateDoc(doc(db, PUBLIC_RELEASES_COLLECTION, rel.id), {
          published: rel.published === false,
          updatedAt: serverTimestamp(),
        });
        showToast(rel.published === false ? `${rel.appName} is now LIVE!` : `${rel.appName} hidden from public store.`);
      } catch (err) {
        showToast(`Failed to update visibility: ${formatFirestoreError(err)}`, "error");
      }
    });
  });

  container.querySelectorAll("[data-copy-rel]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const rel = state.publicReleases.find((r) => r.id === btn.dataset.copyRel);
      if (!rel) return;
      const link = normalizeDirectDownloadUrl(rel.downloadUrl);
      if (!isSafeHttpsUrl(link)) {
        showToast("Edit this release and add a valid HTTPS APK link first.", "error");
        return;
      }
      try {
        await navigator.clipboard.writeText(link);
        showToast("Direct APK download link copied!");
      } catch {
        showToast("Clipboard blocked.", "error");
      }
    });
  });

  container.querySelectorAll("[data-del-rel]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const rel = state.publicReleases.find((r) => r.id === btn.dataset.delRel);
      if (!rel) return;
      askConfirm({
        title: `Delete "${rel.appName} v${rel.versionName}"?`,
        message: "This will immediately remove this APK from the public Sarfu Techno downloads page.",
        okLabel: "Delete Release",
        okClass: "btn-danger",
        onConfirm: async () => {
          try {
            await deleteDoc(doc(db, PUBLIC_RELEASES_COLLECTION, rel.id));
            showToast(`Deleted "${rel.appName}" release.`);
          } catch (err) {
            showToast(`Delete failed: ${formatFirestoreError(err)}`, "error");
          }
        },
      });
    });
  });
}

function renderAdminReleases() {
  renderReleaseAdminCards(
    els.adminReleasesList,
    state.publicReleases,
    "No releases published yet. Paste a Google Drive, MediaFire, or Dropbox APK link on the left to go live in 1 second!"
  );
}

syncReleaseVastraToggleVisibility();

// ============================================================================
// Shared Global Telegram Bot 24/7 Engine (All Projects)
// ============================================================================

function jsStringLiteral(val) {
  return JSON.stringify(String(val ?? ""));
}

function buildAppsScriptCode() {
  const token = els.tgGenToken.value.trim() || "PASTE_YOUR_BOT_TOKEN_HERE";
  const chatId = els.tgGenChatId.value.trim() || "PASTE_YOUR_CHAT_ID_HERE";
  const fallbackAdminUrl =
    els.tgAdminUrl.value.trim() ||
    (window.location.origin.startsWith("https://")
      ? `${window.location.origin}${window.location.pathname}`
      : "");

  return `// =====================================================================
// Sarfu Admin — Shared Multi-Project 24/7 Telegram Relay (Google Apps Script)
// Powers VastraOS + ALL future Sarfu Techno Apps & Games from one webhook.
// Keep this script private in your Google account. Never share BOT_TOKEN.
// =====================================================================

var BOT_TOKEN = ${jsStringLiteral(token)};
var CHAT_ID = ${jsStringLiteral(chatId)};
var DEFAULT_ADMIN_PANEL_URL = ${jsStringLiteral(fallbackAdminUrl)};

function doGet() {
  return ContentService
    .createTextOutput("Sarfu Admin Multi-Project Telegram Webhook is active 24/7.")
    .setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  try {
    var raw = (e && e.postData && e.postData.contents) ? e.postData.contents : "{}";
    var data = JSON.parse(raw);
    var adminUrl = (data.adminPanelUrl && data.adminPanelUrl.indexOf("https://") === 0)
      ? data.adminPanelUrl
      : DEFAULT_ADMIN_PANEL_URL;

    var text = formatSarfuMessage_(data);
    sendTelegram_(text, adminUrl);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function esc_(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatSarfuMessage_(d) {
  var ev = String(d.event || "");
  var project = esc_(d.projectName || "VastraOS");
  var time = esc_(d.timestampIst || Utilities.formatDate(new Date(), "Asia/Kolkata", "dd MMM yyyy, hh:mm a") + " IST");

  if (ev === "NEW_UTR_SUBMITTED" || ev === "NEW_PAYMENT_SUBMITTED") {
    return [
      "💳 <b>NEW PAYMENT / UTR SUBMITTED</b>",
      "📦 <b>Project:</b> " + project,
      "",
      "🏪 <b>Shop / User:</b> " + esc_(d.shopName || d.userName || "—"),
      "👤 <b>Owner:</b> " + esc_(d.ownerName || "—"),
      "📱 <b>Mobile:</b> <code>" + esc_(d.mobileNumber || "—") + "</code>",
      "💰 <b>Amount:</b> ₹" + esc_(d.amountInr || 299) + " (Monthly — Till 1st)",
      "🧾 <b>UTR:</b> <code>" + esc_(d.utrNumber || "—") + "</code>",
      "📎 <b>Receipt:</b> " + (d.hasReceipt ? "Attached ✅" : "UTR Text Only"),
      "🕒 <b>Time:</b> " + time,
      "",
      "Tap below to verify &amp; approve in Sarfu Admin."
    ].join("\\n");
  }

  if (ev === "NEW_SHOP_REGISTERED") {
    var lines = [
      "🏪 <b>NEW SHOP REGISTERED</b>",
      "📦 <b>Project:</b> " + project,
      "",
      "🏷️ <b>Shop:</b> " + esc_(d.shopName || "—"),
      "👤 <b>Owner:</b> " + esc_(d.ownerName || "—"),
      "📱 <b>Mobile:</b> <code>" + esc_(d.mobileNumber || "—") + "</code>"
    ];
    if (d.email) lines.push("📧 <b>Email:</b> " + esc_(d.email));
    if (d.shopType) lines.push("🧵 <b>Type:</b> " + esc_(d.shopType));
    if (d.address) lines.push("📍 <b>Address:</b> " + esc_(d.address));
    lines.push("🔐 <b>Account:</b> " + esc_(d.accountType || project));
    var trialVal = Number(d.trialDays != null ? d.trialDays : 7);
    lines.push("🎁 <b>Trial:</b> " + (trialVal > 0 ? (trialVal + "-Day Free Trial Started") : "No Free Trial"));
    lines.push("🕒 <b>Time:</b> " + time);
    return lines.join("\\n");
  }

  if (ev === "NEW_ACCOUNT_CREATED" || ev === "USER_SIGN_IN") {
    var accLines = [
      "👤 <b>NEW ACCOUNT / SIGN-IN</b>",
      "📦 <b>Project:</b> " + project,
      "",
      "🧑 <b>User:</b> " + esc_(d.ownerName || d.userName || "—"),
      "📱 <b>Mobile:</b> <code>" + esc_(d.mobileNumber || "—") + "</code>"
    ];
    if (d.email) accLines.push("📧 <b>Email:</b> " + esc_(d.email));
    accLines.push("🔐 <b>Mode:</b> " + esc_(d.accountType || project));
    accLines.push("🕒 <b>Time:</b> " + time);
    return accLines.join("\\n");
  }

  if (ev === "NEW_RELEASE_PUBLISHED") {
    return [
      "🚀 <b>NEW APK RELEASE LIVE</b>",
      "📦 <b>Project:</b> " + project,
      "🏷️ <b>Version:</b> v" + esc_(d.versionName || "1.0") + " (#" + esc_(d.versionCode || 1) + ")",
      "📁 <b>Category:</b> " + esc_(d.category || "Android App"),
      "🕒 <b>Time:</b> " + time
    ].join("\\n");
  }

  return [
    "✅ <b>Sarfu Admin Telegram Bot Connected!</b>",
    "📦 <b>Project:</b> " + project,
    "",
    "Your shared 24/7 webhook relay is working for VastraOS and all future Apps &amp; Games.",
    "🕒 <b>Time:</b> " + time
  ].join("\\n");
}

function sendTelegram_(htmlText, adminUrl) {
  var payload = {
    chat_id: CHAT_ID,
    text: htmlText,
    parse_mode: "HTML",
    disable_web_page_preview: true
  };
  if (adminUrl && adminUrl.indexOf("https://") === 0) {
    payload.reply_markup = {
      inline_keyboard: [[
        { text: "🔗 Open Sarfu Admin", url: adminUrl }
      ]]
    };
  }
  UrlFetchApp.fetch("https://api.telegram.org/bot" + BOT_TOKEN + "/sendMessage", {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
}
`;
}

function refreshTelegramScriptPreview() {
  els.tgScriptPreview.textContent = buildAppsScriptCode();
}

[els.tgGenToken, els.tgGenChatId, els.tgAdminUrl].forEach((input) => {
  input.addEventListener("input", refreshTelegramScriptPreview);
});

els.tgToggleTokenBtn.addEventListener("click", () => {
  const isHidden = els.tgGenToken.type === "password";
  els.tgGenToken.type = isHidden ? "text" : "password";
  els.tgToggleTokenBtn.textContent = isHidden ? "Hide" : "Show";
});

els.tgPreviewScriptBtn.addEventListener("click", () => {
  refreshTelegramScriptPreview();
  const hidden = els.tgScriptPreviewWrap.classList.toggle("hidden");
  els.tgPreviewScriptBtn.textContent = hidden ? "View Script" : "Hide Script";
});

els.tgCopyScriptBtn.addEventListener("click", async () => {
  const token = els.tgGenToken.value.trim();
  const chatId = els.tgGenChatId.value.trim();
  if (!token || !chatId) {
    showToast("Enter your Bot Token and Chat ID first so they are pre-filled in Code.gs.", "error");
    return;
  }
  const code = buildAppsScriptCode();
  els.tgScriptPreview.textContent = code;
  try {
    await navigator.clipboard.writeText(code);
    showToast("Multi-Project Code.gs copied! Update script.google.com & redeploy.");
  } catch {
    els.tgScriptPreviewWrap.classList.remove("hidden");
    els.tgPreviewScriptBtn.textContent = "Hide Script";
    showToast("Clipboard blocked — copy the script from the preview box below.", "error");
  }
});

els.tgTestBtn.addEventListener("click", async () => {
  const webhookUrl = els.tgWebhookUrl.value.trim();
  const adminUrl = els.tgAdminUrl.value.trim();
  if (!webhookUrl || !webhookUrl.startsWith("https://")) {
    return showToast("Paste your Google Apps Script https://.../exec URL first.", "error");
  }

  els.tgTestBtn.disabled = true;
  const origText = els.tgTestBtn.textContent;
  els.tgTestBtn.textContent = "Sending Test...";
  try {
    await fetch(webhookUrl, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        event: "TEST_NOTIFICATION",
        projectName: "Sarfu Admin (All Projects)",
        adminPanelUrl: adminUrl,
        timestampIst: formatDateTime(Date.now()) + " IST",
      }),
    });
    showToast("Test alert dispatched! Check your Telegram Bot chat now.");
  } catch (err) {
    showToast(`Could not reach webhook: ${err.message}`, "error");
  } finally {
    els.tgTestBtn.disabled = false;
    els.tgTestBtn.textContent = origText;
  }
});

els.telegramForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const webhookUrl = els.tgWebhookUrl.value.trim();
  const adminUrl = els.tgAdminUrl.value.trim();
  const notifyNewAccount = els.tgNotifyNewAccount.checked;
  const notifyUtrSubmit = els.tgNotifyUtrSubmit.checked;

  if (webhookUrl && !webhookUrl.startsWith("https://")) {
    return showToast("Webhook URL must start with https://", "error");
  }
  if (adminUrl && !adminUrl.startsWith("https://")) {
    return showToast("Sarfu Admin URL must start with https://", "error");
  }

  els.saveTelegramBtn.disabled = true;
  els.saveTelegramBtn.textContent = "Syncing...";
  try {
    const payload = buildFullAppConfigPayload({
      telegramWebhookUrl: webhookUrl,
      adminPanelUrl: adminUrl,
      notifyOnNewAccount: notifyNewAccount,
      notifyOnUtrSubmit: notifyUtrSubmit,
    });
    await setDoc(doc(db, "appConfig", APP_CONFIG_DOC_ID), payload);
    // Automatically mirror shared Telegram webhook to Meme Circle config as well
    await memeCircleCtrl.syncTelegramSettings({
      telegramWebhookUrl: webhookUrl,
      adminPanelUrl: adminUrl,
      notifyOnNewAccount: notifyNewAccount,
      notifyOnUtrSubmit: notifyUtrSubmit,
    });
    showToast(
      webhookUrl
        ? "Shared Telegram 24/7 webhook synced live across VastraOS & Meme Circle!"
        : "Telegram webhook cleared & synced."
    );
  } catch (err) {
    showToast(`Failed to save Telegram settings: ${formatFirestoreError(err)}`, "error");
  } finally {
    els.saveTelegramBtn.disabled = false;
    els.saveTelegramBtn.textContent = "Save & Sync";
  }
});

// Mount Meme Circle Control Deck Controller
memeCircleCtrl = createMemeCircleController({
  db,
  getUser: () => state.user,
  getVastraConfig: () => state.appConfig,
  showToast,
  escapeHtml,
  toBase64ImageSrc,
  toMillis,
  formatDateTime,
  formatDateShortIst,
  formatFirestoreError,
  normalizeDirectDownloadUrl,
  formatInr,
  computeEffectiveStatus,
  statusPillHtml,
  computeFallbackStatus,
  compressImageToRawBase64,
  switchTab,
  openModal,
  closeModal,
  askConfirm,
  openTelegramDrawer,
  openReceiptLightbox: (src, meta) => {
    els.receiptModalImg.src = src;
    els.receiptModalMeta.textContent = meta;
    openModal("receipt-modal");
  },
  onPortfolioChanged: () => {
    renderHub();
  },
});
renderHub();
