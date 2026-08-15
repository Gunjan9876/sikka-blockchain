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

    const loader = document.getElementById("analyticsLoader");
    const timeFilter = document.getElementById("timeFilter");
    const exportCsvBtn = document.getElementById("exportCsvBtn");

    // Chart Instances
    let rewardsLineChart, statusPieChart, topStudentsBarChart, achievementDoughnutChart;

    // SIKKA Theme Colors for Charts
    const theme = {
        gold: '#D4AF37',
        goldLight: 'rgba(212, 175, 55, 0.5)',
        goldDark: 'rgba(212, 175, 55, 0.2)',
        success: '#2ecc71',
        danger: '#e74c3c',
        warning: '#f1c40f',
        textPrimary: '#ffffff',
        textMuted: 'rgba(255, 255, 255, 0.5)',
        gridLines: 'rgba(255, 255, 255, 0.05)'
    };

    Chart.defaults.color = theme.textMuted;
    Chart.defaults.font.family = "'Inter', sans-serif";

    // Data Storage for Export
    let currentData = null;

    async function fetchAnalytics(filter = 'all') {
        loader.style.display = "flex";
        try {
            const res = await fetch(`/api/v1/org/analytics/?filter=${filter}`, {
                headers: { "Authorization": `Bearer ${token}` }
            });
            if (res.ok) {
                currentData = await res.json();
                populateDashboard(currentData);
            } else {
                sikkaShowToast("Error", "Failed to load analytics data.", "error");
            }
        } catch (e) {
            console.error(e);
            sikkaShowToast("Error", "Network error.", "error");
        } finally {
            loader.style.display = "none";
        }
    }

    function populateDashboard(data) {
        // 1. Overview Metrics
        document.getElementById("valTotalStudents").textContent = data.overview.total_students;
        document.getElementById("valActiveStudents").textContent = data.overview.active_students;
        document.getElementById("valRewardsIssued").textContent = data.overview.rewards_issued;
        document.getElementById("valSkaDistributed").textContent = data.overview.ska_distributed.toFixed(2);
        document.getElementById("valQuotaRemaining").textContent = data.overview.quota_remaining.toFixed(2);
        document.getElementById("valAvgReward").textContent = data.overview.avg_reward.toFixed(2);

        // 2. University Performance
        document.getElementById("valQuotaAllocated").textContent = data.university_performance.quota_allocated.toFixed(2) + " SKA";
        document.getElementById("valQuotaUsed").textContent = data.university_performance.quota_used.toFixed(2) + " SKA";
        document.getElementById("valApprovalRate").textContent = data.university_performance.approval_rate + "%";
        document.getElementById("valHighestReward").textContent = data.overview.highest_reward.toFixed(2) + " SKA";

        // 3. Blockchain Insights
        document.getElementById("valTotalTxs").textContent = data.blockchain_insights.total_txs;
        document.getElementById("valSuccessTxs").textContent = data.blockchain_insights.successful_txs;
        document.getElementById("valFailedTxs").textContent = data.blockchain_insights.failed_txs;
        document.getElementById("valBlocksMined").textContent = data.blockchain_insights.blocks_mined;

        // 4. Student Insights
        const activeContainer = document.getElementById("activeStudentsContainer");
        if (data.student_insights.most_active.length > 0) {
            let activeHtml = "";
            data.student_insights.most_active.forEach(s => {
                activeHtml += `
                    <div class="insight-row border-0 py-2">
                        <span class="text-white">${s.name}</span>
                        <span class="badge bg-gold text-black rounded-pill">${s.count} Rewards</span>
                    </div>
                `;
            });
            activeContainer.innerHTML = activeHtml;
        } else {
            activeContainer.innerHTML = `<div class="text-muted small text-center py-3">No reward data available.</div>`;
        }

        // 5. Recent Activity
        const activityBody = document.getElementById("activityFeedBody");
        if (data.recent_activity.length > 0) {
            let actHtml = "";
            data.recent_activity.forEach(a => {
                // Color code badges based on event type
                let badgeClass = 'bg-secondary';
                if (a.type.includes('reward_approved') || a.type.includes('verification_approved')) badgeClass = 'bg-success';
                else if (a.type.includes('reward_rejected')) badgeClass = 'bg-danger';
                else if (a.type.includes('reward_requested')) badgeClass = 'bg-warning text-dark';
                
                const formattedType = a.type.replace(/_/g, ' ').toUpperCase();
                
                actHtml += `
                    <tr>
                        <td class="border-0"><span class="badge ${badgeClass}" style="font-size:0.7rem;">${formattedType}</span></td>
                        <td class="border-0 text-white">${a.message}</td>
                        <td class="border-0 text-muted small">${new Date(a.date).toLocaleString()}</td>
                    </tr>
                `;
            });
            activityBody.innerHTML = actHtml;
        } else {
            activityBody.innerHTML = `<tr><td colspan="3" class="text-center text-muted border-0 py-4">No recent activity found.</td></tr>`;
        }

        // Render Charts
        renderCharts(data.charts);
    }

    function renderCharts(chartsData) {
        // Line Chart
        if (rewardsLineChart) rewardsLineChart.destroy();
        const ctxLine = document.getElementById('rewardsLineChart').getContext('2d');
        const lineLabels = chartsData.rewards_over_time.map(r => r.date);
        const lineData = chartsData.rewards_over_time.map(r => r.amount);
        
        rewardsLineChart = new Chart(ctxLine, {
            type: 'line',
            data: {
                labels: lineLabels,
                datasets: [{
                    label: 'SKA Distributed',
                    data: lineData,
                    borderColor: theme.gold,
                    backgroundColor: theme.goldDark,
                    borderWidth: 2,
                    tension: 0.4,
                    fill: true,
                    pointBackgroundColor: theme.gold,
                    pointRadius: 3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { color: theme.gridLines, drawBorder: false } },
                    y: { grid: { color: theme.gridLines, drawBorder: false }, beginAtZero: true }
                }
            }
        });

        // Bar Chart
        if (topStudentsBarChart) topStudentsBarChart.destroy();
        const ctxBar = document.getElementById('topStudentsBarChart').getContext('2d');
        const barLabels = chartsData.top_students.map(r => r.name);
        const barData = chartsData.top_students.map(r => r.amount);

        topStudentsBarChart = new Chart(ctxBar, {
            type: 'bar',
            data: {
                labels: barLabels,
                datasets: [{
                    label: 'Total SKA',
                    data: barData,
                    backgroundColor: theme.goldLight,
                    borderColor: theme.gold,
                    borderWidth: 1,
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { display: false } },
                    y: { grid: { color: theme.gridLines }, beginAtZero: true }
                }
            }
        });

        // Doughnut Chart
        if (achievementDoughnutChart) achievementDoughnutChart.destroy();
        const ctxDoughnut = document.getElementById('achievementDoughnutChart').getContext('2d');
        const achLabels = Object.keys(chartsData.achievement_distribution);
        const achData = Object.values(chartsData.achievement_distribution);
        
        // Generate gradient-like colors for achievement
        const achColors = [theme.gold, '#e67e22', '#e74c3c', '#9b59b6', '#3498db', '#1abc9c', '#34495e'];

        achievementDoughnutChart = new Chart(ctxDoughnut, {
            type: 'doughnut',
            data: {
                labels: achLabels,
                datasets: [{
                    data: achData,
                    backgroundColor: achColors.slice(0, achLabels.length),
                    borderWidth: 0,
                    hoverOffset: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '70%',
                plugins: {
                    legend: { position: 'right', labels: { color: theme.textPrimary, font: { size: 11 } } }
                }
            }
        });

        // Pie Chart
        if (statusPieChart) statusPieChart.destroy();
        const ctxPie = document.getElementById('statusPieChart').getContext('2d');
        const statLabels = Object.keys(chartsData.status_distribution).map(s => s.toUpperCase());
        const statData = Object.values(chartsData.status_distribution);
        
        // Match status colors: approved=success, pending=warning, rejected=danger
        const statColors = Object.keys(chartsData.status_distribution).map(s => {
            if (s === 'approved') return theme.success;
            if (s === 'pending') return theme.warning;
            if (s === 'rejected') return theme.danger;
            return theme.gold;
        });

        statusPieChart = new Chart(ctxPie, {
            type: 'pie',
            data: {
                labels: statLabels,
                datasets: [{
                    data: statData,
                    backgroundColor: statColors,
                    borderWidth: 0,
                    hoverOffset: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom', labels: { color: theme.textPrimary, font: { size: 11 } } }
                }
            }
        });
    }

    // Export CSV
    exportCsvBtn.addEventListener("click", () => {
        if (!currentData) return;
        
        let csvContent = "data:text/csv;charset=utf-8,";
        
        // Overview
        csvContent += "Overview Metrics\r\n";
        csvContent += "Total Students,Active Students,Rewards Issued,SKA Distributed,Avg Reward\r\n";
        csvContent += `${currentData.overview.total_students},${currentData.overview.active_students},${currentData.overview.rewards_issued},${currentData.overview.ska_distributed},${currentData.overview.avg_reward}\r\n\r\n`;

        // Top Students
        csvContent += "Top Rewarded Students\r\n";
        csvContent += "Student Name,Total SKA\r\n";
        currentData.charts.top_students.forEach(s => {
            csvContent += `${s.name},${s.amount}\r\n`;
        });
        csvContent += "\r\n";

        // Performance
        csvContent += "University Performance\r\n";
        csvContent += "Quota Allocated,Quota Used,Approval Rate\r\n";
        csvContent += `${currentData.university_performance.quota_allocated},${currentData.university_performance.quota_used},${currentData.university_performance.approval_rate}%\r\n`;

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `SIKKA_Analytics_${timeFilter.value}_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });

    // Handle Filter Changes
    timeFilter.addEventListener("change", (e) => {
        fetchAnalytics(e.target.value);
    });

    // Initial Load
    fetchAnalytics();
});
