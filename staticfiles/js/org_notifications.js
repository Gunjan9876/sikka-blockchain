"use strict";

document.addEventListener("DOMContentLoaded", async function() {
    const token = sessionStorage.getItem("sikka_access");
    if (!token) {
        window.location.href = '/accounts/login/';
        return;
    }

    const listContainer = document.getElementById("notificationList");
    const unreadCountBadge = document.getElementById("unreadCountBadge");
    const markAllReadBtn = document.getElementById("markAllReadBtn");
    const filterBtns = document.querySelectorAll(".filter-btn");
    
    // Modal elements
    const notifModal = new bootstrap.Modal(document.getElementById('notificationModal'));
    const modalTitle = document.getElementById('modalTitle');
    const modalMessage = document.getElementById('modalMessage');
    const modalTime = document.getElementById('modalTime');
    const modalIcon = document.getElementById('modalIcon');
    
    let allNotifications = [];
    let currentFilter = "all";

    function getIconClass(type) {
        switch(type) {
            case 'REWARD_REQUEST': return 'bi-envelope-paper icon-reward-req';
            case 'REWARD_APPROVED': return 'bi-check-circle icon-reward-app';
            case 'REWARD_REJECTED': return 'bi-x-circle icon-reward-rej';
            case 'QUOTA_WARNING': return 'bi-exclamation-triangle icon-warning';
            case 'ORG_VERIFICATION': return 'bi-shield-check icon-system';
            default: return 'bi-bell icon-system';
        }
    }

    function timeSince(dateString) {
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
        if (interval > 1) return Math.floor(interval) + " minutes ago";
        return Math.floor(seconds) + " seconds ago";
    }

    function formatMessage(msg) {
        // Find 32+ char hex strings (wallet addresses or tx hashes) and format them nicely
        return msg.replace(/\b([a-fA-F0-9]{32,64})\b/g, match => {
            const short = `${match.substring(0, 6)}...${match.slice(-4)}`;
            return `<span class="wallet-badge" title="${match}">${short}</span>`;
        });
    }

    function getDateGroup(dateString) {
        const date = new Date(dateString);
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        
        const isSameDay = (d1, d2) => 
            d1.getDate() === d2.getDate() && 
            d1.getMonth() === d2.getMonth() && 
            d1.getFullYear() === d2.getFullYear();

        if (isSameDay(date, today)) return "Today";
        if (isSameDay(date, yesterday)) return "Yesterday";
        
        const diffTime = Math.abs(today - date);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        if (diffDays <= 7) return "Last 7 Days";
        
        return "Older";
    }

    function renderNotifications() {
        let filtered = allNotifications;
        if (currentFilter === "unread") {
            filtered = allNotifications.filter(n => !n.is_read);
        } else if (currentFilter === "rewards") {
            filtered = allNotifications.filter(n => n.type.startsWith('REWARD_'));
        } else if (currentFilter === "verification") {
            filtered = allNotifications.filter(n => n.type === 'ORG_VERIFICATION');
        } else if (currentFilter === "system") {
            filtered = allNotifications.filter(n => n.type === 'SYSTEM' || n.type === 'QUOTA_WARNING');
        }

        if (filtered.length === 0) {
            listContainer.innerHTML = `
                <div class="empty-state">
                    <i class="bi bi-bell-slash"></i>
                    <h4>No Notifications</h4>
                    <p>You're all caught up for this view!</p>
                </div>
            `;
            return;
        }

        // Group by Date
        const grouped = {};
        filtered.forEach(n => {
            const group = getDateGroup(n.created_at);
            if (!grouped[group]) grouped[group] = [];
            grouped[group].push(n);
        });

        const groupOrder = ["Today", "Yesterday", "Last 7 Days", "Older"];
        let html = "";

        groupOrder.forEach(groupName => {
            if (grouped[groupName] && grouped[groupName].length > 0) {
                html += `<div class="date-group-header">${groupName}</div>`;
                html += `<div class="notification-group">`;
                
                grouped[groupName].forEach(n => {
                    const icon = getIconClass(n.type);
                    const unreadClass = n.is_read ? "" : "unread";
                    const formattedMsg = formatMessage(n.message);
                    
                    html += `
                        <div class="notification-item ${unreadClass}" data-id="${n.id}">
                            <div class="notification-icon">
                                <i class="bi ${icon}"></i>
                            </div>
                            <div class="notification-content">
                                <div class="notification-title-row">
                                    <h5 class="notification-title">${n.title}</h5>
                                    <span class="notification-time">${timeSince(n.created_at)}</span>
                                </div>
                                <p class="notification-body">${formattedMsg}</p>
                            </div>
                            <div class="unread-indicator"></div>
                        </div>
                    `;
                });
                
                html += `</div>`;
            }
        });
        
        listContainer.innerHTML = html;
        
        // Attach click listeners to all items to open modal and mark read
        document.querySelectorAll('.notification-item').forEach(item => {
            item.addEventListener('click', async function() {
                const id = parseInt(this.getAttribute('data-id'));
                const n = allNotifications.find(x => x.id === id);
                if (n) {
                    openNotificationModal(n);
                    if (!n.is_read) {
                        await markAsRead(id);
                    }
                }
            });
        });
    }

    function openNotificationModal(n) {
        modalTitle.textContent = n.title;
        modalMessage.innerHTML = formatMessage(n.message);
        
        const date = new Date(n.created_at);
        modalTime.innerHTML = `<i class="bi bi-clock me-1"></i> ${date.toLocaleString()} (${timeSince(n.created_at)})`;
        
        const iconClass = getIconClass(n.type);
        modalIcon.className = `notification-icon`; // Reset classes
        modalIcon.innerHTML = `<i class="bi ${iconClass}"></i>`;
        
        // Re-apply the specific icon styling class
        const bgClass = iconClass.split(' ').find(c => c.startsWith('icon-'));
        if (bgClass) modalIcon.classList.add(bgClass);

        const modalActions = document.getElementById('modalActions');
        if (n.type === 'REWARD_REQUEST' && n.related_reward_id) {
            modalActions.classList.remove('d-none');
            modalActions.innerHTML = `
                <div class="d-flex gap-2">
                    <button class="btn btn-success flex-grow-1 action-btn" data-action="approve" data-reward="${n.related_reward_id}">
                        <i class="bi bi-check-circle me-1"></i> Approve
                    </button>
                    <button class="btn btn-danger flex-grow-1 action-btn" data-action="reject" data-reward="${n.related_reward_id}">
                        <i class="bi bi-x-circle me-1"></i> Reject
                    </button>
                </div>
            `;
            
            // Attach listeners to new buttons
            modalActions.querySelectorAll('.action-btn').forEach(btn => {
                btn.addEventListener('click', async function() {
                    const action = this.getAttribute('data-action');
                    const rewardId = this.getAttribute('data-reward');
                    await reviewReward(rewardId, action);
                });
            });
        } else {
            modalActions.classList.add('d-none');
            modalActions.innerHTML = "";
        }

        notifModal.show();
    }

    async function reviewReward(rewardId, action) {
        try {
            const res = await fetch("/api/v1/rewards/review/", {
                method: "POST",
                headers: { 
                    "Authorization": `Bearer ${token}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ reward_id: rewardId, action: action })
            });
            if (res.ok) {
                // Update UI to show success
                const modalActions = document.getElementById('modalActions');
                modalActions.innerHTML = `
                    <div class="alert alert-success m-0 p-2 text-center" style="background: rgba(46, 204, 113, 0.1); border: 1px solid #2ecc71; color: #2ecc71;">
                        <i class="bi bi-check2-circle me-1"></i> Reward successfully ${action}d!
                    </div>
                `;
            } else {
                const data = await res.json();
                alert(data.error || "Failed to process reward.");
            }
        } catch (e) {
            console.error(e);
            alert("Network error occurred.");
        }
    }

    async function fetchNotifications() {
        try {
            const res = await fetch("/api/v1/org/notifications/", {
                headers: { "Authorization": `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                allNotifications = data.notifications;
                
                updateUnreadUI();
                renderNotifications();
            }
        } catch (e) {
            console.error(e);
            listContainer.innerHTML = `<div class="empty-state text-danger">Failed to load notifications.</div>`;
        }
    }

    function updateUnreadUI() {
        const unreadCount = allNotifications.filter(n => !n.is_read).length;
        unreadCountBadge.textContent = unreadCount;
        
        if (unreadCount > 0) {
            markAllReadBtn.style.display = "inline-block";
        } else {
            markAllReadBtn.style.display = "none";
        }
        
        // Synchronize the global sidebar badge
        const sidebarBadge = document.getElementById("sidebarUnreadBadge");
        if (sidebarBadge) {
            sidebarBadge.textContent = unreadCount > 0 ? unreadCount : "";
            sidebarBadge.style.display = unreadCount > 0 ? "inline-block" : "none";
        }
    }

    async function markAsRead(id) {
        try {
            const res = await fetch("/api/v1/org/notifications/read/", {
                method: "POST",
                headers: { 
                    "Authorization": `Bearer ${token}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ notification_id: id })
            });
            if (res.ok) {
                const notif = allNotifications.find(n => n.id === id);
                if (notif) notif.is_read = true;
                
                updateUnreadUI();
                renderNotifications();
            }
        } catch (e) {
            console.error(e);
        }
    }

    markAllReadBtn.addEventListener('click', async function() {
        try {
            const res = await fetch("/api/v1/org/notifications/read-all/", {
                method: "POST",
                headers: { "Authorization": `Bearer ${token}` }
            });
            if (res.ok) {
                allNotifications.forEach(n => n.is_read = true);
                updateUnreadUI();
                renderNotifications();
            }
        } catch (e) {
            console.error(e);
        }
    });

    filterBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            filterBtns.forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            currentFilter = this.getAttribute('data-filter');
            renderNotifications();
        });
    });

    fetchNotifications();
});
