"use strict";

const API = {
    PROFILE:  "/api/v1/accounts/profile/",
    WALLET:   "/api/v1/wallet/",
    LOGOUT:   "/api/v1/accounts/logout/",
    BLOCKS:   "/api/v1/blockchain/",
    STATS:    "/api/v1/blockchain/stats/",
    TX_LIST:  "/api/v1/transactions/",
};

const LOGIN_URL = "/accounts/login/";

/* ── Token ──────────────────────────────────────────────── */
function getToken()   { return sessionStorage.getItem("sikka_access"); }
function clearToken() { sessionStorage.removeItem("sikka_access"); sessionStorage.removeItem("sikka_refresh"); }

async function refreshAccessToken() {
    const refresh = sessionStorage.getItem("sikka_refresh");
    if (!refresh) { window.location.href = LOGIN_URL; return null; }
    const res = await fetch("/api/v1/auth/token/refresh/", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refresh }),
    });
    if (!res.ok) { clearToken(); window.location.href = LOGIN_URL; return null; }
    const data = await res.json();
    sessionStorage.setItem("sikka_access", data.access);
    return data.access;
}

async function apiFetch(url, method = "GET", body = null) {
    const token = getToken();
    if (!token) { window.location.href = LOGIN_URL; return null; }

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
    } catch (_) {
        showToast("Network Error", "Could not reach the server.", "error");
        return null;
    }
}

/* ── Utilities ──────────────────────────────────────────── */
function showToast(title, msg, type = "info") {
    const icons = { success: "bi-check-circle-fill", error: "bi-x-circle-fill", info: "bi-info-circle-fill" };
    const el = document.createElement("div");
    el.className = `sikka-toast toast-${type}`;
    el.innerHTML = `<i class="bi ${icons[type]} toast-icon"></i><div class="toast-body"><div class="toast-title">${escHtml(title)}</div><div class="toast-msg">${escHtml(msg)}</div></div><button class="toast-close"><i class="bi bi-x"></i></button>`;
    el.querySelector(".toast-close").addEventListener("click", () => el.remove());
    document.getElementById("toast-container").appendChild(el);
    setTimeout(() => { el.style.opacity = "0"; setTimeout(() => el.remove(), 300); }, 4500);
}
function escHtml(str) { const d = document.createElement("div"); d.textContent = str; return d.innerHTML; }
function setText(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }
function setHtml(id, html) { const el = document.getElementById(id); if (el) el.innerHTML = html; }
function shortHash(h) { if (!h || h.length < 16) return h || "—"; return h.slice(0, 12) + "…" + h.slice(-6); }
function formatDate(iso) { if (!iso) return "—"; return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); }
function formatDecimal(v) { const n = parseFloat(v); return isNaN(n) ? "0.00000000" : n.toFixed(8); }

/* ── Globals ────────────────────────────────────────────── */
let currentUserAddress = null;
let currentChainHeight = 0;
let blockPage = 1;
let txPage = 1;

/* ── Initialization ─────────────────────────────────────── */
async function loadProfile() {
    const res = await apiFetch(API.PROFILE);
    if (!res || !res.ok) return;
    const d = await res.json();
    setText("nav-username", d.username || "User");
}

async function fetchUserWallet() {
    const res = await apiFetch(API.WALLET);
    if (res && res.ok) {
        const d = await res.json();
        currentUserAddress = d.wallet_address;
    }
}

/* ── Stats ──────────────────────────────────────────────── */
async function loadStats() {
    const res = await apiFetch(API.STATS);
    if (!res || !res.ok) return;
    const d = await res.json();

    currentChainHeight = d.chain_height || 0;
    
    setText("stat-block-height", d.chain_height ?? "—");
    setText("stat-tx-total",     d.total_tx     ?? "—");
    setText("stat-tx-pending",   d.pending_tx   ?? "—");
    setText("stat-difficulty",   d.difficulty   ?? "—");
}

/* ── Blocks (Paginated) ─────────────────────────────────── */
async function loadBlocks(page = 1) {
    blockPage = page;
    const tbody = document.getElementById("blocks-tbody");
    if (tbody) tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><i class="bi bi-arrow-repeat spin"></i> Loading blocks…</div></td></tr>`;
    
    const res = await apiFetch(`${API.BLOCKS}?page=${page}&page_size=10`);
    if (!res || !res.ok) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state">Failed to load data.</div></td></tr>`;
        return;
    }
    const d = await res.json();
    
    // Update global stats derived from blocks
    if (page === 1 && d.blocks && d.blocks.length > 0) {
        setText("stat-reward", formatDecimal(d.blocks[0].reward) + " SKA");
        if (d.blocks.length >= 2) {
            const t1 = new Date(d.blocks[0].timestamp);
            const t2 = new Date(d.blocks[1].timestamp);
            const diffSec = Math.abs(t1 - t2) / 1000;
            setText("stat-avg-time", diffSec.toFixed(1) + " sec");
        } else {
            setText("stat-avg-time", "Not Available");
        }
    }
    
    // Pagination controls
    const prevBtn = document.getElementById("btn-block-prev");
    const nextBtn = document.getElementById("btn-block-next");
    if (prevBtn) prevBtn.disabled = page <= 1;
    if (nextBtn) nextBtn.disabled = page >= (d.total_pages || 1);
    setText("block-page-info", `Page ${page} of ${d.total_pages || 1}`);

    renderBlocks(d.blocks || []);
}

function renderBlocks(blocks) {
    const tbody = document.getElementById("blocks-tbody");
    if (!tbody) return;

    if (!blocks.length) {
        tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state">No blocks found.</div></td></tr>`;
        return;
    }

    tbody.innerHTML = blocks.map(b => `
        <tr class="explorer-row" onclick="showBlockDetail(${b.block_index})">
            <td><span class="badge" style="background: rgba(212,175,55,0.1); color: var(--gold); border: 1px solid var(--gold-border);">#${b.block_index}</span></td>
            <td style="font-family:monospace;font-size:.75rem">${shortHash(b.hash)}</td>
            <td style="font-family:monospace;font-size:.72rem">${shortHash(b.miner_address)}</td>
            <td>${b.tx_count}</td>
            <td>${formatDecimal(b.reward)} SKA</td>
            <td style="font-size:.75rem;color:var(--text-muted)">${formatDate(b.timestamp)}</td>
        </tr>
    `).join("");
}

/* ── Transactions (Paginated) ───────────────────────────── */
async function loadTransactions(page = 1) {
    txPage = page;
    const tbody = document.getElementById("transactions-tbody");
    if (tbody) tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><i class="bi bi-arrow-repeat spin"></i> Loading transactions…</div></td></tr>`;
    
    const res = await apiFetch(`${API.TX_LIST}?page=${page}&page_size=10`);
    if (!res || !res.ok) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state">Failed to load data.</div></td></tr>`;
        return;
    }
    const d = await res.json();
    
    // Pagination controls
    const prevBtn = document.getElementById("btn-tx-prev");
    const nextBtn = document.getElementById("btn-tx-next");
    if (prevBtn) prevBtn.disabled = page <= 1;
    if (nextBtn) nextBtn.disabled = page >= (d.total_pages || 1);
    setText("tx-page-info", `Page ${page} of ${d.total_pages || 1}`);

    renderTransactions(d.transactions || []);
}

function renderTransactions(txs, tableId = "transactions-tbody") {
    const tbody = document.getElementById(tableId);
    if (!tbody) return;

    if (!txs.length) {
        tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state">No transactions found.</div></td></tr>`;
        return;
    }

    tbody.innerHTML = txs.map(tx => {
        const statusColor = tx.status === "CONFIRMED" ? "var(--success)" : tx.status === "FAILED" ? "var(--danger)" : "#f39c12";
        const typeBadge = tx.tx_type === "COINBASE"
            ? `<span class="badge" style="background:rgba(212,175,55,.15);color:var(--gold);border:1px solid rgba(212,175,55,0.3);">Mining</span>`
            : `<span class="badge" style="background:rgba(52,152,219,.15);color:#3498db;border:1px solid rgba(52,152,219,.3);">Transfer</span>`;
        return `
        <tr class="explorer-row" onclick="showTxDetail('${tx.tx_hash}')">
            <td style="font-family:monospace;font-size:.74rem">${shortHash(tx.tx_hash)}</td>
            <td>${typeBadge}</td>
            <td style="font-family:monospace;font-size:.72rem">${tx.sender_address ? shortHash(tx.sender_address) : "<em style='color:var(--text-muted)'>Coinbase</em>"}</td>
            <td style="font-family:monospace;font-size:.72rem">${shortHash(tx.receiver_address)}</td>
            <td>${formatDecimal(tx.amount)} SKA</td>
            <td style="color:${statusColor};font-weight:600;font-size:.78rem">${tx.status}</td>
        </tr>`;
    }).join("");
}

/* ── Modals: Block Detail ───────────────────────────────── */
async function showBlockDetail(blockIndex) {
    const res = await apiFetch(`${API.BLOCKS}${blockIndex}/`);
    if (!res || !res.ok) { showToast("Error", "Could not load block details.", "error"); return; }
    const b = await res.json();
    
    setText("mdl-block-title", `Block #${b.block_index}`);
    setText("mdl-block-height", b.block_index);
    setText("mdl-block-time", formatDate(b.timestamp));
    setText("mdl-block-hash", b.hash);
    setText("mdl-block-prev", b.previous_hash);
    setText("mdl-block-merkle", b.merkle_root);
    setText("mdl-block-miner", b.miner_address);
    setText("mdl-block-reward", formatDecimal(b.reward) + " SKA");
    setText("mdl-block-diff-nonce", `${b.difficulty} / ${b.nonce}`);
    setText("mdl-block-tx-count", b.tx_count);
    
    const confs = (currentChainHeight - b.block_index) + 1;
    setText("mdl-block-confirmations", `${confs} Confirmations`);
    
    // Copy buttons
    bindCopy("copy-block-hash", b.hash);
    bindCopy("copy-block-prev", b.previous_hash);
    
    // View Wallet
    const navMiner = document.getElementById("nav-block-miner");
    if (navMiner) {
        navMiner.onclick = () => showWalletDetail(b.miner_address);
    }
    
    // Tx List inside Block
    const txWrap = document.getElementById("mdl-block-tx-list");
    if (txWrap) {
        if (!b.transactions || !b.transactions.length) {
            txWrap.innerHTML = `<div class="text-muted p-2">No transactions in this block.</div>`;
        } else {
            txWrap.innerHTML = b.transactions.map(t => {
                return `<div class="p-2 border-bottom" style="border-color: rgba(255,255,255,0.05) !important; cursor:pointer;" onclick="showTxDetail('${t.tx_hash}')">
                    <div class="d-flex justify-content-between mb-1">
                        <span style="color:var(--gold); font-family:monospace;">${shortHash(t.tx_hash)}</span>
                        <span>${formatDecimal(t.amount)} SKA</span>
                    </div>
                    <div style="color:var(--text-muted);">From: ${t.sender_address ? shortHash(t.sender_address) : 'Coinbase'} &rarr; To: ${shortHash(t.receiver_address)}</div>
                </div>`;
            }).join("");
        }
    }

    document.getElementById("block-detail-modal").classList.add("visible");
}

/* ── Modals: Tx Detail ──────────────────────────────────── */
async function showTxDetail(txHash) {
    const res = await apiFetch(`${API.TX_LIST}${txHash}/`);
    if (!res || !res.ok) { showToast("Error", "Could not load transaction details.", "error"); return; }
    const tx = await res.json();
    
    setText("mdl-tx-hash", tx.tx_hash);
    setText("mdl-tx-status", tx.status);
    setText("mdl-tx-block", tx.block_index !== null ? `#${tx.block_index}` : "Pending");
    setText("mdl-tx-time", formatDate(tx.created_at));
    setText("mdl-tx-sender", tx.sender_address || "Coinbase");
    setText("mdl-tx-receiver", tx.receiver_address);
    setText("mdl-tx-amount", formatDecimal(tx.amount) + " SKA");
    setText("mdl-tx-fee", formatDecimal(tx.fee) + " SKA");
    
    // Status color
    const sWrap = document.getElementById("mdl-tx-status");
    if (sWrap) {
        sWrap.style.color = tx.status === "CONFIRMED" ? "var(--success)" : tx.status === "FAILED" ? "var(--danger)" : "#f39c12";
    }
    
    // Confirmations
    if (tx.block_index !== null && currentChainHeight >= tx.block_index) {
        const confs = (currentChainHeight - tx.block_index) + 1;
        setText("mdl-tx-confirmations", `${confs} Confirmations`);
    } else {
        setText("mdl-tx-confirmations", "");
    }
    
    // Nav buttons
    const btnBlock = document.getElementById("nav-tx-block");
    if (btnBlock) {
        btnBlock.style.display = tx.block_index !== null ? "inline-block" : "none";
        btnBlock.onclick = () => showBlockDetail(tx.block_index);
    }
    const btnSender = document.getElementById("nav-tx-sender");
    if (btnSender) {
        btnSender.style.display = tx.sender_address ? "inline-block" : "none";
        btnSender.onclick = () => showWalletDetail(tx.sender_address);
    }
    const btnReceiver = document.getElementById("nav-tx-receiver");
    if (btnReceiver) {
        btnReceiver.onclick = () => showWalletDetail(tx.receiver_address);
    }
    
    // Copy buttons
    bindCopy("copy-tx-hash", tx.tx_hash);
    bindCopy("copy-tx-sender", tx.sender_address);
    bindCopy("copy-tx-receiver", tx.receiver_address);
    
    document.getElementById("tx-detail-modal").classList.add("visible");
}

/* ── Modals: Wallet Detail ──────────────────────────────── */
async function showWalletDetail(address) {
    if (!address) return;
    
    // Ledger Calculation via Transactions
    showToast("Calculating Ledger", "Deriving wallet stats from blockchain...", "info");
    
    // NOTE: fetching up to 1000 items to guarantee an accurate derived balance.
    // In production this would be handled server-side, but this complies with constraints.
    const res = await apiFetch(`${API.TX_LIST}?wallet=${encodeURIComponent(address)}&page_size=1000`);
    if (!res || !res.ok) { showToast("Error", "Could not fetch wallet history.", "error"); return; }
    
    const d = await res.json();
    const txs = d.transactions || [];
    
    if (txs.length === 0) {
        populateWalletModal(address, 0, 0, 0, null, null);
        return;
    }
    
    let balance = 0;
    let blocksMined = 0;
    
    // Txs are assumed sorted by created_at desc
    const firstActivity = txs[txs.length - 1].created_at;
    const lastActivity = txs[0].created_at;
    
    txs.forEach(tx => {
        if (tx.status !== 'CONFIRMED') return;
        const amt = parseFloat(tx.amount) || 0;
        const fee = parseFloat(tx.fee) || 0;
        
        if (tx.tx_type === 'COINBASE' && tx.receiver_address === address) {
            balance += amt;
            blocksMined++;
        } else if (tx.receiver_address === address && tx.sender_address !== address) {
            balance += amt;
        } else if (tx.sender_address === address && tx.receiver_address !== address) {
            balance -= (amt + fee);
        } else if (tx.sender_address === address && tx.receiver_address === address) {
            balance -= fee; // Sent to self
        }
    });
    
    populateWalletModal(address, balance, blocksMined, txs.length, firstActivity, lastActivity);
}

function populateWalletModal(address, balance, blocksMined, totalTx, firstAct, lastAct) {
    setText("mdl-wallet-address", address);
    setText("mdl-wallet-balance", formatDecimal(balance) + " SKA");
    setText("mdl-wallet-tx-count", totalTx);
    setText("mdl-wallet-blocks", blocksMined);
    setText("mdl-wallet-first", formatDate(firstAct));
    setText("mdl-wallet-last", formatDate(lastAct));
    
    bindCopy("copy-wallet-address", address);
    
    document.getElementById("wallet-detail-modal").classList.add("visible");
}

/* ── Utilities ──────────────────────────────────────────── */
function bindCopy(id, text) {
    const el = document.getElementById(id);
    if (!el) return;
    if (!text) { el.style.display = "none"; return; }
    el.style.display = "inline-block";
    
    // Remove old listeners by cloning
    const newEl = el.cloneNode(true);
    el.parentNode.replaceChild(newEl, el);
    
    newEl.addEventListener("click", () => {
        navigator.clipboard.writeText(text).then(() => showToast("Copied!", "Copied to clipboard.", "success"));
    });
}

/* ── Smart Search ───────────────────────────────────────── */
async function runSearch() {
    const query = document.getElementById("explorer-search")?.value.trim();
    if (!query) return;

    document.getElementById("search-empty-state").style.display = "none";

    // 1. Block Height (pure digits)
    if (/^\d+$/.test(query)) {
        const res = await apiFetch(`${API.BLOCKS}${query}/`);
        if (res && res.ok) {
            await showBlockDetail(parseInt(query));
            return;
        }
    }

    // 2. Hash (64 hex chars) - Try Tx, then Block
    if (/^[0-9a-fA-F]{64}$/.test(query)) {
        showToast("Searching", "Checking transactions and blocks…", "info");
        
        const txRes = await apiFetch(`${API.TX_LIST}${query}/`);
        if (txRes && txRes.ok) {
            await showTxDetail(query);
            return;
        }

        const blkRes = await apiFetch(API.BLOCKS);
        if (blkRes && blkRes.ok) {
            const d = await blkRes.json();
            const match = (d.blocks || []).find(b => b.hash.toLowerCase() === query.toLowerCase());
            if (match) { 
                await showBlockDetail(match.block_index); 
                return; 
            }
        }
    }

    // 3. Wallet Address (Starts with SKA or length > 20)
    if (query.length > 10 && !/^[0-9a-fA-F]{64}$/.test(query)) {
        const res = await apiFetch(`${API.TX_LIST}?wallet=${encodeURIComponent(query)}`);
        if (res && res.ok) {
            const d = await res.json();
            if (d.transactions && d.transactions.length > 0) {
                await showWalletDetail(query);
                return;
            }
        }
    }

    // Empty state
    document.getElementById("search-empty-state").style.display = "block";
}

/* ── Main Entry ─────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", async () => {
    if (!getToken()) { window.location.href = LOGIN_URL; return; }

    // Navigation and Modals
    document.querySelectorAll(".sikka-modal-close, .sikka-modal-overlay").forEach(el => {
        el.addEventListener("click", (e) => {
            if (e.target === el || el.classList.contains('sikka-modal-close')) {
                const overlay = el.classList.contains('sikka-modal-overlay') ? el : el.closest(".sikka-modal-overlay");
                if (overlay) overlay.classList.remove("visible");
            }
        });
    });

    // Pagination Controls
    document.getElementById("btn-block-prev")?.addEventListener("click", () => loadBlocks(blockPage - 1));
    document.getElementById("btn-block-next")?.addEventListener("click", () => loadBlocks(blockPage + 1));
    document.getElementById("btn-tx-prev")?.addEventListener("click", () => loadTransactions(txPage - 1));
    document.getElementById("btn-tx-next")?.addEventListener("click", () => loadTransactions(txPage + 1));

    // Search Controls
    document.getElementById("btn-explorer-search")?.addEventListener("click", runSearch);
    document.getElementById("explorer-search")?.addEventListener("keydown", e => { if (e.key === "Enter") runSearch(); });
    
    // Refresh
    document.getElementById("btn-refresh-explorer")?.addEventListener("click", () => {
        loadStats(); loadBlocks(1); loadTransactions(1);
        showToast("Refreshed", "Explorer data updated.", "info");
    });
    
    // Logout
    document.getElementById("btn-logout")?.addEventListener("click", () => { apiFetch(API.LOGOUT, "POST"); clearToken(); window.location.href = LOGIN_URL; });
    document.getElementById("sidebar-logout")?.addEventListener("click", () => { apiFetch(API.LOGOUT, "POST"); clearToken(); window.location.href = LOGIN_URL; });

    await Promise.all([
        loadProfile(),
        fetchUserWallet(),
        loadStats(), 
        loadBlocks(1), 
        loadTransactions(1)
    ]);
});