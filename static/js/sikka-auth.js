/**
 * sikka-auth.js  –  Shared SPA authentication & routing for SIKKA
 *
 * Loaded once in base.html before every page script.
 * Owns ALL token management, API auth, logout, and role-based routing.
 *
 * Page scripts (dashboard.js, org_dashboard.js, wallet.js, …)
 * call the exported helpers instead of reimplementing them.
 *
 * ── Token storage ──────────────────────────────────────────
 * "Remember Me" → localStorage   (persists across tabs/sessions)
 * Normal login  → sessionStorage (cleared when tab closes)
 * getToken / getRefresh check BOTH so the correct store is always found.
 * clearToken wipes both so logout is always clean.
 *
 * ── Role-based page guard ───────────────────────────────────
 * initSikkaPage(expectedRole)  must be called at the top of every page's
 * DOMContentLoaded handler.  It:
 *   1. Checks that a token exists; redirects to login if not.
 *   2. Fetches /api/v1/accounts/profile/ (once per page load).
 *   3. If the role doesn't match the current page, redirects:
 *        University on /dashboard/     → /dashboard/org/
 *        Student    on /dashboard/org/ → /dashboard/
 *   4. Populates the sidebar user block.
 *   5. Returns the profile data so the page can use it.
 *
 * expectedRole: "student" | "university" | "any"
 */

"use strict";

/* ═══════════════════════════════════════════════════════════════════════════
   CONSTANTS
═══════════════════════════════════════════════════════════════════════════ */
const SIKKA_LOGIN_URL   = "/accounts/login/";
const SIKKA_REFRESH_URL = "/api/v1/auth/token/refresh/";
const SIKKA_LOGOUT_URL  = "/api/v1/accounts/logout/";
const SIKKA_PROFILE_URL = "/api/v1/accounts/profile/";
const SIKKA_STUDENT_URL = "/dashboard/";
const SIKKA_UNI_URL     = "/dashboard/org/";

/* ═══════════════════════════════════════════════════════════════════════════
   TOKEN HELPERS
═══════════════════════════════════════════════════════════════════════════ */

/** Returns the stored access token, checking sessionStorage first then localStorage. */
function getToken() {
    return sessionStorage.getItem("sikka_access")
        || localStorage.getItem("sikka_access")
        || null;
}

/** Returns the stored refresh token, checking sessionStorage first then localStorage. */
function getRefresh() {
    return sessionStorage.getItem("sikka_refresh")
        || localStorage.getItem("sikka_refresh")
        || null;
}

/**
 * Store tokens after a successful login.
 * @param {string}  access
 * @param {string}  refresh
 * @param {boolean} remember – true → localStorage, false → sessionStorage
 */
function storeTokens(access, refresh, remember = false) {
    const store = remember ? localStorage : sessionStorage;
    store.setItem("sikka_access",  access);
    store.setItem("sikka_refresh", refresh);
}

/** Wipe all token storage (both locations). Called on logout. */
function clearToken() {
    ["sikka_access", "sikka_refresh"].forEach(k => {
        sessionStorage.removeItem(k);
        localStorage.removeItem(k);
    });
}

/** Whether a new access token was stored in localStorage (Remember Me session). */
function _isRememberMe() {
    return !!localStorage.getItem("sikka_refresh");
}

/* ═══════════════════════════════════════════════════════════════════════════
   NAVIGATION
═══════════════════════════════════════════════════════════════════════════ */
function redirectToLogin()   { window.location.replace(SIKKA_LOGIN_URL); }
function redirectToStudent() { window.location.replace(SIKKA_STUDENT_URL); }
function redirectToUni()     { window.location.replace(SIKKA_UNI_URL); }

/* ═══════════════════════════════════════════════════════════════════════════
   TOKEN REFRESH
═══════════════════════════════════════════════════════════════════════════ */
async function refreshAccessToken() {
    const refresh = getRefresh();
    if (!refresh) { redirectToLogin(); return null; }

    try {
        const res = await fetch(SIKKA_REFRESH_URL, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ refresh }),
        });
        if (!res.ok) { clearToken(); redirectToLogin(); return null; }

        const data  = await res.json();
        const store = _isRememberMe() ? localStorage : sessionStorage;
        store.setItem("sikka_access", data.access);
        return data.access;
    } catch {
        redirectToLogin();
        return null;
    }
}

/* ═══════════════════════════════════════════════════════════════════════════
   AUTHENTICATED FETCH
═══════════════════════════════════════════════════════════════════════════ */
/**
 * Authenticated wrapper around fetch().
 * – Injects Bearer token automatically.
 * – Retries once with a fresh token on 401.
 * – Redirects to login if no token or refresh fails.
 */
async function apiFetch(url, method = "GET", body = null) {
    const token = getToken();
    if (!token) { redirectToLogin(); return null; }

    const buildOpts = (tok) => {
        const opts = {
            method,
            headers: {
                "Authorization":   `Bearer ${tok}`,
                "X-Requested-With": "XMLHttpRequest",
            },
        };
        if (body !== null) {
            opts.headers["Content-Type"] = "application/json";
            opts.body = JSON.stringify(body);
        }
        return opts;
    };

    try {
        let res = await fetch(url, buildOpts(token));
        if (res.status === 401) {
            const newToken = await refreshAccessToken();
            if (!newToken) return null;
            res = await fetch(url, buildOpts(newToken));
        }
        return res;
    } catch {
        sikkaShowToast("Network Error", "Could not reach the server.", "error");
        return null;
    }
}

/* ═══════════════════════════════════════════════════════════════════════════
   LOGOUT
═══════════════════════════════════════════════════════════════════════════ */
async function logout() {
    try { await apiFetch(SIKKA_LOGOUT_URL, "POST"); } catch { /* ignore */ }
    clearToken();
    redirectToLogin();
}

/* ═══════════════════════════════════════════════════════════════════════════
   ROLE-BASED PAGE GUARD  (call this from every page's DOMContentLoaded)
═══════════════════════════════════════════════════════════════════════════ */
/**
 * Guards the current page by verifying the user's role.
 *
 * @param {"student"|"university"|"any"} expectedRole
 *   – "student"    : if user is a university, redirect to /dashboard/org/
 *   – "university" : if user is a student,    redirect to /dashboard/
 *   – "any"        : no role redirect (wallet, explorer, settings, etc.)
 *
 * @returns {Object|null}  The profile payload, or null if redirected.
 */
async function initSikkaPage(expectedRole = "any") {
    // 1. Must have a token
    if (!getToken()) {
        redirectToLogin();
        return null;
    }

    // 2. Fetch profile (single source of truth for role)
    const res = await apiFetch(SIKKA_PROFILE_URL);
    if (!res || !res.ok) {
        redirectToLogin();
        return null;
    }
    const profile = await res.json();

    // 3. Role guard
    const isUni = !!profile.has_org;
    if (expectedRole === "student"    && isUni)  { redirectToUni();     return null; }
    if (expectedRole === "university" && !isUni) { redirectToStudent(); return null; }

    // 4. Populate shared sidebar UI
    _populateSidebarUser(profile);

    // Fetch unread notifications for university users
    if (profile.role === "university") {
        const badge = document.getElementById("sidebarUnreadBadge");
        if (badge) {
            fetch("/api/v1/org/notifications/", {
                headers: { "Authorization": `Bearer ${getToken()}` }
            }).then(res => res.json()).then(data => {
                if (data.unread_count > 0) {
                    badge.textContent = data.unread_count;
                    badge.style.display = "inline-block";
                }
            }).catch(e => console.error("Error fetching notifications count", e));
        }
    }

    return profile;
}

/* ═══════════════════════════════════════════════════════════════════════════
   SIDEBAR HELPERS
═══════════════════════════════════════════════════════════════════════════ */
function _populateSidebarUser(profile) {
    const av = document.getElementById("sidebar-avatar");
    if (av) av.textContent = (profile.username || "U")[0].toUpperCase();

    const unEl = document.getElementById("sidebar-username");
    if (unEl) unEl.textContent = profile.username || "";

    const emEl = document.getElementById("sidebar-email");
    if (emEl) emEl.textContent = profile.email || "";

    const navUn = document.getElementById("nav-username");
    if (navUn) navUn.textContent = profile.username || "User";
}

function initSikkaSidebar() {
    const toggle  = document.getElementById("sidebar-toggle");
    const sidebar = document.getElementById("sidebar");
    const overlay = document.getElementById("sidebar-overlay");
    if (toggle && sidebar && overlay) {
        toggle.addEventListener("click",  () => {
            sidebar.classList.toggle("open");
            overlay.classList.toggle("open");
        });
        overlay.addEventListener("click", () => {
            sidebar.classList.remove("open");
            overlay.classList.remove("open");
        });
    }
    document.getElementById("sidebar-logout")
        ?.addEventListener("click", (e) => { e.preventDefault(); logout(); });
    document.getElementById("btn-logout")
        ?.addEventListener("click", (e) => { e.preventDefault(); logout(); });
}

/* ═══════════════════════════════════════════════════════════════════════════
   TOAST NOTIFICATIONS
═══════════════════════════════════════════════════════════════════════════ */
function sikkaShowToast(title, msg, type = "info") {
    const container = document.getElementById("toast-container");
    if (!container) return;
    const icons = {
        success: "bi-check-circle-fill",
        error:   "bi-x-circle-fill",
        info:    "bi-info-circle-fill",
    };
    const el = document.createElement("div");
    el.className = `sikka-toast toast-${type}`;
    el.innerHTML = `
        <i class="bi ${icons[type] || icons.info} toast-icon"></i>
        <div class="toast-body">
            <div class="toast-title">${sikkaEscHtml(title)}</div>
            <div class="toast-msg">${sikkaEscHtml(msg)}</div>
        </div>
        <button class="toast-close" aria-label="Close"><i class="bi bi-x"></i></button>
    `;
    el.querySelector(".toast-close").addEventListener("click", () => el.remove());
    container.appendChild(el);
    setTimeout(() => {
        el.style.opacity = "0";
        el.style.transition = "opacity .3s";
        setTimeout(() => el.remove(), 300);
    }, 4500);
}

function sikkaEscHtml(str) {
    const d = document.createElement("div");
    d.textContent = String(str);
    return d.innerHTML;
}

/* ── Legacy aliases so existing page scripts work without changes ─────── */
/* dashboard.js, wallet.js, mining.js, profile.js, explorer.js all define
   their own showToast / escHtml.  sikka-auth.js provides its own prefixed
   versions so there is no conflict.  Page scripts can still define theirs. */
