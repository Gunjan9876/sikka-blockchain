    document.addEventListener("DOMContentLoaded", async function() {
        const token = sessionStorage.getItem("sikka_access");
        if (!token) {
            window.location.href = '/accounts/login/';
            return;
        }

        // Image Preview Logic
        const imageInput = document.getElementById('profileImageInput');
        const previewImg = document.getElementById('avatarPreview');
        let selectedFile = null;

        imageInput.addEventListener('change', function() {
            if (this.files && this.files[0]) {
                selectedFile = this.files[0];
                const reader = new FileReader();
                reader.onload = function(e) {
                    previewImg.src = e.target.result;
                }
                reader.readAsDataURL(selectedFile);
            }
        });

        // Fetch Profile Data
        try {
            const response = await fetch("/api/v1/accounts/profile/", {
                headers: { "Authorization": `Bearer ${token}` }
            });
            const data = await response.json();
            
            if (response.ok) {
                document.getElementById('username').value = data.username || '';
                document.getElementById('email').value = data.email || '';
                document.getElementById('phone').value = data.phone || '';
                
                // Set Avatar
                if (data.profile_image) {
                    previewImg.src = data.profile_image;
                } else {
                    previewImg.src = `https://ui-avatars.com/api/?name=${data.username}&background=random`;
                }
                
                // Fetch Wallet details
                fetch("/api/v1/wallet/", {
                    headers: { "Authorization": `Bearer ${token}` }
                }).then(res => res.json()).then(walletData => {
                    if (walletData.address) {
                        document.getElementById('walletAddressDisplay').value = walletData.address;
                        document.getElementById('btnCopyAddress').disabled = false;
                    }
                }).catch(e => console.log(e));

                // Badges
                const emailBadge = document.getElementById('emailStatusBadge');
                if (data.email_verified) {
                    emailBadge.textContent = "Verified";
                    emailBadge.className = "status-badge status-verified";
                } else {
                    emailBadge.textContent = "Unverified";
                    emailBadge.className = "status-badge status-pending";
                }

                const totpBadge = document.getElementById('totpStatusBadge');
                const totpAction = document.getElementById('totpActionContainer');
                if (data.totp_enabled) {
                    totpBadge.textContent = "Enabled";
                    totpBadge.className = "status-badge status-verified";
                    totpAction.innerHTML = `<button class="btn btn-sm btn-outline-danger w-100" id="btnDisable2FAInit">Disable 2FA</button>`;
                } else {
                    totpBadge.textContent = "Disabled";
                    totpBadge.className = "status-badge status-pending";
                    totpAction.innerHTML = `<button class="btn btn-sm btn-outline-gold w-100" id="btnEnable2FAInit">Enable 2FA</button>`;
                }
                
                // Attach 2FA event listeners
                attach2FAListeners();
                
                const walletBadge = document.getElementById('walletStatusBadge');
                if (data.wallet_status === 'active') {
                    walletBadge.textContent = "Active";
                    walletBadge.className = "status-badge status-verified";
                } else {
                    walletBadge.textContent = data.wallet_status || "Not Created";
                    walletBadge.className = "status-badge status-pending";
                }
            } else if (response.status === 401) {
                window.location.href = '/accounts/login/';
            } else {
                console.error("Failed to fetch profile data");
            }
        } catch (err) {
            console.error("Error loading profile", err);
        }

        // Save Profile Logic
        const form = document.getElementById('profileSettingsForm');
        form.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const btn = document.getElementById('btnSaveProfile');
            const originalContent = btn.innerHTML;
            btn.innerHTML = `<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Saving...`;
            btn.disabled = true;

            const formData = new FormData();
            formData.append("phone", document.getElementById('phone').value);
            formData.append("first_name", document.getElementById('firstName').value);
            formData.append("last_name", document.getElementById('lastName').value);
            
            if (selectedFile) {
                formData.append("profile_image", selectedFile);
            }

            try {
                const response = await fetch("/api/v1/accounts/profile/", {
                    method: "POST",
                    headers: { 
                        "Authorization": `Bearer ${token}`,
                        "X-CSRFToken": getCookie("csrftoken")
                    },
                    body: formData
                });
                
                const result = await response.json();
                const alertContainer = document.getElementById('settingsAlertContainer');
                
                if (response.ok) {
                    alertContainer.innerHTML = `
                        <div class="alert alert-success alert-dismissible fade show" role="alert">
                            <i class="bi bi-check-circle-fill me-2"></i> ${result.message}
                            <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
                        </div>
                    `;
                } else {
                    alertContainer.innerHTML = `
                        <div class="alert alert-danger alert-dismissible fade show" role="alert">
                            <i class="bi bi-exclamation-triangle-fill me-2"></i> Error saving profile.
                            <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
                        </div>
                    `;
                }
            } catch (err) {
                console.error(err);
            } finally {
                btn.innerHTML = originalContent;
                btn.disabled = false;
            }
        });

        // Function to get CSRF token
        function getCookie(name) {
            let cookieValue = null;
            if (document.cookie && document.cookie !== '') {
                const cookies = document.cookie.split(';');
                for (let i = 0; i < cookies.length; i++) {
                    const cookie = cookies[i].trim();
                    if (cookie.substring(0, name.length + 1) === (name + '=')) {
                        cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                        break;
                    }
                }
            }
            return cookieValue;
        }

        // Change Password Logic
        const pwdForm = document.getElementById('changePasswordForm');
        pwdForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const btn = document.getElementById('btnChangePassword');
            const alertContainer = document.getElementById('passwordAlertContainer');
            
            const oldPwd = document.getElementById('oldPassword').value;
            const newPwd = document.getElementById('newPassword').value;
            const confirmPwd = document.getElementById('confirmNewPassword').value;

            btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span> Updating...`;
            btn.disabled = true;

            try {
                const response = await fetch("/api/v1/accounts/password-change/", {
                    method: "POST",
                    headers: { 
                        "Authorization": `Bearer ${token}`,
                        "Content-Type": "application/json",
                        "X-CSRFToken": getCookie("csrftoken")
                    },
                    body: JSON.stringify({
                        old_password: oldPwd,
                        new_password: newPwd,
                        confirm_password: confirmPwd
                    })
                });
                
                const result = await response.json();
                
                if (response.ok) {
                    alertContainer.innerHTML = `<div class="alert alert-success small py-2"><i class="bi bi-check-circle"></i> ${result.message}</div>`;
                    pwdForm.reset();
                    setTimeout(() => {
                        const modal = bootstrap.Modal.getInstance(document.getElementById('changePasswordModal'));
                        modal.hide();
                        alertContainer.innerHTML = '';
                    }, 2000);
                } else {
                    let errorMsgs = [];
                    for(let key in result) {
                        errorMsgs.push(Array.isArray(result[key]) ? result[key][0] : result[key]);
                    }
                    alertContainer.innerHTML = `<div class="alert alert-danger small py-2"><i class="bi bi-exclamation-triangle"></i> ${errorMsgs.join("<br>")}</div>`;
                }
            } catch (err) {
                alertContainer.innerHTML = `<div class="alert alert-danger small py-2"><i class="bi bi-exclamation-triangle"></i> Network error occurred.</div>`;
            } finally {
                btn.innerHTML = "Update Password";
                btn.disabled = false;
            }
        });

        // 2FA Logic
        function attach2FAListeners() {
            const btnEnable = document.getElementById('btnEnable2FAInit');
            const btnDisable = document.getElementById('btnDisable2FAInit');
            const setupSection = document.getElementById('section-2fa-setup');
            const disableSection = document.getElementById('section-2fa-disable');

            if (btnEnable) {
                btnEnable.addEventListener('click', async function() {
                    btnEnable.innerHTML = `<span class="spinner-border spinner-border-sm"></span> Loading...`;
                    btnEnable.disabled = true;
                    
                    try {
                        const response = await fetch("/api/v1/accounts/2fa/setup/", {
                            headers: { "Authorization": `Bearer ${token}` }
                        });
                        const data = await response.json();
                        if (response.ok) {
                            document.getElementById('qr-image').src = data.qr_code;
                            document.getElementById('totp-manual-key').textContent = data.secret;
                            btnEnable.style.display = 'none';
                            setupSection.style.display = 'block';
                        } else {
                            alert(data.error || "Failed to initiate 2FA setup.");
                            btnEnable.innerHTML = "Enable 2FA";
                            btnEnable.disabled = false;
                        }
                    } catch (err) {
                        console.error(err);
                        alert("Network error. Please try again.");
                        btnEnable.innerHTML = "Enable 2FA";
                        btnEnable.disabled = false;
                    }
                });
            }

            if (btnDisable) {
                btnDisable.addEventListener('click', function() {
                    btnDisable.style.display = 'none';
                    disableSection.style.display = 'block';
                });
            }
        }

        // Verify 2FA
        document.getElementById('btn-verify-totp').addEventListener('click', async function() {
            const otp = document.getElementById('totp-verify-otp').value;
            if (otp.length !== 6) return alert("OTP must be 6 digits.");
            
            const btn = document.getElementById('btn-verify-totp');
            btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span>`;
            btn.disabled = true;
            
            try {
                const response = await fetch("/api/v1/accounts/2fa/verify/", {
                    method: "POST",
                    headers: { 
                        "Authorization": `Bearer ${token}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({ otp })
                });
                if (response.ok) {
                    location.reload();
                } else {
                    const data = await response.json();
                    alert(data.error || "Invalid OTP");
                    btn.innerHTML = "Verify";
                    btn.disabled = false;
                }
            } catch (err) {
                console.error(err);
                btn.innerHTML = "Verify";
                btn.disabled = false;
            }
        });

        // Disable 2FA
        document.getElementById('btn-disable-totp').addEventListener('click', async function() {
            const otp = document.getElementById('totp-disable-otp').value;
            if (otp.length !== 6) return alert("OTP must be 6 digits.");
            
            const btn = document.getElementById('btn-disable-totp');
            btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span>`;
            btn.disabled = true;
            
            try {
                const response = await fetch("/api/v1/accounts/2fa/disable/", {
                    method: "POST",
                    headers: { 
                        "Authorization": `Bearer ${token}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({ otp })
                });
                if (response.ok) {
                    location.reload();
                } else {
                    const data = await response.json();
                    alert(data.error || "Invalid OTP");
                    btn.innerHTML = "Confirm Disable";
                    btn.disabled = false;
                }
            } catch (err) {
                console.error(err);
                btn.innerHTML = "Confirm Disable";
                btn.disabled = false;
            }
        });

        // Theme Toggle Logic
        const themeSwitch = document.getElementById('themeSwitch');
        if (themeSwitch) {
            themeSwitch.checked = document.documentElement.getAttribute('data-theme') === 'dark';
            themeSwitch.addEventListener('change', function() {
                const newTheme = this.checked ? 'dark' : 'light';
                document.documentElement.setAttribute('data-theme', newTheme);
                document.documentElement.setAttribute('data-bs-theme', newTheme);
                localStorage.setItem('sikka_theme', newTheme);
            });
        }
    });

    function copyWalletAddress() {
        const address = document.getElementById('walletAddressDisplay').value;
        if(address && address !== 'Loading...') {
            navigator.clipboard.writeText(address);
            alert("Wallet address copied to clipboard!");
        }
    }
