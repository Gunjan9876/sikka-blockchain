"use strict";

/**
 * dashboard.js – Student Dashboard
 *
 * Auth, token management, logout, role detection, and page guard are all
 * provided by sikka-auth.js which is loaded before this script in base.html.
 *
 * apiFetch, getToken, clearToken, logout, initSikkaSidebar,
 * initSikkaPage, sikkaShowToast, sikkaEscHtml → all from sikka-auth.js
 */

const API = {
    PROFILE:      "/api/v1/accounts/profile/",
    WALLET:       "/api/v1/wallet/",
    STATUS:       "/api/v1/mining/status/",
    START:        "/api/v1/mining/start/",
    CLAIM:        "/api/v1/mining/claim/",
    LOGOUT:       "/api/v1/accounts/logout/",
    TX_SEND:      "/api/v1/transactions/send/",
    TX_LIST:      "/api/v1/transactions/",
    FEE_ESTIMATE: "/api/v1/transactions/fee-estimate/",
    HISTORY:      "/api/v1/mining/history/",
    RIG:          "/api/v1/mining/rig/",
    RIG_UPGRADE:  "/api/v1/mining/rig/upgrade/",
    POOLS:        "/api/v1/mining/pools/",
    POOL_JOIN:    "/api/v1/mining/pools/join/",
    POOL_LEAVE:   "/api/v1/mining/pools/leave/",
};
const LOGIN_URL    = SIKKA_LOGIN_URL;   // alias from sikka-auth.js
const MAX_MINE_SEC = 24 * 3600;

// These functions are provided globally by sikka-auth.js.
// Aliases keep the rest of this file unchanged.
function redirectToLogin() { window.location.replace(SIKKA_LOGIN_URL); }

/* ── Toast ──────────────────────────────────────────────── */
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

function escHtml(str) { const d = document.createElement("div"); d.textContent = str; return d.innerHTML; }

/* ── UI Helpers ─────────────────────────────────────────── */
function setText(id, value)      { const el = document.getElementById(id); if (el) el.textContent = value; }
function setHtml(id, html)       { const el = document.getElementById(id); if (el) el.innerHTML = html; }
function setDisabled(id, state)  { const el = document.getElementById(id); if (el) el.disabled = state; }

function formatDecimal(val) {
    const n = parseFloat(val);
    return isNaN(n) ? "0.00000000" : n.toFixed(8);
}
function formatDate(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
function secondsToHMS(secs) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return [h, m, s].map(v => String(v).padStart(2, "0")).join(":");
}
function shortHash(hash) {
    if (!hash) return "—";
    return hash.slice(0, 10) + "…" + hash.slice(-6);
}

/* ── PoW Mining Overlay ─────────────────────────────────── */
/*
 * showPowOverlay() / hidePowOverlay() / setPowSuccess()
 *
 * Displays a fullscreen modal while the server is running the real
 * SHA-256 Proof-of-Work loop.  A JS counter simulates live nonce
 * increments so the user can see "mining" happening in real time.
 * When the server responds, setPowSuccess() swaps in the result.
 */

let _powOverlayEl   = null;   // DOM node for the overlay
let _powNonceTimer  = null;   // setInterval handle for nonce counter
let _powNonceValue  = 0;      // current displayed nonce
let _powHashTimer   = null;   // setInterval handle for fake hash flicker
const POW_DIFFICULTY = 4;     // must match mining/services.py POW_DIFFICULTY

/** Generate a random-looking 64-char hex string for the hash display */
function _randomHash() {
    const hex = "0123456789abcdef";
    let h = "";
    for (let i = 0; i < 64; i++) h += hex[Math.floor(Math.random() * 16)];
    return h;
}

/** Build and inject the overlay HTML (called once on first use) */
function _buildPowOverlay() {
    if (_powOverlayEl) return;

    const el = document.createElement("div");
    el.id = "pow-overlay";
    el.style.cssText = `
        position:fixed; inset:0; z-index:9999;
        background:rgba(10,10,10,.93);
        display:flex; align-items:center; justify-content:center;
        backdrop-filter:blur(4px);
        opacity:0; transition:opacity .25s;
    `;

    el.innerHTML = `
        <div style="
            background:var(--card-bg,#1a1a1a);
            border:1px solid var(--gold-border,rgba(212,175,55,.25));
            border-radius:16px;
            padding:2.5rem 2rem;
            max-width:480px; width:92%;
            text-align:center;
            box-shadow:0 8px 40px rgba(0,0,0,.6);
        ">
            <!-- Icon / spinner -->
            <div id="pow-icon" style="font-size:3rem; margin-bottom:1rem;">
                <span id="pow-spinner" style="display:inline-block;">⛏️</span>
            </div>

            <!-- Title -->
            <div id="pow-title" style="
                font-size:1.25rem; font-weight:700;
                color:var(--gold,#d4af37); margin-bottom:.4rem;
            ">Mining Block…</div>

            <!-- Subtitle -->
            <div id="pow-subtitle" style="
                font-size:.82rem; color:var(--text-muted,#888);
                margin-bottom:1.6rem;
            ">Running SHA-256 Proof-of-Work on the server</div>

            <!-- Nonce counter -->
            <div style="
                background:#111; border:1px solid #2a2a2a;
                border-radius:10px; padding:1rem 1.2rem;
                margin-bottom:1rem; text-align:left;
                font-family:monospace; font-size:.8rem;
            ">
                <div style="color:#555; margin-bottom:.5rem; font-size:.72rem; text-transform:uppercase; letter-spacing:.06em;">
                    <i class="bi bi-cpu"></i> PoW Engine
                </div>
                <div style="display:flex; justify-content:space-between; margin-bottom:.35rem;">
                    <span style="color:#666;">Difficulty</span>
                    <span style="color:var(--gold,#d4af37); font-weight:600;">
                        ${"0".repeat(POW_DIFFICULTY)}<span style="color:#444;">xxxx…</span>
                    </span>
                </div>
                <div style="display:flex; justify-content:space-between; margin-bottom:.35rem;">
                    <span style="color:#666;">Nonce</span>
                    <span id="pow-nonce" style="color:#e0e0e0; font-weight:600;">0</span>
                </div>
                <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                    <span style="color:#666; flex-shrink:0; margin-right:.5rem;">Hash</span>
                    <span id="pow-hash" style="
                        color:#444; word-break:break-all; text-align:right;
                        font-size:.68rem; line-height:1.5;
                    ">—</span>
                </div>
            </div>

            <!-- Progress bar (indeterminate shimmer) -->
            <div style="
                height:4px; background:#222; border-radius:4px;
                overflow:hidden; margin-bottom:1.2rem;
            ">
                <div id="pow-progress-bar" style="
                    height:100%; width:30%;
                    background:linear-gradient(90deg,var(--gold,#d4af37),var(--gold-light,#f2cf63));
                    border-radius:4px;
                    animation:pow-shimmer 1.2s ease-in-out infinite alternate;
                "></div>
            </div>

            <!-- Status message -->
            <div id="pow-status" style="font-size:.78rem; color:#666;">
                Iterating nonces until hash starts with
                <strong style="color:var(--gold,#d4af37); font-family:monospace;">
                    ${"0".repeat(POW_DIFFICULTY)}…
                </strong>
            </div>
        </div>

        <style>
            @keyframes pow-shimmer {
                0%   { transform: translateX(-100%); }
                100% { transform: translateX(340%); }
            }
            @keyframes pow-pulse {
                0%,100% { transform: scale(1);   opacity:1;   }
                50%      { transform: scale(1.15); opacity:.8; }
            }
            #pow-spinner { animation: pow-pulse 1s ease-in-out infinite; }
        </style>
    `;

    document.body.appendChild(el);
    _powOverlayEl = el;
}

/** Show the overlay and start the live nonce/hash animation */
function showPowOverlay() {
    _buildPowOverlay();

    // Reset to initial mining state
    document.getElementById("pow-icon").innerHTML    = `<span id="pow-spinner" style="display:inline-block; animation:pow-pulse 1s ease-in-out infinite;">⛏️</span>`;
    document.getElementById("pow-title").textContent  = "Mining Block…";
    document.getElementById("pow-title").style.color  = "var(--gold,#d4af37)";
    document.getElementById("pow-subtitle").textContent = "Running SHA-256 Proof-of-Work on the server";
    document.getElementById("pow-progress-bar").style.animation = "pow-shimmer 1.2s ease-in-out infinite alternate";
    document.getElementById("pow-status").innerHTML   = `Iterating nonces until hash starts with <strong style="color:var(--gold,#d4af37);font-family:monospace;">${"0".repeat(POW_DIFFICULTY)}…</strong>`;

    _powNonceValue = 0;
    document.getElementById("pow-nonce").textContent = "0";
    document.getElementById("pow-hash").textContent  = "—";

    // Show overlay with fade
    _powOverlayEl.style.display = "flex";
    requestAnimationFrame(() => { _powOverlayEl.style.opacity = "1"; });

    // Live nonce counter — increments fast to simulate server iteration speed
    // ~50,000–200,000 nonces/sec is realistic for Python SHA-256
    _powNonceTimer = setInterval(() => {
        // Accelerate gradually: starts slow, ramps up
        // Cap at 2500/frame (~150k nonces/sec) to prevent astronomical overflow
        const step = Math.min(2500, Math.floor(1000 + _powNonceValue * 0.08));
        _powNonceValue += step;
        document.getElementById("pow-nonce").textContent = _powNonceValue.toLocaleString();
    }, 16); // ~60fps

    // Hash flicker — shows random hex strings to simulate attempts
    _powHashTimer = setInterval(() => {
        const h = _randomHash();
        const el = document.getElementById("pow-hash");
        if (el) {
            // Colour the leading chars to show they don't match target yet
            const leading = h.slice(0, POW_DIFFICULTY);
            const rest    = h.slice(POW_DIFFICULTY);
            el.innerHTML  = `<span style="color:#e74c3c;">${leading}</span><span style="color:#333;">${rest}</span>`;
        }
    }, 80);
}

/**
 * Called when the server returns a successful mining result.
 * Stops the simulation counters and shows the actual PoW result.
 */
function setPowSuccess(reward) {
    // Stop simulation timers
    if (_powNonceTimer) { clearInterval(_powNonceTimer); _powNonceTimer = null; }
    if (_powHashTimer)  { clearInterval(_powHashTimer);  _powHashTimer  = null; }

    // Freeze nonce display at final simulated value
    const finalNonce = _powNonceValue.toLocaleString();

    // Show a "valid" hash with the required leading zeros
    const validHash = "0".repeat(POW_DIFFICULTY) + _randomHash().slice(POW_DIFFICULTY);
    const hashEl = document.getElementById("pow-hash");
    if (hashEl) {
        hashEl.innerHTML = `<span style="color:#2ecc71;">${"0".repeat(POW_DIFFICULTY)}</span><span style="color:#666;">${validHash.slice(POW_DIFFICULTY)}</span>`;
    }

    // Update the UI to "Block Mined!" state
    document.getElementById("pow-icon").innerHTML    = `<span style="font-size:3rem;">✅</span>`;
    document.getElementById("pow-title").textContent  = "Block Mined!";
    document.getElementById("pow-title").style.color  = "#2ecc71";
    document.getElementById("pow-subtitle").textContent = `${formatDecimal(reward)} SKA credited to your wallet`;
    document.getElementById("pow-progress-bar").style.animation = "none";
    document.getElementById("pow-progress-bar").style.width     = "100%";
    document.getElementById("pow-progress-bar").style.background = "#2ecc71";
    document.getElementById("pow-status").innerHTML  = `<span style="color:#2ecc71;">✓ Valid hash found after ${finalNonce} attempts</span>`;
}

/** Hide and remove the overlay after a short delay */
function hidePowOverlay(delay = 1800) {
    if (_powNonceTimer) { clearInterval(_powNonceTimer); _powNonceTimer = null; }
    if (_powHashTimer)  { clearInterval(_powHashTimer);  _powHashTimer  = null; }

    setTimeout(() => {
        if (_powOverlayEl) {
            _powOverlayEl.style.opacity = "0";
            setTimeout(() => {
                if (_powOverlayEl) { _powOverlayEl.style.display = "none"; }
            }, 260);
        }
    }, delay);
}

/* ── Profile & Wallet ───────────────────────────────────── */
let profileData = {};
let walletData = {};
let allTransactions = [];
let allHistory = [];
let chartGrowth = null;
let chartActivity = null;

/**
 * loadProfile — accepts the profile returned by initSikkaPage() so we
 * don't make a second /api/v1/accounts/profile/ call.
 */
function loadProfile(profile) {
    profileData = profile;
    setText("welcome-username", profileData.username || "User");
    // Sidebar is already populated by initSikkaPage → _populateSidebarUser

    const badges = document.getElementById("wallet-security-badges");
    if (badges) {
        badges.innerHTML = "";
        if (profileData.email_verified)    badges.innerHTML += `<span class="badge" style="background: rgba(74, 222, 128, 0.1); color: #4ade80; border: 1px solid rgba(74, 222, 128, 0.2);">Email Verified</span> `;
        if (profileData.two_factor_enabled) badges.innerHTML += `<span class="badge" style="background: rgba(74, 222, 128, 0.1); color: #4ade80; border: 1px solid rgba(74, 222, 128, 0.2);">2FA Active</span>`;
    }
}

async function loadWallet() {
    const res = await apiFetch(API.WALLET);
    if (!res || !res.ok) return;
    walletData = await res.json();
    
    setText("net-balance", formatDecimal(walletData.balance) + " SKA");
    setText("net-rewards", formatDecimal(walletData.total_mined) + " SKA");
    
    setText("wallet-balance", formatDecimal(walletData.balance));
    setText("wallet-created", formatDate(walletData.created_at));
    setText("wallet-address", walletData.wallet_address || "—");
    
    const statusLabel = document.getElementById("wallet-status");
    if (statusLabel) {
        statusLabel.textContent = walletData.wallet_status || "—";
        statusLabel.className = `card-badge ${walletData.wallet_status === 'active' ? 'badge-active' : 'badge-idle'}`;
    }

    const copyBtn = document.getElementById("btn-copy-address");
    if (copyBtn) copyBtn.dataset.address = walletData.wallet_address || "";
    
    await loadDashboardAnalytics();
}

/* ── Copy Address ───────────────────────────────────────── */
function initCopyAddress() {
    document.getElementById("btn-copy-address")?.addEventListener("click", function () {
        const addr = this.dataset.address;
        if (!addr) { showToast("Nothing to copy", "Wallet address not loaded yet.", "error"); return; }
        navigator.clipboard.writeText(addr).then(() => {
            const icon = this.querySelector("i");
            if (icon) { icon.className = "bi bi-clipboard-check"; }
            showToast("Copied!", "Wallet address copied to clipboard.", "success");
            setTimeout(() => { if (icon) icon.className = "bi bi-clipboard"; }, 2000);
        }).catch(() => {
            showToast("Copy failed", "Please copy the address manually.", "error");
        });
    });
}

/* ── Mining ─────────────────────────────────────────────── */
let miningPollTimer = null;
let elapsedSeconds  = 0;
let timerInterval   = null;
let isMining        = false;

async function loadMiningStatus(silent = false) {
    const res = await apiFetch(API.STATUS);
    if (!res) return;
    if (!res.ok) {
        if (!silent) showToast("Mining Error", "Could not fetch mining status.", "error");
        return;
    }
    applyMiningStatus(await res.json());
}

function applyMiningStatus(data) {
    isMining = data.is_mining;
    const badge = document.getElementById("mining-status-badge");
    if (badge) {
        badge.textContent = isMining ? "Mining Active" : "Idle";
        badge.className   = "card-badge " + (isMining ? "badge-running" : "badge-idle");
    }
    setDisabled("btn-start", isMining);
    setDisabled("btn-claim", !isMining);

    if (isMining) {
        elapsedSeconds = data.elapsed_seconds || 0;
        updateTimerDisplay();
        updateProgressBar(elapsedSeconds);
        setText("mining-estimate-val", formatDecimal(data.estimated_reward) + " SKA");
        startLocalTimer();
        startPollTimer();
    } else {
        stopLocalTimer(); stopPollTimer();
        setText("mining-timer",        "00:00:00");
        setText("mining-estimate-val", "0.00000000 SKA");
        updateProgressBar(0);
    }

    if (data.rig) {
        renderRigInfo(data.rig);
        setText("bc-hashrate", data.rig.hash_rate ? data.rig.hash_rate + " H/s" : "Estimated...");
    }
    renderPoolStatus(data.pool || null);
}

function updateTimerDisplay() { setText("mining-timer", secondsToHMS(Math.min(elapsedSeconds, MAX_MINE_SEC))); }

function updateProgressBar(secs) {
    const pct = Math.min((secs / MAX_MINE_SEC) * 100, 100).toFixed(2);
    const bar   = document.getElementById("mining-progress-bar");
    const pctEl = document.getElementById("mining-progress-pct");
    if (bar)   bar.style.width   = pct + "%";
    if (pctEl) pctEl.textContent = pct + "%";
}

function startLocalTimer() {
    if (timerInterval) return;
    timerInterval = setInterval(() => {
        if (elapsedSeconds < MAX_MINE_SEC) elapsedSeconds++;
        updateTimerDisplay();
        updateProgressBar(elapsedSeconds);
    }, 1000);
}
function stopLocalTimer() { if (timerInterval) { clearInterval(timerInterval); timerInterval = null; } }

function startPollTimer() {
    if (miningPollTimer) return;
    miningPollTimer = setInterval(() => { loadMiningStatus(true); loadWallet(); }, 10000);
}
function stopPollTimer() { if (miningPollTimer) { clearInterval(miningPollTimer); miningPollTimer = null; } }

async function startMining() {
    setDisabled("btn-start", true);
    const btn  = document.getElementById("btn-start");
    const orig = btn?.innerHTML;
    if (btn) btn.innerHTML = `<i class="bi bi-arrow-repeat spin"></i> Starting…`;
    const res = await apiFetch(API.START, "POST");
    if (res) {
        const data = await res.json();
        if (res.ok) {
            showToast("Mining Started", "Your session has begun. Rewards accumulate over 24 h.", "success");
            await loadMiningStatus(true);
        } else {
            showToast("Cannot Start", data.error || "An error occurred.", "error");
            setDisabled("btn-start", false);
        }
    } else {
        setDisabled("btn-start", false);
    }
    if (btn) btn.innerHTML = orig;
}

/*
 * claimReward()
 * ─────────────
 * 1. Show the PoW overlay immediately (before the API call).
 * 2. Fire the claim API call — server runs real SHA-256 PoW (~0.2-0.5s).
 * 3. While waiting, the overlay animates a live nonce counter + hash flicker.
 * 4. On success → setPowSuccess() shows the final nonce + valid hash + reward.
 * 5. After 1.8s delay → hidePowOverlay() fades out, dashboard updates.
 * 6. On error → hide overlay immediately, show error toast.
 */
async function claimReward() {
    setDisabled("btn-claim", true);

    // Show PoW animation overlay — user sees mining happening in real time
    showPowOverlay();

    let res;
    try {
        res = await apiFetch(API.CLAIM, "POST");
    } catch (err) {
        hidePowOverlay(0);
        showToast("Claim Failed", "Network error during mining.", "error");
        setDisabled("btn-claim", !isMining);
        return;
    }

    if (res) {
        const data = await res.json();
        if (res.ok) {
            // PoW succeeded on server — show success state in overlay
            setPowSuccess(data.reward);
            showToast("Reward Claimed! 🎉", `${formatDecimal(data.reward)} SKA credited to your wallet.`, "success");

            // Hide overlay after 1.8s, then refresh dashboard
            hidePowOverlay(1800);
            setTimeout(async () => {
                stopLocalTimer(); stopPollTimer(); isMining = false;
                applyMiningStatus({ is_mining: false });
                await loadWallet();
                await loadTransactions();
                await loadMiningHistory();
            }, 1800);
        } else {
            // Server rejected the claim (e.g. zero reward, no session)
            hidePowOverlay(0);
            showToast("Claim Failed", data.error || "An error occurred.", "error");
            setDisabled("btn-claim", !isMining);
        }
    } else {
        hidePowOverlay(0);
        setDisabled("btn-claim", !isMining);
    }
}

/* ── Mining History (Redesigned for Timeline) ───────────── */
async function loadMiningHistory() {
    // Left empty as it's now bundled into loadDashboardAnalytics
}

function renderMiningHistory(sessions) {
    // Handled by buildTimelineAndNotifications
}

/* ── Send Transaction ───────────────────────────────────── */
async function sendTransaction() {
    const addrEl   = document.getElementById("send-address");
    const amountEl = document.getElementById("send-amount");
    const receiver = addrEl?.value.trim();
    const amount   = amountEl?.value.trim();

    if (!receiver || !amount) {
        showToast("Missing Fields", "Enter a receiver address and amount.", "error");
        return;
    }

    const feeText = document.getElementById("fee-estimate-val")?.textContent || "0.00";
    const totalText = document.getElementById("fee-total-val")?.textContent || amount;
    
    document.getElementById("confirm-amt-val").textContent = `${amount} SKA`;
    document.getElementById("confirm-to-val").textContent = receiver;
    document.getElementById("confirm-fee-val").textContent = `${feeText} SKA`;
    document.getElementById("confirm-total-val").textContent = `${totalText} SKA`;
    
    document.getElementById("confirm-modal").classList.add("visible");
}

document.getElementById("btn-confirm-cancel")?.addEventListener("click", () => {
    document.getElementById("confirm-modal").classList.remove("visible");
});

document.getElementById("btn-confirm-send")?.addEventListener("click", async () => {
    const addrEl   = document.getElementById("send-address");
    const amountEl = document.getElementById("send-amount");
    const receiver = addrEl?.value.trim();
    const amount   = amountEl?.value.trim();

    const btn  = document.getElementById("btn-confirm-send");
    const orig = btn?.innerHTML;
    if (btn) { btn.disabled = true; btn.innerHTML = `<i class="bi bi-arrow-repeat spin"></i> Sending…`; }

    const res = await apiFetch(API.TX_SEND, "POST", { receiver_address: receiver, amount });

    if (res) {
        const data = await res.json();
        if (res.ok) {
            showToast("Transaction Submitted", `TX: ${shortHash(data.tx_hash)} — pending block confirmation.`, "success");
            if (addrEl)   addrEl.value   = "";
            if (amountEl) amountEl.value = "";
            const feeRow = document.getElementById("fee-estimate-row");
            if (feeRow) feeRow.style.display = "none";
            document.getElementById("confirm-modal").classList.remove("visible");
            await loadWallet();
            await loadTransactions();
        } else {
            showToast("Transfer Failed", data.error || "An error occurred.", "error");
        }
    }

    if (btn) { btn.disabled = false; btn.innerHTML = orig; }
});

/* ── Fee Estimate (dashboard send form) ─────────────────── */
let _dashFeeTimer = null;
function initFeeEstimate() {
    const amtEl = document.getElementById("send-amount");
    if (!amtEl) return;
    amtEl.addEventListener("input", () => {
        clearTimeout(_dashFeeTimer);
        const amt = parseFloat(amtEl.value);
        const row = document.getElementById("fee-estimate-row");
        if (!amt || amt <= 0) {
            if (row) row.style.display = "none";
            return;
        }
        _dashFeeTimer = setTimeout(async () => {
            const res = await apiFetch(`${API.FEE_ESTIMATE}?amount=${amt}`);
            if (!res || !res.ok) return;
            const d = await res.json();
            const fee   = parseFloat(d.fee   || 0);
            const total = parseFloat(d.total || amt + fee);
            const feeVal = document.getElementById("fee-estimate-val");
            const totVal = document.getElementById("fee-total-val");
            if (feeVal) feeVal.textContent = fee.toFixed(8);
            if (totVal) totVal.textContent = (amt + fee).toFixed(8);
            if (row)    row.style.display  = "block";
        }, 500);
    });
}

/* ── Transactions & Analytics Engine ────────────────────── */
async function loadTransactions() {
    // Left empty as it's now bundled into loadDashboardAnalytics
}

async function loadDashboardAnalytics() {
    // 1. Fetch data concurrently
    const [txRes, histRes] = await Promise.all([
        apiFetch(`${API.TX_LIST}?page=1&page_size=100`),
        apiFetch(`${API.HISTORY}?page=1&page_size=50`)
    ]);
    
    if (txRes && txRes.ok) {
        const d = await txRes.json();
        allTransactions = d.transactions || [];
        setText("net-txs", d.total || allTransactions.length);
        
        let blocksMined = allTransactions.filter(t => t.tx_type === 'COINBASE').length;
        if (d.total_pages > 1 && blocksMined === 100) blocksMined = "100+";
        setText("net-blocks", blocksMined);
        
        let maxBlock = -1;
        for (let t of allTransactions) {
            if (t.block_index !== null && t.block_index > maxBlock) maxBlock = t.block_index;
        }
        setText("bc-latest-block", maxBlock > -1 ? `#${maxBlock}` : "Syncing...");
        
        if (allTransactions.length > 0) {
            setText("wallet-last-activity", formatDate(allTransactions[0].created_at));
        }
    }
    
    if (histRes && histRes.ok) {
        const d = await histRes.json();
        allHistory = d.sessions || [];
    }
    
    processRewardStats();
    buildTimelineAndNotifications();
    renderCharts();
}

function processRewardStats() {
    const now = new Date();
    let today = 0, weekly = 0, monthly = 0;
    
    allHistory.forEach(s => {
        if (s.status !== "CLAIMED") return;
        const d = new Date(s.claimed_at || s.started_at);
        const diff = (now - d) / (1000 * 3600 * 24);
        const amt = parseFloat(s.reward) || 0;
        
        if (diff <= 1) today += amt;
        if (diff <= 7) weekly += amt;
        if (diff <= 30) monthly += amt;
    });
    
    setText("reward-today", formatDecimal(today) + " SKA");
    setText("reward-weekly", formatDecimal(weekly) + " SKA");
    setText("reward-monthly", formatDecimal(monthly) + " SKA");
    setText("reward-lifetime", formatDecimal(walletData.total_mined || 0) + " SKA");
}

function buildTimelineAndNotifications() {
    let feed = [];
    allTransactions.forEach(t => {
        feed.push({
            type: t.tx_type === 'COINBASE' ? 'MINED' : (t.sender_address === walletData.wallet_address ? 'SENT' : 'RECEIVED'),
            date: new Date(t.created_at),
            amount: parseFloat(t.amount),
            hash: t.tx_hash,
            status: t.status
        });
    });
    allHistory.forEach(h => {
        if (h.status === 'RUNNING') {
            feed.push({ type: 'MINING_STARTED', date: new Date(h.started_at), amount: 0, status: 'RUNNING', hash: 'Mining Session' });
        }
    });
    feed.sort((a,b) => b.date - a.date);
    
    const tlEl = document.getElementById("activity-timeline");
    if (tlEl) {
        if (!feed.length) {
            tlEl.innerHTML = `<div class="text-center text-muted py-4">No activity yet.</div>`;
        } else {
            tlEl.innerHTML = feed.slice(0, 15).map(i => {
                let icon = "bi-circle", color = "var(--text-muted)", title = "", desc = "";
                if (i.type === 'MINED') { icon = "bi-box"; color = "var(--gold)"; title = `Block Mined (+${i.amount.toFixed(4)} SKA)`; }
                else if (i.type === 'RECEIVED') { icon = "bi-arrow-down-left-square"; color = "#4ade80"; title = `Received ${i.amount.toFixed(4)} SKA`; }
                else if (i.type === 'SENT') { icon = "bi-arrow-up-right-square"; color = "var(--danger)"; title = `Sent ${i.amount.toFixed(4)} SKA`; }
                else if (i.type === 'MINING_STARTED') { icon = "bi-cpu"; color = "#3498db"; title = "Mining Session Started"; }
                return `
                <div class="timeline-item">
                    <div class="timeline-marker" style="border-color: ${color};"></div>
                    <div class="timeline-content">
                        <div class="timeline-title">
                            <span style="color: ${color};"><i class="bi ${icon} me-1"></i> ${title}</span>
                            <span class="timeline-date">${i.date.toLocaleDateString()} ${i.date.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span>
                        </div>
                        <div class="timeline-desc" style="font-family:monospace;">${i.hash ? (i.hash.length > 20 ? shortHash(i.hash) : i.hash) : ""}</div>
                    </div>
                </div>`;
            }).join("");
        }
    }
    
    const notifEl = document.getElementById("notifications-panel");
    if (notifEl) {
        let notifs = feed.filter(f => f.type === 'MINED' || f.type === 'RECEIVED' || f.type === 'MINING_STARTED').slice(0, 7);
        if (!notifs.length) {
            notifEl.innerHTML = `<div class="text-center text-muted py-3" style="font-size: 0.8rem;">No new notifications.</div>`;
        } else {
            notifEl.innerHTML = notifs.map(n => {
                const isRcv = n.type === 'RECEIVED';
                const isMin = n.type === 'MINING_STARTED';
                return `
                <div style="padding: 0.75rem; border-bottom: 1px solid var(--gold-border); display:flex; align-items:center; gap: 0.75rem;">
                    <div style="width: 32px; height: 32px; border-radius: 50%; background: ${isRcv ? 'rgba(74,222,128,0.1)' : (isMin ? 'rgba(52,152,219,0.1)' : 'rgba(212,175,55,0.1)')}; color: ${isRcv ? '#4ade80' : (isMin ? '#3498db' : 'var(--gold)')}; display:flex; align-items:center; justify-content:center; flex-shrink: 0;">
                        <i class="bi ${isRcv ? 'bi-wallet2' : (isMin ? 'bi-cpu' : 'bi-gift')}"></i>
                    </div>
                    <div>
                        <div style="font-size: 0.8rem; font-weight: 600; color: var(--text-primary);">${isRcv ? 'Payment Received' : (isMin ? 'Session Active' : 'Reward Claimed')}</div>
                        <div style="font-size: 0.7rem; color: var(--text-muted);">${n.amount ? '+'+n.amount.toFixed(4)+' SKA • ' : ''}${n.date.toLocaleDateString()}</div>
                    </div>
                </div>`;
            }).join("");
        }
    }
}

function renderCharts() {
    if (!window.Chart) return;
    Chart.defaults.color = "#a0a0a0";
    Chart.defaults.font.family = "Poppins, sans-serif";

    const dailyMap = {};
    for(let i=13; i>=0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i);
        dailyMap[d.toISOString().split('T')[0]] = { mined: 0, sent: 0, rcv: 0 };
    }
    
    let runningBalance = parseFloat(walletData.balance || 0);
    const sortedTx = [...allTransactions].sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
    const growthLabels = Object.keys(dailyMap);
    const growthData = new Array(14).fill(0);
    growthData[13] = runningBalance;
    
    let bal = runningBalance;
    let dayIdx = 13;
    let currentDayStr = growthLabels[dayIdx];
    
    for (let tx of sortedTx) {
        const dStr = tx.created_at.split('T')[0];
        const amt = parseFloat(tx.amount);
        const fee = parseFloat(tx.fee || 0);
        
        if (tx.status !== 'CONFIRMED') continue;
        
        if (dailyMap[dStr]) {
            if (tx.tx_type === 'COINBASE') dailyMap[dStr].mined += amt;
            else if (tx.sender_address === walletData.wallet_address) dailyMap[dStr].sent += (amt + fee);
            else dailyMap[dStr].rcv += amt;
        }
        
        while (dayIdx >= 0 && currentDayStr > dStr) {
            dayIdx--;
            if(dayIdx >= 0) { currentDayStr = growthLabels[dayIdx]; growthData[dayIdx] = bal; }
        }
        
        if (tx.tx_type === 'COINBASE' || tx.receiver_address === walletData.wallet_address) { bal -= amt; }
        else if (tx.sender_address === walletData.wallet_address) { bal += (amt + fee); }
    }
    while(dayIdx >= 0) { growthData[dayIdx] = bal; dayIdx--; }

    const ctxGrowth = document.getElementById('growthChart');
    if (ctxGrowth) {
        if (chartGrowth) chartGrowth.destroy();
        chartGrowth = new Chart(ctxGrowth, {
            type: 'line',
            data: {
                labels: growthLabels.map(d => new Date(d).toLocaleDateString(undefined, {month:'short', day:'numeric'})),
                datasets: [{
                    label: 'Balance',
                    data: growthData,
                    borderColor: '#d4af37',
                    backgroundColor: 'rgba(212, 175, 55, 0.1)',
                    fill: true,
                    tension: 0.3,
                    borderWidth: 2,
                    pointRadius: 0,
                    pointHitRadius: 10
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { x: { grid: { display: false } }, y: { grid: { color: 'rgba(255,255,255,0.05)' }, beginAtZero: true } }
            }
        });
    }
    
    const ctxAct = document.getElementById('activityChart');
    if (ctxAct) {
        if (chartActivity) chartActivity.destroy();
        chartActivity = new Chart(ctxAct, {
            type: 'bar',
            data: {
                labels: growthLabels.map(d => new Date(d).toLocaleDateString(undefined, {day:'numeric'})),
                datasets: [
                    { label: 'Mined', data: growthLabels.map(k => dailyMap[k].mined), backgroundColor: 'rgba(212, 175, 55, 0.8)' },
                    { label: 'Sent', data: growthLabels.map(k => dailyMap[k].sent), backgroundColor: 'rgba(231, 76, 60, 0.8)' }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, grid: { color: 'rgba(255,255,255,0.05)' } } }
            }
        });
    }
}

/* ── Transaction Details Modal ──────────────────────────── */
async function showTxDetail(txHash) {
    const res = await apiFetch(`${API.TX_LIST}${txHash}/`);
    if (!res || !res.ok) {
        showToast("Error", "Could not load transaction details.", "error");
        return;
    }
    const tx = await res.json();
    
    document.getElementById("mdl-tx-status").textContent = tx.status;
    document.getElementById("mdl-tx-amount").textContent = formatDecimal(tx.amount) + " SKA";
    document.getElementById("mdl-tx-fee").textContent = formatDecimal(tx.fee) + " SKA";
    document.getElementById("mdl-tx-hash").textContent = tx.tx_hash || "—";
    document.getElementById("mdl-tx-block").textContent = tx.block_index !== null ? `#${tx.block_index}` : "Pending";
    document.getElementById("mdl-tx-sender").textContent = tx.sender_address || "—";
    document.getElementById("mdl-tx-receiver").textContent = tx.receiver_address || "—";
    document.getElementById("mdl-tx-time").textContent = formatDate(tx.created_at);
    
    document.getElementById("tx-detail-modal").classList.add("visible");
}

/* ── Rig Info ────────────────────────────────────────────── */
async function loadRigInfo() {
    const res = await apiFetch(API.STATUS);
    if (!res || !res.ok) return; // Silent since it's often polled
    const data = await res.json();
    if (data.rig) renderRigInfo(data.rig);
    renderPoolStatus(data.pool || null);
}

function renderRigInfo(rig) {
    setText("rig-tier-label",  rig.tier_label  || "—");
    setText("rig-hash-rate",   rig.hash_rate   ? rig.hash_rate + " H/s" : "—");
    setText("rig-multiplier",  rig.multiplier  ? "×" + rig.multiplier   : "—");

    const upgradeWrap = document.getElementById("rig-upgrade-wrap");
    const maxLabel    = document.getElementById("rig-max-label");
    if (rig.is_max_tier) {
        if (upgradeWrap) upgradeWrap.style.display = "none";
        if (maxLabel)    maxLabel.style.display    = "block";
    } else {
        setText("rig-upgrade-cost", rig.next_tier_cost || "—");
        const btn = document.getElementById("btn-upgrade-rig");
        if (btn) btn.title = `Upgrade to ${rig.next_tier_label || "next tier"}`;
        if (upgradeWrap) upgradeWrap.style.display = "block";
        if (maxLabel)    maxLabel.style.display    = "none";
    }
}

async function upgradeRig() {
    const btn  = document.getElementById("btn-upgrade-rig");
    const orig = btn?.innerHTML;
    if (btn) { btn.disabled = true; btn.innerHTML = `<i class="bi bi-arrow-repeat spin"></i> Upgrading…`; }
    const res = await apiFetch(API.RIG_UPGRADE, "POST");
    if (res) {
        const data = await res.json();
        if (res.ok) {
            showToast("Rig Upgraded! 🚀", data.message || "Your rig has been upgraded.", "success");
            await loadRigInfo();  // reloads rig+pool from status
            await loadWallet();
        } else {
            showToast("Upgrade Failed", data.error || "An error occurred.", "error");
        }
    }
    if (btn) { btn.disabled = false; btn.innerHTML = orig; }
}

/* ── Pool ────────────────────────────────────────────────── */
async function loadPoolStatus() {
    // Pool membership is in the status response
    const statusRes = await apiFetch(API.STATUS);
    if (!statusRes || !statusRes.ok) return;
    const statusData = await statusRes.json();
    renderPoolStatus(statusData.pool || null);

    // Available pools for the join dropdown
    const poolRes = await apiFetch(API.POOLS);
    if (poolRes && poolRes.ok) {
        const poolData = await poolRes.json();
        renderPoolSelect(poolData.pools || []);
    }
}

function renderPoolStatus(pool) {
    const poolDetail  = document.getElementById("pool-detail");
    const poolJoin    = document.getElementById("pool-join-wrap");
    const statusLabel = document.getElementById("pool-status-label");

    if (pool) {
        if (statusLabel) { statusLabel.textContent = "Active Member"; statusLabel.style.color = "var(--success)"; }
        setText("pool-name", pool.pool_name || pool.name || "—");
        setText("pool-fee",  pool.pool_fee_pct ? pool.pool_fee_pct + "%" : "—");
        if (poolDetail) poolDetail.style.display = "block";
        if (poolJoin)   poolJoin.style.display   = "none";
    } else {
        if (statusLabel) { statusLabel.textContent = "Not in a pool"; statusLabel.style.color = "var(--text-muted)"; }
        if (poolDetail) poolDetail.style.display = "none";
        if (poolJoin)   poolJoin.style.display   = "block";
    }
}

function renderPoolSelect(pools) {
    const sel = document.getElementById("pool-select");
    if (!sel) return;
    sel.innerHTML = `<option value="">Select a pool…</option>` + pools.map(p =>
        `<option value="${p.id}">${escHtml(p.name)} — Fee: ${p.pool_fee_pct}% | ${p.member_count} members</option>`
    ).join("");
}

async function joinPool() {
    const sel    = document.getElementById("pool-select");
    const poolId = sel?.value;
    if (!poolId) { showToast("Select a Pool", "Please choose a pool to join.", "error"); return; }
    const btn  = document.getElementById("btn-join-pool");
    const orig = btn?.innerHTML;
    if (btn) { btn.disabled = true; btn.innerHTML = `<i class="bi bi-arrow-repeat spin"></i> Joining…`; }
    const res = await apiFetch(API.POOL_JOIN, "POST", { pool_id: parseInt(poolId) });
    if (res) {
        const data = await res.json();
        if (res.ok) {
            showToast("Pool Joined! 🤝", data.message || "You have joined the pool.", "success");
            await loadPoolStatus();
        } else {
            showToast("Join Failed", data.error || "An error occurred.", "error");
        }
    }
    if (btn) { btn.disabled = false; btn.innerHTML = orig; }
}

async function leavePool() {
    const btn  = document.getElementById("btn-leave-pool");
    const orig = btn?.innerHTML;
    if (btn) { btn.disabled = true; btn.innerHTML = `<i class="bi bi-arrow-repeat spin"></i> Leaving…`; }
    const res = await apiFetch(API.POOL_LEAVE, "POST");
    if (res) {
        const data = await res.json();
        if (res.ok) {
            showToast("Left Pool", data.message || "You have left the pool.", "info");
            await loadPoolStatus();
        } else {
            showToast("Error", data.error || "An error occurred.", "error");
        }
    }
    if (btn) { btn.disabled = false; btn.innerHTML = orig; }
}

/* ── Logout & Refresh ───────────────────────────────────── */
// logout() is provided globally by sikka-auth.js

async function refreshAll() {
    setDisabled("btn-refresh", true);
    const btn  = document.getElementById("btn-refresh");
    const orig = btn?.innerHTML;
    if (btn) btn.innerHTML = `<i class="bi bi-arrow-repeat spin"></i> Refreshing…`;
    await Promise.all([loadWallet(), loadMiningStatus(false), loadTransactions(), loadMiningHistory(), loadRigInfo(), loadPoolStatus()]);
    if (btn) btn.innerHTML = orig;
    setDisabled("btn-refresh", false);
    showToast("Refreshed", "Dashboard data updated.", "info");
}

// initSidebar() is provided by sikka-auth.js as initSikkaSidebar()

/* ── Init ───────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", async () => {
    // initSikkaSidebar wires up toggle + both logout buttons
    initSikkaSidebar();

    document.getElementById("btn-start")?.addEventListener("click", startMining);
    document.getElementById("btn-claim")?.addEventListener("click", claimReward);
    document.getElementById("btn-refresh")?.addEventListener("click", refreshAll);
    document.getElementById("btn-refresh-actions")?.addEventListener("click", refreshAll);
    document.getElementById("btn-send")?.addEventListener("click", sendTransaction);
    document.getElementById("btn-upgrade-rig")?.addEventListener("click", upgradeRig);
    document.getElementById("btn-join-pool")?.addEventListener("click", joinPool);
    document.getElementById("btn-leave-pool")?.addEventListener("click", leavePool);
    document.getElementById("btn-refresh-actions")?.addEventListener("click", () => {
        loadMiningStatus(false);
        loadWallet();
        loadTransactions();
    });

    document.querySelectorAll(".sikka-modal-close, .sikka-modal-overlay").forEach(el => {
        el.addEventListener("click", (e) => {
            if (e.target === el || el.classList.contains('sikka-modal-close')) {
                const overlay = el.classList.contains('sikka-modal-overlay') ? el : el.closest(".sikka-modal-overlay");
                if (overlay) overlay.classList.remove("visible");
            }
        });
    });

    initCopyAddress();
    initFeeEstimate();

    // initSikkaPage("student"):
    //   1. Checks token exists; redirects to login if not.
    //   2. Fetches /api/v1/accounts/profile/ once.
    //   3. If user is a university (has_org), redirects to /dashboard/org/.
    //   4. Populates sidebar user block.
    //   Returns null if redirected, profile object if student is confirmed.
    const profile = await initSikkaPage("student");
    if (!profile) return; // redirected

    // Use the already-fetched profile instead of re-calling the API
    loadProfile(profile);

    await Promise.all([
        loadWallet(),
        loadMiningStatus(false),
        loadTransactions(),
        loadMiningHistory(),
        loadRigInfo(),
        loadPoolStatus(),
    ]);
});