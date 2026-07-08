/**
 * SIKKA Dashboard — Client-side Application
 *
 * Responsibilities:
 *  - Read auth token from sessionStorage (set by login page)
 *  - Attach Authorization header to all API calls
 *  - Load wallet & profile data on page load
 *  - Poll mining status every 5 seconds while mining is active
 *  - Handle Start Mining / Claim Reward actions
 *  - Show toast notifications for all outcomes
 *  - Redirect to login if token is missing or expired
 */

"use strict";

/* ── Constants ──────────────────────────────────────────── */
const API = {
    PROFILE: "/api/accounts/profile/",
    WALLET:  "/api/wallet/",
    STATUS:  "/api/mining/status/",
    START:   "/api/mining/start/",
    CLAIM:   "/api/mining/claim/",
    LOGOUT:  "/api/accounts/logout/",
};

const LOGIN_URL    = "/accounts/login/";
const MAX_MINE_SEC = 24 * 3600;          // 24 h cap

/* ── Token Management ───────────────────────────────────── */
function getToken() {
    return sessionStorage.getItem("sikka_token");
}

function clearToken() {
    sessionStorage.removeItem("sikka_token");
}

/* ── API Helper ─────────────────────────────────────────── */
async function apiFetch(url, method = "GET", body = null) {
    const token = getToken();
    if (!token) {
        redirectToLogin();
        return null;
    }

    const opts = {
        method,
        headers: {
            "Authorization": `Token ${token}`,
            "X-Requested-With": "XMLHttpRequest",
        },
    };

    if (body) {
        opts.headers["Content-Type"] = "application/json";
        opts.body = JSON.stringify(body);
    }

    try {
        const res = await fetch(url, opts);

        if (res.status === 401) {
            clearToken();
            redirectToLogin();
            return null;
        }

        return res;
    } catch (_) {
        showToast("Network Error", "Could not reach the server.", "error");
        return null;
    }
}

/* ── Redirect ───────────────────────────────────────────── */
function redirectToLogin() {
    window.location.href = LOGIN_URL;
}

/* ── Toast Notifications ────────────────────────────────── */
const toastContainer = document.getElementById("toast-container");

function showToast(title, msg, type = "info") {
    const icons = { success: "bi-check-circle-fill", error: "bi-x-circle-fill", info: "bi-info-circle-fill" };

    const el = document.createElement("div");
    el.className = `sikka-toast toast-${type}`;
    el.innerHTML = `
        <i class="bi ${icons[type] || icons.info} toast-icon"></i>
        <div class="toast-body">
            <div class="toast-title">${escHtml(title)}</div>
            <div class="toast-msg">${escHtml(msg)}</div>
        </div>
        <button class="toast-close" aria-label="Close"><i class="bi bi-x"></i></button>
    `;

    el.querySelector(".toast-close").addEventListener("click", () => el.remove());
    toastContainer.appendChild(el);

    setTimeout(() => {
        el.style.opacity = "0";
        el.style.transition = "opacity .3s";
        setTimeout(() => el.remove(), 300);
    }, 4500);
}

function escHtml(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
}

/* ── UI Helpers ─────────────────────────────────────────── */
function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function setDisabled(id, state) {
    const el = document.getElementById(id);
    if (el) el.disabled = state;
}

function formatDecimal(val) {
    const n = parseFloat(val);
    return isNaN(n) ? "0.00000000" : n.toFixed(8);
}

function formatDate(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
    });
}

function secondsToHMS(secs) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return [h, m, s].map(v => String(v).padStart(2, "0")).join(":");
}

/* ── Profile & Wallet ───────────────────────────────────── */
async function loadProfile() {
    const res = await apiFetch(API.PROFILE);
    if (!res || !res.ok) return;

    const data = await res.json();

    // Topnav badge
    setText("nav-username", data.username || "User");

    // Sidebar avatar + info
    const av = document.getElementById("sidebar-avatar");
    if (av) av.textContent = (data.username || "U")[0].toUpperCase();
    setText("sidebar-username", data.username || "");
    setText("sidebar-email", data.email || "");

    // Welcome card
    setText("welcome-username", data.username || "User");
}

async function loadWallet() {
    const res = await apiFetch(API.WALLET);
    if (!res) return;

    if (!res.ok) {
        showToast("Wallet Error", "Could not load wallet data.", "error");
        return;
    }

    const data = await res.json();
    setText("wallet-balance",   formatDecimal(data.balance));
    setText("wallet-mined",     formatDecimal(data.total_mined));
    setText("wallet-sent",      formatDecimal(data.total_sent));
    setText("wallet-received",  formatDecimal(data.total_received));
    setText("wallet-created",   formatDate(data.created_at));
}

/* ── Mining State ───────────────────────────────────────── */
let miningPollTimer   = null;
let elapsedSeconds    = 0;
let timerInterval     = null;
let isMining          = false;

async function loadMiningStatus(silent = false) {
    const res = await apiFetch(API.STATUS);
    if (!res) return;

    if (!res.ok) {
        if (!silent) showToast("Mining Error", "Could not fetch mining status.", "error");
        return;
    }

    const data = await res.json();
    applyMiningStatus(data);
}

function applyMiningStatus(data) {
    isMining = data.is_mining;

    // Mining status badge
    const badge = document.getElementById("mining-status-badge");
    if (badge) {
        badge.textContent = isMining ? "Mining Active" : "Idle";
        badge.className   = "card-badge " + (isMining ? "badge-running" : "badge-idle");
    }

    // Buttons
    setDisabled("btn-start", isMining);
    setDisabled("btn-claim", !isMining);

    // Timer and estimate
    if (isMining) {
        elapsedSeconds = data.elapsed_seconds || 0;
        updateTimerDisplay();
        updateProgressBar(elapsedSeconds);
        setText("mining-estimate-val", formatDecimal(data.estimated_reward) + " SKA");
        setText("mining-started-at", formatDate(data.started_at));

        startLocalTimer();
        startPollTimer();
    } else {
        stopLocalTimer();
        stopPollTimer();
        setText("mining-timer", "00:00:00");
        setText("mining-estimate-val", "0.00000000 SKA");
        setText("mining-started-at", "—");
        updateProgressBar(0);
    }
}

function updateTimerDisplay() {
    const capped = Math.min(elapsedSeconds, MAX_MINE_SEC);
    setText("mining-timer", secondsToHMS(capped));
}

function updateProgressBar(secs) {
    const pct = Math.min((secs / MAX_MINE_SEC) * 100, 100).toFixed(2);
    const bar = document.getElementById("mining-progress-bar");
    const pctEl = document.getElementById("mining-progress-pct");
    if (bar) bar.style.width = pct + "%";
    if (pctEl) pctEl.textContent = pct + "%";
}

function startLocalTimer() {
    if (timerInterval) return;                         // already running
    timerInterval = setInterval(() => {
        if (elapsedSeconds < MAX_MINE_SEC) {
            elapsedSeconds++;
        }
        updateTimerDisplay();
        updateProgressBar(elapsedSeconds);
    }, 1000);
}

function stopLocalTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

function startPollTimer() {
    if (miningPollTimer) return;                       // already polling
    miningPollTimer = setInterval(() => {
        loadMiningStatus(true);
        loadWallet();
    }, 10000);                                         // every 10 s
}

function stopPollTimer() {
    if (miningPollTimer) {
        clearInterval(miningPollTimer);
        miningPollTimer = null;
    }
}

/* ── Start Mining ───────────────────────────────────────── */
async function startMining() {
    setDisabled("btn-start", true);
    const startBtn = document.getElementById("btn-start");
    const origHTML = startBtn ? startBtn.innerHTML : "";
    if (startBtn) startBtn.innerHTML = `<i class="bi bi-arrow-repeat spin"></i> Starting…`;

    const res = await apiFetch(API.START, "POST");

    if (!res) {
        setDisabled("btn-start", false);
        if (startBtn) startBtn.innerHTML = origHTML;
        return;
    }

    const data = await res.json();

    if (res.ok) {
        showToast("Mining Started", "Your mining session has begun. Rewards accumulate over 24 h.", "success");
        await loadMiningStatus(true);
    } else {
        showToast("Cannot Start Mining", data.error || "An error occurred.", "error");
        setDisabled("btn-start", false);
    }

    if (startBtn) startBtn.innerHTML = origHTML;
}

/* ── Claim Reward ───────────────────────────────────────── */
async function claimReward() {
    setDisabled("btn-claim", true);
    const claimBtn = document.getElementById("btn-claim");
    const origHTML = claimBtn ? claimBtn.innerHTML : "";
    if (claimBtn) claimBtn.innerHTML = `<i class="bi bi-arrow-repeat spin"></i> Claiming…`;

    const res = await apiFetch(API.CLAIM, "POST");

    if (!res) {
        setDisabled("btn-claim", false);
        if (claimBtn) claimBtn.innerHTML = origHTML;
        return;
    }

    const data = await res.json();

    if (res.ok) {
        const amount = formatDecimal(data.reward);
        showToast("Reward Claimed! 🎉", `${amount} SKA has been credited to your wallet.`, "success");
        stopLocalTimer();
        stopPollTimer();
        isMining = false;
        applyMiningStatus({ is_mining: false });
        await loadWallet();
        await loadMiningHistory();
    } else {
        showToast("Claim Failed", data.error || "An error occurred.", "error");
        setDisabled("btn-claim", !isMining);
    }

    if (claimBtn) claimBtn.innerHTML = origHTML;
}

/* ── Logout ─────────────────────────────────────────────── */
async function logout() {
    const res = await apiFetch(API.LOGOUT, "POST");
    clearToken();

    if (res && res.ok) {
        showToast("Logged Out", "You have been logged out successfully.", "success");
    }

    setTimeout(() => redirectToLogin(), 800);
}

/* ── Mining History ─────────────────────────────────────── */
async function loadMiningHistory() {
    // History is loaded from the mining status; for claimed sessions we
    // use the wallet data. A full history endpoint is a Phase 5 concern.
    // For now, we show the last-known session data in a placeholder row.
    const tbody = document.getElementById("history-tbody");
    if (!tbody) return;

    // Refresh is acknowledged; table remains as loaded from template.
    // (Full history API endpoint to be added in Phase 5.)
}

/* ── Refresh All ────────────────────────────────────────── */
async function refreshAll() {
    setDisabled("btn-refresh", true);
    const btn = document.getElementById("btn-refresh");
    const origHTML = btn ? btn.innerHTML : "";
    if (btn) btn.innerHTML = `<i class="bi bi-arrow-repeat spin"></i> Refreshing…`;

    await Promise.all([loadWallet(), loadMiningStatus(false)]);

    if (btn) btn.innerHTML = origHTML;
    setDisabled("btn-refresh", false);
    showToast("Refreshed", "Dashboard data has been updated.", "info");
}

/* ── Sidebar Toggle (Mobile) ────────────────────────────── */
function initSidebar() {
    const toggle  = document.getElementById("sidebar-toggle");
    const sidebar = document.getElementById("sidebar");
    const overlay = document.getElementById("sidebar-overlay");

    if (toggle && sidebar && overlay) {
        toggle.addEventListener("click", () => {
            sidebar.classList.toggle("open");
            overlay.classList.toggle("open");
        });

        overlay.addEventListener("click", () => {
            sidebar.classList.remove("open");
            overlay.classList.remove("open");
        });
    }
}

/* ── Init ───────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", async () => {
    // Guard: redirect to login if no token
    if (!getToken()) {
        redirectToLogin();
        return;
    }

    // Wire buttons
    document.getElementById("btn-start")?.addEventListener("click", startMining);
    document.getElementById("btn-claim")?.addEventListener("click", claimReward);
    document.getElementById("btn-refresh")?.addEventListener("click", refreshAll);
    document.getElementById("btn-logout")?.addEventListener("click", logout);
    document.getElementById("sidebar-logout")?.addEventListener("click", logout);

    // Sidebar mobile
    initSidebar();

    // Load all data in parallel
    await Promise.all([
        loadProfile(),
        loadWallet(),
        loadMiningStatus(false),
    ]);
});
