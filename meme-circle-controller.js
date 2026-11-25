/**
 * Sarfu Admin — Meme Circle Control Deck Controller
 * Manages live Firestore sync for Meme Circle (appConfig/memecircle_billing,
 * mcUsers, mcSubscriptions, mcSubscriptionRequests, mcNotifications),
 * 1-day configurable trial, Rs 30 / 10-day rolling UPI UTR approvals,
 * 3-mode user plan management, independent Maintenance/Update controls,
 * and the 1-Click Copy Master Build Prompt modal.
 */

import {
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
  MC_APP_CONFIG_DOC_ID,
  MC_USERS_COLLECTION,
  MC_SUBSCRIPTIONS_COLLECTION,
  MC_REQUESTS_COLLECTION,
  MC_NOTIFICATIONS_COLLECTION,
  DEFAULT_MC_APP_CONFIG,
} from "./firebase-config.js";
import { buildMemeCircleMasterPrompt } from "./meme-circle-prompt.js";

const DAY_MS = 86_400_000;
const MAX_QR_BASE64_LEN = 340_000;

export function createMemeCircleController(ctx) {
  const {
    db,
    getUser,
    getVastraConfig,
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
    openReceiptLightbox,
    onPortfolioChanged,
  } = ctx;

  const $ = (id) => document.getElementById(id);

  const mcState = {
    config: { ...DEFAULT_MC_APP_CONFIG },
    configLoaded: false,
    pendingQrBase64: "",
    users: [],
    subscriptions: new Map(), // uid -> mcSubscription
    requests: [],
    utrFilter: "PENDING",
    utrSearch: "",
    userFilter: "ALL",
    userSearch: "",
    manageUid: null,
    manageMode: "cycles", // "cycles" | "paid-days" | "trial-days"
    unsubscribers: [],
  };

  const els = {
    // Badges & Hub Slot
    navPendingBadge: $("mc-nav-pending-badge"),
    mobilePendingBadge: $("mc-mobile-pending-badge"),
    subnavPendingBadge: $("mc-subnav-pending-badge"),
    navUsersCount: $("mc-nav-users-count"),
    navMaintDot: $("mc-nav-maint-dot"),
    slotUsers: $("slot-mc-users"),
    slotPending: $("slot-mc-pending"),
    slotPlan: $("slot-mc-plan"),
    slotTrial: $("slot-mc-trial"),

    // Overview
    kpiRevenue: $("mc-kpi-revenue"),
    kpiRevenueSub: $("mc-kpi-revenue-sub"),
    kpiPending: $("mc-kpi-pending"),
    kpiActivePaid: $("mc-kpi-active-paid"),
    kpiPaidSub: $("mc-kpi-paid-sub"),
    kpiActiveTrial: $("mc-kpi-active-trial"),
    kpiTrialSub: $("mc-kpi-trial-sub"),
    kpiExpired: $("mc-kpi-expired"),
    overviewPendingList: $("mc-overview-pending-list"),
    overviewConfigSummary: $("mc-overview-config-summary"),

    // UTR Approvals
    utrFilterPills: $("mc-utr-filter-pills"),
    utrSearchInput: $("mc-utr-search-input"),
    utrRequestsList: $("mc-utr-requests-list"),
    countReqPending: $("mc-count-req-pending"),
    countReqApproved: $("mc-count-req-approved"),
    countReqRejected: $("mc-count-req-rejected"),
    countReqAll: $("mc-count-req-all"),

    // Billing, Trial & QR
    billingForm: $("mc-billing-form"),
    cfgUpiId: $("mc-cfg-upi-id"),
    cfgUpiName: $("mc-cfg-upi-name"),
    cfgPlanPrice: $("mc-cfg-plan-price"),
    cfgPlanDays: $("mc-cfg-plan-days"),
    cfgTrialDays: $("mc-cfg-trial-days"),
    cfgInstructions: $("mc-cfg-instructions"),
    qrDropzone: $("mc-qr-dropzone"),
    qrFileInput: $("mc-qr-file-input"),
    qrPickBtn: $("mc-qr-pick-btn"),
    qrCopyVastraBtn: $("mc-qr-copy-vastra-btn"),
    qrClearBtn: $("mc-qr-clear-btn"),
    qrUploadPreviewWrap: $("mc-qr-upload-preview-wrap"),
    qrUploadPreviewImg: $("mc-qr-upload-preview-img"),
    qrSizeHint: $("mc-qr-size-hint"),
    billingLastUpdated: $("mc-billing-last-updated"),
    saveBillingBtn: $("mc-save-billing-btn"),
    previewPriceTitle: $("mc-preview-price-title"),
    previewTrialLabel: $("mc-preview-trial-label"),
    previewPayeeName: $("mc-preview-payee-name"),
    previewUpiId: $("mc-preview-upi-id"),
    previewQrImg: $("mc-preview-qr-img"),
    previewQrEmpty: $("mc-preview-qr-empty"),
    previewInstructions: $("mc-preview-instructions"),

    // Users
    userFilterPills: $("mc-user-filter-pills"),
    userSearchInput: $("mc-user-search-input"),
    usersTableBody: $("mc-users-table-body"),
    usersEmptyState: $("mc-users-empty-state"),
    countUserAll: $("mc-count-user-all"),
    countUserActive: $("mc-count-user-active"),
    countUserTrial: $("mc-count-user-trial"),
    countUserPending: $("mc-count-user-pending"),
    countUserExpired: $("mc-count-user-expired"),
    countUserSuspended: $("mc-count-user-suspended"),

    // System & Updates
    tgTriggerStatusPill: $("mc-tg-trigger-status-pill"),
    systemForm: $("mc-system-form"),
    sysMaintToggle: $("mc-sys-maint-toggle"),
    maintWarningBanner: $("mc-maint-warning-banner"),
    sysMaintMsg: $("mc-sys-maint-msg"),
    sysLatestCode: $("mc-sys-latest-code"),
    sysLatestName: $("mc-sys-latest-name"),
    sysMinCode: $("mc-sys-min-code"),
    sysUpdateUrl: $("mc-sys-update-url"),
    sysUpdateNotes: $("mc-sys-update-notes"),
    saveSystemBtn: $("mc-save-system-btn"),

    // 3-Mode Manage Modal
    manageForm: $("mc-manage-user-form"),
    manageUserDesc: $("mc-manage-user-desc"),
    manageCurrentSummary: $("mc-manage-current-summary"),
    manageTabs: $("mc-manage-tabs"),
    manageCyclesInput: $("mc-manage-cycles-input"),
    paidExactDaysInput: $("mc-paid-exact-days-input"),
    paidExpireNowBtn: $("mc-paid-expire-now-btn"),
    trialExactDaysInput: $("mc-trial-exact-days-input"),
    manageExpiryPreview: $("mc-manage-expiry-preview"),
    manageNoteInput: $("mc-manage-note-input"),
    confirmManageBtn: $("mc-confirm-manage-btn"),

    // Master Build Prompt Modal
    promptTextarea: $("mc-master-prompt-textarea"),
    copyPromptBtn: $("mc-copy-prompt-btn"),
  };

  function clampMcTrialDays(val) {
    const n = Math.round(Number(val));
    if (!Number.isFinite(n)) return 1;
    return Math.max(0, Math.min(90, n));
  }

  function buildFullMcConfigPayload(overrides = {}) {
    const cur = mcState.config;
    const vastraCfg = getVastraConfig() || {};
    return {
      ownerUpiId: String(
        overrides.ownerUpiId ?? cur.ownerUpiId ?? vastraCfg.ownerUpiId ?? DEFAULT_MC_APP_CONFIG.ownerUpiId
      )
        .trim()
        .slice(0, 100),
      ownerUpiName: String(
        overrides.ownerUpiName ?? cur.ownerUpiName ?? DEFAULT_MC_APP_CONFIG.ownerUpiName
      )
        .trim()
        .slice(0, 100),
      ownerUpiQrBase64: String(overrides.ownerUpiQrBase64 ?? cur.ownerUpiQrBase64 ?? ""),
      planPriceInr: Math.max(
        1,
        Math.min(100000, Math.round(Number(overrides.planPriceInr ?? cur.planPriceInr ?? 30)))
      ),
      planDays: Math.max(
        1,
        Math.min(3650, Math.round(Number(overrides.planDays ?? cur.planDays ?? 10)))
      ),
      trialDays: clampMcTrialDays(overrides.trialDays ?? cur.trialDays ?? 1),
      instructions: String(
        overrides.instructions ?? cur.instructions ?? DEFAULT_MC_APP_CONFIG.instructions
      )
        .trim()
        .slice(0, 600),
      maintenanceMode: Boolean(overrides.maintenanceMode ?? cur.maintenanceMode ?? false),
      maintenanceMessage: String(
        overrides.maintenanceMessage ??
          cur.maintenanceMessage ??
          DEFAULT_MC_APP_CONFIG.maintenanceMessage
      )
        .trim()
        .slice(0, 400),
      latestAppVersionCode: Math.max(
        1,
        Math.min(100000, Math.round(Number(overrides.latestAppVersionCode ?? cur.latestAppVersionCode ?? 1)))
      ),
      latestAppVersionName: String(
        overrides.latestAppVersionName ?? cur.latestAppVersionName ?? "1.0"
      )
        .trim()
        .slice(0, 40),
      minSupportedVersionCode: Math.max(
        1,
        Math.min(
          100000,
          Math.round(Number(overrides.minSupportedVersionCode ?? cur.minSupportedVersionCode ?? 1))
        )
      ),
      updateUrl: String(overrides.updateUrl ?? cur.updateUrl ?? "").trim().slice(0, 500),
      updateNotes: String(overrides.updateNotes ?? cur.updateNotes ?? "").trim().slice(0, 500),
      telegramWebhookUrl: String(
        overrides.telegramWebhookUrl ??
          cur.telegramWebhookUrl ??
          vastraCfg.telegramWebhookUrl ??
          ""
      )
        .trim()
        .slice(0, 500),
      adminPanelUrl: String(
        overrides.adminPanelUrl ?? cur.adminPanelUrl ?? vastraCfg.adminPanelUrl ?? ""
      )
        .trim()
        .slice(0, 500),
      notifyOnNewAccount: Boolean(
        overrides.notifyOnNewAccount ?? (cur.notifyOnNewAccount !== false)
      ),
      notifyOnUtrSubmit: Boolean(
        overrides.notifyOnUtrSubmit ?? (cur.notifyOnUtrSubmit !== false)
      ),
      updatedAt: serverTimestamp(),
    };
  }

  function getMetrics() {
    const now = Date.now();
    const pendingReqs = mcState.requests.filter((r) => r.status === "PENDING");
    const approvedReqs = mcState.requests.filter((r) => r.status === "APPROVED");
    const totalRevenue = approvedReqs.reduce((acc, r) => acc + (Number(r.amountInr) || 0), 0);

    // Combine registered mcUsers and any orphan mcSubscriptions by uid
    const uidSet = new Set();
    mcState.users.forEach((u) => uidSet.add(u.uid || u.id));
    mcState.subscriptions.forEach((_, uid) => uidSet.add(uid));

    let activePaid = 0;
    let activeTrial = 0;
    let expiredOrSuspended = 0;

    uidSet.forEach((uid) => {
      const sub = mcState.subscriptions.get(uid);
      const eff = computeEffectiveStatus(sub, now);
      if (eff === "ACTIVE" || (eff === "EXPIRING_SOON" && Number(sub?.paidExpiryMillis || 0) > now)) {
        activePaid++;
      } else if (eff === "TRIAL_ACTIVE" || eff === "EXPIRING_SOON") {
        activeTrial++;
      } else if (eff === "EXPIRED" || eff === "TRIAL_EXPIRED" || eff === "SUSPENDED") {
        expiredOrSuspended++;
      }
    });

    return {
      totalUsers: uidSet.size,
      pendingReqs,
      approvedReqs,
      totalRevenue,
      activePaid,
      activeTrial,
      expiredOrSuspended,
      planPriceInr: Number(mcState.config.planPriceInr || 30),
      planDays: Number(mcState.config.planDays || 10),
      trialDays: clampMcTrialDays(mcState.config.trialDays),
      maintenanceMode: Boolean(mcState.config.maintenanceMode),
    };
  }

  function notifyPortfolio() {
    if (typeof onPortfolioChanged === "function") onPortfolioChanged();
  }

  // ==========================================================================
  // Live Listeners
  // ==========================================================================

  function stopListeners() {
    mcState.unsubscribers.forEach((unsub) => {
      try {
        unsub();
      } catch {}
    });
    mcState.unsubscribers = [];
  }

  function startListeners() {
    stopListeners();

    // 1. appConfig/memecircle_billing
    mcState.unsubscribers.push(
      onSnapshot(
        doc(db, "appConfig", MC_APP_CONFIG_DOC_ID),
        (snap) => {
          const data = snap.exists() ? snap.data() : {};
          mcState.config = { ...DEFAULT_MC_APP_CONFIG, ...data };
          if (!mcState.configLoaded) {
            mcState.configLoaded = true;
            populateConfigForms();
          } else {
            const activeEl = document.activeElement;
            if (els.sysMaintToggle && activeEl !== els.sysMaintToggle) {
              els.sysMaintToggle.checked = Boolean(mcState.config.maintenanceMode);
              els.maintWarningBanner?.classList.toggle("hidden", !mcState.config.maintenanceMode);
            }
            if (els.billingForm && (!activeEl || !els.billingForm.contains(activeEl))) {
              els.cfgTrialDays.value = clampMcTrialDays(mcState.config.trialDays);
              els.cfgPlanPrice.value = Number(mcState.config.planPriceInr || 30);
              els.cfgPlanDays.value = Number(mcState.config.planDays || 10);
              updateBillingPreview();
            }
            syncIndicators();
          }
          renderOverview();
          notifyPortfolio();
        },
        (err) => showToast(`Meme Circle config sync error: ${formatFirestoreError(err)}`, "error")
      )
    );

    // 2. mcSubscriptionRequests
    mcState.unsubscribers.push(
      onSnapshot(
        collection(db, MC_REQUESTS_COLLECTION),
        (snap) => {
          mcState.requests = snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
          renderOverview();
          renderUtrRequests();
          notifyPortfolio();
        },
        (err) => showToast(`Meme Circle requests sync error: ${formatFirestoreError(err)}`, "error")
      )
    );

    // 3. mcUsers
    mcState.unsubscribers.push(
      onSnapshot(
        collection(db, MC_USERS_COLLECTION),
        (snap) => {
          mcState.users = snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
          renderOverview();
          renderUsers();
          notifyPortfolio();
        },
        (err) => showToast(`Meme Circle users sync error: ${formatFirestoreError(err)}`, "error")
      )
    );

    // 4. mcSubscriptions
    mcState.unsubscribers.push(
      onSnapshot(
        collection(db, MC_SUBSCRIPTIONS_COLLECTION),
        (snap) => {
          const map = new Map();
          snap.docs.forEach((d) => map.set(d.id, { id: d.id, ...d.data() }));
          mcState.subscriptions = map;
          renderOverview();
          renderUsers();
          notifyPortfolio();
        },
        (err) => showToast(`Meme Circle subscriptions sync error: ${formatFirestoreError(err)}`, "error")
      )
    );
  }

  // ==========================================================================
  // Render: Overview & Hub Slot Badges
  // ==========================================================================

  function renderOverview() {
    const m = getMetrics();

    if (els.slotUsers) els.slotUsers.textContent = String(m.totalUsers);
    if (els.slotPending) els.slotPending.textContent = String(m.pendingReqs.length);
    if (els.slotPlan) els.slotPlan.textContent = `₹${m.planPriceInr}/${m.planDays}d`;
    if (els.slotTrial) els.slotTrial.textContent = m.trialDays === 0 ? "Off" : `${m.trialDays}d`;

    if (els.kpiRevenue) els.kpiRevenue.textContent = formatInr(m.totalRevenue);
    if (els.kpiRevenueSub) {
      els.kpiRevenueSub.textContent = `${m.approvedReqs.length} approved ${m.planDays}-day renewal${
        m.approvedReqs.length === 1 ? "" : "s"
      }`;
    }
    if (els.kpiPending) els.kpiPending.textContent = String(m.pendingReqs.length);
    if (els.kpiActivePaid) els.kpiActivePaid.textContent = String(m.activePaid);
    if (els.kpiPaidSub) els.kpiPaidSub.textContent = `₹${m.planPriceInr} / ${m.planDays}-day rolling plan`;
    if (els.kpiActiveTrial) els.kpiActiveTrial.textContent = String(m.activeTrial);
    if (els.kpiTrialSub) {
      els.kpiTrialSub.textContent =
        m.trialDays === 0 ? "Free trial disabled (0d)" : `${m.trialDays}-day default trial`;
    }
    if (els.kpiExpired) els.kpiExpired.textContent = String(m.expiredOrSuspended);

    if (els.navUsersCount) els.navUsersCount.textContent = String(m.totalUsers);
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

    if (els.navMaintDot) {
      els.navMaintDot.classList.toggle("hidden", !m.maintenanceMode);
    }

    // Recent Pending UTRs
    if (els.overviewPendingList) {
      if (m.pendingReqs.length === 0) {
        els.overviewPendingList.innerHTML = `<div class="empty-state">All caught up! No pending Meme Circle UTR requests right now.</div>`;
      } else {
        els.overviewPendingList.innerHTML = m.pendingReqs
          .slice(0, 5)
          .map(
            (req) => `
          <div class="mini-req-card">
            <div>
              <div class="mini-req-title">${escapeHtml(req.userName || "Creator")} &middot; ${formatInr(req.amountInr)}</div>
              <div class="mini-req-sub">UTR: <code class="mono">${escapeHtml(req.utrNumber)}</code> &middot; ${escapeHtml(req.mobileNumber || "—")}</div>
            </div>
            <button type="button" class="btn btn-emerald btn-sm" data-mc-review-req="${escapeHtml(req.id)}">Review</button>
          </div>`
          )
          .join("");

        els.overviewPendingList.querySelectorAll("[data-mc-review-req]").forEach((btn) => {
          btn.addEventListener("click", () => {
            mcState.utrFilter = "PENDING";
            mcState.utrSearch = "";
            if (els.utrSearchInput) els.utrSearchInput.value = "";
            syncUtrFilterPills();
            renderUtrRequests();
            switchTab("mc-approvals");
          });
        });
      }
    }

    // Live Config Snapshot
    if (els.overviewConfigSummary) {
      const cfg = mcState.config;
      const vastraCfg = getVastraConfig() || {};
      const tgUrl = cfg.telegramWebhookUrl || vastraCfg.telegramWebhookUrl || "";
      const tgConnected = Boolean(tgUrl && tgUrl.startsWith("https://"));
      els.overviewConfigSummary.innerHTML = `
        <div class="config-row"><span>Owner UPI ID</span><strong class="mono">${escapeHtml(cfg.ownerUpiId)}</strong></div>
        <div class="config-row"><span>Payee Name</span><strong>${escapeHtml(cfg.ownerUpiName)}</strong></div>
        <div class="config-row"><span>UPI QR Code</span><strong>${cfg.ownerUpiQrBase64 ? "Uploaded &amp; Live ✓" : "Not uploaded (UPI ID fallback)"}</strong></div>
        <div class="config-row"><span>Paid Plan</span><strong>${formatInr(cfg.planPriceInr)} / ${Number(cfg.planDays || 10)} days (Rolling)</strong></div>
        <div class="config-row"><span>Default Free Trial</span><strong>${m.trialDays === 0 ? "Disabled (0 days)" : `${m.trialDays} day${m.trialDays === 1 ? "" : "s"}`}</strong></div>
        <div class="config-row"><span>Maintenance Mode</span><strong>${cfg.maintenanceMode ? '<span class="pill pill-danger">ON</span>' : '<span class="pill pill-success">OFF</span>'}</strong></div>
        <div class="config-row config-row-clickable" data-mc-open-tg="true" role="button" tabindex="0"><span>Shared Telegram 24/7</span><strong>${tgConnected ? '<span class="pill pill-success">Connected 24/7 ✓</span>' : '<span class="pill pill-warning">Not Configured</span>'}</strong></div>
        <div class="config-row"><span>App Version Policy</span><strong class="mono">Latest v${escapeHtml(cfg.latestAppVersionName || "1.0")} (#${Number(cfg.latestAppVersionCode || 1)}) &middot; Min #${Number(cfg.minSupportedVersionCode || 1)}</strong></div>
      `;
      const tgRow = els.overviewConfigSummary.querySelector("[data-mc-open-tg]");
      if (tgRow) tgRow.addEventListener("click", () => openTelegramDrawer("settings"));
    }
  }

  // Interactive Overview KPI jumps
  document.querySelectorAll("[data-mc-kpi-jump]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const [tab, filter] = String(btn.dataset.mcKpiJump || "").split(":");
      if (tab === "mc-approvals" && filter) {
        mcState.utrFilter = filter;
        mcState.utrSearch = "";
        if (els.utrSearchInput) els.utrSearchInput.value = "";
        syncUtrFilterPills();
        renderUtrRequests();
        switchTab("mc-approvals");
      } else if (tab === "mc-users" && filter) {
        mcState.userFilter = filter;
        mcState.userSearch = "";
        if (els.userSearchInput) els.userSearchInput.value = "";
        els.userFilterPills?.querySelectorAll(".filter-pill").forEach((b) => {
          b.classList.toggle("active", b.dataset.mcUserFilter === mcState.userFilter);
        });
        renderUsers();
        switchTab("mc-users");
      }
    });
  });

  // ==========================================================================
  // UTR Approvals (Rolling +planDays, Default +10 Days for Rs 30)
  // ==========================================================================

  function syncUtrFilterPills() {
    els.utrFilterPills?.querySelectorAll(".filter-pill").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mcFilter === mcState.utrFilter);
    });
  }

  els.utrFilterPills?.querySelectorAll(".filter-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      mcState.utrFilter = btn.dataset.mcFilter || "PENDING";
      syncUtrFilterPills();
      renderUtrRequests();
    });
  });

  els.utrSearchInput?.addEventListener("input", (e) => {
    mcState.utrSearch = e.target.value.trim().toLowerCase();
    renderUtrRequests();
  });

  function renderUtrRequests() {
    if (!els.utrRequestsList) return;
    const pending = mcState.requests.filter((r) => r.status === "PENDING");
    const approved = mcState.requests.filter((r) => r.status === "APPROVED");
    const rejected = mcState.requests.filter((r) => r.status === "REJECTED");

    if (els.countReqPending) els.countReqPending.textContent = String(pending.length);
    if (els.countReqApproved) els.countReqApproved.textContent = String(approved.length);
    if (els.countReqRejected) els.countReqRejected.textContent = String(rejected.length);
    if (els.countReqAll) els.countReqAll.textContent = String(mcState.requests.length);

    let filtered = mcState.requests;
    if (mcState.utrFilter !== "ALL") {
      filtered = filtered.filter((r) => r.status === mcState.utrFilter);
    }
    if (mcState.utrSearch) {
      const q = mcState.utrSearch;
      filtered = filtered.filter(
        (r) =>
          (r.utrNumber || "").toLowerCase().includes(q) ||
          (r.userName || "").toLowerCase().includes(q) ||
          (r.mobileNumber || "").toLowerCase().includes(q) ||
          (r.uid || "").toLowerCase().includes(q)
      );
    }

    if (filtered.length === 0) {
      els.utrRequestsList.innerHTML = `<div class="panel empty-state" style="grid-column:1/-1">No Meme Circle subscription requests found in this filter.</div>`;
      return;
    }

    const now = Date.now();
    const planDays = Math.max(1, Math.min(3650, Math.round(Number(mcState.config.planDays) || 10)));

    els.utrRequestsList.innerHTML = filtered
      .map((req) => {
        const receiptSrc = toBase64ImageSrc(req.receiptBase64);
        const isPending = req.status === "PENDING";
        const sub = mcState.subscriptions.get(req.uid) || null;
        const baseMs = Math.max(
          now,
          Number(sub?.paidExpiryMillis || 0),
          Number(sub?.trialExpiryMillis || 0)
        );
        const targetExpiryMs = baseMs + planDays * DAY_MS;

        return `
        <article class="req-card" data-mc-req-card="${escapeHtml(req.id)}">
          <div class="req-head">
            <div>
              <div class="req-shop">${escapeHtml(req.userName || "Meme Circle User")}</div>
              <div class="req-owner">${escapeHtml(req.mobileNumber || "—")}</div>
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
              ? `<div class="req-receipt-thumb" data-mc-open-receipt="${escapeHtml(req.id)}">
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
            <span class="mono">${escapeHtml(req.uid)}</span>
          </div>

          ${
            isPending
              ? `<div class="field">
                   <input type="text" class="input" data-mc-note-for="${escapeHtml(req.id)}" maxlength="240" placeholder="Optional admin note (shown in Meme Circle)..." />
                 </div>
                 <div class="req-actions">
                   <button type="button" class="btn btn-emerald" data-mc-approve-req="${escapeHtml(req.id)}">Approve +${planDays}d (Till ${escapeHtml(formatDateShortIst(targetExpiryMs))})</button>
                   <button type="button" class="btn btn-ghost-danger" data-mc-reject-req="${escapeHtml(req.id)}">Reject</button>
                 </div>`
              : req.adminNote
              ? `<div class="muted-note"><strong>Admin Note:</strong> ${escapeHtml(req.adminNote)}</div>`
              : ""
          }
        </article>`;
      })
      .join("");

    els.utrRequestsList.querySelectorAll("[data-mc-open-receipt]").forEach((el) => {
      el.addEventListener("click", () => {
        const req = mcState.requests.find((r) => r.id === el.dataset.mcOpenReceipt);
        if (!req) return;
        openReceiptLightbox(
          toBase64ImageSrc(req.receiptBase64),
          `Meme Circle • ${req.userName} • UTR: ${req.utrNumber} • ${formatInr(req.amountInr)}`
        );
      });
    });

    els.utrRequestsList.querySelectorAll("[data-mc-approve-req]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const reqId = btn.dataset.mcApproveReq;
        const req = mcState.requests.find((r) => r.id === reqId);
        if (!req) return;
        const noteEl = els.utrRequestsList.querySelector(`[data-mc-note-for="${CSS.escape(reqId)}"]`);
        const note = noteEl ? noteEl.value.trim() : "";
        approveUtrRequest(req, note, btn);
      });
    });

    els.utrRequestsList.querySelectorAll("[data-mc-reject-req]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const reqId = btn.dataset.mcRejectReq;
        const req = mcState.requests.find((r) => r.id === reqId);
        if (!req) return;
        const noteEl = els.utrRequestsList.querySelector(`[data-mc-note-for="${CSS.escape(reqId)}"]`);
        const note = noteEl ? noteEl.value.trim() : "";
        askConfirm({
          title: "Reject Meme Circle UTR?",
          message: `Reject UTR ${req.utrNumber} for "${req.userName}"? The user will be notified in-app immediately.`,
          okLabel: "Reject Request",
          okClass: "btn-danger",
          onConfirm: () => rejectUtrRequest(req, note, btn),
        });
      });
    });
  }

  async function approveUtrRequest(req, note, btn) {
    const adminUser = getUser();
    if (!adminUser) return;
    const origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Approving...";

    const planPrice = Math.max(1, Math.min(100000, Math.round(Number(mcState.config.planPriceInr) || 30)));
    const planDays = Math.max(1, Math.min(3650, Math.round(Number(mcState.config.planDays) || 10)));
    const now = Date.now();
    let approvedUntilLabel = "";

    try {
      await runTransaction(db, async (tx) => {
        const reqRef = doc(db, MC_REQUESTS_COLLECTION, req.id);
        const subRef = doc(db, MC_SUBSCRIPTIONS_COLLECTION, req.uid);

        const reqSnap = await tx.get(reqRef);
        if (!reqSnap.exists()) throw new Error("Request no longer exists.");
        if (reqSnap.data().status !== "PENDING") {
          throw new Error(`Request already processed (${reqSnap.data().status}).`);
        }

        const subSnap = await tx.get(subRef);
        const existingSub = subSnap.exists() ? subSnap.data() : null;

        const currentPaidExp = Number(existingSub?.paidExpiryMillis || 0);
        const currentTrialExp = Number(existingSub?.trialExpiryMillis || 0);
        const baseMillis = Math.max(now, currentPaidExp, currentTrialExp);
        const newExpiryMillis = baseMillis + planDays * DAY_MS;
        approvedUntilLabel = formatDateShortIst(newExpiryMillis);
        const cleanNote = (note || `Approved +${planDays} days (valid until ${approvedUntilLabel})`).slice(0, 240);

        tx.update(reqRef, {
          status: "APPROVED",
          adminNote: cleanNote,
          reviewedBy: adminUser.uid,
          updatedAt: serverTimestamp(),
        });

        if (subSnap.exists()) {
          tx.update(subRef, {
            status: "ACTIVE",
            planPriceInr: planPrice,
            planDays,
            paidStartMillis: Number(existingSub.paidStartMillis || 0) > 0 ? existingSub.paidStartMillis : now,
            paidExpiryMillis: newExpiryMillis,
            lastApprovedUtr: String(req.utrNumber || "").slice(0, 64),
            updatedAt: serverTimestamp(),
          });
        } else {
          tx.set(subRef, {
            uid: req.uid,
            userName: String(req.userName || "Creator").slice(0, 80),
            mobileNumber: String(req.mobileNumber || "0000000000").slice(0, 20),
            status: "ACTIVE",
            planPriceInr: planPrice,
            planDays,
            trialStartMillis: now,
            trialExpiryMillis: now,
            paidStartMillis: now,
            paidExpiryMillis: newExpiryMillis,
            lastApprovedUtr: String(req.utrNumber || "").slice(0, 64),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }

        const notifRef = doc(collection(db, MC_NOTIFICATIONS_COLLECTION));
        tx.set(notifRef, {
          uid: req.uid,
          type: "SUBSCRIPTION_APPROVED",
          title: "Meme Circle Pro Activated!",
          message: `Your payment (UTR ${req.utrNumber}) is verified. ${planDays}-day Pro access unlocked until ${approvedUntilLabel}!`.slice(
            0,
            400
          ),
          referenceId: req.id,
          read: false,
          createdAt: serverTimestamp(),
        });
      });

      showToast(`Approved ${req.userName}! Active for +${planDays} days (till ${approvedUntilLabel}).`);
    } catch (err) {
      showToast(`Approve failed: ${formatFirestoreError(err)}`, "error");
      btn.disabled = false;
      btn.textContent = origText;
    }
  }

  async function rejectUtrRequest(req, note, btn) {
    const adminUser = getUser();
    if (!adminUser) return;
    btn.disabled = true;
    const cleanNote = (note || "UTR could not be verified. Please check and resubmit.").slice(0, 240);
    const now = Date.now();

    try {
      await runTransaction(db, async (tx) => {
        const reqRef = doc(db, MC_REQUESTS_COLLECTION, req.id);
        const subRef = doc(db, MC_SUBSCRIPTIONS_COLLECTION, req.uid);

        const reqSnap = await tx.get(reqRef);
        if (!reqSnap.exists()) throw new Error("Request not found.");
        if (reqSnap.data().status !== "PENDING") {
          throw new Error(`Request already processed (${reqSnap.data().status}).`);
        }

        const subSnap = await tx.get(subRef);
        const existingSub = subSnap.exists() ? subSnap.data() : null;

        tx.update(reqRef, {
          status: "REJECTED",
          adminNote: cleanNote,
          reviewedBy: adminUser.uid,
          updatedAt: serverTimestamp(),
        });

        if (subSnap.exists() && existingSub.status !== "SUSPENDED") {
          tx.update(subRef, {
            status: computeFallbackStatus(existingSub, now),
            updatedAt: serverTimestamp(),
          });
        }

        const notifRef = doc(collection(db, MC_NOTIFICATIONS_COLLECTION));
        tx.set(notifRef, {
          uid: req.uid,
          type: "SUBSCRIPTION_REJECTED",
          title: "Payment Verification Failed",
          message: `UTR ${req.utrNumber} was not approved. Note: ${cleanNote}`.slice(0, 400),
          referenceId: req.id,
          read: false,
          createdAt: serverTimestamp(),
        });
      });

      showToast(`Rejected Meme Circle request for ${req.userName}.`);
    } catch (err) {
      showToast(`Reject failed: ${formatFirestoreError(err)}`, "error");
      btn.disabled = false;
    }
  }

  // ==========================================================================
  // Billing, 1-Day Trial & UPI QR Editor + Live Preview
  // ==========================================================================

  function populateConfigForms() {
    const cfg = mcState.config;
    if (els.cfgUpiId) els.cfgUpiId.value = cfg.ownerUpiId || "";
    if (els.cfgUpiName) els.cfgUpiName.value = cfg.ownerUpiName || "";
    if (els.cfgPlanPrice) els.cfgPlanPrice.value = Number(cfg.planPriceInr) || 30;
    if (els.cfgPlanDays) els.cfgPlanDays.value = Number(cfg.planDays) || 10;
    if (els.cfgTrialDays) els.cfgTrialDays.value = clampMcTrialDays(cfg.trialDays);
    if (els.cfgInstructions) els.cfgInstructions.value = cfg.instructions || "";
    mcState.pendingQrBase64 = cfg.ownerUpiQrBase64 || "";

    if (els.sysMaintToggle) els.sysMaintToggle.checked = Boolean(cfg.maintenanceMode);
    els.maintWarningBanner?.classList.toggle("hidden", !cfg.maintenanceMode);
    if (els.sysMaintMsg) {
      els.sysMaintMsg.value = cfg.maintenanceMessage || DEFAULT_MC_APP_CONFIG.maintenanceMessage;
    }
    if (els.sysLatestCode) els.sysLatestCode.value = Number(cfg.latestAppVersionCode) || 1;
    if (els.sysLatestName) els.sysLatestName.value = cfg.latestAppVersionName || "1.0";
    if (els.sysMinCode) els.sysMinCode.value = Number(cfg.minSupportedVersionCode) || 1;
    if (els.sysUpdateUrl) els.sysUpdateUrl.value = cfg.updateUrl || "";
    if (els.sysUpdateNotes) els.sysUpdateNotes.value = cfg.updateNotes || "";

    syncIndicators();
    updateBillingPreview();
  }

  function syncIndicators() {
    if (els.billingLastUpdated) {
      const updatedMs = toMillis(mcState.config.updatedAt);
      els.billingLastUpdated.textContent = updatedMs
        ? `Last synced: ${formatDateTime(updatedMs)}`
        : "Using default ₹30 / 10d / 1d trial (click Publish to initialize)";
    }

    const vastraCfg = getVastraConfig() || {};
    const tgUrl = mcState.config.telegramWebhookUrl || vastraCfg.telegramWebhookUrl || "";
    const tgLive = Boolean(tgUrl && tgUrl.trim().startsWith("https://"));
    if (els.tgTriggerStatusPill) {
      els.tgTriggerStatusPill.textContent = tgLive ? "Connected 24/7" : "Not Configured";
      els.tgTriggerStatusPill.className = `pill pill-compact ${tgLive ? "pill-success" : "pill-warning"}`;
    }
  }

  function updateBillingPreview() {
    if (!els.previewPriceTitle) return;
    const upiId = els.cfgUpiId.value.trim() || "vastraos.billing@upi";
    const upiName = els.cfgUpiName.value.trim() || "Sarfu Techno";
    const price = Math.max(1, Math.round(Number(els.cfgPlanPrice.value) || 30));
    const days = Math.max(1, Math.round(Number(els.cfgPlanDays.value) || 10));
    const trialDays = clampMcTrialDays(els.cfgTrialDays.value);
    const instructions = els.cfgInstructions.value.trim();
    const qrSrc = toBase64ImageSrc(mcState.pendingQrBase64);

    els.previewPriceTitle.textContent = `Pay ₹${price} • ${days} Days`;
    els.previewTrialLabel.textContent =
      trialDays === 0
        ? "Free trial disabled — paid plan required"
        : `New users get ${trialDays}-day free trial`;
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
      const kb = Math.round((mcState.pendingQrBase64.length * 3) / 4 / 1024);
      els.qrSizeHint.textContent = `QR ready (~${kb} KB raw Base64) — live in Meme Circle`;
    } else {
      els.previewQrImg.classList.add("hidden");
      els.previewQrEmpty.classList.remove("hidden");
      els.qrUploadPreviewWrap.classList.add("hidden");
      els.qrClearBtn.classList.add("hidden");
      els.qrSizeHint.textContent = "PNG/JPG auto-resized to ≤512px & saved as raw Base64";
    }
  }

  [
    els.cfgUpiId,
    els.cfgUpiName,
    els.cfgPlanPrice,
    els.cfgPlanDays,
    els.cfgTrialDays,
    els.cfgInstructions,
  ].forEach((input) => {
    input?.addEventListener("input", updateBillingPreview);
  });

  document.querySelectorAll(".mc-cfg-trial-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (els.cfgTrialDays) els.cfgTrialDays.value = btn.dataset.mcTrialDays;
      updateBillingPreview();
    });
  });

  async function handleMcQrFile(file) {
    try {
      const rawBase64 = await compressImageToRawBase64(file, 512, MAX_QR_BASE64_LEN, true);
      mcState.pendingQrBase64 = rawBase64;
      updateBillingPreview();
      showToast("Meme Circle QR compressed & ready! Click Publish to sync.");
    } catch (err) {
      showToast(err.message, "error");
    }
  }

  els.qrPickBtn?.addEventListener("click", () => els.qrFileInput?.click());
  els.qrFileInput?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) handleMcQrFile(file);
    e.target.value = "";
  });

  els.qrCopyVastraBtn?.addEventListener("click", () => {
    const vastraCfg = getVastraConfig() || {};
    if (!vastraCfg.ownerUpiQrBase64 && !vastraCfg.ownerUpiId) {
      return showToast("No VastraOS QR or UPI configured yet.", "error");
    }
    if (vastraCfg.ownerUpiId && els.cfgUpiId) els.cfgUpiId.value = vastraCfg.ownerUpiId;
    if (vastraCfg.ownerUpiName && els.cfgUpiName) els.cfgUpiName.value = vastraCfg.ownerUpiName;
    if (vastraCfg.ownerUpiQrBase64) mcState.pendingQrBase64 = vastraCfg.ownerUpiQrBase64;
    updateBillingPreview();
    showToast("Copied VastraOS UPI ID & QR into Meme Circle draft! Click Publish to save.");
  });

  els.qrClearBtn?.addEventListener("click", () => {
    mcState.pendingQrBase64 = "";
    updateBillingPreview();
    showToast("Meme Circle QR cleared from draft. Click Publish to apply.");
  });

  if (els.qrDropzone) {
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
      if (file) handleMcQrFile(file);
    });
  }

  els.billingForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const upiId = els.cfgUpiId.value.trim();
    const upiName = els.cfgUpiName.value.trim();
    const price = Math.round(Number(els.cfgPlanPrice.value));
    const planDays = Math.round(Number(els.cfgPlanDays.value));
    const trialDays = Math.round(Number(els.cfgTrialDays.value));
    const instructions = els.cfgInstructions.value.trim();

    if (upiId.length < 3) return showToast("UPI ID must be at least 3 characters.", "error");
    if (!upiName) return showToast("Beneficiary name is required.", "error");
    if (!Number.isInteger(price) || price < 1 || price > 100000)
      return showToast("Plan price must be between ₹1 and ₹100,000.", "error");
    if (!Number.isInteger(planDays) || planDays < 1 || planDays > 3650)
      return showToast("Plan days must be between 1 and 3650.", "error");
    if (!Number.isInteger(trialDays) || trialDays < 0 || trialDays > 90)
      return showToast("Free trial days must be between 0 and 90.", "error");
    if (!instructions) return showToast("Payment instructions are required.", "error");

    els.saveBillingBtn.disabled = true;
    els.saveBillingBtn.textContent = "Publishing...";
    try {
      const payload = buildFullMcConfigPayload({
        ownerUpiId: upiId,
        ownerUpiName: upiName,
        ownerUpiQrBase64: mcState.pendingQrBase64,
        planPriceInr: price,
        planDays,
        trialDays,
        instructions,
      });
      await setDoc(doc(db, "appConfig", MC_APP_CONFIG_DOC_ID), payload);
      showToast(`Meme Circle Billing live: ₹${price}/${planDays}d & ${trialDays}d free trial!`);
    } catch (err) {
      showToast(`Failed to publish Meme Circle billing: ${formatFirestoreError(err)}`, "error");
    } finally {
      els.saveBillingBtn.disabled = false;
      els.saveBillingBtn.textContent = "Publish Live to Meme Circle";
    }
  });

  // ==========================================================================
  // All Meme Circle Users + 3-Mode Plan Manager + Suspend/Reactivate
  // ==========================================================================

  els.userFilterPills?.querySelectorAll(".filter-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      mcState.userFilter = btn.dataset.mcUserFilter || "ALL";
      els.userFilterPills.querySelectorAll(".filter-pill").forEach((b) => {
        b.classList.toggle("active", b.dataset.mcUserFilter === mcState.userFilter);
      });
      renderUsers();
    });
  });

  els.userSearchInput?.addEventListener("input", (e) => {
    mcState.userSearch = e.target.value.trim().toLowerCase();
    renderUsers();
  });

  function getMergedMcUsers() {
    const map = new Map();
    mcState.users.forEach((u) => {
      const uid = u.uid || u.id;
      map.set(uid, {
        uid,
        name: u.name || "Creator",
        mobileNumber: u.mobileNumber || "—",
        email: u.email || "",
        createdAt: u.createdAt,
      });
    });
    mcState.subscriptions.forEach((sub, uid) => {
      if (!map.has(uid)) {
        map.set(uid, {
          uid,
          name: sub.userName || "Creator",
          mobileNumber: sub.mobileNumber || "—",
          email: "",
          createdAt: sub.createdAt,
        });
      }
    });
    return Array.from(map.values()).sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
  }

  function renderUsers() {
    if (!els.usersTableBody) return;
    const now = Date.now();
    const enriched = getMergedMcUsers().map((user) => {
      const sub = mcState.subscriptions.get(user.uid) || null;
      const effStatus = computeEffectiveStatus(sub, now);
      const expiryMs = sub
        ? Math.max(Number(sub.paidExpiryMillis || 0), Number(sub.trialExpiryMillis || 0))
        : 0;
      const daysLeft = expiryMs > now ? Math.ceil((expiryMs - now) / DAY_MS) : 0;
      return { user, sub, effStatus, expiryMs, daysLeft };
    });

    if (els.countUserAll) els.countUserAll.textContent = String(enriched.length);
    if (els.countUserActive) {
      els.countUserActive.textContent = String(
        enriched.filter(
          (x) => x.effStatus === "ACTIVE" || (x.effStatus === "EXPIRING_SOON" && Number(x.sub?.paidExpiryMillis || 0) > now)
        ).length
      );
    }
    if (els.countUserTrial) {
      els.countUserTrial.textContent = String(
        enriched.filter(
          (x) =>
            x.effStatus === "TRIAL_ACTIVE" ||
            (x.effStatus === "EXPIRING_SOON" && Number(x.sub?.paidExpiryMillis || 0) <= now)
        ).length
      );
    }
    if (els.countUserPending) {
      els.countUserPending.textContent = String(
        enriched.filter((x) => x.effStatus === "PAYMENT_PENDING").length
      );
    }
    if (els.countUserExpired) {
      els.countUserExpired.textContent = String(
        enriched.filter((x) => x.effStatus === "EXPIRED" || x.effStatus === "TRIAL_EXPIRED").length
      );
    }
    if (els.countUserSuspended) {
      els.countUserSuspended.textContent = String(
        enriched.filter((x) => x.effStatus === "SUSPENDED").length
      );
    }

    let rows = enriched;
    if (mcState.userFilter === "ACTIVE") {
      rows = rows.filter(
        (x) => x.effStatus === "ACTIVE" || (x.effStatus === "EXPIRING_SOON" && Number(x.sub?.paidExpiryMillis || 0) > now)
      );
    } else if (mcState.userFilter === "TRIAL") {
      rows = rows.filter(
        (x) =>
          x.effStatus === "TRIAL_ACTIVE" ||
          (x.effStatus === "EXPIRING_SOON" && Number(x.sub?.paidExpiryMillis || 0) <= now)
      );
    } else if (mcState.userFilter === "PAYMENT_PENDING") {
      rows = rows.filter((x) => x.effStatus === "PAYMENT_PENDING");
    } else if (mcState.userFilter === "EXPIRED") {
      rows = rows.filter(
        (x) => x.effStatus === "EXPIRED" || x.effStatus === "TRIAL_EXPIRED" || x.effStatus === "NO_SUB"
      );
    } else if (mcState.userFilter === "SUSPENDED") {
      rows = rows.filter((x) => x.effStatus === "SUSPENDED");
    }

    if (mcState.userSearch) {
      const q = mcState.userSearch;
      rows = rows.filter(
        (x) =>
          (x.user.name || "").toLowerCase().includes(q) ||
          (x.user.mobileNumber || "").toLowerCase().includes(q) ||
          (x.user.email || "").toLowerCase().includes(q) ||
          x.user.uid.toLowerCase().includes(q)
      );
    }

    if (rows.length === 0) {
      els.usersTableBody.innerHTML = "";
      els.usersEmptyState?.classList.remove("hidden");
      return;
    }

    els.usersEmptyState?.classList.add("hidden");
    els.usersTableBody.innerHTML = rows
      .map(({ user, sub, effStatus, expiryMs, daysLeft }) => {
        const isSuspended = effStatus === "SUSPENDED";
        return `
        <tr>
          <td>
            <div class="cell-title">${escapeHtml(user.name)}</div>
            <div class="cell-sub mono">${escapeHtml(user.uid)}</div>
          </td>
          <td>
            <div class="cell-title mono">${escapeHtml(user.mobileNumber)}</div>
            <div class="cell-sub">${escapeHtml(user.email || "—")}</div>
          </td>
          <td>${statusPillHtml(effStatus)}</td>
          <td>
            <div class="cell-title">${expiryMs ? formatDateShortIst(expiryMs) : "—"}</div>
            <div class="cell-sub">${daysLeft > 0 ? `${daysLeft} day${daysLeft === 1 ? "" : "s"} left` : "Expired / Locked"}</div>
          </td>
          <td class="mono">${escapeHtml(sub?.lastApprovedUtr || "—")}</td>
          <td class="text-right">
            <div class="row-actions">
              <button type="button" class="btn btn-emerald btn-sm" data-mc-manage-uid="${escapeHtml(user.uid)}">Manage Plan / Days</button>
              ${
                isSuspended
                  ? `<button type="button" class="btn btn-primary btn-sm" data-mc-unsuspend-uid="${escapeHtml(user.uid)}">Reactivate</button>`
                  : `<button type="button" class="btn btn-ghost-danger btn-sm" data-mc-suspend-uid="${escapeHtml(user.uid)}">Suspend</button>`
              }
            </div>
          </td>
        </tr>`;
      })
      .join("");

    els.usersTableBody.querySelectorAll("[data-mc-manage-uid]").forEach((btn) => {
      btn.addEventListener("click", () => openManageModal(btn.dataset.mcManageUid));
    });

    els.usersTableBody.querySelectorAll("[data-mc-suspend-uid]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const uid = btn.dataset.mcSuspendUid;
        const user = getMergedMcUsers().find((u) => u.uid === uid);
        if (!user) return;
        askConfirm({
          title: `Suspend "${user.name}"?`,
          message: "This will immediately lock Meme Circle Pro & app access for this user until reactivated.",
          okLabel: "Suspend User",
          okClass: "btn-danger",
          onConfirm: () => setUserSuspended(user, true),
        });
      });
    });

    els.usersTableBody.querySelectorAll("[data-mc-unsuspend-uid]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const uid = btn.dataset.mcUnsuspendUid;
        const user = getMergedMcUsers().find((u) => u.uid === uid);
        if (user) setUserSuspended(user, false);
      });
    });
  }

  function setManageMode(mode) {
    mcState.manageMode = mode;
    els.manageTabs?.querySelectorAll("[data-mc-manage-mode]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mcManageMode === mode);
    });
    document.querySelectorAll("[data-mc-manage-pane]").forEach((pane) => {
      pane.classList.toggle("active", pane.dataset.mcManagePane === mode);
    });
    updateManagePreview();
  }

  function openManageModal(uid) {
    const user = getMergedMcUsers().find((u) => u.uid === uid);
    if (!user) return;
    const sub = mcState.subscriptions.get(uid) || null;
    const now = Date.now();
    const paidExp = Number(sub?.paidExpiryMillis || 0);
    const trialExp = Number(sub?.trialExpiryMillis || 0);
    const paidDaysLeft = paidExp > now ? Math.ceil((paidExp - now) / DAY_MS) : 0;
    const trialDaysLeft = trialExp > now ? Math.ceil((trialExp - now) / DAY_MS) : 0;
    const effStatus = computeEffectiveStatus(sub, now);

    mcState.manageUid = uid;
    els.manageUserDesc.textContent = `Adjust rolling paid plan cycles, add/reduce paid days, or update free trial days for "${user.name}" (${user.mobileNumber}).`;
    els.manageCurrentSummary.innerHTML = `
      <div><strong>Current Status:</strong> ${escapeHtml(effStatus.replace(/_/g, " "))}</div>
      <div><strong>Paid Expiry:</strong> ${paidExp > 0 ? `${escapeHtml(formatDateShortIst(paidExp))} (${paidDaysLeft}d left)` : "None"}</div>
      <div><strong>Trial Expiry:</strong> ${trialExp > 0 ? `${escapeHtml(formatDateShortIst(trialExp))} (${trialDaysLeft}d left)` : "None"}</div>
    `;

    els.manageCyclesInput.value = 1;
    els.paidExactDaysInput.value = paidDaysLeft;
    els.trialExactDaysInput.value =
      trialDaysLeft > 0 ? Math.min(90, trialDaysLeft) : clampMcTrialDays(mcState.config.trialDays);
    els.manageNoteInput.value = "";

    setManageMode("cycles");
    openModal("mc-manage-modal");
  }

  els.manageTabs?.querySelectorAll("[data-mc-manage-mode]").forEach((btn) => {
    btn.addEventListener("click", () => setManageMode(btn.dataset.mcManageMode));
  });

  function updateManagePreview() {
    if (!els.manageExpiryPreview) return;
    const uid = mcState.manageUid;
    const sub = uid ? mcState.subscriptions.get(uid) : null;
    const now = Date.now();
    const planDays = Math.max(1, Math.min(3650, Math.round(Number(mcState.config.planDays) || 10)));

    els.manageExpiryPreview.classList.remove("preview-danger");

    if (mcState.manageMode === "cycles") {
      const cycles = Math.max(1, Math.min(36, Math.round(Number(els.manageCyclesInput.value) || 1)));
      const totalAddDays = cycles * planDays;
      const baseMillis = Math.max(
        now,
        Number(sub?.paidExpiryMillis || 0),
        Number(sub?.trialExpiryMillis || 0)
      );
      const targetMillis = baseMillis + totalAddDays * DAY_MS;
      els.manageExpiryPreview.textContent = `Rolling Plan (+${totalAddDays} days): Active until ${formatDateShortIst(targetMillis)} IST`;
    } else if (mcState.manageMode === "paid-days") {
      const days = Math.max(0, Math.min(3650, Math.round(Number(els.paidExactDaysInput.value) || 0)));
      if (days === 0) {
        els.manageExpiryPreview.classList.add("preview-danger");
        els.manageExpiryPreview.textContent =
          "0 paid days: Immediately EXPIRES paid plan and locks Meme Circle Pro features.";
      } else {
        const targetMillis = now + days * DAY_MS;
        els.manageExpiryPreview.textContent = `Paid Days Set: Active for ${days} day${days === 1 ? "" : "s"} — expires ${formatDateShortIst(targetMillis)} IST`;
      }
    } else {
      const days = clampMcTrialDays(els.trialExactDaysInput.value);
      if (days === 0) {
        els.manageExpiryPreview.classList.add("preview-danger");
        els.manageExpiryPreview.textContent = "0 trial days: Immediately ENDS free trial for this user.";
      } else {
        const targetMillis = now + days * DAY_MS;
        els.manageExpiryPreview.textContent = `Free Trial Set: ${days} day${days === 1 ? "" : "s"} left — ends ${formatDateShortIst(targetMillis)} IST`;
      }
    }
  }

  document.querySelectorAll(".mc-quick-cycle-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (els.manageCyclesInput) els.manageCyclesInput.value = btn.dataset.mcCycles;
      updateManagePreview();
    });
  });

  document.querySelectorAll(".mc-paid-delta-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const delta = Number(btn.dataset.mcDelta || 0);
      const cur = Math.max(0, Math.round(Number(els.paidExactDaysInput.value) || 0));
      els.paidExactDaysInput.value = Math.max(0, Math.min(3650, cur + delta));
      updateManagePreview();
    });
  });

  els.paidExpireNowBtn?.addEventListener("click", () => {
    els.paidExactDaysInput.value = 0;
    updateManagePreview();
  });

  document.querySelectorAll(".mc-trial-quick-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      els.trialExactDaysInput.value = clampMcTrialDays(btn.dataset.mcTrial);
      updateManagePreview();
    });
  });

  [els.manageCyclesInput, els.paidExactDaysInput, els.trialExactDaysInput].forEach((input) => {
    input?.addEventListener("input", updateManagePreview);
  });

  els.manageForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const uid = mcState.manageUid;
    const user = getMergedMcUsers().find((u) => u.uid === uid);
    if (!user) return;

    const mode = mcState.manageMode;
    const refNote = (els.manageNoteInput.value.trim() || "ADMIN_ADJUSTED").slice(0, 64);
    const planPrice = Math.max(1, Math.min(100000, Math.round(Number(mcState.config.planPriceInr) || 30)));
    const planDays = Math.max(1, Math.min(3650, Math.round(Number(mcState.config.planDays) || 10)));
    const now = Date.now();
    let successSummary = "";

    els.confirmManageBtn.disabled = true;
    els.confirmManageBtn.textContent = "Syncing...";

    try {
      await runTransaction(db, async (tx) => {
        const subRef = doc(db, MC_SUBSCRIPTIONS_COLLECTION, uid);
        const subSnap = await tx.get(subRef);
        const existingSub = subSnap.exists() ? subSnap.data() : null;

        const existingTrialStart = Number(existingSub?.trialStartMillis || 0) || now;
        const existingTrialExp = Number(existingSub?.trialExpiryMillis || 0);
        const existingPaidStart = Number(existingSub?.paidStartMillis || 0);
        const existingPaidExp = Number(existingSub?.paidExpiryMillis || 0);

        let updatePayload = {};
        let notifType = "SUBSCRIPTION_APPROVED";
        let notifTitle = "Meme Circle Plan Updated";
        let notifMsg = "";

        if (mode === "cycles") {
          const cycles = Math.round(Number(els.manageCyclesInput.value));
          if (!Number.isInteger(cycles) || cycles < 1 || cycles > 36) {
            throw new Error("Enter valid cycles between 1 and 36.");
          }
          const addDays = cycles * planDays;
          const baseMillis = Math.max(now, existingPaidExp, existingTrialExp);
          const newExpiryMillis = baseMillis + addDays * DAY_MS;
          const label = formatDateShortIst(newExpiryMillis);
          updatePayload = {
            status: "ACTIVE",
            planPriceInr: planPrice,
            planDays: Math.min(3650, addDays),
            paidStartMillis: existingPaidStart > 0 ? existingPaidStart : now,
            paidExpiryMillis: newExpiryMillis,
            lastApprovedUtr: refNote,
          };
          notifTitle = "Meme Circle Pro Extended!";
          notifMsg = `Admin added +${addDays} days to your Meme Circle Pro plan. Valid until ${label}.`;
          successSummary = `Extended "${user.name}" by +${addDays}d (till ${label})!`;
        } else if (mode === "paid-days") {
          const days = Math.round(Number(els.paidExactDaysInput.value));
          if (!Number.isInteger(days) || days < 0 || days > 3650) {
            throw new Error("Enter valid paid days between 0 and 3650.");
          }
          if (days === 0) {
            const expiredMs = Math.max(1, now - 1000);
            updatePayload = {
              status: existingTrialExp > now ? "TRIAL_ACTIVE" : "EXPIRED",
              planPriceInr: planPrice,
              planDays,
              paidStartMillis: existingPaidStart > 0 ? existingPaidStart : expiredMs,
              paidExpiryMillis: expiredMs,
              lastApprovedUtr: refNote,
            };
            notifType = "SUBSCRIPTION_EXPIRED";
            notifTitle = "Meme Circle Plan Updated";
            notifMsg = "Your paid Meme Circle validity was updated by Admin. Renew anytime to unlock Pro features.";
            successSummary = `Expired paid plan immediately for "${user.name}".`;
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
            notifTitle = "Meme Circle Days Updated";
            notifMsg = `Admin updated your Meme Circle Pro validity to ${days} day${days === 1 ? "" : "s"} remaining (until ${label}).`;
            successSummary = `Set "${user.name}" paid validity to ${days}d (till ${label}).`;
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
            notifMsg = "Your Meme Circle free trial period ended. Subscribe for ₹30 / 10 days to unlock Pro.";
            successSummary = `Ended free trial for "${user.name}".`;
          } else {
            const newTrialExp = now + days * DAY_MS;
            const label = formatDateShortIst(newTrialExp);
            updatePayload = {
              status: paidStillActive ? "ACTIVE" : "TRIAL_ACTIVE",
              trialStartMillis: existingTrialStart,
              trialExpiryMillis: newTrialExp,
            };
            notifTitle = "Free Trial Updated";
            notifMsg = `Admin updated your Meme Circle free trial to ${days} day${days === 1 ? "" : "s"} remaining (ends ${label}).`;
            successSummary = `Set "${user.name}" free trial to ${days}d (till ${label}).`;
          }
        }

        if (subSnap.exists()) {
          tx.update(subRef, {
            ...updatePayload,
            updatedAt: serverTimestamp(),
          });
        } else {
          tx.set(subRef, {
            uid,
            userName: String(user.name || "Creator").slice(0, 80),
            mobileNumber: String(user.mobileNumber || "0000000000").slice(0, 20),
            status: updatePayload.status || "TRIAL_EXPIRED",
            planPriceInr: planPrice,
            planDays: updatePayload.planDays || planDays,
            trialStartMillis: updatePayload.trialStartMillis ?? now,
            trialExpiryMillis: updatePayload.trialExpiryMillis ?? now,
            paidStartMillis: updatePayload.paidStartMillis ?? 0,
            paidExpiryMillis: updatePayload.paidExpiryMillis ?? 0,
            lastApprovedUtr: updatePayload.lastApprovedUtr ?? refNote,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }

        const notifRef = doc(collection(db, MC_NOTIFICATIONS_COLLECTION));
        tx.set(notifRef, {
          uid,
          type: notifType,
          title: notifTitle,
          message: notifMsg.slice(0, 400),
          referenceId: refNote,
          read: false,
          createdAt: serverTimestamp(),
        });
      });

      closeModal("mc-manage-modal");
      showToast(successSummary);
    } catch (err) {
      showToast(`Update failed: ${formatFirestoreError(err)}`, "error");
    } finally {
      els.confirmManageBtn.disabled = false;
      els.confirmManageBtn.textContent = "Apply Changes Now";
    }
  });

  async function setUserSuspended(user, suspend) {
    const sub = mcState.subscriptions.get(user.uid);
    const now = Date.now();
    const planPrice = Math.max(1, Math.min(100000, Math.round(Number(mcState.config.planPriceInr) || 30)));
    const planDays = Math.max(1, Math.min(3650, Math.round(Number(mcState.config.planDays) || 10)));

    try {
      const subRef = doc(db, MC_SUBSCRIPTIONS_COLLECTION, user.uid);
      if (sub) {
        await updateDoc(subRef, {
          status: suspend ? "SUSPENDED" : computeFallbackStatus(sub, now),
          planPriceInr: Number(sub.planPriceInr) >= 1 ? Math.round(Number(sub.planPriceInr)) : planPrice,
          planDays: Number(sub.planDays) >= 1 ? Math.round(Number(sub.planDays)) : planDays,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(subRef, {
          uid: user.uid,
          userName: String(user.name || "Creator").slice(0, 80),
          mobileNumber: String(user.mobileNumber || "0000000000").slice(0, 20),
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

      await setDoc(doc(collection(db, MC_NOTIFICATIONS_COLLECTION)), {
        uid: user.uid,
        type: suspend ? "SUBSCRIPTION_EXPIRED" : "SUBSCRIPTION_APPROVED",
        title: suspend ? "Account Suspended" : "Account Reactivated",
        message: suspend
          ? "Your Meme Circle account has been paused by Sarfu Admin. Contact support for help."
          : "Your Meme Circle account access has been restored by Sarfu Admin!",
        referenceId: user.uid,
        read: false,
        createdAt: serverTimestamp(),
      });

      showToast(suspend ? `"${user.name}" suspended.` : `"${user.name}" reactivated!`);
    } catch (err) {
      showToast(`Action failed: ${formatFirestoreError(err)}`, "error");
    }
  }

  // ==========================================================================
  // Independent Meme Circle System, Maintenance & Force Update Controls
  // ==========================================================================

  els.sysMaintToggle?.addEventListener("change", () => {
    els.maintWarningBanner?.classList.toggle("hidden", !els.sysMaintToggle.checked);
  });

  els.systemForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const maintMode = els.sysMaintToggle.checked;
    const maintMsg = els.sysMaintMsg.value.trim() || DEFAULT_MC_APP_CONFIG.maintenanceMessage;
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
      return showToast("Minimum version code cannot exceed Latest version code.", "error");
    }
    if (!latestName) return showToast("Latest version name is required.", "error");
    if (updateUrl && !/^https:\/\//i.test(updateUrl)) {
      return showToast("Download URL must start with https://", "error");
    }

    const doSave = async () => {
      els.saveSystemBtn.disabled = true;
      els.saveSystemBtn.textContent = "Syncing...";
      try {
        const payload = buildFullMcConfigPayload({
          maintenanceMode: maintMode,
          maintenanceMessage: maintMsg,
          latestAppVersionCode: latestCode,
          latestAppVersionName: latestName,
          minSupportedVersionCode: minCode,
          updateUrl,
          updateNotes,
        });
        await setDoc(doc(db, "appConfig", MC_APP_CONFIG_DOC_ID), payload);
        showToast(
          maintMode
            ? "Meme Circle Maintenance Mode ENABLED (VastraOS unaffected)!"
            : "Meme Circle system & update controls synced live!"
        );
      } catch (err) {
        showToast(`Failed to save Meme Circle system config: ${formatFirestoreError(err)}`, "error");
      } finally {
        els.saveSystemBtn.disabled = false;
        els.saveSystemBtn.textContent = "Save Meme Circle Controls";
      }
    };

    if (maintMode && !mcState.config.maintenanceMode) {
      askConfirm({
        title: "Enable Meme Circle Maintenance?",
        message:
          "This will pause Meme Circle users behind a Maintenance screen immediately (VastraOS POS shops remain 100% online).",
        okLabel: "Enable Maintenance",
        okClass: "btn-danger",
        onConfirm: doSave,
      });
    } else {
      await doSave();
    }
  });

  // ==========================================================================
  // 1-Click Copy Master Build Prompt Modal
  // ==========================================================================

  function openBuildPromptModal() {
    const vastraCfg = getVastraConfig() || {};
    const promptText = buildMemeCircleMasterPrompt({
      firebaseConfig: FIREBASE_CONFIG,
      databaseId: FIRESTORE_DATABASE_ID,
      mcConfig: mcState.config,
      telegramWebhookUrl: mcState.config.telegramWebhookUrl || vastraCfg.telegramWebhookUrl || "",
    });
    if (els.promptTextarea) els.promptTextarea.value = promptText;
    openModal("mc-build-prompt-modal");
  }

  document.querySelectorAll("[data-open-mc-prompt]").forEach((btn) => {
    btn.addEventListener("click", openBuildPromptModal);
  });

  els.copyPromptBtn?.addEventListener("click", async () => {
    const text = els.promptTextarea?.value || "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      showToast("Master Build Prompt copied! Paste it into a New AI Studio Project.");
    } catch {
      els.promptTextarea?.select();
      showToast("Selected prompt text — press Ctrl+C / Copy.", "warning");
    }
  });

  // ==========================================================================
  // External Sync Helpers (called by app.js Releases & Shared Telegram)
  // ==========================================================================

  async function syncReleaseUpdate({ versionCode, versionName, downloadUrl, releaseNotes }) {
    const payload = buildFullMcConfigPayload({
      latestAppVersionCode: versionCode,
      latestAppVersionName: versionName,
      updateUrl: String(downloadUrl || "").slice(0, 500),
      updateNotes: String(releaseNotes || "").slice(0, 500),
    });
    await setDoc(doc(db, "appConfig", MC_APP_CONFIG_DOC_ID), payload);
    if (els.sysLatestCode) els.sysLatestCode.value = versionCode;
    if (els.sysLatestName) els.sysLatestName.value = versionName;
    if (els.sysUpdateUrl) els.sysUpdateUrl.value = String(downloadUrl || "").slice(0, 500);
    if (els.sysUpdateNotes) els.sysUpdateNotes.value = String(releaseNotes || "").slice(0, 500);
  }

  async function syncTelegramSettings({
    telegramWebhookUrl,
    adminPanelUrl,
    notifyOnNewAccount,
    notifyOnUtrSubmit,
  }) {
    const payload = buildFullMcConfigPayload({
      telegramWebhookUrl,
      adminPanelUrl,
      notifyOnNewAccount,
      notifyOnUtrSubmit,
    });
    await setDoc(doc(db, "appConfig", MC_APP_CONFIG_DOC_ID), payload);
    syncIndicators();
  }

  return {
    startListeners,
    stopListeners,
    getMetrics,
    syncIndicators,
    syncReleaseUpdate,
    syncTelegramSettings,
    openBuildPromptModal,
  };
}
