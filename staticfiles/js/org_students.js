"use strict";

document.addEventListener("DOMContentLoaded", async function() {
    const token = sessionStorage.getItem("sikka_access");
    if (!token) {
        window.location.href = '/accounts/login/';
        return;
    }

    // Initialize sidebar
    initSikkaSidebar();
    const profile = await initSikkaPage("university");
    if (!profile) return;

    let allStudents = [];
    let displayedStudents = [];
    let currentFilter = "all";
    let currentSearch = "";

    // Pagination
    let currentPage = 1;
    const itemsPerPage = 10;

    const tableBody = document.getElementById("studentsTableBody");
    const loader = document.getElementById("tableLoader");
    const noResults = document.getElementById("noResults");
    
    // Offcanvas Elements
    const profileDrawer = new bootstrap.Offcanvas(document.getElementById('studentProfileDrawer'));

    function timeSince(dateString) {
        if (!dateString) return "Never";
        const date = new Date(dateString);
        const seconds = Math.floor((new Date() - date) / 1000);
        let interval = seconds / 31536000;
        if (interval > 1) return Math.floor(interval) + " years ago";
        interval = seconds / 2592000;
        if (interval > 1) return Math.floor(interval) + " months ago";
        interval = seconds / 86400;
        if (interval > 1) return Math.floor(interval) + " days ago";
        interval = seconds / 3600;
        if (interval > 1) return Math.floor(interval) + " hours ago";
        interval = seconds / 60;
        if (interval > 1) return Math.floor(interval) + " mins ago";
        return Math.floor(seconds) + " secs ago";
    }

    function shortWallet(address) {
        if (!address) return "-";
        return `${address.substring(0, 6)}...${address.slice(-4)}`;
    }

    function getInitials(name, username) {
        let text = name || username || "U";
        return text.substring(0, 1).toUpperCase();
    }

    async function loadStudents() {
        try {
            const res = await fetch("/api/v1/org/students/", {
                headers: { "Authorization": `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                allStudents = data.students;
                updateStats();
                applyFilters();
            } else {
                sikkaShowToast("Error", "Failed to load students.", "error");
            }
        } catch (e) {
            console.error(e);
            sikkaShowToast("Error", "Network error.", "error");
        } finally {
            loader.style.display = "none";
        }
    }

    function updateStats() {
        const total = allStudents.length;
        const active = allStudents.filter(s => s.is_active).length;
        const rewarded = allStudents.filter(s => s.org_total_rewards > 0).length;
        
        let totalSka = 0;
        let topEarner = { name: "--", amount: -1 };

        allStudents.forEach(s => {
            const amt = parseFloat(s.org_total_ska_earned || 0);
            totalSka += amt;
            if (amt > topEarner.amount) {
                topEarner = { name: s.name, amount: amt };
            }
        });
        
        const avg = rewarded > 0 ? (totalSka / rewarded).toFixed(2) : "0.00";

        document.getElementById("statTotalStudents").textContent = total;
        document.getElementById("statActiveStudents").textContent = active;
        document.getElementById("statRewardedStudents").textContent = rewarded;
        document.getElementById("statTotalSka").textContent = totalSka.toFixed(2);
        document.getElementById("statAvgReward").textContent = avg;
        document.getElementById("statHighestStudent").textContent = topEarner.amount > 0 ? topEarner.name : "--";
    }

    function applyFilters() {
        let filtered = allStudents;

        if (currentFilter === "rewarded") {
            filtered = filtered.filter(s => s.org_total_rewards > 0);
        } else if (currentFilter === "never_rewarded") {
            filtered = filtered.filter(s => s.org_total_rewards === 0);
        } else if (currentFilter === "active") {
            filtered = filtered.filter(s => s.is_active);
        } else if (currentFilter === "inactive") {
            filtered = filtered.filter(s => !s.is_active);
        }

        if (currentSearch) {
            const q = currentSearch.toLowerCase();
            filtered = filtered.filter(s => 
                (s.name && s.name.toLowerCase().includes(q)) ||
                (s.username && s.username.toLowerCase().includes(q)) ||
                (s.email && s.email.toLowerCase().includes(q)) ||
                (s.wallet_address && s.wallet_address.toLowerCase().includes(q))
            );
        }

        displayedStudents = filtered;
        currentPage = 1; // reset to first page on filter change
        renderTable();
    }

    function renderTable() {
        if (displayedStudents.length === 0) {
            tableBody.innerHTML = "";
            noResults.classList.remove("d-none");
            document.getElementById("paginationInfo").textContent = "Showing 0 of 0";
            document.getElementById("paginationControls").innerHTML = "";
            return;
        }
        noResults.classList.add("d-none");

        // Calculate Pagination
        const totalPages = Math.ceil(displayedStudents.length / itemsPerPage);
        if (currentPage > totalPages) currentPage = totalPages;
        
        const startIndex = (currentPage - 1) * itemsPerPage;
        const endIndex = Math.min(startIndex + itemsPerPage, displayedStudents.length);
        const paginatedData = displayedStudents.slice(startIndex, endIndex);

        let html = "";
        paginatedData.forEach(s => {
            let statusHtml;
            if (s.is_active) {
                const daysSinceLogin = s.last_login ? Math.floor((new Date() - new Date(s.last_login)) / (1000 * 60 * 60 * 24)) : 999;
                if (daysSinceLogin <= 7) {
                    statusHtml = `<span class="status-badge status-active">🟢 Active</span>`;
                } else {
                    statusHtml = `<span class="status-badge" style="background:rgba(241, 196, 15, 0.1); color:#f1c40f; border:1px solid rgba(241,196,15,0.2);">🟡 Recently Active</span>`;
                }
            } else {
                if (!s.last_login) {
                    statusHtml = `<span class="status-badge" style="background:rgba(255,255,255,0.1); color:#ccc; border:1px solid rgba(255,255,255,0.2);">⚪ Never Logged In</span>`;
                } else {
                    statusHtml = `<span class="status-badge status-inactive">🔴 Inactive</span>`;
                }
            }
                
            const earned = parseFloat(s.org_total_ska_earned).toFixed(2);
            const balance = parseFloat(s.wallet_balance).toFixed(2);
            const initials = getInitials(s.name, s.username);

            html += `
                <tr data-id="${s.id}">
                    <td>
                        <div class="student-identity">
                            <div class="student-avatar">${initials}</div>
                            <div>
                                <div class="fw-bold">${s.name}</div>
                                <div class="text-muted small">@${s.username}</div>
                            </div>
                        </div>
                    </td>
                    <td>${s.email}</td>
                    <td><span class="wallet-badge" title="${s.wallet_address}">${shortWallet(s.wallet_address)}</span></td>
                    <td>${balance} SKA</td>
                    <td>${s.org_total_rewards}</td>
                    <td class="text-success">+${earned}</td>
                    <td>${statusHtml}</td>
                    <td>
                        <div class="action-icons">
                            <button class="btn-icon" title="View Profile" data-action="profile"><i class="bi bi-eye"></i></button>
                            <button class="btn-icon" title="View Rewards" data-action="rewards"><i class="bi bi-award"></i></button>
                            <button class="btn-icon" title="View Wallet" data-action="wallet"><i class="bi bi-wallet2"></i></button>
                            <button class="btn-icon" title="Blockchain Activity" data-action="tx"><i class="bi bi-link-45deg"></i></button>
                        </div>
                    </td>
                </tr>
            `;
        });

        tableBody.innerHTML = html;

        // Render Pagination Controls
        document.getElementById("paginationInfo").textContent = `Showing ${startIndex + 1}–${endIndex} of ${displayedStudents.length} students`;
        
        let pgHtml = `
            <button class="pagination-btn" ${currentPage === 1 ? 'disabled' : ''} onclick="window.goToPage(${currentPage - 1})">Prev</button>
        `;
        for (let i = 1; i <= totalPages; i++) {
            // Show only a few buttons if many pages
            if (i === 1 || i === totalPages || (i >= currentPage - 1 && i <= currentPage + 1)) {
                pgHtml += `<button class="pagination-btn ${i === currentPage ? 'active' : ''}" onclick="window.goToPage(${i})">${i}</button>`;
            } else if (i === currentPage - 2 || i === currentPage + 2) {
                pgHtml += `<span class="text-muted mx-1">...</span>`;
            }
        }
        pgHtml += `
            <button class="pagination-btn" ${currentPage === totalPages ? 'disabled' : ''} onclick="window.goToPage(${currentPage + 1})">Next</button>
        `;
        document.getElementById("paginationControls").innerHTML = pgHtml;

        // Attach click listeners for actions
        document.querySelectorAll("#studentsTableBody tr").forEach(row => {
            row.addEventListener('click', function(e) {
                const id = parseInt(this.getAttribute('data-id'));
                const student = allStudents.find(x => x.id === id);
                if (!student) return;

                const actionBtn = e.target.closest('.btn-icon');
                let targetAction = actionBtn ? actionBtn.getAttribute('data-action') : 'profile';
                
                openProfileDrawer(student, targetAction);
            });
        });
    }

    // Expose for pagination buttons
    window.goToPage = function(p) {
        currentPage = p;
        renderTable();
    };

    function openProfileDrawer(s, action = 'profile') {
        document.getElementById('drawerName').textContent = s.name;
        document.getElementById('drawerUsername').textContent = s.username;
        document.getElementById('drawerEmail').textContent = s.email;
        
        const wBadge = document.getElementById('drawerWallet');
        wBadge.textContent = shortWallet(s.wallet_address);
        wBadge.setAttribute('title', s.wallet_address);
        
        document.getElementById('drawerCreated').textContent = s.account_created ? new Date(s.account_created).toLocaleDateString() : 'Unknown';
        document.getElementById('drawerLastLogin').textContent = s.last_login ? new Date(s.last_login).toLocaleString() : 'Never';
        
        let statusHtml;
        if (s.is_active) {
            statusHtml = `<span class="status-badge status-active">🟢 Active Account</span>`;
        } else {
            statusHtml = `<span class="status-badge status-inactive">🔴 Inactive Account</span>`;
        }
        document.getElementById('drawerStatusBadge').innerHTML = statusHtml;

        document.getElementById('drawerBalance').textContent = parseFloat(s.wallet_balance).toFixed(2);
        document.getElementById('drawerSkaEarned').textContent = parseFloat(s.org_total_ska_earned).toFixed(2);
        document.getElementById('drawerTotalRewards').textContent = s.org_total_rewards;
        document.getElementById('drawerLastRewardDate').textContent = s.org_last_reward_date ? new Date(s.org_last_reward_date).toLocaleDateString() : 'Never';

        // Render Reward History
        const rhContainer = document.getElementById('drawerRewardHistory');
        if (s.reward_history && s.reward_history.length > 0) {
            let rhHtml = `<div class="list-group list-group-flush bg-transparent">`;
            s.reward_history.forEach(r => {
                const amt = parseFloat(r.amount).toFixed(2);
                rhHtml += `
                    <div class="list-group-item bg-transparent border-color-light p-3">
                        <div class="d-flex justify-content-between mb-1">
                            <strong class="text-gold">${r.achievement}</strong>
                            <span class="text-success fw-bold">+${amt} SKA</span>
                        </div>
                        <div class="small text-muted mb-1">${r.description}</div>
                        <div class="d-flex justify-content-between align-items-center">
                            <span style="font-size:0.75rem; color:rgba(255,255,255,0.4);">${new Date(r.date).toLocaleString()}</span>
                            <span class="badge ${r.status === 'approved' ? 'bg-success' : (r.status === 'rejected' ? 'bg-danger' : 'bg-warning')} rounded-pill" style="font-size:0.6rem;">${r.status.toUpperCase()}</span>
                        </div>
                    </div>
                `;
            });
            rhHtml += `</div>`;
            rhContainer.innerHTML = rhHtml;
        } else {
            rhContainer.innerHTML = `<div class="p-3 text-muted text-center small">No rewards from this university.</div>`;
        }

        // Render Tx History
        const txContainer = document.getElementById('drawerTxHistory');
        if (s.recent_transactions && s.recent_transactions.length > 0) {
            let txHtml = `<div class="list-group list-group-flush bg-transparent">`;
            s.recent_transactions.forEach(tx => {
                const amt = parseFloat(tx.amount).toFixed(2);
                const isReceive = tx.type === 'receive' || tx.type === 'reward';
                const sign = isReceive ? '+' : '-';
                const color = isReceive ? 'text-success' : 'text-danger';
                
                txHtml += `
                    <div class="list-group-item bg-transparent border-color-light p-3">
                        <div class="d-flex justify-content-between mb-1">
                            <strong class="text-uppercase" style="font-size:0.8rem;">${tx.type}</strong>
                            <span class="${color} fw-bold">${sign}${amt}</span>
                        </div>
                        <div class="wallet-badge d-inline-block mb-1" style="font-size:0.7rem;">${shortWallet(tx.tx_hash)}</div>
                        <div class="d-flex justify-content-between align-items-center mt-1">
                            <span style="font-size:0.75rem; color:rgba(255,255,255,0.4);">${tx.timestamp ? new Date(tx.timestamp).toLocaleString() : ''}</span>
                            <span class="badge ${tx.status === 'completed' ? 'bg-success' : 'bg-warning'} rounded-pill" style="font-size:0.6rem;">${tx.status.toUpperCase()}</span>
                        </div>
                    </div>
                `;
            });
            txHtml += `</div>`;
            txContainer.innerHTML = txHtml;
        } else {
            txContainer.innerHTML = `<div class="p-3 text-muted text-center small">No recent blockchain activity.</div>`;
        }

        // Handle Accordions based on action
        const bColRewards = bootstrap.Collapse.getOrCreateInstance(document.getElementById('collapseRewards'), {toggle: false});
        const bColTxs = bootstrap.Collapse.getOrCreateInstance(document.getElementById('collapseTxs'), {toggle: false});
        
        bColRewards.hide();
        bColTxs.hide();

        profileDrawer.show();

        // Delay slightly for animation before opening accordions
        setTimeout(() => {
            if (action === 'rewards') {
                bColRewards.show();
            } else if (action === 'tx') {
                bColTxs.show();
            }
        }, 300);
    }

    // Event Listeners
    document.getElementById("searchInput").addEventListener("input", function(e) {
        currentSearch = e.target.value.trim();
        applyFilters();
    });

    document.querySelectorAll("#filterContainer .filter-btn").forEach(btn => {
        btn.addEventListener("click", function() {
            document.querySelectorAll("#filterContainer .filter-btn").forEach(b => b.classList.remove("active"));
            this.classList.add("active");
            currentFilter = this.getAttribute("data-filter");
            applyFilters();
        });
    });

    // Exports
    document.getElementById("exportCsvBtn").addEventListener("click", () => exportTable("csv"));
    document.getElementById("exportExcelBtn").addEventListener("click", () => exportTable("xlsx"));
    
    document.getElementById("exportPdfBtn").addEventListener("click", () => {
        if (displayedStudents.length === 0) {
            sikkaShowToast("Export", "No data to export.", "info");
            return;
        }
        
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        
        doc.text("Student Management Export", 14, 15);
        
        const tableColumn = ["Name", "Username", "Email", "Balance", "Rewards", "Earned", "Status"];
        const tableRows = [];

        displayedStudents.forEach(s => {
            const studentData = [
                s.name,
                "@" + s.username,
                s.email,
                parseFloat(s.wallet_balance).toFixed(2),
                s.org_total_rewards,
                parseFloat(s.org_total_ska_earned).toFixed(2),
                s.is_active ? "Active" : "Inactive"
            ];
            tableRows.push(studentData);
        });

        doc.autoTable({
            head: [tableColumn],
            body: tableRows,
            startY: 20,
            theme: 'grid',
            styles: { fontSize: 8 },
            headStyles: { fillColor: [212, 175, 55] }
        });
        
        const fileName = `SIKKA_Students_${new Date().toISOString().split('T')[0]}.pdf`;
        doc.save(fileName);
    });

    function exportTable(type) {
        if (displayedStudents.length === 0) {
            sikkaShowToast("Export", "No data to export.", "info");
            return;
        }

        const exportData = displayedStudents.map(s => ({
            "Name": s.name,
            "Username": s.username,
            "Email": s.email,
            "Wallet Address": s.wallet_address,
            "Balance (SKA)": parseFloat(s.wallet_balance).toFixed(2),
            "Rewards from Org": s.org_total_rewards,
            "Total SKA Earned": parseFloat(s.org_total_ska_earned).toFixed(2),
            "Account Created": s.account_created ? new Date(s.account_created).toLocaleDateString() : "",
            "Last Login": s.last_login ? new Date(s.last_login).toLocaleString() : "",
            "Status": s.is_active ? "Active" : "Inactive"
        }));

        const ws = XLSX.utils.json_to_sheet(exportData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Students");

        const fileName = `SIKKA_Students_Export_${new Date().toISOString().split('T')[0]}.${type}`;
        XLSX.writeFile(wb, fileName);
    }

    // Load Data
    loadStudents();
});
