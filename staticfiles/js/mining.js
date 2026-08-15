"use strict";

const API = {
    PROFILE:    "/api/v1/accounts/profile/",
    LOGOUT:     "/api/v1/accounts/logout/",
    STATUS:     "/api/v1/mining/status/",
    START:      "/api/v1/mining/start/",
    CLAIM:      "/api/v1/mining/claim/",
    HISTORY:    "/api/v1/mining/history/?page_size=500", // Pull up to 500 for charts
    RIG:        "/api/v1/mining/rig/",
    RIG_UPGRADE:"/api/v1/mining/rig/upgrade/",
    POOLS:      "/api/v1/mining/pools/",
    POOL_JOIN:  "/api/v1/mining/pools/join/",
    POOL_LEAVE: "/api/v1/mining/pools/leave/",
    BLOCKS:     "/api/v1/blockchain/",
};

const LOGIN_URL    = "/accounts/login/";
const MAX_MINE_SEC = 24 * 3600;
let ACTIVE_DIFFICULTY = 2;
let ACTIVE_RIG_MULTIPLIER = 1;
let ACTIVE_RIG_SKIP = 1;

/* ── Globals ────────────────────────────────────────────── */
let allMiningSessions = [];
let filteredSessions = [];
let historyPage = 1;
const HISTORY_PAGE_SIZE = 10;
let chartsInstance = { rewards: null, activity: null };

/* ── Token ──────────────────────────────────────────────── */
function getToken()   { return sessionStorage.getItem("sikka_access"); }
function getRefresh() { return sessionStorage.getItem("sikka_refresh"); }
function clearToken() { sessionStorage.removeItem("sikka_access"); sessionStorage.removeItem("sikka_refresh"); }
function redirectToLogin() { window.location.href = LOGIN_URL; }

async function refreshAccessToken() {
    const refresh = getRefresh();
    if (!refresh) { redirectToLogin(); return null; }
    try {
        const res = await fetch("/api/v1/auth/token/refresh/", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refresh }),
        });
        if (!res.ok) { clearToken(); redirectToLogin(); return null; }
        const data = await res.json();
        sessionStorage.setItem("sikka_access", data.access);
        return data.access;
    } catch(e) {
        return null;
    }
}

/* ── API Helper ─────────────────────────────────────────── */
async function apiFetch(url, method = "GET", body = null) {
    const token = getToken();
    if (!token) { redirectToLogin(); return null; }
    const opts = { method, headers: { "Authorization": `Bearer ${token}`, "X-Requested-With": "XMLHttpRequest" } };
    if (body) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
    try {
        const res = await fetch(url, opts);
        if (res.status === 401) {
            const newToken = await refreshAccessToken();
            if (!newToken) return null;
            opts.headers["Authorization"] = `Bearer ${newToken}`;
            return await fetch(url, opts);
        }
        return res;
    } catch (e) {
        console.error("apiFetch Error:", e);
        showToast("Network Error", "Could not reach the server.", "error");
        return null;
    }
}

/* ── Toast & Helpers ────────────────────────────────────── */
function showToast(title, msg, type = "info") {
    const icons = { success: "bi-check-circle-fill", error: "bi-x-circle-fill", info: "bi-info-circle-fill" };
    const el = document.createElement("div");
    el.className = `sikka-toast toast-${type}`;
    el.innerHTML = `<i class="bi ${icons[type] || icons.info} toast-icon"></i>
        <div class="toast-body"><div class="toast-title">${escHtml(title)}</div><div class="toast-msg">${escHtml(msg)}</div></div>
        <button class="toast-close"><i class="bi bi-x"></i></button>`;
    el.querySelector(".toast-close")?.addEventListener("click", () => el.remove());
    document.getElementById("toast-container")?.appendChild(el);
    setTimeout(() => { if (el) { el.style.opacity = "0"; setTimeout(() => el.remove(), 300); } }, 4500);
}

function escHtml(str) { 
    if (!str) return "";
    const d = document.createElement("div"); 
    d.textContent = String(str); 
    return d.innerHTML; 
}
function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
function setDisabled(id, state) { const el = document.getElementById(id); if (el) el.disabled = state; }
function formatDecimal(val) { 
    if (val === null || val === undefined) return "0.00000000";
    const n = parseFloat(val); 
    return isNaN(n) ? "0.00000000" : n.toFixed(8); 
}
function secondsToHMS(s) {
    if (isNaN(s) || s < 0) return "—";
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
}
function formatDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleString("en-IN", { day:"numeric", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" });
}

/* ── Mining Console UI ──────────────────────────────────── */
let isMining       = false;
let elapsedSeconds = 0;
let timerInterval  = null;
let pollTimer      = null;

function calculateEstimatedTime() {
    const baseTime = 120;
    const est = (baseTime * Math.pow(2, ACTIVE_DIFFICULTY - 2)) / ACTIVE_RIG_SKIP;
    return Math.max(est, 10);
}

function applyMiningStatus(data) {
    isMining = !!data.is_mining;

    const badge = document.getElementById("mining-status-badge");
    const statStatus = document.getElementById("stat-mining-status");
    if (badge) {
        badge.textContent = isMining ? "Mining Active" : "Idle";
        badge.className   = "card-badge " + (isMining ? "badge-running" : "badge-idle");
    }
    if (statStatus) {
        statStatus.textContent = isMining ? "Mining" : "Idle";
        statStatus.style.color = isMining ? "var(--gold)" : "var(--text-muted)";
    }

    setDisabled("btn-start", isMining);
    setDisabled("btn-claim", !isMining);

    const liveBox = document.getElementById("pow-live-box");

    if (isMining) {
        elapsedSeconds = data.elapsed_seconds || 0;
        if (liveBox) liveBox.style.display = "block";
        startLocalTimer();
        startPollTimer();
    } else {
        stopLocalTimer(); stopPollTimer();
        if (liveBox) liveBox.style.display = "none";
    }

    if (data.rig)  renderRigInfo(data.rig);
    renderPoolStatus(data.pool || null);
}

function updateProgressUI() {
    const estTarget = calculateEstimatedTime();
    let p = (elapsedSeconds / estTarget) * 100;
    if (p > 100) p = 100;
    
    setText("pow-time-elapsed", new Date(Math.min(elapsedSeconds, 86400) * 1000).toISOString().slice(11, 19));
    
    const remaining = Math.max(0, estTarget - elapsedSeconds);
    setText("pow-time-remaining", new Date(remaining * 1000).toISOString().slice(11, 19));
    
    setText("pow-progress-text", p.toFixed(1) + "%");
    
    const bar = document.getElementById("pow-progress-bar");
    const log = document.getElementById("pow-console-log");
    if (bar) {
        bar.style.width = p + "%";
        if (p >= 100) {
            bar.classList.add("solving");
            if (log) log.innerHTML = "<span style='color:#4ade80;'>Target hash discovered! Ready to solve & claim.</span>";
        } else {
            bar.classList.remove("solving");
            if (log) log.innerHTML = `Calculating hashes... Nonce attempt: ${(elapsedSeconds * 250000).toLocaleString()}`;
        }
    }
}

function startLocalTimer() {
    if (timerInterval) return;
    updateProgressUI();
    timerInterval = setInterval(() => {
        elapsedSeconds++;
        updateProgressUI();
    }, 1000);
}
function stopLocalTimer() { if (timerInterval) { clearInterval(timerInterval); timerInterval = null; } }

function startPollTimer() {
    if (pollTimer) return;
    pollTimer = setInterval(() => loadMiningStatus(true), 15000);
}
function stopPollTimer() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

/* ── API Calls ───────────────────────────────────────────── */
async function loadMiningStatus(silent = false) {
    try {
        const res = await apiFetch(API.STATUS);
        if (!res || !res.ok) {
            if (!silent) showToast("Mining Error", "Could not fetch mining status.", "error");
            return;
        }
        const data = await res.json();
        applyMiningStatus(data);
    } catch(e) {
        console.warn("Could not fetch mining status", e);
    }

    try {
        const statsRes = await apiFetch('/api/v1/blockchain/stats/');
        if (statsRes && statsRes.ok) {
            const stats = await statsRes.json();
            ACTIVE_DIFFICULTY = stats.difficulty || 2;
            setText("stat-network-diff", ACTIVE_DIFFICULTY);
            setText("pow-console-diff", ACTIVE_DIFFICULTY);
            
            const bRes = await apiFetch('/api/v1/blockchain/?page=1&page_size=1');
            if (bRes && bRes.ok) {
                const b = await bRes.json();
                if (b.blocks && b.blocks.length > 0) {
                    const rew = formatDecimal(b.blocks[0].reward) + " SKA";
                    setText("stat-current-reward", rew);
                    setText("pow-console-reward", rew);
                } else {
                    setText("stat-current-reward", "Not Available");
                    setText("pow-console-reward", "Not Available");
                }
            }
        }
    } catch (e) {
        console.warn("Could not fetch network stats", e);
    }
}

async function startMining() {
    const btn  = document.getElementById("btn-start");
    const orig = btn?.innerHTML;
    if (btn) { btn.disabled = true; btn.innerHTML = `<i class="bi bi-arrow-repeat spin"></i> Starting…`; }

    try {
        const res = await apiFetch(API.START, "POST");
        if (res) {
            const data = await res.json();
            if (res.ok) {
                showToast("Proof-of-Work Started! ⛏️", "Mining engine running.", "success");
                if (btn) { btn.innerHTML = orig; } 
                await loadMiningStatus(true);
                return;
            } else {
                showToast("Cannot Start", data.error || "An error occurred.", "error");
            }
        }
    } catch (e) {
        showToast("Error", "Could not start mining.", "error");
    }
    if (btn) { btn.disabled = false; btn.innerHTML = orig; }
}

async function claimReward() {
    setDisabled("btn-claim", true);
    const log = document.getElementById("pow-console-log");
    if (log) log.innerHTML = "<span style='color:var(--gold);'>Broadcasting solution to network...</span>";

    try {
        const res = await apiFetch(API.CLAIM, "POST");
        if (res) {
            const data = await res.json();
            if (res.ok) {
                showToast("Block Solved! 🎉", `${formatDecimal(data.reward)} SKA credited to your wallet.`, "success");
                if (log) log.innerHTML = `<span style='color:#4ade80;'>Success! Block accepted.</span>`;
                setTimeout(async () => {
                    stopLocalTimer(); stopPollTimer(); isMining = false;
                    applyMiningStatus({ is_mining: false });
                    await loadMiningHistory();
                }, 2000);
            } else {
                if (log) log.innerHTML = `<span style='color:var(--danger);'>Submission failed: ${data.error || "Unknown"}</span>`;
                showToast("Claim Failed", data.error || "An error occurred.", "error");
                setDisabled("btn-claim", false);
            }
        } else {
            setDisabled("btn-claim", !isMining);
        }
    } catch (e) {
        showToast("Error", "An unexpected error occurred during claim.", "error");
        setDisabled("btn-claim", false);
    }
}

/* ── Rig ─────────────────────────────────────────────────── */
function renderRigInfo(rig) {
    if (!rig) return;
    ACTIVE_RIG_MULTIPLIER = parseFloat(rig.multiplier) || 1;
    ACTIVE_RIG_SKIP = parseFloat(rig.skip_factor) || 1;

    setText("rig-tier-label", rig.tier_label || rig.tier || "—");
    setText("rig-tier-badge", rig.tier_label || rig.tier || "—");
    setText("rig-hash-rate",  (rig.hash_rate || "—") + " H/s");
    setText("rig-multiplier", "×" + ACTIVE_RIG_MULTIPLIER);
    setText("rig-skip",       "×" + ACTIVE_RIG_SKIP);
    setText("rig-upgrade-cost", rig.upgrade_cost || "—");

    const upgradeWrap = document.getElementById("rig-upgrade-wrap");
    const maxLabel    = document.getElementById("rig-max-label");
    if (rig.is_max_tier) {
        if (upgradeWrap) upgradeWrap.style.display = "none";
        if (maxLabel)    maxLabel.style.display    = "block";
    } else {
        if (upgradeWrap) upgradeWrap.style.display = "block";
        if (maxLabel)    maxLabel.style.display    = "none";
    }
}

async function loadRigInfo() {
    try {
        const res = await apiFetch(API.RIG);
        if (!res || !res.ok) return;
        renderRigInfo(await res.json());
    } catch(e) {}
}

async function upgradeRig() {
    const btn  = document.getElementById("btn-upgrade-rig");
    const orig = btn?.innerHTML;
    if (btn) { btn.disabled = true; btn.innerHTML = `<i class="bi bi-arrow-repeat spin"></i> Upgrading…`; }
    try {
        const res = await apiFetch(API.RIG_UPGRADE, "POST");
        if (res) {
            const data = await res.json();
            if (res.ok) {
                showToast("Rig Upgraded! 🚀", data.message || "Your rig has been upgraded.", "success");
                await loadRigInfo();
            } else {
                showToast("Upgrade Failed", data.error || "An error occurred.", "error");
            }
        }
    } catch (e) {
        showToast("Error", "An unexpected error occurred.", "error");
    }
    if (btn) { btn.disabled = false; btn.innerHTML = orig; }
}

/* ── Pool ────────────────────────────────────────────────── */
function renderPoolStatus(pool) {
    const inView   = document.getElementById("pool-in-view");
    const joinView = document.getElementById("pool-join-view");
    const badge    = document.getElementById("pool-status-badge");

    if (pool) {
        if (badge) { badge.textContent = "Active Member"; badge.style.color = "var(--success)"; }
        setText("pool-name",    pool.pool_name || pool.name || "—");
        setText("pool-fee",     (pool.pool_fee_pct || "—") + "%");
        if (inView)   inView.style.display   = "block";
        if (joinView) joinView.style.display  = "none";
    } else {
        if (badge) { badge.textContent = "No Pool"; badge.style.color = "var(--text-muted)"; }
        if (inView)   inView.style.display   = "none";
        if (joinView) joinView.style.display  = "block";
    }
}

async function loadPoolStatus() {
    try {
        const poolRes = await apiFetch(API.POOLS);
        if (poolRes && poolRes.ok) {
            const poolData = await poolRes.json();
            const sel = document.getElementById("pool-select");
            if (sel) {
                sel.innerHTML = `<option value="">Select a pool…</option>` + (poolData.pools || []).map(p =>
                    `<option value="${p.id}">${escHtml(p.name)} — Fee: ${p.pool_fee_pct}% | ${p.member_count} members</option>`
                ).join("");
            }
        }
    } catch(e) {}
}

async function joinPool() {
    const poolId = document.getElementById("pool-select")?.value;
    if (!poolId) { showToast("Select a Pool", "Please choose a pool to join.", "error"); return; }
    const btn  = document.getElementById("btn-join-pool");
    const orig = btn?.innerHTML;
    if (btn) { btn.disabled = true; btn.innerHTML = `<i class="bi bi-arrow-repeat spin"></i> Joining…`; }
    try {
        const res = await apiFetch(API.POOL_JOIN, "POST", { pool_id: parseInt(poolId) });
        if (res && res.ok) {
            showToast("Pool Joined! 🤝", "You have joined the pool.", "success");
            await loadMiningStatus(true);
        } else {
            const data = await res.json();
            showToast("Join Failed", data.error || "An error occurred.", "error");
        }
    } catch (e) {
        showToast("Error", "An unexpected error occurred.", "error");
    }
    if (btn) { btn.disabled = false; btn.innerHTML = orig; }
}

async function leavePool() {
    const btn  = document.getElementById("btn-leave-pool");
    const orig = btn?.innerHTML;
    if (btn) { btn.disabled = true; btn.innerHTML = `<i class="bi bi-arrow-repeat spin"></i> Leaving…`; }
    try {
        const res = await apiFetch(API.POOL_LEAVE, "POST");
        if (res && res.ok) {
            showToast("Left Pool", "You have left the pool.", "info");
            await loadMiningStatus(true);
        } else {
            const data = await res.json();
            showToast("Error", data.error || "An error occurred.", "error");
        }
    } catch (e) {
        showToast("Error", "An unexpected error occurred.", "error");
    }
    if (btn) { btn.disabled = false; btn.innerHTML = orig; }
}

/* ── Mining History & Analytics ──────────────────────────── */
async function loadMiningHistory() {
    const tbody = document.getElementById("history-tbody");
    try {
        const res = await apiFetch(API.HISTORY);
        if (!res || !res.ok) {
            if (tbody) tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><i class="bi bi-cpu"></i> No mining history found.</div></td></tr>`;
            renderOverviewAnalytics(); // Fallback to 0
            renderCharts(); // Clear charts
            return;
        }
        const data = await res.json();
        
        allMiningSessions = Array.isArray(data.sessions) ? data.sessions : [];
        
        // Sort descending by start time by default
        allMiningSessions.sort((a,b) => {
            const da = new Date(a.started_at).getTime() || 0;
            const db = new Date(b.started_at).getTime() || 0;
            return db - da;
        });
        
        applyFilters();
        renderOverviewAnalytics();
        renderCharts();
    } catch(e) {
        console.error("History load error:", e);
        if (tbody) tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><i class="bi bi-exclamation-triangle"></i> Error loading history.</div></td></tr>`;
        renderOverviewAnalytics(); // Fallback to 0
        renderCharts(); // Clear charts
    }
}

function applyFilters() {
    try {
        const termEl = document.getElementById("history-search");
        const statusEl = document.getElementById("history-filter-status");
        const term = (termEl && termEl.value ? termEl.value : "").toLowerCase();
        const status = statusEl && statusEl.value ? statusEl.value : "ALL";
        
        filteredSessions = allMiningSessions.filter(s => {
            if (status !== "ALL" && s.status !== status) return false;
            if (term) {
                const txt = `${s.rig_tier || ""} ${s.pool || ""} ${s.status || ""}`.toLowerCase();
                if (!txt.includes(term)) return false;
            }
            return true;
        });
        
        historyPage = 1;
        renderHistoryTable();
    } catch (e) {
        console.error("Filter error:", e);
    }
}

window.openSessionModal = function(sjEnc) {
    try {
        const s = JSON.parse(decodeURIComponent(sjEnc));
        
        setText("mdl-session-status", s.status || "—");
        setText("mdl-session-reward", formatDecimal(s.reward) + " SKA");
        setText("mdl-session-start", formatDate(s.started_at));
        setText("mdl-session-claim", s.claimed_at ? formatDate(s.claimed_at) : "—");
        setText("mdl-session-rig", s.rig_tier || "—");
        setText("mdl-session-pool", s.pool || "Solo");
        setText("mdl-session-hash", s.block_hash || "Not Available");
        
        const copyBtn = document.getElementById("copy-session-hash");
        if (s.block_hash && copyBtn) {
            copyBtn.style.display = "inline-block";
            const newBtn = copyBtn.cloneNode(true);
            copyBtn.parentNode.replaceChild(newBtn, copyBtn);
            newBtn.addEventListener("click", () => {
                navigator.clipboard.writeText(s.block_hash).then(() => showToast("Copied!", "Block hash copied to clipboard.", "success"));
            });
        } else if (copyBtn) {
            copyBtn.style.display = "none";
        }
        
        if (s.claimed_at && s.started_at) {
            const dStart = new Date(s.started_at).getTime();
            const dClaim = new Date(s.claimed_at).getTime();
            if (!isNaN(dStart) && !isNaN(dClaim)) {
                setText("mdl-session-duration", secondsToHMS(Math.floor((dClaim - dStart)/1000)));
            } else {
                setText("mdl-session-duration", "—");
            }
        } else {
            setText("mdl-session-duration", "—");
        }
        
        const overlay = document.getElementById("session-detail-modal");
        if (overlay) overlay.classList.add("visible");
    } catch(e) {
        console.error("Failed to parse session", e);
    }
};

function renderHistoryTable() {
    try {
        const tbody = document.getElementById("history-tbody");
        const wrap = document.getElementById("history-pagination-wrap");
        if (!tbody) return;
        
        if (filteredSessions.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><i class="bi bi-cpu"></i> No mining sessions match your filters.</div></td></tr>`;
            if (wrap) wrap.style.display = "none";
            return;
        }
        
        const totalPages = Math.max(1, Math.ceil(filteredSessions.length / HISTORY_PAGE_SIZE));
        const startIdx = (historyPage - 1) * HISTORY_PAGE_SIZE;
        const paginated = filteredSessions.slice(startIdx, startIdx + HISTORY_PAGE_SIZE);
        
        tbody.innerHTML = paginated.map(s => {
            const statusColor = s.status === "CLAIMED" ? "var(--success)" : s.status === "RUNNING" ? "var(--gold)" : "var(--danger)";
            
            let dur = "—";
            if (s.claimed_at && s.started_at) {
                const ds = new Date(s.started_at).getTime();
                const dc = new Date(s.claimed_at).getTime();
                if (!isNaN(ds) && !isNaN(dc)) {
                    dur = secondsToHMS(Math.floor((dc - ds)/1000));
                }
            }

            const sj = encodeURIComponent(JSON.stringify(s));

            return `<tr class="explorer-row" onclick="openSessionModal('${sj}')">
                <td><span style="color:${statusColor}; font-weight:600;">${escHtml(s.status || "—")}</span></td>
                <td style="color:var(--gold);">${formatDecimal(s.reward)} SKA</td>
                <td>${escHtml(s.rig_tier || "—")}</td>
                <td>${escHtml(s.pool || "Solo")}</td>
                <td style="font-size:.75rem;">${formatDate(s.started_at)}</td>
                <td style="font-size:.75rem; color:var(--text-muted);">${s.claimed_at ? formatDate(s.claimed_at) + `<br/>(${dur})` : "—"}</td>
            </tr>`;
        }).join("");
        
        if (wrap) wrap.style.display = totalPages > 1 ? "flex" : "none";
        
        const info = document.getElementById("history-page-info");
        if (info) info.textContent = `Page ${historyPage} of ${totalPages}`;
        
        const btnPrev = document.getElementById("btn-history-prev");
        const btnNext = document.getElementById("btn-history-next");
        if (btnPrev) btnPrev.disabled = historyPage <= 1;
        if (btnNext) btnNext.disabled = historyPage >= totalPages;
    } catch(e) {
        console.error("Render table error:", e);
    }
}

function renderOverviewAnalytics() {
    try {
        let totalCoins = 0;
        let totalBlocks = 0;
        let successful = 0;
        let totalSolveTimeSec = 0;
        
        allMiningSessions.forEach(s => {
            if (s.status === "CLAIMED") {
                const rw = parseFloat(s.reward);
                if (!isNaN(rw)) totalCoins += rw;
                
                totalBlocks++;
                successful++;
                
                if (s.claimed_at && s.started_at) {
                    const dt = (new Date(s.claimed_at).getTime() - new Date(s.started_at).getTime()) / 1000;
                    if (!isNaN(dt)) totalSolveTimeSec += dt;
                }
            }
        });

        const successRate = allMiningSessions.length > 0 ? (successful / allMiningSessions.length) * 100 : 0;
        
        setText("stat-total-coins", formatDecimal(totalCoins) + " SKA");
        setText("stat-total-blocks", totalBlocks);
        setText("stat-success-rate", successRate.toFixed(1) + "%");
        
        if (successful > 0 && totalSolveTimeSec > 0) {
            const avg = Math.floor(totalSolveTimeSec / successful);
            setText("stat-avg-solve", secondsToHMS(avg));
        } else {
            setText("stat-avg-solve", "Not Available");
        }
    } catch (e) {
        console.error("Analytics error:", e);
    }
}

/* ── Charts Engine ───────────────────────────────────────── */
function renderCharts() {
    try {
        const empR = document.getElementById("chart-rewards-empty");
        const empA = document.getElementById("chart-activity-empty");

        // Destroy existing
        if (chartsInstance.rewards) { chartsInstance.rewards.destroy(); chartsInstance.rewards = null; }
        if (chartsInstance.activity) { chartsInstance.activity.destroy(); chartsInstance.activity = null; }

        if (!window.Chart) {
            console.warn("Chart.js not loaded.");
            if (empR) empR.style.display = "flex";
            if (empA) empA.style.display = "flex";
            return;
        }

        // Apply defaults safely if Chart is a valid object
        if (Chart.defaults && Chart.defaults.font) {
            Chart.defaults.color = "#a0a5b1";
            Chart.defaults.font.family = "Inter, sans-serif";
        }

        const dailyData = {};
        const actData = {};
        
        // Sort ascending for chart flow
        const chronological = [...allMiningSessions].reverse();
        
        chronological.forEach(s => {
            if (!s.started_at) return;
            const dt = new Date(s.started_at);
            if (isNaN(dt.getTime())) return;
            
            const dateKey = dt.toISOString().split('T')[0];
            
            if (!actData[dateKey]) actData[dateKey] = 0;
            actData[dateKey]++; 
            
            if (s.status === "CLAIMED") {
                if (!dailyData[dateKey]) dailyData[dateKey] = 0;
                const r = parseFloat(s.reward);
                if (!isNaN(r)) dailyData[dateKey] += r;
            }
        });
        
        const labels = Object.keys(actData);
        if (labels.length === 0) {
            if (empR) empR.style.display = "flex";
            if (empA) empA.style.display = "flex";
            return;
        }
        
        if (empR) empR.style.display = "none";
        if (empA) empA.style.display = "none";

        const rewardVals = labels.map(l => dailyData[l] || 0);
        const actVals = labels.map(l => actData[l]);
        
        const ctxReward = document.getElementById("chart-rewards");
        if (ctxReward) {
            chartsInstance.rewards = new Chart(ctxReward, {
                type: "bar",
                data: {
                    labels: labels.map(l => l.slice(5)), // MM-DD
                    datasets: [{
                        label: "Rewards (SKA)",
                        data: rewardVals,
                        backgroundColor: "rgba(212, 175, 55, 0.7)",
                        borderColor: "#d4af37",
                        borderWidth: 1,
                        borderRadius: 4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        y: { grid: { color: "rgba(255,255,255,0.05)" }, beginAtZero: true },
                        x: { grid: { display: false } }
                    }
                }
            });
        }
        
        const ctxAct = document.getElementById("chart-activity");
        if (ctxAct) {
            chartsInstance.activity = new Chart(ctxAct, {
                type: "line",
                data: {
                    labels: labels.map(l => l.slice(5)),
                    datasets: [{
                        label: "Mining Sessions",
                        data: actVals,
                        borderColor: "#4ade80",
                        backgroundColor: "rgba(74, 222, 128, 0.1)",
                        borderWidth: 2,
                        fill: true,
                        tension: 0.3
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        y: { grid: { color: "rgba(255,255,255,0.05)" }, beginAtZero: true, ticks: { stepSize: 1 } },
                        x: { grid: { display: false } }
                    }
                }
            });
        }
    } catch (e) {
        console.error("Chart render error:", e);
    }
}

/* ── Sidebar Toggle ──────────────────────────────────────── */
function initSidebar() {
    const toggle  = document.getElementById("sidebar-toggle");
    const sidebar = document.getElementById("sidebar");
    const overlay = document.getElementById("sidebar-overlay");
    if (toggle && sidebar && overlay) {
        toggle.addEventListener("click",  () => { sidebar.classList.toggle("open"); overlay.classList.toggle("open"); });
        overlay.addEventListener("click", () => { sidebar.classList.remove("open"); overlay.classList.remove("open"); });
    }
}

/* ── UI Bindings ─────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", async () => {
    if (!getToken()) { redirectToLogin(); return; }

    initSidebar();

    // Navigation and Modals
    document.querySelectorAll(".sikka-modal-close, .sikka-modal-overlay").forEach(el => {
        el.addEventListener("click", (e) => {
            if (e.target === el || el.classList.contains('sikka-modal-close')) {
                const overlay = el.classList.contains('sikka-modal-overlay') ? el : el.closest(".sikka-modal-overlay");
                if (overlay) overlay.classList.remove("visible");
            }
        });
    });

    // Mining Controls
    document.getElementById("btn-start")?.addEventListener("click", startMining);
    document.getElementById("btn-claim")?.addEventListener("click", claimReward);
    document.getElementById("btn-refresh-status")?.addEventListener("click", () => loadMiningStatus(false));
    
    // Rig/Pool Controls
    document.getElementById("btn-upgrade-rig")?.addEventListener("click", upgradeRig);
    document.getElementById("btn-join-pool")?.addEventListener("click", joinPool);
    document.getElementById("btn-leave-pool")?.addEventListener("click", leavePool);
    
    // History Table Controls
    document.getElementById("history-search")?.addEventListener("input", () => { historyPage = 1; applyFilters(); });
    document.getElementById("history-filter-status")?.addEventListener("change", () => { historyPage = 1; applyFilters(); });
    document.getElementById("btn-history-prev")?.addEventListener("click", () => { if(historyPage > 1) { historyPage--; renderHistoryTable(); }});
    document.getElementById("btn-history-next")?.addEventListener("click", () => { historyPage++; renderHistoryTable(); });
    
    // Logout
    document.getElementById("btn-logout")?.addEventListener("click", () => { apiFetch(API.LOGOUT, "POST"); clearToken(); window.location.href = LOGIN_URL; });
    document.getElementById("sidebar-logout")?.addEventListener("click", () => { apiFetch(API.LOGOUT, "POST"); clearToken(); window.location.href = LOGIN_URL; });

    // Initial load
    const profileP = apiFetch(API.PROFILE).then(async (res) => {
        if(res && res.ok){
            try {
                const d = await res.json();
                setText("nav-username", d.username || "User");
                setText("sidebar-username", d.username || "");
                setText("sidebar-email", d.email || "");
                const av = document.getElementById("sidebar-avatar");
                if (av) av.textContent = (d.username || "U")[0].toUpperCase();
            } catch(e) {
                console.error("Profile parse err:", e);
            }
        }
    }).catch(e => console.error("Profile load err:", e));

    await Promise.all([
        profileP,
        loadMiningStatus(false),
        loadPoolStatus(),
        loadMiningHistory()
    ]);
});