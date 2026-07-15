"use strict";

const API = {
    PROFILE:      "/api/accounts/profile/",
    WALLET:       "/api/wallet/",
    STATUS:       "/api/mining/status/",
    START:        "/api/mining/start/",
    CLAIM:        "/api/mining/claim/",
    LOGOUT:       "/api/accounts/logout/",
    TX_SEND:      "/api/transactions/send/",
    TX_LIST:      "/api/transactions/",
    HISTORY:      "/api/mining/history/",
    RIG:          "/api/mining/rig/",
    RIG_UPGRADE:  "/api/mining/rig/upgrade/",
    POOLS:        "/api/mining/pools/",
    POOL_JOIN:    "/api/mining/pools/join/",
    POOL_LEAVE:   "/api/mining/pools/leave/",
};

const LOGIN_URL    = "/accounts/login/";
const MAX_MINE_SEC = 24 * 3600;

/* ── Token ──────────────────────────────────────────────── */
function getToken()  { return sessionStorage.getItem("sikka_token"); }
function clearToken(){ sessionStorage.removeItem("sikka_token"); }

/* ── API Helper ─────────────────────────────────────────── */
async function apiFetch(url, method = "GET", body = null) {
    const token = getToken();
    if (!token) { redirectToLogin(); return null; }

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
        if (res.status === 401) { clearToken(); redirectToLogin(); return null; }
        return res;
    } catch (_) {
        showToast("Network Error", "Could not reach the server.", "error");
        return null;
    }
}

function redirectToLogin() { window.location.href = LOGIN_URL; }

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
        const step = Math.floor(1000 + _powNonceValue * 0.08);
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
async function loadProfile() {
    const res = await apiFetch(API.PROFILE);
    if (!res || !res.ok) return;
    const data = await res.json();
    setText("nav-username",     data.username || "User");
    const av = document.getElementById("sidebar-avatar");
    if (av) av.textContent = (data.username || "U")[0].toUpperCase();
    setText("sidebar-username", data.username || "");
    setText("sidebar-email",    data.email    || "");
    setText("welcome-username", data.username || "User");
}

async function loadWallet() {
    const res = await apiFetch(API.WALLET);
    if (!res || !res.ok) return;
    const data = await res.json();
    setText("wallet-balance",  formatDecimal(data.balance));
    setText("wallet-mined",    formatDecimal(data.total_mined));
    setText("wallet-sent",     formatDecimal(data.total_sent));
    setText("wallet-received", formatDecimal(data.total_received));
    setText("wallet-created",  formatDate(data.created_at));
    setText("wallet-address",  data.wallet_address || "—");
    setText("wallet-status",   data.wallet_status  || "—");

    const copyBtn = document.getElementById("btn-copy-address");
    if (copyBtn) copyBtn.dataset.address = data.wallet_address || "";
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
        setText("mining-started-at",   formatDate(data.started_at));
        startLocalTimer();
        startPollTimer();
    } else {
        stopLocalTimer(); stopPollTimer();
        setText("mining-timer",        "00:00:00");
        setText("mining-estimate-val", "0.00000000 SKA");
        setText("mining-started-at",   "—");
        updateProgressBar(0);
    }

    // Rig + pool always present in status response
    if (data.rig)  renderRigInfo(data.rig);
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

/* ── Mining History ─────────────────────────────────────── */
async function loadMiningHistory() {
    const res = await apiFetch(API.HISTORY);
    if (!res || !res.ok) return;
    const data = await res.json();
    renderMiningHistory(data.sessions || []);
}

function renderMiningHistory(sessions) {
    const tbody = document.getElementById("history-tbody");
    if (!tbody) return;

    if (!sessions.length) {
        tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><i class="bi bi-clock-history"></i> No mining sessions yet. Start mining to earn rewards!</div></td></tr>`;
        return;
    }

    tbody.innerHTML = sessions.map(s => {
        const statusColor = s.status === "CLAIMED"
            ? "var(--success)"
            : s.status === "RUNNING"
            ? "var(--gold)"
            : "var(--text-muted)";
        const statusBadge = `<span style="color:${statusColor}; font-weight:600;">${s.status}</span>`;
        return `<tr>
            <td>${statusBadge}</td>
            <td>${formatDecimal(s.reward_rate)} SKA/hr</td>
            <td style="color:var(--gold);">${formatDecimal(s.reward)} SKA</td>
            <td style="font-size:.75rem;">${formatDate(s.started_at)}</td>
            <td style="font-size:.75rem;">${s.claimed_at ? formatDate(s.claimed_at) : "—"}</td>
        </tr>`;
    }).join("");
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

    const btn  = document.getElementById("btn-send");
    const orig = btn?.innerHTML;
    if (btn) { btn.disabled = true; btn.innerHTML = `<i class="bi bi-arrow-repeat spin"></i> Sending…`; }

    const res = await apiFetch(API.TX_SEND, "POST", { receiver_address: receiver, amount });

    if (res) {
        const data = await res.json();
        if (res.ok) {
            showToast("Transaction Submitted", `TX: ${shortHash(data.tx_hash)} — pending block confirmation.`, "success");
            if (addrEl)   addrEl.value   = "";
            if (amountEl) amountEl.value = "";
            await loadWallet();
            await loadTransactions();
        } else {
            showToast("Transfer Failed", data.error || "An error occurred.", "error");
        }
    }

    if (btn) { btn.disabled = false; btn.innerHTML = orig; }
}

/* ── Transactions ───────────────────────────────────────── */
async function loadTransactions() {
    const res = await apiFetch(API.TX_LIST);
    if (!res || !res.ok) return;
    const data = await res.json();
    renderTransactions(data.transactions || []);
}

function renderTransactions(txs) {
    const tbody = document.getElementById("tx-tbody");
    if (!tbody) return;

    if (!txs.length) {
        tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><i class="bi bi-arrow-left-right"></i> No transactions yet.</div></td></tr>`;
        return;
    }

    tbody.innerHTML = txs.slice(0, 20).map(tx => {
        const statusColor = tx.status === "CONFIRMED" ? "var(--success)" : tx.status === "FAILED" ? "var(--danger)" : "#f39c12";
        const type = tx.tx_type === "COINBASE"
            ? `<span style="background:rgba(212,175,55,.15);color:var(--gold);border:1px solid var(--gold-border);border-radius:6px;padding:2px 8px;font-size:.7rem">Mining</span>`
            : `<span style="background:rgba(52,152,219,.15);color:#3498db;border:1px solid rgba(52,152,219,.3);border-radius:6px;padding:2px 8px;font-size:.7rem">Transfer</span>`;
        return `<tr>
            <td style="font-family:monospace;font-size:.75rem">${shortHash(tx.tx_hash)}</td>
            <td>${type}</td>
            <td style="font-family:monospace;font-size:.72rem">${shortHash(tx.sender_address) || "—"}</td>
            <td style="font-family:monospace;font-size:.72rem">${shortHash(tx.receiver_address)}</td>
            <td>${formatDecimal(tx.amount)} SKA</td>
            <td style="color:${statusColor};font-weight:600;font-size:.78rem">${tx.status}</td>
        </tr>`;
    }).join("");
}

/* ── Rig Info ────────────────────────────────────────────── */
async function loadRigInfo() {
    const res = await apiFetch(API.STATUS);
    if (!res || !res.ok) return;
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
async function logout() {
    await apiFetch(API.LOGOUT, "POST");
    clearToken();
    setTimeout(() => redirectToLogin(), 400);
}

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

/* ── Sidebar ────────────────────────────────────────────── */
function initSidebar() {
    const toggle  = document.getElementById("sidebar-toggle");
    const sidebar = document.getElementById("sidebar");
    const overlay = document.getElementById("sidebar-overlay");
    if (toggle && sidebar && overlay) {
        toggle.addEventListener("click",   () => { sidebar.classList.toggle("open"); overlay.classList.toggle("open"); });
        overlay.addEventListener("click",  () => { sidebar.classList.remove("open"); overlay.classList.remove("open"); });
    }
}

/* ── Init ───────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", async () => {
    if (!getToken()) { redirectToLogin(); return; }

    document.getElementById("btn-start")?.addEventListener("click", startMining);
    document.getElementById("btn-claim")?.addEventListener("click", claimReward);
    document.getElementById("btn-refresh")?.addEventListener("click", refreshAll);
    document.getElementById("btn-refresh-actions")?.addEventListener("click", refreshAll);
    document.getElementById("btn-logout")?.addEventListener("click", logout);
    document.getElementById("sidebar-logout")?.addEventListener("click", logout);
    document.getElementById("btn-send")?.addEventListener("click", sendTransaction);
    document.getElementById("btn-upgrade-rig")?.addEventListener("click", upgradeRig);
    document.getElementById("btn-join-pool")?.addEventListener("click", joinPool);
    document.getElementById("btn-leave-pool")?.addEventListener("click", leavePool);

    initSidebar();
    initCopyAddress();

    await Promise.all([
        loadProfile(),
        loadWallet(),
        loadMiningStatus(false),
        loadTransactions(),
        loadMiningHistory(),
        loadRigInfo(),
        loadPoolStatus(),
    ]);
});