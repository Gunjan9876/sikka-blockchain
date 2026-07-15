"use strict";

const API = {
    PROFILE:  "/api/accounts/profile/",
    LOGOUT:   "/api/accounts/logout/",
    BLOCKS:   "/api/blockchain/",
    STATS:    "/api/blockchain/stats/",
    TX_LIST:  "/api/transactions/",
};

const LOGIN_URL = "/accounts/login/";

/* ── Token ──────────────────────────────────────────────── */
function getToken() { return sessionStorage.getItem("sikka_token"); }
function clearToken() { sessionStorage.removeItem("sikka_token"); }

/* ── API Helper ─────────────────────────────────────────── */
async function apiFetch(url, method = "GET", body = null) {
    const token = getToken();
    if (!token) { window.location.href = LOGIN_URL; return null; }

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
        if (res.status === 401) { clearToken(); window.location.href = LOGIN_URL; return null; }
        return res;
    } catch (_) {
        showToast("Network Error", "Could not reach the server.", "error");
        return null;
    }
}

/* ── Toast ──────────────────────────────────────────────── */
function showToast(title, msg, type = "info") {
    const icons = { success: "bi-check-circle-fill", error: "bi-x-circle-fill", info: "bi-info-circle-fill" };
    const el = document.createElement("div");
    el.className = `sikka-toast toast-${type}`;
    el.innerHTML = `
        <i class="bi ${icons[type]} toast-icon"></i>
        <div class="toast-body">
            <div class="toast-title">${escHtml(title)}</div>
            <div class="toast-msg">${escHtml(msg)}</div>
        </div>
        <button class="toast-close" aria-label="Close"><i class="bi bi-x"></i></button>
    `;
    el.querySelector(".toast-close").addEventListener("click", () => el.remove());
    document.getElementById("toast-container").appendChild(el);
    setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity .3s"; setTimeout(() => el.remove(), 300); }, 4500);
}

function escHtml(str) { const d = document.createElement("div"); d.textContent = str; return d.innerHTML; }
function setText(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }
function shortHash(h) { if (!h || h.length < 16) return h || "—"; return h.slice(0, 12) + "…" + h.slice(-6); }
function formatDate(iso) { if (!iso) return "—"; return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); }
function formatDecimal(v) { const n = parseFloat(v); return isNaN(n) ? "0.00000000" : n.toFixed(8); }

/* ── Profile ────────────────────────────────────────────── */
async function loadProfile() {
    const res = await apiFetch(API.PROFILE);
    if (!res || !res.ok) return;
    const d = await res.json();
    setText("nav-username", d.username || "User");
    const av = document.getElementById("sidebar-avatar");
    if (av) av.textContent = (d.username || "U")[0].toUpperCase();
    setText("sidebar-username", d.username || "");
    setText("sidebar-email", d.email || "");
}

/* ── Chain Stats ────────────────────────────────────────── */
async function loadStats() {
    const res = await apiFetch(API.STATS);
    if (!res || !res.ok) return;
    const d = await res.json();

    setText("stat-block-height", d.chain_height ?? "—");
    setText("stat-tx-total",     d.total_tx     ?? "—");
    setText("stat-tx-pending",   d.pending_tx   ?? "—");
    setText("stat-difficulty",   d.difficulty   ?? "—");
    setText("stat-confirmed",    d.confirmed_tx ?? "—");
    setText("stat-chain-valid",  d.chain_valid ? "✓ Valid" : "✗ Broken");

    const validEl = document.getElementById("stat-chain-valid");
    if (validEl) {
        validEl.style.color = d.chain_valid ? "var(--success)" : "var(--danger)";
    }

    if (d.latest_hash) {
        setText("stat-latest-hash", shortHash(d.latest_hash));
    }
}

/* ── Blocks ─────────────────────────────────────────────── */
async function loadBlocks() {
    const res = await apiFetch(API.BLOCKS);
    if (!res || !res.ok) return;
    const d = await res.json();
    renderBlocks(d.blocks || []);
}

function renderBlocks(blocks) {
    const tbody = document.getElementById("blocks-tbody");
    if (!tbody) return;

    if (!blocks.length) {
        tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><i class="bi bi-box-seam"></i> No blocks yet. Claim a mining reward to produce the first block.</div></td></tr>`;
        return;
    }

    tbody.innerHTML = blocks.map(b => `
        <tr class="explorer-row" data-type="block" data-value="${b.block_index}">
            <td><span class="badge-block">#${b.block_index}</span></td>
            <td style="font-family:monospace;font-size:.75rem">${shortHash(b.hash)}</td>
            <td style="font-family:monospace;font-size:.72rem">${shortHash(b.miner_address)}</td>
            <td>${b.tx_count}</td>
            <td>${formatDecimal(b.reward)} SKA</td>
            <td style="font-size:.75rem;color:var(--text-muted)">${formatDate(b.timestamp)}</td>
        </tr>
    `).join("");

    // click row → show detail panel
    tbody.querySelectorAll(".explorer-row").forEach(row => {
        row.addEventListener("click", () => showBlockDetail(parseInt(row.dataset.value)));
    });
}

/* ── Block Detail Panel ─────────────────────────────────── */
async function showBlockDetail(blockIndex) {
    const res = await apiFetch(`${API.BLOCKS}${blockIndex}/`);
    if (!res || !res.ok) return;
    const b = await res.json();

    document.getElementById("detail-title").textContent   = `Block #${b.block_index}`;
    document.getElementById("detail-hash").textContent    = b.hash;
    document.getElementById("detail-prev").textContent    = b.previous_hash;
    document.getElementById("detail-merkle").textContent  = b.merkle_root;
    document.getElementById("detail-nonce").textContent   = b.nonce;
    document.getElementById("detail-diff").textContent    = b.difficulty;
    document.getElementById("detail-miner").textContent   = b.miner_address;
    document.getElementById("detail-reward").textContent  = formatDecimal(b.reward) + " SKA";
    document.getElementById("detail-txcount").textContent = b.tx_count;
    document.getElementById("detail-time").textContent    = formatDate(b.timestamp);

    document.getElementById("detail-panel").style.display = "block";
    document.getElementById("detail-panel").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/* ── Transactions ───────────────────────────────────────── */
async function loadTransactions() {
    const res = await apiFetch(API.TX_LIST);
    if (!res || !res.ok) return;
    const d = await res.json();
    renderTransactions(d.transactions || []);
}

function renderTransactions(txs) {
    const tbody = document.getElementById("transactions-tbody");
    if (!tbody) return;

    if (!txs.length) {
        tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><i class="bi bi-arrow-left-right"></i> No transactions yet.</div></td></tr>`;
        return;
    }

    tbody.innerHTML = txs.map(tx => {
        const statusColor = tx.status === "CONFIRMED" ? "var(--success)" : tx.status === "FAILED" ? "var(--danger)" : "#f39c12";
        const typeBadge = tx.tx_type === "COINBASE"
            ? `<span style="background:rgba(212,175,55,.15);color:var(--gold);border:1px solid var(--gold-border);border-radius:6px;padding:2px 8px;font-size:.7rem">Mining</span>`
            : `<span style="background:rgba(52,152,219,.15);color:#3498db;border:1px solid rgba(52,152,219,.3);border-radius:6px;padding:2px 8px;font-size:.7rem">Transfer</span>`;
        return `
        <tr>
            <td style="font-family:monospace;font-size:.74rem">${shortHash(tx.tx_hash)}</td>
            <td>${typeBadge}</td>
            <td style="font-family:monospace;font-size:.72rem">${tx.sender_address ? shortHash(tx.sender_address) : "<em style='color:var(--text-muted)'>coinbase</em>"}</td>
            <td style="font-family:monospace;font-size:.72rem">${shortHash(tx.receiver_address)}</td>
            <td>${formatDecimal(tx.amount)} SKA</td>
            <td style="color:${statusColor};font-weight:600;font-size:.78rem">${tx.status}</td>
        </tr>`;
    }).join("");
}

/* ── Search ─────────────────────────────────────────────── */
async function runSearch() {
    const query = document.getElementById("explorer-search")?.value.trim();
    if (!query) return;

    // block index (pure number)
    if (/^\d+$/.test(query)) {
        await showBlockDetail(parseInt(query));
        return;
    }

    // block hash (64 hex chars)
    if (/^[0-9a-fA-F]{64}$/.test(query)) {
        showToast("Hash search", "Block hash search: checking blocks table…", "info");
        const res = await apiFetch(API.BLOCKS);
        if (!res || !res.ok) return;
        const d = await res.json();
        const match = (d.blocks || []).find(b => b.hash.toLowerCase() === query.toLowerCase());
        if (match) { await showBlockDetail(match.block_index); return; }
        showToast("Not found", "No block found with that hash.", "error");
        return;
    }

    // tx hash or wallet address — search transactions
    const res = await apiFetch(API.TX_LIST);
    if (!res || !res.ok) return;
    const d = await res.json();
    const txs = (d.transactions || []).filter(tx =>
        tx.tx_hash.toLowerCase().includes(query.toLowerCase()) ||
        tx.sender_address?.toLowerCase().includes(query.toLowerCase()) ||
        tx.receiver_address?.toLowerCase().includes(query.toLowerCase())
    );

    if (!txs.length) {
        showToast("Not found", "No transactions found matching that query.", "error");
        return;
    }

    renderTransactions(txs);
    document.getElementById("section-transactions").scrollIntoView({ behavior: "smooth" });
    showToast("Results", `Found ${txs.length} transaction(s).`, "success");
}

/* ── Logout ─────────────────────────────────────────────── */
async function logout() {
    await apiFetch(API.LOGOUT, "POST");
    clearToken();
    setTimeout(() => { window.location.href = LOGIN_URL; }, 400);
}

/* ── Sidebar ────────────────────────────────────────────── */
function initSidebar() {
    const toggle  = document.getElementById("sidebar-toggle");
    const sidebar = document.getElementById("sidebar");
    const overlay = document.getElementById("sidebar-overlay");
    if (toggle && sidebar && overlay) {
        toggle.addEventListener("click", () => { sidebar.classList.toggle("open"); overlay.classList.toggle("open"); });
        overlay.addEventListener("click", () => { sidebar.classList.remove("open"); overlay.classList.remove("open"); });
    }
}

/* ── Refresh ────────────────────────────────────────────── */
async function refreshAll() {
    await Promise.all([loadStats(), loadBlocks(), loadTransactions()]);
    showToast("Refreshed", "Explorer data updated.", "info");
}

/* ── Init ───────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", async () => {
    if (!getToken()) { window.location.href = LOGIN_URL; return; }

    document.getElementById("btn-logout")?.addEventListener("click", logout);
    document.getElementById("sidebar-logout")?.addEventListener("click", logout);
    document.getElementById("btn-explorer-search")?.addEventListener("click", runSearch);
    document.getElementById("explorer-search")?.addEventListener("keydown", e => { if (e.key === "Enter") runSearch(); });
    document.getElementById("btn-refresh-explorer")?.addEventListener("click", refreshAll);
    document.getElementById("btn-close-detail")?.addEventListener("click", () => {
        document.getElementById("detail-panel").style.display = "none";
    });

    initSidebar();

    await Promise.all([loadProfile(), loadStats(), loadBlocks(), loadTransactions()]);
});