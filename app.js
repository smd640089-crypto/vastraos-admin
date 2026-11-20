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
  runTransaction,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import {
  FIREBASE_CONFIG,
  FIRESTORE_DATABASE_ID,
  ALLOWED_ADMIN_EMAIL,
  APP_CONFIG_DOC_ID,
  DEFAULT_APP_CONFIG,
} from "./firebase-config.js";

const DAY_MS = 86_400_000;
const MAX_QR_BASE64_LEN = 340_000; // Safely below 450,000 firestore.rules cap

// Initialize Firebase App + Named Firestore Database
const firebaseApp = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp, FIRESTORE_DATABASE_ID);
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

// Application State
const state = {
  user: null,
  activeTab: "overview",
  appConfig: { ...DEFAULT_APP_CONFIG },
  appConfigLoaded: false,
  pendingQrBase64: "",
  requests: [],
  shops: [],
  subscriptions: new Map(), // shopId -> sub doc
  users: new Map(), // uid -> user doc
  utrFilter: "PENDING",
  utrSearch: "",
  shopFilter: "ALL",
  shopSearch: "",
  extendShopId: null,
  pendingConfirmAction: null,
  unsubscribers: [],
};

// DOM References
const $ = (id) => document.getElementById(id);

const els = {
  authView: $("auth-view"),
  appShell: $("app-shell"),
  authErrorBox: $("auth-error-box"),
  unauthorizedDomainGuide: $("unauthorized-domain-guide"),
  currentHostnameCode: $("current-hostname-code"),
  copyHostnameBtn: $("copy-hostname-btn"),
  googleSigninBtn: $("google-signin-btn"),
  googleSigninLabel: $("google-signin-label"),
  signoutBtn: $("signout-btn"),
  pageTitle: $("page-title"),
  topbarMaintChip: $("topbar-maint-chip"),
  navPendingBadge: $("nav-pending-badge"),
  mobilePendingBadge: $("mobile-pending-badge"),
  navShopsCount: $("nav-shops-count"),
  navMaintDot: $("nav-maint-dot"),
  adminAvatar: $("admin-avatar"),
  adminDisplayName: $("admin-display-name"),
  adminEmailLabel: $("admin-email-label"),
  toastContainer: $("toast-container"),

  // Overview
  kpiPending: $("kpi-pending"),
  kpiActivePaid: $("kpi-active-paid"),
  kpiActiveTrial: $("kpi-active-trial"),
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

  // Billing & QR
  billingForm: $("billing-form"),
  cfgUpiId: $("cfg-upi-id"),
  cfgUpiName: $("cfg-upi-name"),
  cfgPlanPrice: $("cfg-plan-price"),
  cfgPlanDays: $("cfg-plan-days"),
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

  // Telegram Bot 24/7 Alerts (Slide-Up Drawer + Trigger Badges)
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
  extendDaysInput: $("extend-days-input"),
  extendNoteInput: $("extend-note-input"),
  confirmExtendBtn: $("confirm-extend-btn"),
  confirmModal: $("confirm-modal"),
  confirmModalTitle: $("confirm-modal-title"),
  confirmModalMessage: $("confirm-modal-message"),
  confirmModalOk: $("confirm-modal-ok"),
};

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
  }, type === "error" ? 4200 : 2800);
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

function formatDateShort(ms) {
  if (!ms) return "—";
  try {
    return new Date(ms).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

function formatInr(amount) {
  const n = Number(amount) || 0;
  return `₹${n.toLocaleString("en-IN")}`;
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
// Navigation & Modals
// ============================================================================

const TAB_TITLES = {
  overview: "Overview",
  approvals: "UTR Approvals",
  billing: "Billing, Plan & UPI QR",
  shops: "All Registered Shops",
  system: "System, Maintenance & Updates",
};

function switchTab(tab) {
  state.activeTab = tab;
  els.pageTitle.textContent = TAB_TITLES[tab] || "Admin Panel";

  document.querySelectorAll(".tab-panel").forEach((el) => el.classList.remove("active"));
  const target = $(`tab-${tab}`);
  if (target) target.classList.add("active");

  document.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
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

els.heroTelegramChip.addEventListener("click", () => {
  const connected = Boolean(
    state.appConfig.telegramWebhookUrl &&
      state.appConfig.telegramWebhookUrl.trim().startsWith("https://")
  );
  openTelegramDrawer(connected ? "settings" : "script");
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
// Authentication (Strictly smd640089@gmail.com)
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
  stopListeners();
  await signOut(auth);
  showToast("Signed out safely.");
});

// Check redirect result silently on load
getRedirectResult(auth).catch((err) => {
  if (err?.code === "auth/unauthorized-domain") {
    showUnauthorizedDomainHelp();
  } else if (err?.message) {
    showAuthError(err.message);
  }
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    stopListeners();
    state.user = null;
    els.appShell.classList.add("hidden");
    els.authView.classList.remove("hidden");
    return;
  }

  const email = (user.email || "").toLowerCase();
  if (email !== ALLOWED_ADMIN_EMAIL.toLowerCase() || !user.emailVerified) {
    stopListeners();
    await signOut(auth);
    els.appShell.classList.add("hidden");
    els.authView.classList.remove("hidden");
    showAuthError(
      `Access denied for ${user.email || "this account"}. Only verified ${ALLOWED_ADMIN_EMAIL} is authorized to access VastraOS Admin Panel.`
    );
    return;
  }

  clearAuthErrors();
  state.user = user;
  els.adminDisplayName.textContent = user.displayName || "VastraOS Admin";
  els.adminEmailLabel.textContent = user.email;
  els.adminAvatar.textContent = (user.displayName || user.email || "A").charAt(0).toUpperCase();

  els.authView.classList.add("hidden");
  els.appShell.classList.remove("hidden");
  startListeners();
});

// ============================================================================
// Live Firestore Listeners
// ============================================================================

function stopListeners() {
  state.unsubscribers.forEach((unsub) => {
    try { unsub(); } catch {}
  });
  state.unsubscribers = [];
}

function startListeners() {
  stopListeners();

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
          // Keep badges and overview synced, refresh forms if user isn't actively editing them
          syncFormIndicators();
        }
        renderOverview();
      },
      (err) => showToast(`Config sync error: ${err.message}`, "error")
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
        renderOverview();
        renderUtrRequests();
      },
      (err) => showToast(`Requests sync error: ${err.message}`, "error")
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
        renderOverview();
        renderShops();
      },
      (err) => showToast(`Shops sync error: ${err.message}`, "error")
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
        renderOverview();
        renderShops();
      },
      (err) => showToast(`Subscriptions sync error: ${err.message}`, "error")
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
// Render: Overview
// ============================================================================

function renderOverview() {
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

  els.kpiPending.textContent = String(pendingReqs.length);
  els.kpiActivePaid.textContent = String(activePaid);
  els.kpiActiveTrial.textContent = String(activeTrial);
  els.kpiExpired.textContent = String(expiredOrSuspended);
  els.kpiRevenue.textContent = formatInr(totalRevenue);
  els.kpiRevenueSub.textContent = `${approvedReqs.length} approved renewal${approvedReqs.length === 1 ? "" : "s"}`;

  // Navigation badges
  els.navShopsCount.textContent = String(state.shops.length);
  if (pendingReqs.length > 0) {
    els.navPendingBadge.textContent = String(pendingReqs.length);
    els.navPendingBadge.classList.remove("hidden");
    els.mobilePendingBadge.textContent = String(pendingReqs.length);
    els.mobilePendingBadge.classList.remove("hidden");
  } else {
    els.navPendingBadge.classList.add("hidden");
    els.mobilePendingBadge.classList.add("hidden");
  }

  const maintOn = Boolean(state.appConfig.maintenanceMode);
  els.topbarMaintChip.classList.toggle("hidden", !maintOn);
  els.navMaintDot.classList.toggle("hidden", !maintOn);

  // Recent pending list
  if (pendingReqs.length === 0) {
    els.overviewPendingList.innerHTML = `<div class="empty-state">All caught up! No pending UTR requests right now.</div>`;
  } else {
    els.overviewPendingList.innerHTML = pendingReqs
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
    <div class="config-row"><span>Plan Price &amp; Cycle</span><strong>${formatInr(cfg.planPriceInr)} / ${Number(cfg.planDays) || 28} days</strong></div>
    <div class="config-row"><span>Maintenance Mode</span><strong>${cfg.maintenanceMode ? '<span class="pill pill-danger">ON</span>' : '<span class="pill pill-success">OFF</span>'}</strong></div>
    <div class="config-row config-row-clickable" data-open-tg-row="true" role="button" tabindex="0"><span>Telegram 24/7 Alerts</span><strong>${tgConnected ? '<span class="pill pill-success">Connected 24/7 ✓</span>' : '<span class="pill pill-warning">Not Configured</span>'}</strong></div>
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

  const liveDays = Number(state.appConfig.planDays) || 28;
  els.utrRequestsList.innerHTML = filtered
    .map((req) => {
      const receiptSrc = toBase64ImageSrc(req.receiptBase64);
      const isPending = req.status === "PENDING";
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
                 <button type="button" class="btn btn-emerald" data-approve-req="${escapeHtml(req.id)}">Approve (+${liveDays}d)</button>
                 <button type="button" class="btn btn-ghost-danger" data-reject-req="${escapeHtml(req.id)}">Reject</button>
               </div>`
            : req.adminNote
            ? `<div class="muted-note"><strong>Admin Note:</strong> ${escapeHtml(req.adminNote)}</div>`
            : ""
        }
      </article>`;
    })
    .join("");

  // Bind receipt viewer
  els.utrRequestsList.querySelectorAll("[data-open-receipt]").forEach((el) => {
    el.addEventListener("click", () => {
      const req = state.requests.find((r) => r.id === el.dataset.openReceipt);
      if (!req) return;
      els.receiptModalImg.src = toBase64ImageSrc(req.receiptBase64);
      els.receiptModalMeta.textContent = `${req.shopName} • UTR: ${req.utrNumber} • ${formatInr(req.amountInr)}`;
      openModal("receipt-modal");
    });
  });

  // Bind Approve
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

  // Bind Reject
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

  const planDays = Math.max(1, Math.min(3650, Math.round(Number(state.appConfig.planDays) || 28)));
  const planPrice = Math.max(1, Math.min(100000, Math.round(Number(state.appConfig.planPriceInr) || 299)));
  const cleanNote = (note || `Approved (+${planDays} days)`).slice(0, 240);
  const now = Date.now();

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
      const newExpiryMillis = baseMillis + planDays * DAY_MS;

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
          planDays: planDays,
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
          planDays: planDays,
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
        message: `Your payment (UTR ${req.utrNumber}) is verified. +${planDays} days added — valid until ${formatDateShort(newExpiryMillis)}.`.slice(
          0,
          400
        ),
        referenceId: req.id,
        read: false,
        createdAt: serverTimestamp(),
      });
    });

    showToast(`Approved ${req.shopName}! +${planDays} days synced live.`);
  } catch (err) {
    showToast(`Approve failed: ${err.message}`, "error");
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
    showToast(`Reject failed: ${err.message}`, "error");
    btn.disabled = false;
  }
}

// ============================================================================
// Billing, Plan Pricing & UPI QR Editor + Live Preview
// ============================================================================

function populateConfigForms() {
  const cfg = state.appConfig;
  els.cfgUpiId.value = cfg.ownerUpiId || "";
  els.cfgUpiName.value = cfg.ownerUpiName || "";
  els.cfgPlanPrice.value = Number(cfg.planPriceInr) || 299;
  els.cfgPlanDays.value = Number(cfg.planDays) || 28;
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

  // Telegram Bot 24/7 Alerts fields
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

  els.heroTgDot.className = tgLive ? "status-dot-emerald" : "status-dot-amber";
  els.heroTgLabel.textContent = tgLive ? "Telegram 24/7" : "Setup Telegram";
}

function updateBillingPreview() {
  const upiId = els.cfgUpiId.value.trim() || "vastraos.billing@upi";
  const upiName = els.cfgUpiName.value.trim() || "VastraOS Software Technologies";
  const price = Math.max(1, Math.round(Number(els.cfgPlanPrice.value) || 299));
  const days = Math.max(1, Math.round(Number(els.cfgPlanDays.value) || 28));
  const instructions = els.cfgInstructions.value.trim();
  const qrSrc = toBase64ImageSrc(state.pendingQrBase64);

  els.previewPriceTitle.textContent = `Pay ₹${price} for ${days} Days`;
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

[els.cfgUpiId, els.cfgUpiName, els.cfgPlanPrice, els.cfgPlanDays, els.cfgInstructions].forEach((input) => {
  input.addEventListener("input", updateBillingPreview);
});

async function compressQrImageFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    throw new Error("Please select a valid PNG or JPG QR image.");
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

  // Resize to max 512px while keeping crisp QR edges on solid white background
  const maxDim = 512;
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  // Try crisp PNG first (ideal for QR codes); fall back to high-quality JPEG if large
  let outDataUrl = canvas.toDataURL("image/png");
  let rawBase64 = outDataUrl.split(",")[1] || "";

  if (rawBase64.length > MAX_QR_BASE64_LEN) {
    for (const q of [0.88, 0.78, 0.65, 0.5]) {
      outDataUrl = canvas.toDataURL("image/jpeg", q);
      rawBase64 = outDataUrl.split(",")[1] || "";
      if (rawBase64.length <= MAX_QR_BASE64_LEN) break;
    }
  }

  if (rawBase64.length > MAX_QR_BASE64_LEN) {
    throw new Error("Image is still too large after compression. Please use a simpler QR image.");
  }

  return rawBase64;
}

async function handleQrFile(file) {
  try {
    const rawBase64 = await compressQrImageFile(file);
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
  const payload = {
    ownerUpiId: String(overrides.ownerUpiId ?? cur.ownerUpiId ?? DEFAULT_APP_CONFIG.ownerUpiId).trim().slice(0, 100),
    ownerUpiName: String(overrides.ownerUpiName ?? cur.ownerUpiName ?? DEFAULT_APP_CONFIG.ownerUpiName).trim().slice(0, 100),
    ownerUpiQrBase64: String(overrides.ownerUpiQrBase64 ?? cur.ownerUpiQrBase64 ?? ""),
    planPriceInr: Math.max(1, Math.min(100000, Math.round(Number(overrides.planPriceInr ?? cur.planPriceInr ?? 299)))),
    planDays: Math.max(1, Math.min(3650, Math.round(Number(overrides.planDays ?? cur.planDays ?? 28)))),
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
  return payload;
}

els.billingForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const upiId = els.cfgUpiId.value.trim();
  const upiName = els.cfgUpiName.value.trim();
  const price = Math.round(Number(els.cfgPlanPrice.value));
  const days = Math.round(Number(els.cfgPlanDays.value));
  const instructions = els.cfgInstructions.value.trim();

  if (upiId.length < 3) return showToast("UPI ID must be at least 3 characters.", "error");
  if (!upiName) return showToast("Beneficiary name is required.", "error");
  if (!Number.isInteger(price) || price < 1 || price > 100000) return showToast("Plan price must be between ₹1 and ₹100,000.", "error");
  if (!Number.isInteger(days) || days < 1 || days > 3650) return showToast("Validity days must be between 1 and 3650.", "error");
  if (!instructions) return showToast("Payment instructions are required.", "error");

  els.saveBillingBtn.disabled = true;
  els.saveBillingBtn.textContent = "Publishing...";
  try {
    const payload = buildFullAppConfigPayload({
      ownerUpiId: upiId,
      ownerUpiName: upiName,
      ownerUpiQrBase64: state.pendingQrBase64,
      planPriceInr: price,
      planDays: days,
      instructions,
    });
    await setDoc(doc(db, "appConfig", APP_CONFIG_DOC_ID), payload);
    showToast("Billing UPI, QR & plan synced live to all VastraOS apps!");
  } catch (err) {
    showToast(`Failed to publish: ${err.message}`, "error");
  } finally {
    els.saveBillingBtn.disabled = false;
    els.saveBillingBtn.textContent = "Publish Live to All Apps";
  }
});

// ============================================================================
// Render & Actions: All Registered Shops
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

  // Update counts
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
          <div class="cell-title">${expiryMs ? formatDateShort(expiryMs) : "—"}</div>
          <div class="cell-sub">${daysLeft > 0 ? `${daysLeft} day${daysLeft === 1 ? "" : "s"} left` : "Expired / None"}</div>
        </td>
        <td class="mono">${escapeHtml(sub?.lastApprovedUtr || "—")}</td>
        <td class="text-right">
          <div class="row-actions">
            <button type="button" class="btn btn-primary btn-sm" data-extend-shop="${escapeHtml(shopId)}">Extend / Activate</button>
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

  // Bind Extend
  els.shopsTableBody.querySelectorAll("[data-extend-shop]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const shopId = btn.dataset.extendShop;
      const shop = state.shops.find((s) => (s.shopId || s.id) === shopId);
      if (!shop) return;
      state.extendShopId = shopId;
      els.extendShopDesc.textContent = `Add paid validity days to "${shop.shopName}" (${shop.ownerName}). Remaining active days are automatically preserved.`;
      els.extendDaysInput.value = Number(state.appConfig.planDays) || 28;
      els.extendNoteInput.value = "";
      openModal("extend-modal");
    });
  });

  // Bind Suspend
  els.shopsTableBody.querySelectorAll("[data-suspend-shop]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const shopId = btn.dataset.suspendShop;
      const shop = state.shops.find((s) => (s.shopId || s.id) === shopId);
      if (!shop) return;
      askConfirm({
        title: `Suspend "${shop.shopName}"?`,
        message: "This will immediately pause billing & stock creation for this shop in the Android app until you reactivate it.",
        okLabel: "Suspend Shop",
        okClass: "btn-danger",
        onConfirm: () => setShopSuspended(shop, true),
      });
    });
  });

  // Bind Reactivate
  els.shopsTableBody.querySelectorAll("[data-unsuspend-shop]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const shopId = btn.dataset.unsuspendShop;
      const shop = state.shops.find((s) => (s.shopId || s.id) === shopId);
      if (!shop) return;
      setShopSuspended(shop, false);
    });
  });
}

document.querySelectorAll(".quick-days-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    els.extendDaysInput.value = btn.dataset.days;
  });
});

els.extendShopForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const shopId = state.extendShopId;
  const shop = state.shops.find((s) => (s.shopId || s.id) === shopId);
  if (!shop) return;

  const days = Math.round(Number(els.extendDaysInput.value));
  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    return showToast("Enter valid days between 1 and 3650.", "error");
  }
  const refNote = (els.extendNoteInput.value.trim() || "ADMIN_EXTENDED").slice(0, 64);
  const planPrice = Math.max(1, Math.min(100000, Math.round(Number(state.appConfig.planPriceInr) || 299)));
  const planDays = Math.max(1, Math.min(3650, Math.round(Number(state.appConfig.planDays) || 28)));
  const now = Date.now();

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

      const baseMillis = Math.max(
        now,
        Number(existingSub?.paidExpiryMillis || 0),
        Number(existingSub?.trialExpiryMillis || 0)
      );
      const newExpiryMillis = baseMillis + days * DAY_MS;

      if (subSnap.exists()) {
        tx.update(subRef, {
          status: "ACTIVE",
          planPriceInr: planPrice,
          planDays: planDays,
          paidStartMillis: Number(existingSub.paidStartMillis || 0) > 0 ? existingSub.paidStartMillis : now,
          paidExpiryMillis: newExpiryMillis,
          lastApprovedUtr: refNote,
          updatedAt: serverTimestamp(),
        });
      } else {
        tx.set(subRef, {
          shopId,
          ownerUid: shop.ownerUid,
          memberUids,
          status: "ACTIVE",
          planPriceInr: planPrice,
          planDays: planDays,
          trialStartMillis: now,
          trialExpiryMillis: now,
          paidStartMillis: now,
          paidExpiryMillis: newExpiryMillis,
          lastApprovedUtr: refNote,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      const notifRef = doc(collection(db, "notifications"));
      tx.set(notifRef, {
        shopId,
        ownerUid: shop.ownerUid,
        memberUids,
        type: "SUBSCRIPTION_APPROVED",
        title: "Subscription Extended by Admin",
        message: `Admin added +${days} days to your VastraOS plan. Valid until ${formatDateShort(newExpiryMillis)}.`.slice(0, 400),
        referenceId: refNote,
        read: false,
        createdAt: serverTimestamp(),
      });
    });

    closeModal("extend-modal");
    showToast(`Added +${days} days to "${shop.shopName}"!`);
  } catch (err) {
    showToast(`Failed to extend shop: ${err.message}`, "error");
  } finally {
    els.confirmExtendBtn.disabled = false;
    els.confirmExtendBtn.textContent = "Activate / Extend Now";
  }
});

async function setShopSuspended(shop, suspend) {
  const shopId = shop.shopId || shop.id;
  const sub = state.subscriptions.get(shopId);
  const now = Date.now();
  const planPrice = Math.max(1, Math.min(100000, Math.round(Number(state.appConfig.planPriceInr) || 299)));
  const planDays = Math.max(1, Math.min(3650, Math.round(Number(state.appConfig.planDays) || 28)));
  const memberUids = (sub?.memberUids?.length ? sub.memberUids : shop.memberUids) || [shop.ownerUid];

  try {
    const subRef = doc(db, "subscriptions", shopId);
    if (sub) {
      await updateDoc(subRef, {
        status: suspend ? "SUSPENDED" : computeFallbackStatus(sub, now),
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(subRef, {
        shopId,
        ownerUid: shop.ownerUid,
        memberUids,
        status: suspend ? "SUSPENDED" : "TRIAL_EXPIRED",
        planPriceInr: planPrice,
        planDays: planDays,
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
    showToast(`Action failed: ${err.message}`, "error");
  }
}

// ============================================================================
// System, Maintenance Mode & App Version Control
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
  const updateUrl = els.sysUpdateUrl.value.trim();
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
    return showToast("Download URL must start with http:// or https://", "error");
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
      showToast(`Failed to save system config: ${err.message}`, "error");
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
// Telegram Bot 24/7 Notifications & Private Apps Script Generator
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
// VastraOS 24/7 Telegram Notification Relay (Google Apps Script Web App)
// Keep this script private in your Google account. Never share BOT_TOKEN.
// =====================================================================

var BOT_TOKEN = ${jsStringLiteral(token)};
var CHAT_ID = ${jsStringLiteral(chatId)};
var DEFAULT_ADMIN_PANEL_URL = ${jsStringLiteral(fallbackAdminUrl)};

function doGet() {
  return ContentService
    .createTextOutput("VastraOS Telegram Webhook is active 24/7.")
    .setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  try {
    var raw = (e && e.postData && e.postData.contents) ? e.postData.contents : "{}";
    var data = JSON.parse(raw);
    var adminUrl = (data.adminPanelUrl && data.adminPanelUrl.indexOf("https://") === 0)
      ? data.adminPanelUrl
      : DEFAULT_ADMIN_PANEL_URL;

    var text = formatVastraMessage_(data);
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

function formatVastraMessage_(d) {
  var ev = String(d.event || "");
  var time = esc_(d.timestampIst || Utilities.formatDate(new Date(), "Asia/Kolkata", "dd MMM yyyy, hh:mm a") + " IST");

  if (ev === "NEW_UTR_SUBMITTED") {
    return [
      "💳 <b>NEW SUBSCRIPTION UTR SUBMITTED</b>",
      "",
      "🏪 <b>Shop:</b> " + esc_(d.shopName || "—"),
      "👤 <b>Owner:</b> " + esc_(d.ownerName || "—"),
      "📱 <b>Mobile:</b> <code>" + esc_(d.mobileNumber || "—") + "</code>",
      "💰 <b>Amount:</b> ₹" + esc_(d.amountInr || 299) + " (" + esc_(d.planDays || 28) + " Days)",
      "🧾 <b>UTR:</b> <code>" + esc_(d.utrNumber || "—") + "</code>",
      "📎 <b>Receipt:</b> " + (d.hasReceipt ? "Attached ✅" : "UTR Text Only"),
      "🕒 <b>Time:</b> " + time,
      "",
      "Tap below to verify &amp; approve this renewal."
    ].join("\\n");
  }

  if (ev === "NEW_SHOP_REGISTERED") {
    var lines = [
      "🏪 <b>NEW VASTRAOS SHOP REGISTERED</b>",
      "",
      "🏷️ <b>Shop:</b> " + esc_(d.shopName || "—"),
      "👤 <b>Owner:</b> " + esc_(d.ownerName || "—"),
      "📱 <b>Mobile:</b> <code>" + esc_(d.mobileNumber || "—") + "</code>"
    ];
    if (d.email) lines.push("📧 <b>Email:</b> " + esc_(d.email));
    if (d.shopType) lines.push("🧵 <b>Type:</b> " + esc_(d.shopType));
    if (d.address) lines.push("📍 <b>Address:</b> " + esc_(d.address));
    lines.push("🔐 <b>Account:</b> " + esc_(d.accountType || "VastraOS"));
    lines.push("🎁 <b>Trial:</b> " + esc_(d.trialDays || 7) + "-Day Free Trial Started");
    lines.push("🕒 <b>Time:</b> " + time);
    return lines.join("\\n");
  }

  if (ev === "NEW_ACCOUNT_CREATED") {
    var accLines = [
      "👤 <b>NEW VASTRAOS ACCOUNT CREATED</b>",
      "",
      "🧑 <b>Owner:</b> " + esc_(d.ownerName || "—"),
      "📱 <b>Mobile:</b> <code>" + esc_(d.mobileNumber || "—") + "</code>"
    ];
    if (d.email) accLines.push("📧 <b>Email:</b> " + esc_(d.email));
    accLines.push("🔐 <b>Mode:</b> " + esc_(d.accountType || "VastraOS"));
    accLines.push("🕒 <b>Time:</b> " + time);
    return accLines.join("\\n");
  }

  return [
    "✅ <b>VastraOS Telegram Bot Connected!</b>",
    "",
    "Your 24/7 webhook relay is working properly.",
    "You will receive instant alerts here for new accounts/shops and UTR subscription renewals.",
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
        { text: "🔗 Open VastraOS Admin Panel", url: adminUrl }
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
    showToast("Ready-to-paste Code.gs copied! Paste it in script.google.com & deploy.");
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
    return showToast("Admin Panel URL must start with https://", "error");
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
    showToast(
      webhookUrl
        ? "Telegram 24/7 webhook synced live to all VastraOS Android apps!"
        : "Telegram webhook cleared & synced."
    );
  } catch (err) {
    showToast(`Failed to save Telegram settings: ${err.message}`, "error");
  } finally {
    els.saveTelegramBtn.disabled = false;
    els.saveTelegramBtn.textContent = "Save & Sync Telegram Settings";
  }
});

