document.addEventListener("DOMContentLoaded", async function() {
    const token = sessionStorage.getItem("sikka_access");
    if (!token) {
        window.location.href = '/accounts/login/';
        return;
    }

    const tbody = document.getElementById("activityTableBody");
    
    try {
        const response = await fetch("/api/v1/accounts/login-activity/", {
            headers: { "Authorization": `Bearer ${token}` }
        });
        
        if (response.ok) {
            const data = await response.json();
            
            if (data.length === 0) {
                tbody.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-muted">No recent activity found.</td></tr>`;
                return;
            }
            
            let html = "";
            data.forEach(log => {
                const statusClass = log.status === 'Success' ? 'status-success' : 'status-failed';
                
                html += `
                    <tr>
                        <td class="ps-4">
                            <div class="fw-medium">${log.created_at}</div>
                        </td>
                        <td>
                            <div>${log.action}</div>
                        </td>
                        <td>
                            <div class="font-monospace small text-muted">${log.ip_address || 'Unknown'}</div>
                        </td>
                        <td class="text-end pe-4">
                            <span class="status-badge ${statusClass}">${log.status}</span>
                        </td>
                    </tr>
                `;
            });
            
            tbody.innerHTML = html;
        } else if (response.status === 401) {
            window.location.href = '/accounts/login/';
        } else {
            tbody.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-danger">Failed to load activity.</td></tr>`;
        }
    } catch (err) {
        console.error("Error fetching login activity:", err);
        tbody.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-danger">Failed to load activity.</td></tr>`;
    }
});
