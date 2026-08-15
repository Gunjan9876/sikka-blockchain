"use strict";

/* ── API Endpoints ──────────────────────────────────────────────────────── */
const API = {
    PROFILE:      "/api/v1/accounts/profile/",
    WALLET:       "/api/v1/wallet/",
    LOGOUT:       "/api/v1/accounts/logout/",
    TOTP_SETUP:   "/api/v1/accounts/2fa/setup/",
    TOTP_VERIFY:  "/api/v1/accounts/2fa/verify/",
    TOTP_DISABLE: "/api/v1/accounts/2fa/disable/",
    MINING_HIST:  "/api/v1/mining/history/",
};
const LOGIN_URL = "/accounts/login/";

/* ── Token Helpers ──────────────────────────────────────────────────────── */
function getToken()   { return sessionStorage.getItem("sikka_access"); }
function getRefresh() { return sessionStorage.getItem("sikka_refresh"); }
function clearToken() {
    sessionStorage.removeItem("sikka_access");
    sessionStorage.removeItem("sikka_refresh");
}
function redirectToLogin() { window.location.href = LOGIN_URL; }

async function refreshAccessToken() {
    const refresh = getRefresh();
    if (!refresh) { redirectToLogin(); return null; }
    const res = await fetch("/api/v1/auth/token/refresh/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh }),
    });
    if (!res.ok) { clearToken(); redirectToLogin(); return null; }
    const data = await res.json();
    sessionStorage.setItem("sikka_access", data.access);
    return data.access;
}

/* ── API Fetch ──────────────────────────────────────────────────────────── */
async function apiFetch(url, method = "GET", body = null) {
    const token = getToken();
    if (!token) { redirectToLogin(); return null; }

    const opts = {
        method,
        headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type":  "application/json",
        },
    };
    if (body) opts.body = JSON.stringify(body);

    let res;
    try {
        res = await fetch(url, opts);
    } catch {
        showToast("Network Error", "Could not reach the server.", "error");
        return null;
    }

    if (res.status === 401) {
        const newToken = await refreshAccessToken();
        if (!newToken) return null;
        opts.headers["Authorization"] = `Bearer ${newToken}`;
        try {
            res = await fetch(url, opts);
        } catch {
            showToast("Network Error", "Could not reach the server.", "error");
            return null;
        }
    }

    return res;
}

/* ── Toast ──────────────────────────────────────────────────────────────── */
const toastContainer = document.getElementById("toast-container");
function escHtml(s) {
    return String(s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
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

/* ── Load Profile ───────────────────────────────────────────────────────── */
async function loadProfile() {
    const res = await apiFetch(API.PROFILE);
    if (!res || !res.ok) { showToast("Error", "Failed to load profile.", "error"); return; }
    const d = await res.json();

    const uname = d.username || "User";

    // Sidebar
    document.getElementById("sidebar-username").textContent = uname;
    document.getElementById("sidebar-email").textContent    = d.email || "";
    document.getElementById("nav-username").textContent     = uname;
    document.getElementById("sidebar-avatar").textContent   = uname[0].toUpperCase();

    // Profile card
    document.getElementById("profile-avatar").textContent   = uname[0].toUpperCase();
    document.getElementById("profile-username").textContent = uname;
    document.getElementById("profile-email").textContent    = d.email || "—";

    if (d.phone) {
        document.getElementById("profile-phone").textContent = "📞 " + d.phone;
    }

    // Wallet status
    const walletBadge = document.getElementById("wallet-status-badge");
    const wsMap = {
        active:       ["badge-active",    "Active"],
        suspended:    ["badge-suspended", "Suspended"],
        closed:       ["badge-suspended", "Closed"],
        not_created:  ["badge-idle",      "Not Created"],
    };
    const [wCls, wLabel] = wsMap[d.wallet_status] || ["badge-idle", d.wallet_status || "—"];
    walletBadge.className   = `card-badge ${wCls}`;
    walletBadge.textContent = wLabel;

    // 2FA badge + section toggle
    render2FAState(d.totp_enabled);
}

/* ── Load Stats Summary ─────────────────────────────────────────────────── */
async function loadStats() {
    ["prof-stat-mined", "prof-stat-sent", "prof-stat-received", "prof-stat-sessions", "profile-wallet-address"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = `<div class="skeleton skeleton-text" style="margin:0; width:100%;"></div>`;
    });

    const resWallet = await apiFetch(API.WALLET);
    if (resWallet && resWallet.ok) {
        const w = await resWallet.json();
        const addrEl = document.getElementById("profile-wallet-address");
        if (addrEl) addrEl.textContent = w.wallet_address || "—";
        
        document.getElementById("prof-stat-mined").textContent = parseFloat(w.total_mined || 0).toFixed(4) + " SKA";
        document.getElementById("prof-stat-sent").textContent = parseFloat(w.total_sent || 0).toFixed(4) + " SKA";
        document.getElementById("prof-stat-received").textContent = parseFloat(w.total_received || 0).toFixed(4) + " SKA";
    }

    const resMining = await apiFetch(API.MINING_HIST);
    if (resMining && resMining.ok) {
        const m = await resMining.json();
        document.getElementById("prof-stat-sessions").textContent = m.total || 0;
    }
}

/* ── 2FA State Render ───────────────────────────────────────────────────── */
function render2FAState(enabled) {
    const totpBadge   = document.getElementById("totp-status-badge");
    const setupSec    = document.getElementById("section-2fa-setup");
    const disableSec  = document.getElementById("section-2fa-disable");

    if (enabled) {
        totpBadge.className   = "card-badge badge-active";
        totpBadge.textContent = "Enabled";
        setupSec.style.display   = "none";
        disableSec.style.display = "block";
    } else {
        totpBadge.className   = "card-badge badge-idle";
        totpBadge.textContent = "Disabled";
        setupSec.style.display   = "block";
        disableSec.style.display = "none";
        // Reset QR section if going back to disabled
        document.getElementById("qr-section").style.display = "none";
        document.getElementById("totp-verify-otp").value    = "";
    }
}

/* ── Generate QR Code ───────────────────────────────────────────────────── */
document.getElementById("btn-get-qr").addEventListener("click", async () => {
    const btn = document.getElementById("btn-get-qr");
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span> Generating…`;

    const res = await apiFetch(API.TOTP_SETUP);

    btn.disabled = false;
    btn.innerHTML = `<i class="bi bi-qr-code-scan me-1"></i> Generate QR Code`;

    if (!res || !res.ok) {
        showToast("Error", "Could not generate QR code.", "error");
        return;
    }

    const data = await res.json();

    document.getElementById("qr-image").src            = data.qr_code   || "";
    document.getElementById("totp-manual-key").textContent = data.secret || "—";
    document.getElementById("qr-section").style.display    = "block";
    document.getElementById("totp-verify-otp").focus();
});

/* ── Verify & Activate 2FA ──────────────────────────────────────────────── */
document.getElementById("btn-verify-totp").addEventListener("click", async () => {
    const otp = document.getElementById("totp-verify-otp").value.trim();
    if (!otp || otp.length !== 6 || !/^\d+$/.test(otp)) {
        showToast("Invalid OTP", "Enter the 6-digit code from your authenticator app.", "error");
        return;
    }

    const btn = document.getElementById("btn-verify-totp");
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span> Activating…`;

    const res = await apiFetch(API.TOTP_VERIFY, "POST", { otp });

    btn.disabled = false;
    btn.innerHTML = `<i class="bi bi-check-circle me-1"></i> Activate 2FA`;

    if (!res) return;
    const data = await res.json();

    if (res.ok) {
        showToast("2FA Enabled!", "Your account is now protected with TOTP.", "success");
        render2FAState(true);
    } else {
        showToast("Activation Failed", data.error || "Invalid OTP. Try again.", "error");
        document.getElementById("totp-verify-otp").value = "";
        document.getElementById("totp-verify-otp").focus();
    }
});

/* ── Disable 2FA ────────────────────────────────────────────────────────── */
document.getElementById("btn-disable-totp").addEventListener("click", async () => {
    const otp = document.getElementById("totp-disable-otp").value.trim();
    if (!otp || otp.length !== 6 || !/^\d+$/.test(otp)) {
        showToast("Invalid OTP", "Enter the 6-digit code from your authenticator app.", "error");
        return;
    }

    const btn = document.getElementById("btn-disable-totp");
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span> Disabling…`;

    const res = await apiFetch(API.TOTP_DISABLE, "POST", { otp });

    btn.disabled = false;
    btn.innerHTML = `<i class="bi bi-shield-x me-1"></i> Disable 2FA`;

    if (!res) return;
    const data = await res.json();

    if (res.ok) {
        showToast("2FA Disabled", "Two-factor authentication has been turned off.", "info");
        document.getElementById("totp-disable-otp").value = "";
        render2FAState(false);
    } else {
        showToast("Failed", data.error || "Invalid OTP.", "error");
        document.getElementById("totp-disable-otp").value = "";
        document.getElementById("totp-disable-otp").focus();
    }
});

/* ── Logout ─────────────────────────────────────────────────────────────── */
async function doLogout() {
    await apiFetch(API.LOGOUT, "POST", { refresh: getRefresh() });
    clearToken();
    redirectToLogin();
}
document.getElementById("btn-logout").addEventListener("click", doLogout);
document.getElementById("sidebar-logout").addEventListener("click", (e) => { e.preventDefault(); doLogout(); });
document.getElementById("btn-logout-all").addEventListener("click", doLogout);

/* ── Sidebar Toggle ─────────────────────────────────────────────────────── */
const sidebar        = document.getElementById("sidebar");
const sidebarOverlay = document.getElementById("sidebar-overlay");
document.getElementById("sidebar-toggle").addEventListener("click", () => {
    sidebar.classList.toggle("open");
    sidebarOverlay.classList.toggle("open");
});
sidebarOverlay.addEventListener("click", () => {
    sidebar.classList.remove("open");
    sidebarOverlay.classList.remove("open");
});

/* ── Boot ───────────────────────────────────────────────────────────────── */
if (!getToken()) {
    redirectToLogin();
} else {
    loadProfile();
    loadStats();
}