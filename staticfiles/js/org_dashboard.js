/**
 * org_dashboard.js – University Dashboard controller
 *
 * Auth, token management, logout, and role detection are all handled by
 * sikka-auth.js (loaded before this script in base.html).
 * This file contains only University Dashboard-specific UI logic.
 */
"use strict";

const ORG_API = {
    ORG_INFO: "/api/v1/rewards/org/",
};

/* ── Org Info & Metrics ─────────────────────────────────────────────────── */
async function loadOrgData() {
    const res = await apiFetch(ORG_API.ORG_INFO);
    if (!res || !res.ok) {
        sikkaShowToast("Error", "Failed to load university data.", "error");
        return;
    }
    const d = await res.json();

    // Welcome card
    const nameEl = document.getElementById("org-name");
    if (nameEl) nameEl.textContent = d.name || "University";

    if (d.logo_url) {
        const logoWrap = document.getElementById("org-logo-container");
        if (logoWrap) {
            logoWrap.innerHTML = `<img src="${d.logo_url}" alt="Logo" class="org-logo shadow-sm">`;
        }
    }

    const badgesEl = document.getElementById("org-badges");
    if (badgesEl) {
        let html = "";
        if (d.verification_status === "verified") {
            html += `<span class="badge badge-verified rounded-pill"><i class="bi bi-patch-check-fill me-1"></i> Verified Partner</span>`;
        } else if (d.verification_status === "pending") {
            html += `<span class="badge badge-pending rounded-pill"><i class="bi bi-hourglass-split me-1"></i> Verification Pending</span>`;
        } else {
            html += `<span class="badge bg-danger rounded-pill"><i class="bi bi-x-circle-fill me-1"></i> Rejected</span>`;
        }
        if (d.address) {
            html += ` <span class="text-muted small"><i class="bi bi-geo-alt-fill me-1"></i>${sikkaEscHtml(d.address)}</span>`;
        }
        if (d.website) {
            html += ` <a href="${sikkaEscHtml(d.website)}" target="_blank" rel="noopener" class="small" style="color:var(--primary-color);text-decoration:none;"><i class="bi bi-link-45deg me-1"></i>Website</a>`;
        }
        badgesEl.innerHTML = html;
    }

    // Stats cards
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set("stat-students",    d.total_students   ?? "--");
    set("stat-rewards",     d.rewards_issued   ?? "--");
    set("stat-pending",     d.pending_requests ?? "--");

    const distributed = parseFloat(d.total_ska_distributed || 0);
    set("stat-distributed", isNaN(distributed) ? "--" : distributed.toFixed(2));

    // Quota section
    const total     = parseFloat(d.reward_quota    || 0);
    const used      = parseFloat(d.quota_used      || 0);
    const remaining = parseFloat(d.quota_remaining || 0);

    set("quota-total",        isNaN(total)     ? "--" : total.toFixed(2));
    set("quota-used-display", isNaN(used)      ? "--" : Math.round(used).toString());
    set("quota-remaining",    isNaN(remaining) ? "--" : remaining.toFixed(2));

    const usedPct = total > 0 ? (used / total) * 100 : 0;

    // Donut chart (CSS conic-gradient)
    const chart = document.getElementById("quota-chart-container");
    if (chart) {
        chart.style.background = `conic-gradient(var(--primary-color) 0% ${usedPct.toFixed(2)}%, rgba(212,175,55,0.1) ${usedPct.toFixed(2)}% 100%)`;
    }

    // Progress bar
    const bar = document.getElementById("quota-progress-bar");
    if (bar) {
        const remainPct = Math.max(0, 100 - usedPct);
        bar.style.width = `${remainPct.toFixed(2)}%`;
        bar.classList.toggle("bg-danger",  remainPct < 20);
        bar.classList.toggle("bg-success", remainPct >= 20);
    }
}

/* ── Init ───────────────────────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", async () => {
    initSikkaSidebar();

    // initSikkaPage("university") does three things:
    //   1. Checks a token exists (else → login)
    //   2. Calls /api/v1/accounts/profile/ and checks has_org
    //   3. If not a university, redirects to /dashboard/ (student page)
    //   4. Populates sidebar user name/email/avatar
    //   Returns null if redirected, profile object if OK.
    const profile = await initSikkaPage("university");
    if (!profile) return; // redirected

    // Load university-specific data
    await loadOrgData();
});
