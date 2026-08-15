"use strict";

/* ── API Endpoints ──────────────────────────────────────────────────────── */
const API = {
    PROFILE:      "/api/v1/accounts/profile/",
    WALLET:       "/api/v1/wallet/",
    TX_LIST:      "/api/v1/transactions/",
    TX_SEND:      "/api/v1/transactions/send/",
    FEE_ESTIMATE: "/api/v1/transactions/fee-estimate/",
    LOGOUT:       "/api/v1/accounts/logout/",
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

/* ── API Fetch with auto-refresh ────────────────────────────────────────── */
async function apiFetch(url, method = "GET", body = null) {
    const token = getToken();
    if (!token) { redirectToLogin(); return null; }
    const opts = { method, headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" } };
    if (body) opts.body = JSON.stringify(body);
    let res;
    try { res = await fetch(url, opts); } catch { showToast("Network Error", "Could not reach the server.", "error"); return null; }
    if (res.status === 401) {
        const newToken = await refreshAccessToken();
        if (!newToken) return null;
        opts.headers["Authorization"] = `Bearer ${newToken}`;
        try { res = await fetch(url, opts); } catch { showToast("Network Error", "Could not reach the server.", "error"); return null; }
    }
    return res;
}

/* ── Toast ──────────────────────────────────────────────────────────────── */
const toastContainer = document.getElementById("toast-container");
function escHtml(s) {
    return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
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
    setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity .3s"; setTimeout(() => el.remove(), 300); }, 4500);
}

/* ── Formatters ─────────────────────────────────────────────────────────── */
function fmt(n) { return parseFloat(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 8 }); }
function shortHash(h) {
    if (!h || h.length < 12) return h;
    return h.slice(0, 8) + "…" + h.slice(-6);
}
function fmtDate(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleString("en-IN", {
        day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
}
function statusBadge(s) {
    const map = { pending: ["badge-pending", "Pending"], confirmed: ["badge-active", "Confirmed"], failed: ["badge-suspended", "Failed"] };
    const [cls, label] = map[s] || ["badge-idle", s || "—"];
    return `<span class="card-badge ${cls}">${label}</span>`;
}

/* ── State ──────────────────────────────────────────────────────────────── */
let walletAddress = "";
let currentPage = 1;
let pageSize = 10;
let pubKeyExpanded = false;
let currentFilter = "all";
let currentSort = "newest";
let currentSearch = "";
let rawTransactions = []; // Fetched current page transactions
let allTransactionsForAnalytics = []; // For charts and insights
let chartGrowth = null;
let chartDaily = null;

/* ── Load Profile ───────────────────────────────────────────────────────── */
async function loadProfile() {
    const res = await apiFetch(API.PROFILE);
    if (!res || !res.ok) return;
    const d = await res.json();
    document.getElementById("sidebar-username").textContent = d.username || "User";
    document.getElementById("sidebar-email").textContent    = d.email || "";
    document.getElementById("nav-username").textContent     = d.username || "User";
    document.getElementById("sidebar-avatar").textContent   = (d.username || "U")[0].toUpperCase();
    
    // Security Badges based on Profile
    if (d.email_verified) {
        const bdg = document.createElement("span");
        bdg.className = "card-badge badge-active";
        bdg.innerHTML = `<i class="bi bi-shield-check"></i> Email`;
        document.getElementById("wallet-security-badges").appendChild(bdg);
    }
    if (d.two_factor_enabled) {
        const bdg = document.createElement("span");
        bdg.className = "card-badge badge-active";
        bdg.innerHTML = `<i class="bi bi-shield-lock-fill"></i> 2FA`;
        document.getElementById("wallet-security-badges").appendChild(bdg);
    }
}

/* ── Load Wallet ────────────────────────────────────────────────────────── */
async function loadWallet() {
    const res = await apiFetch(API.WALLET);
    if (!res || !res.ok) { showToast("Wallet Error", "Could not load wallet data.", "error"); return; }
    const w = await res.json();
    walletAddress = w.wallet_address || "";

    // Old Stat boxes (if any remaining in UI) or custom
    const setTxt = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
    
    // New Summary Cards
    document.getElementById("summary-balance").textContent = fmt(w.balance) + " SKA";
    document.getElementById("summary-lifetime").textContent = fmt(w.total_mined) + " SKA";
    
    // Address / Security
    setTxt("wallet-address", walletAddress || "—");
    setTxt("wallet-pubkey", w.public_key || "—");
    setTxt("wallet-created", `Created: ${fmtDate(w.created_at)}`);
    
    const badge = document.getElementById("wallet-status-badge");
    if(badge) {
        const stMap = { active: ["badge-active", "Active"], suspended: ["badge-suspended", "Suspended"] };
        const [cls, label] = stMap[w.wallet_status] || ["badge-idle", w.wallet_status || "—"];
        badge.className = `card-badge ${cls}`;
        badge.innerHTML = `<i class="bi bi-check-circle-fill"></i> ${label}`;
    }
    const sync = document.getElementById("wallet-sync-badge");
    if(sync) {
        sync.className = `card-badge badge-active`;
        sync.innerHTML = `<i class="bi bi-hdd-network"></i> Synced`;
    }

    // Fetch transactions
    await fetchAllForAnalytics();
    loadTransactions(currentPage);
}

/* ── Fetch all transactions for Analytics (Simulation) ──────────────────── */
async function fetchAllForAnalytics() {
    // To not overload the backend, we fetch up to 100 recent txs to calculate metrics and charts.
    const url = walletAddress ? `${API.TX_LIST}?page=1&page_size=100&wallet=${encodeURIComponent(walletAddress)}` : `${API.TX_LIST}?page=1&page_size=100`;
    const res = await apiFetch(url);
    if (res && res.ok) {
        const d = await res.json();
        allTransactionsForAnalytics = d.transactions || [];
        calculateAnalytics(allTransactionsForAnalytics);
    }
}

function calculateAnalytics(txs) {
    if(!txs.length) return;

    let todayMined = 0;
    let pendingRewards = 0;
    let highestReward = 0;
    let blocksMined = 0;
    let totalMinedAmt = 0;
    
    const todayStr = new Date().toISOString().split("T")[0];
    
    const dailyMap = {};
    const growthData = [];
    let runningBal = 0; // We will approximate running balance backwards
    
    // Sort oldest to newest for charts
    const sorted = [...txs].sort((a,b) => new Date(a.created_at) - new Date(b.created_at));
    
    sorted.forEach(tx => {
        const amt = parseFloat(tx.amount);
        const dateStr = tx.created_at.split("T")[0];
        
        // Is mining?
        const isMine = (tx.tx_type === 'mining' || tx.sender_address === "0000000000000000000000000000000000000000000000000000000000000000");
        const isIncoming = tx.receiver_address === walletAddress;
        
        if (isMine && isIncoming) {
            blocksMined++;
            totalMinedAmt += amt;
            if(amt > highestReward) highestReward = amt;
            if(dateStr === todayStr) todayMined += amt;
            if(tx.status === 'pending') pendingRewards += amt;
        }

        // Daily Earnings Map
        if (isIncoming) {
            dailyMap[dateStr] = (dailyMap[dateStr] || 0) + amt;
            runningBal += amt;
        } else {
            runningBal -= (amt + parseFloat(tx.fee));
        }
        
        growthData.push({ x: dateStr, y: runningBal > 0 ? runningBal : 0 });
    });

    // Populate Insights UI
    document.getElementById("summary-today").textContent = fmt(todayMined) + " SKA";
    document.getElementById("summary-pending").textContent = fmt(pendingRewards) + " SKA";
    
    document.getElementById("insight-highest").textContent = fmt(highestReward);
    document.getElementById("insight-blocks").textContent = blocksMined;
    document.getElementById("insight-avg-reward").textContent = blocksMined ? fmt(totalMinedAmt/blocksMined) : "0.00";
    
    // Find best day
    let bestDay = "—", maxDayAmt = 0, sumDaily = 0, activeDays = 0;
    for(const [d, v] of Object.entries(dailyMap)) {
        sumDaily += v; activeDays++;
        if(v > maxDayAmt) { maxDayAmt = v; bestDay = d; }
    }
    
    document.getElementById("insight-best-day").textContent = bestDay !== "—" ? new Date(bestDay).toLocaleDateString("en-IN", {month:'short', day:'numeric'}) : "—";
    document.getElementById("insight-avg-daily").textContent = activeDays ? fmt(sumDaily/activeDays) : "0.00";
    document.getElementById("insight-streak").textContent = activeDays > 0 ? activeDays + " Days" : "0 Days";
    document.getElementById("insight-efficiency").textContent = blocksMined > 0 ? "98.5%" : "—"; // Mocked metric

    // Render Charts
    renderCharts(dailyMap, growthData);
    
    // Render Timeline (reverse sort, newest first)
    renderTimeline([...sorted].reverse().slice(0, 10));
}

function renderCharts(dailyMap, growthData) {
    if(!window.Chart) return;

    Chart.defaults.color = "#a0a0a0";
    Chart.defaults.font.family = "'Poppins', sans-serif";

    // Growth Chart
    const ctx1 = document.getElementById("growthChart");
    if(ctx1) {
        if(chartGrowth) chartGrowth.destroy();
        
        // Deduplicate growth dates, take last snapshot of day
        const dedup = {};
        growthData.forEach(d => dedup[d.x] = d.y);
        const lbls1 = Object.keys(dedup);
        const vals1 = Object.values(dedup);

        chartGrowth = new Chart(ctx1, {
            type: 'line',
            data: {
                labels: lbls1,
                datasets: [{
                    label: 'Balance (SKA)',
                    data: vals1,
                    borderColor: '#d4af37',
                    backgroundColor: 'rgba(212, 175, 55, 0.1)',
                    fill: true,
                    tension: 0.4,
                    pointRadius: 2,
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: {display: false} },
                scales: { 
                    x: { grid: {color: 'rgba(255,255,255,0.05)'} },
                    y: { grid: {color: 'rgba(255,255,255,0.05)'} }
                }
            }
        });
    }

    // Daily Chart
    const ctx2 = document.getElementById("dailyChart");
    if(ctx2) {
        if(chartDaily) chartDaily.destroy();
        const lbls2 = Object.keys(dailyMap).slice(-14); // Last 14 active days
        const vals2 = lbls2.map(k => dailyMap[k]);
        
        chartDaily = new Chart(ctx2, {
            type: 'bar',
            data: {
                labels: lbls2,
                datasets: [{
                    label: 'Earnings',
                    data: vals2,
                    backgroundColor: '#4ade80',
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: {display: false} },
                scales: { 
                    x: { grid: {display: false} },
                    y: { grid: {color: 'rgba(255,255,255,0.05)'} }
                }
            }
        });
    }
}

function renderTimeline(txs) {
    const cont = document.getElementById("recent-activity-timeline");
    if(!cont) return;
    
    if(!txs.length) {
        cont.innerHTML = `<div class="text-muted" style="font-size:0.8rem;">No recent activity.</div>`;
        return;
    }

    cont.innerHTML = txs.map(tx => {
        const isMine = (tx.tx_type === 'mining' || tx.sender_address === "0000000000000000000000000000000000000000000000000000000000000000");
        const isIncoming = tx.receiver_address === walletAddress;
        
        let typeStr = "Sent", cls = "out", icon = "bi-arrow-up-right";
        if(isMine) { typeStr = "Mined Block"; cls = "mine"; icon = "bi-cpu-fill"; }
        else if(isIncoming) { typeStr = "Received"; cls = "in"; icon = "bi-arrow-down-left"; }

        return `
        <div class="timeline-item" onclick="openTxDetail('${tx.tx_hash}')">
            <div class="timeline-icon ${cls}"><i class="bi ${icon}"></i></div>
            <div class="timeline-content fade-in">
                <div class="d-flex justify-content-between">
                    <span class="timeline-title">${typeStr}</span>
                    <span class="timeline-amt ${cls}">${isIncoming ? '+' : '-'}${fmt(tx.amount)} SKA</span>
                </div>
                <div class="timeline-meta">
                    <span>${statusBadge(tx.status).replace('card-badge', 'badge')}</span>
                    <span>${new Date(tx.created_at).toLocaleTimeString("en-IN", {hour:'2-digit', minute:'2-digit'})}</span>
                </div>
            </div>
        </div>`;
    }).join("");
}

/* ── UI Actions ─────────────────────────────────────────────────────────── */
document.getElementById("btn-copy-address")?.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(walletAddress); showToast("Copied!", "Wallet address copied.", "success"); }
    catch { showToast("Error", "Manual copy required.", "error"); }
});

document.getElementById("btn-show-qr")?.addEventListener("click", () => {
    document.getElementById("qr-address-text").textContent = walletAddress;
    const img = document.getElementById("qr-image");
    img.src = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${walletAddress}&color=000000&bgcolor=ffffff`;
    img.style.display = "block";
    document.getElementById("qr-loading").style.display = "none";
    document.getElementById("btn-qr-download").href = img.src; // Simple download link
    document.getElementById("qr-modal").classList.add("visible");
});
document.getElementById("btn-qr-copy")?.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(walletAddress); showToast("Copied!", "Wallet address copied.", "success"); } catch{}
});
document.getElementById("btn-quick-receive")?.addEventListener("click", () => {
    document.getElementById("btn-show-qr").click();
});
document.getElementById("btn-toggle-pubkey")?.addEventListener("click", () => {
    const el  = document.getElementById("wallet-pubkey");
    const btn = document.getElementById("btn-toggle-pubkey");
    pubKeyExpanded = !pubKeyExpanded;
    el.style.maxHeight  = pubKeyExpanded ? "none" : "40px";
    btn.innerHTML = pubKeyExpanded ? `Hide key <i class="bi bi-chevron-up"></i>` : `Show full key <i class="bi bi-chevron-down"></i>`;
});

/* ── Send Logic ─────────────────────────────────────────────────────────── */
let feeTimer = null;
document.getElementById("send-amount")?.addEventListener("input", () => {
    clearTimeout(feeTimer);
    const amt = parseFloat(document.getElementById("send-amount").value);
    if (!amt || amt <= 0) { document.getElementById("fee-estimate-row").style.display = "none"; return; }
    feeTimer = setTimeout(async () => {
        const res = await apiFetch(`${API.FEE_ESTIMATE}?amount=${amt}`);
        if(res && res.ok) {
            const d = await res.json();
            document.getElementById("fee-estimate-val").textContent = parseFloat(d.fee||0).toFixed(8);
            document.getElementById("fee-total-val").textContent    = (amt + parseFloat(d.fee||0)).toFixed(8);
            document.getElementById("fee-estimate-row").style.display = "block";
        }
    }, 500);
});

document.getElementById("btn-send")?.addEventListener("click", () => {
    const addr = document.getElementById("send-address").value.trim();
    const amount = document.getElementById("send-amount").value.trim();
    if (!addr || !amount || parseFloat(amount) <= 0) { showToast("Error", "Valid address & amount required.", "error"); return; }
    if (addr === walletAddress) { showToast("Invalid", "Cannot send to yourself.", "error"); return; }
    
    document.getElementById("confirm-amt-val").textContent = `${amount} SKA`;
    document.getElementById("confirm-to-val").textContent = addr;
    document.getElementById("confirm-fee-val").textContent = document.getElementById("fee-estimate-val").textContent + " SKA";
    document.getElementById("confirm-total-val").textContent = document.getElementById("fee-total-val").textContent + " SKA";
    document.getElementById("confirm-modal").classList.add("visible");
});
document.getElementById("btn-confirm-cancel")?.addEventListener("click", () => document.getElementById("confirm-modal").classList.remove("visible"));

document.getElementById("btn-confirm-send")?.addEventListener("click", async () => {
    const btn = document.getElementById("btn-confirm-send");
    btn.disabled = true; btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span> Sending…`;
    const res = await apiFetch(API.TX_SEND, "POST", {
        receiver_address: document.getElementById("send-address").value.trim(),
        amount: parseFloat(document.getElementById("send-amount").value.trim()),
    });
    btn.disabled = false; btn.innerHTML = `<i class="bi bi-send-check"></i> Confirm & Send`;
    document.getElementById("confirm-modal").classList.remove("visible");
    if(res) {
        const data = await res.json();
        if(res.ok) {
            showToast("Success", `Sent! TX: ${shortHash(data.tx_hash)}`, "success");
            document.getElementById("send-address").value = ""; document.getElementById("send-amount").value = "";
            document.getElementById("fee-estimate-row").style.display = "none";
            loadWallet(); // Refresh all
        } else {
            showToast("Failed", data.error || "Transaction error.", "error");
        }
    }
});

/* ── Table & Filters ────────────────────────────────────────────────────── */
document.getElementById("tx-page-size")?.addEventListener("change", (e) => {
    pageSize = parseInt(e.target.value);
    loadTransactions(1);
});
document.getElementById("tx-sort")?.addEventListener("change", (e) => {
    currentSort = e.target.value;
    renderTransactionTable();
});
document.getElementById("tx-search")?.addEventListener("input", (e) => {
    currentSearch = e.target.value.toLowerCase().trim();
    renderTransactionTable();
});
document.querySelectorAll(".filter-tab").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".filter-tab").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        currentFilter = btn.dataset.filter;
        renderTransactionTable();
    });
});

async function loadTransactions(page = 1) {
    currentPage = page;
    const tbody = document.getElementById("tx-tbody");
    if (tbody) tbody.innerHTML = `<tr><td colspan="7"><div class="premium-empty-state"><div class="spinner-border text-gold"></div></div></td></tr>`;
    
    const url = walletAddress
        ? `${API.TX_LIST}?page=${page}&page_size=${pageSize}&wallet=${encodeURIComponent(walletAddress)}`
        : `${API.TX_LIST}?page=${page}&page_size=${pageSize}`;
    const res = await apiFetch(url);
    if (!res || !res.ok) { tbody.innerHTML = `<tr><td colspan="7"><div class="premium-empty-state"><i class="bi bi-exclamation-triangle"></i><p>Failed to load.</p></div></td></tr>`; return; }
    
    const data = await res.json();
    rawTransactions = data.transactions || [];
    
    const metaEl = document.getElementById("tx-meta");
    if (metaEl && data.total !== undefined) metaEl.textContent = `${data.total} transaction${data.total !== 1 ? "s" : ""}`;
    
    renderTransactionTable();
    renderPagination({ total_pages: data.total_pages, page: data.page, has_next: data.has_next, has_prev: data.has_prev });
}

function renderTransactionTable() {
    const tbody = document.getElementById("tx-tbody");
    if(!tbody) return;

    let filtered = [...rawTransactions];
    
    // Apply Filter
    if (currentFilter === "mining") {
        filtered = filtered.filter(tx => tx.tx_type === 'mining' || tx.sender_address === "0000000000000000000000000000000000000000000000000000000000000000");
    } else if (currentFilter === "incoming") {
        filtered = filtered.filter(tx => tx.receiver_address === walletAddress && tx.tx_type !== 'mining');
    } else if (currentFilter === "outgoing") {
        filtered = filtered.filter(tx => tx.sender_address === walletAddress);
    } else if (currentFilter === "pending") {
        filtered = filtered.filter(tx => tx.status === "pending");
    } else if (currentFilter === "completed") {
        filtered = filtered.filter(tx => tx.status === "confirmed");
    }

    // Apply Search
    if(currentSearch) {
        filtered = filtered.filter(tx => 
            (tx.tx_hash||"").toLowerCase().includes(currentSearch) ||
            (tx.sender_address||"").toLowerCase().includes(currentSearch) ||
            (tx.receiver_address||"").toLowerCase().includes(currentSearch)
        );
    }

    // Apply Sort
    filtered.sort((a,b) => {
        if(currentSort === "newest") return new Date(b.created_at) - new Date(a.created_at);
        if(currentSort === "oldest") return new Date(a.created_at) - new Date(b.created_at);
        if(currentSort === "highest") return parseFloat(b.amount) - parseFloat(a.amount);
        if(currentSort === "lowest") return parseFloat(a.amount) - parseFloat(b.amount);
        return 0;
    });

    if (!filtered.length) {
        tbody.innerHTML = `<tr><td colspan="7"><div class="premium-empty-state"><i class="bi bi-search"></i><p>No transactions match filters.</p></div></td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(tx => {
        const isMine = (tx.tx_type === 'mining' || tx.sender_address === "0000000000000000000000000000000000000000000000000000000000000000");
        const isIncoming = tx.receiver_address === walletAddress;
        
        let typeIcon = `<span style="color:#f87171;"><i class="bi bi-arrow-up-right"></i> Sent</span>`;
        if(isMine) typeIcon = `<span style="color:#a78bfa;"><i class="bi bi-cpu"></i> Mined</span>`;
        else if(isIncoming) typeIcon = `<span style="color:#4ade80;"><i class="bi bi-arrow-down-left"></i> Received</span>`;

        return `<tr class="clickable fade-in" onclick="openTxDetail('${tx.tx_hash}')">
            <td><code title="${tx.tx_hash || ""}">${shortHash(tx.tx_hash)}</code></td>
            <td>${typeIcon}</td>
            <td><code style="font-size:.7rem;">${isMine ? 'Network' : shortHash(tx.sender_address)}</code></td>
            <td><code style="font-size:.7rem;">${shortHash(tx.receiver_address)}</code></td>
            <td><strong style="color: ${isIncoming ? '#4ade80' : '#f87171'};">${isIncoming?'+':'-'}${fmt(tx.amount)}</strong></td>
            <td>${statusBadge(tx.status)}</td>
            <td style="font-size:.72rem; color:var(--text-muted);">${fmtDate(tx.created_at)}</td>
        </tr>`;
    }).join("");
}

function renderPagination(meta) {
    const container = document.getElementById("tx-pagination");
    if (!container || !meta.total_pages || meta.total_pages <= 1) { if(container) container.innerHTML = ""; return; }
    let html = "";
    if (meta.has_prev) html += `<button class="btn-outline-gold px-2 py-1 mx-1" style="font-size:.8rem;" onclick="loadTransactions(${meta.page - 1})"><i class="bi bi-chevron-left"></i></button>`;
    html += `<span style="color:var(--text-muted); font-size:.8rem; margin:0 10px; align-self:center;">Page ${meta.page} of ${meta.total_pages}</span>`;
    if (meta.has_next) html += `<button class="btn-outline-gold px-2 py-1 mx-1" style="font-size:.8rem;" onclick="loadTransactions(${meta.page + 1})"><i class="bi bi-chevron-right"></i></button>`;
    container.innerHTML = html;
}

/* ── Transaction Details Modal ──────────────────────────────────────────── */
window.openTxDetail = function(txHash) {
    // Check current page first, then analytics list
    let tx = rawTransactions.find(t => t.tx_hash === txHash) || allTransactionsForAnalytics.find(t => t.tx_hash === txHash);
    if (!tx) return;
    
    const isMine = (tx.tx_type === 'mining' || tx.sender_address === "0000000000000000000000000000000000000000000000000000000000000000");
    const isIncoming = tx.receiver_address === walletAddress;
    
    const dirEl = document.getElementById("mdl-tx-direction");
    const amtEl = document.getElementById("mdl-tx-amount");
    
    if(isMine) {
        dirEl.innerHTML = `<span style="color:#a78bfa;"><i class="bi bi-cpu"></i> Mining Reward</span>`;
        amtEl.style.color = "#a78bfa";
        amtEl.textContent = "+" + fmt(tx.amount) + " SKA";
    } else if (isIncoming) {
        dirEl.innerHTML = `<span style="color:#4ade80;"><i class="bi bi-arrow-down-left"></i> Incoming Transfer</span>`;
        amtEl.style.color = "#4ade80";
        amtEl.textContent = "+" + fmt(tx.amount) + " SKA";
    } else {
        dirEl.innerHTML = `<span style="color:#f87171;"><i class="bi bi-arrow-up-right"></i> Outgoing Transfer</span>`;
        amtEl.style.color = "#f87171";
        amtEl.textContent = "-" + fmt(tx.amount) + " SKA";
    }

    document.getElementById("mdl-tx-status").innerHTML = statusBadge(tx.status);
    document.getElementById("mdl-tx-fee").textContent = fmt(tx.fee) + " SKA";
    document.getElementById("mdl-tx-hash").textContent = tx.tx_hash || "—";
    
    // Copy Hash Button
    document.getElementById("btn-copy-hash").onclick = async () => {
        try { await navigator.clipboard.writeText(tx.tx_hash); showToast("Copied", "Hash copied", "success"); } catch{}
    };

    document.getElementById("mdl-tx-block").textContent = tx.block_index !== null ? `#${tx.block_index}` : "Pending";
    document.getElementById("mdl-tx-confirmations").textContent = tx.status === 'confirmed' ? "12+ Blocks (Secure)" : "0 Blocks (Unconfirmed)";
    document.getElementById("mdl-tx-sender").textContent = isMine ? "Network Reward" : (tx.sender_address || "—");
    document.getElementById("mdl-tx-receiver").textContent = tx.receiver_address || "—";
    document.getElementById("mdl-tx-time").textContent = fmtDate(tx.created_at);
    
    document.getElementById("tx-detail-modal").classList.add("visible");
};

/* ── Export Functions ───────────────────────────────────────────────────── */
document.getElementById("btn-export-csv")?.addEventListener("click", () => {
    if(!rawTransactions.length) { showToast("Empty", "No transactions to export", "info"); return; }
    
    const headers = ["Hash", "Date", "Type", "Sender", "Receiver", "Amount", "Fee", "Status"];
    const rows = rawTransactions.map(tx => {
        const isMine = (tx.tx_type === 'mining' || tx.sender_address === "0000000000000000000000000000000000000000000000000000000000000000");
        const type = isMine ? 'Mining' : (tx.receiver_address === walletAddress ? 'Incoming' : 'Outgoing');
        return [
            tx.tx_hash,
            tx.created_at,
            type,
            tx.sender_address,
            tx.receiver_address,
            tx.amount,
            tx.fee,
            tx.status
        ];
    });
    
    let csvContent = "data:text/csv;charset=utf-8," + headers.join(",") + "\n" + rows.map(e => e.join(",")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "sikka_transactions.csv");
    document.body.appendChild(link);
    link.click();
    link.remove();
});

document.getElementById("btn-export-pdf")?.addEventListener("click", () => {
    if(!window.jspdf || !allTransactionsForAnalytics.length) { 
        showToast("Error", "PDF library not loaded or no data available.", "error"); return; 
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.setTextColor(212, 175, 55); // Gold
    doc.text("SIKKA Wallet Statement", 14, 22);
    
    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.setFont("helvetica", "normal");
    doc.text(`Wallet: ${walletAddress}`, 14, 30);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 35);
    
    const body = allTransactionsForAnalytics.slice(0, 50).map(tx => {
        const isMine = (tx.tx_type === 'mining' || tx.sender_address === "0000000000000000000000000000000000000000000000000000000000000000");
        const type = isMine ? 'Mine' : (tx.receiver_address === walletAddress ? 'In' : 'Out');
        return [
            shortHash(tx.tx_hash),
            new Date(tx.created_at).toLocaleDateString(),
            type,
            fmt(tx.amount),
            tx.status
        ];
    });

    doc.autoTable({
        startY: 45,
        head: [['Hash', 'Date', 'Type', 'Amount (SKA)', 'Status']],
        body: body,
        theme: 'grid',
        headStyles: { fillColor: [20, 20, 20], textColor: [212, 175, 55] },
        styles: { fontSize: 8, cellPadding: 3 },
    });
    
    doc.save("sikka_wallet_statement.pdf");
});

/* ── Modals Close Helpers ───────────────────────────────────────────────── */
document.querySelectorAll(".sikka-modal-close, .sikka-modal-overlay").forEach(el => {
    el.addEventListener("click", (e) => {
        if (e.target === el || el.classList.contains('sikka-modal-close')) {
            const overlay = el.classList.contains('sikka-modal-overlay') ? el : el.closest(".sikka-modal-overlay");
            if (overlay) overlay.classList.remove("visible");
        }
    });
});

/* ── Logout & Sidebar ───────────────────────────────────────────────────── */
async function doLogout() {
    await apiFetch(API.LOGOUT, "POST", { refresh: getRefresh() });
    clearToken(); redirectToLogin();
}
document.getElementById("btn-logout")?.addEventListener("click", doLogout);
document.getElementById("sidebar-logout")?.addEventListener("click", (e) => { e.preventDefault(); doLogout(); });

const sidebar = document.getElementById("sidebar");
const sidebarOverlay = document.getElementById("sidebar-overlay");
document.getElementById("sidebar-toggle")?.addEventListener("click", () => {
    sidebar.classList.toggle("open"); sidebarOverlay.classList.toggle("open");
});
sidebarOverlay?.addEventListener("click", () => {
    sidebar.classList.remove("open"); sidebarOverlay.classList.remove("open");
});

/* ── Boot ───────────────────────────────────────────────────────────────── */
if (!getToken()) {
    redirectToLogin();
} else {
    loadProfile();
    loadWallet(); // Chains analytics and table load
}