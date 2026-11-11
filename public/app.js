document.addEventListener('DOMContentLoaded', () => {
    // State
    let currentTab = 'paneConnection';
    let currentTargetType = 'contact';
    let currentFilter = 'all';
    let schedulesData = [];
    let isConnected = false;

    // Elements
    const globalStatusPill = document.getElementById('globalStatusPill');
    const statusText = document.getElementById('statusText');
    const headerSubtitle = document.getElementById('headerSubtitle');

    const qrContainer = document.getElementById('qrContainer');
    const qrSpinner = document.getElementById('qrSpinner');
    const qrImage = document.getElementById('qrImage');
    const qrHint = document.getElementById('qrHint');

    const connectedContainer = document.getElementById('connectedContainer');
    const connectedPhone = document.getElementById('connectedPhone');
    const btnLogout = document.getElementById('btnLogout');

    const btnTypeContact = document.getElementById('btnTypeContact');
    const btnTypeGroup = document.getElementById('btnTypeGroup');
    const groupContactTarget = document.getElementById('groupContactTarget');
    const groupGroupTarget = document.getElementById('groupGroupTarget');
    const targetContact = document.getElementById('targetContact');
    const selectGroup = document.getElementById('selectGroup');
    const btnRefreshGroups = document.getElementById('btnRefreshGroups');

    const messageText = document.getElementById('messageText');
    const charCount = document.getElementById('charCount');
    const scheduledAt = document.getElementById('scheduledAt');
    const formSchedule = document.getElementById('formSchedule');
    const btnSendImmediately = document.getElementById('btnSendImmediately');

    const scheduleListContainer = document.getElementById('scheduleListContainer');
    const btnReloadSchedules = document.getElementById('btnReloadSchedules');

    const countAll = document.getElementById('countAll');
    const countPending = document.getElementById('countPending');
    const countSent = document.getElementById('countSent');
    const countFailed = document.getElementById('countFailed');

    const toastNotification = document.getElementById('toastNotification');

    // Default datetime-local: 5 minutes from now
    setDefaultScheduleTime(5);

    // Navigation Tabs
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const targetPaneId = item.dataset.target;
            switchTab(targetPaneId);
        });
    });

    function switchTab(paneId) {
        currentTab = paneId;
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

        const targetPane = document.getElementById(paneId);
        if (targetPane) targetPane.classList.add('active');

        const activeNav = document.querySelector(`.nav-item[data-target="${paneId}"]`);
        if (activeNav) activeNav.classList.add('active');

        if (paneId === 'paneHistory') {
            fetchSchedules();
        } else if (paneId === 'paneSchedule' && isConnected) {
            fetchGroups();
        }
    }

    // Target Type Toggling (Kontak vs Grup)
    btnTypeContact.addEventListener('click', () => {
        currentTargetType = 'contact';
        btnTypeContact.classList.add('active');
        btnTypeGroup.classList.remove('active');
        groupContactTarget.style.display = 'block';
        groupGroupTarget.style.display = 'none';
    });

    btnTypeGroup.addEventListener('click', () => {
        currentTargetType = 'group';
        btnTypeGroup.classList.add('active');
        btnTypeContact.classList.remove('active');
        groupContactTarget.style.display = 'none';
        groupGroupTarget.style.display = 'block';
        fetchGroups();
    });

    // Character counter for message
    messageText.addEventListener('input', () => {
        charCount.textContent = `${messageText.value.length} karakter`;
    });

    // Time Shortcut Chips
    document.querySelectorAll('.shortcut-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const mins = chip.dataset.mins;
            const special = chip.dataset.special;

            if (mins) {
                setDefaultScheduleTime(parseInt(mins, 10));
                showToast(`Waktu diatur +${mins} menit ke depan`);
            } else if (special === 'tomorrow-8am') {
                const tomorrow = new Date();
                tomorrow.setDate(tomorrow.getDate() + 1);
                tomorrow.setHours(8, 0, 0, 0);
                scheduledAt.value = formatForDateTimeInput(tomorrow);
                showToast('Waktu diatur Besok pukul 08:00');
            }
        });
    });

    function setDefaultScheduleTime(plusMinutes) {
        const d = new Date(Date.now() + plusMinutes * 60 * 1000);
        scheduledAt.value = formatForDateTimeInput(d);
    }

    function formatForDateTimeInput(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day}T${hours}:${minutes}`;
    }

    // Refresh Groups Button
    btnRefreshGroups.addEventListener('click', () => {
        fetchGroups(true);
    });

    async function fetchGroups(showNotice = false) {
        if (!isConnected) return;
        try {
            selectGroup.innerHTML = '<option value="" disabled selected>Sedang memuat grup...</option>';
            const res = await fetch('/api/groups');
            const data = await res.json();
            
            if (data.groups && data.groups.length > 0) {
                selectGroup.innerHTML = '<option value="" disabled selected>-- Pilih Salah Satu Grup --</option>';
                data.groups.forEach(g => {
                    const opt = document.createElement('option');
                    opt.value = g.id;
                    opt.textContent = `${g.subject} (${g.size} anggota)`;
                    selectGroup.appendChild(opt);
                });
                if (showNotice) showToast(`Berhasil memuat ${data.groups.length} grup`);
            } else {
                selectGroup.innerHTML = '<option value="" disabled selected>Belum ada grup yang ditemukan</option>';
            }
        } catch (err) {
            console.error('Fetch groups error:', err);
            selectGroup.innerHTML = '<option value="" disabled selected>Gagal memuat grup</option>';
        }
    }

    // Poll Status (QR code and Connection)
    async function checkStatus() {
        try {
            const res = await fetch('/api/status');
            const data = await res.json();

            if (data.status === 'open') {
                isConnected = true;
                globalStatusPill.className = 'status-pill status-open';
                statusText.textContent = 'Terhubung';
                headerSubtitle.textContent = `Aktif (+${data.userPhone})`;

                qrContainer.style.display = 'none';
                connectedContainer.style.display = 'block';
                connectedPhone.textContent = `+${data.userPhone}`;
            } else if (data.status === 'connecting') {
                isConnected = false;
                globalStatusPill.className = 'status-pill status-connecting';
                statusText.textContent = 'Scan QR';
                headerSubtitle.textContent = 'Menunggu scan QR Code...';

                connectedContainer.style.display = 'none';
                qrContainer.style.display = 'flex';

                if (data.qr) {
                    qrSpinner.style.display = 'none';
                    qrImage.style.display = 'block';
                    qrImage.src = data.qr;
                    qrHint.textContent = 'Arahkan pemindai WhatsApp ke QR Code di atas';
                } else {
                    qrSpinner.style.display = 'block';
                    qrImage.style.display = 'none';
                    qrHint.textContent = 'Sedang membuat QR Code baru...';
                }
            } else {
                isConnected = false;
                globalStatusPill.className = 'status-pill status-close';
                statusText.textContent = 'Terputus';
                headerSubtitle.textContent = 'WhatsApp tidak terhubung';

                connectedContainer.style.display = 'none';
                qrContainer.style.display = 'flex';
                qrSpinner.style.display = 'block';
                qrImage.style.display = 'none';
                qrHint.textContent = 'Mencoba menghubungkan kembali...';
            }
        } catch (err) {
            console.error('Check status error:', err);
            globalStatusPill.className = 'status-pill status-close';
            statusText.textContent = 'Offline';
            headerSubtitle.textContent = 'Server tidak terjangkau';
        }
    }

    // Periodic status poll every 3 seconds
    setInterval(checkStatus, 3000);
    checkStatus();

    // Logout Action
    btnLogout.addEventListener('click', async () => {
        if (!confirm('Apakah Anda yakin ingin memutuskan sesi WhatsApp ini?')) return;
        try {
            showToast('Memutuskan sesi...');
            const res = await fetch('/api/logout', { method: 'POST' });
            const data = await res.json();
            showToast(data.message || 'Berhasil logout');
            checkStatus();
        } catch (err) {
            showToast('Gagal logout: ' + err.message);
        }
    });

    // Form Schedule Submit
    formSchedule.addEventListener('submit', async (e) => {
        e.preventDefault();

        const message = messageText.value.trim();
        const timeVal = scheduledAt.value;

        if (!message) {
            alert('Silakan tuliskan pesan!');
            return;
        }

        let target = '';
        let targetName = '';

        if (currentTargetType === 'contact') {
            const raw = targetContact.value.trim();
            if (!raw) {
                alert('Silakan masukkan nomor WhatsApp tujuan!');
                return;
            }
            target = raw;
            targetName = 'Kontak +' + (raw.startsWith('0') ? '62' + raw.slice(1) : raw);
        } else {
            const selectedOpt = selectGroup.options[selectGroup.selectedIndex];
            if (!selectGroup.value) {
                alert('Silakan pilih salah satu grup tujuan!');
                return;
            }
            target = selectGroup.value;
            targetName = selectedOpt ? selectedOpt.textContent.split(' (')[0] : target;
        }

        try {
            showToast('Menyimpan jadwal...');
            const res = await fetch('/api/schedules', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    target,
                    targetType: currentTargetType,
                    targetName,
                    message,
                    scheduledAt: timeVal
                })
            });

            const data = await res.json();
            if (data.success) {
                showToast('Jadwal pesan berhasil disimpan!');
                messageText.value = '';
                charCount.textContent = '0 karakter';
                targetContact.value = '';
                setDefaultScheduleTime(5);
                switchTab('paneHistory');
            } else {
                alert('Gagal: ' + (data.error || 'Terjadi kesalahan'));
            }
        } catch (err) {
            alert('Kesalahan jaringan: ' + err.message);
        }
    });

    // Send Immediately Button
    btnSendImmediately.addEventListener('click', async () => {
        if (!isConnected) {
            alert('WhatsApp belum terhubung! Silakan scan QR Code terlebih dahulu.');
            return;
        }

        const message = messageText.value.trim();
        if (!message) {
            alert('Silakan tuliskan pesan!');
            return;
        }

        let target = '';
        if (currentTargetType === 'contact') {
            const raw = targetContact.value.trim();
            if (!raw) {
                alert('Masukkan nomor WhatsApp tujuan!');
                return;
            }
            target = raw;
        } else {
            if (!selectGroup.value) {
                alert('Pilih grup tujuan!');
                return;
            }
            target = selectGroup.value;
        }

        if (!confirm('Kirim pesan ini sekarang juga ke ' + target + '?')) return;

        try {
            showToast('Mengirim pesan...');
            const res = await fetch('/api/send-now', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    target,
                    targetType: currentTargetType,
                    message
                })
            });
            const data = await res.json();
            if (data.success) {
                showToast('Pesan berhasil langsung terkirim!');
                messageText.value = '';
                charCount.textContent = '0 karakter';
            } else {
                alert('Gagal mengirim: ' + data.error);
            }
        } catch (err) {
            alert('Kesalahan jaringan: ' + err.message);
        }
    });

    // Fetch Schedules
    async function fetchSchedules() {
        try {
            const res = await fetch('/api/schedules');
            const data = await res.json();
            schedulesData = data.schedules || [];
            updateScheduleCounters();
            renderSchedules();
        } catch (err) {
            console.error('Fetch schedules error:', err);
        }
    }

    btnReloadSchedules.addEventListener('click', () => {
        fetchSchedules();
        showToast('Memperbarui daftar riwayat...');
    });

    // Filter Chips for History
    document.querySelectorAll('.filter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            currentFilter = chip.dataset.filter;
            renderSchedules();
        });
    });

    function updateScheduleCounters() {
        const total = schedulesData.length;
        const pending = schedulesData.filter(s => s.status === 'pending').length;
        const sent = schedulesData.filter(s => s.status === 'sent').length;
        const failed = schedulesData.filter(s => s.status === 'failed').length;

        countAll.textContent = total;
        countPending.textContent = pending;
        countSent.textContent = sent;
        countFailed.textContent = failed;
    }

    function renderSchedules() {
        let filtered = schedulesData;
        if (currentFilter !== 'all') {
            filtered = schedulesData.filter(s => s.status === currentFilter);
        }

        if (filtered.length === 0) {
            scheduleListContainer.innerHTML = `
                <div class="empty-state">
                    <i class="fa-regular fa-calendar-xmark"></i>
                    <p>Tidak ada jadwal pesan (${currentFilter}).</p>
                </div>
            `;
            return;
        }

        scheduleListContainer.innerHTML = '';
        filtered.forEach(item => {
            const card = document.createElement('div');
            card.className = `schedule-card status-${item.status}`;

            const iconType = item.targetType === 'group' ? 'fa-users' : 'fa-user';
            const scheduledDate = new Date(item.scheduledAt).toLocaleString('id-ID', {
                dateStyle: 'medium',
                timeStyle: 'short'
            });

            let statusLabel = 'Menunggu';
            let tagClass = 'tag-pending';
            if (item.status === 'sent') {
                statusLabel = 'Terkirim';
                tagClass = 'tag-sent';
            } else if (item.status === 'failed') {
                statusLabel = 'Gagal';
                tagClass = 'tag-failed';
            }

            card.innerHTML = `
                <div class="card-top">
                    <span class="target-badge">
                        <i class="fa-solid ${iconType}"></i> ${escapeHtml(item.targetName)}
                    </span>
                    <span class="status-tag ${tagClass}">${statusLabel}</span>
                </div>
                <div class="schedule-message-preview">${escapeHtml(item.message)}</div>
                <div class="schedule-time-meta">
                    <span><i class="fa-regular fa-clock"></i> ${scheduledDate}</span>
                    <div class="schedule-actions">
                        <button class="btn-icon-danger btn-delete-schedule" data-id="${item.id}" title="Hapus Jadwal">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>
                    </div>
                </div>
            `;

            scheduleListContainer.appendChild(card);
        });

        // Attach delete events
        document.querySelectorAll('.btn-delete-schedule').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.dataset.id;
                if (!confirm('Hapus jadwal ini?')) return;
                try {
                    const res = await fetch(`/api/schedules/${id}`, { method: 'DELETE' });
                    const data = await res.json();
                    if (data.success) {
                        showToast('Jadwal berhasil dihapus');
                        fetchSchedules();
                    }
                } catch (err) {
                    showToast('Gagal menghapus: ' + err.message);
                }
            });
        });
    }

    function escapeHtml(str) {
        if (!str) return '';
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function showToast(msg) {
        toastNotification.textContent = msg;
        toastNotification.classList.add('show');
        setTimeout(() => {
            toastNotification.classList.remove('show');
        }, 2500);
    }
});
