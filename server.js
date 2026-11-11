const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const pino = require('pino');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');

const app = express();
const PORT = process.env.PORT || 3000;
const AUTH_DIR = path.join(__dirname, 'auth_info');
const SCHEDULES_FILE = path.join(__dirname, 'schedules.json');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Global state
let sock = null;
let connectionStatus = 'close'; // 'close' | 'connecting' | 'open'
let qrCodeDataUrl = null;
let userPhone = null;
let cachedGroups = [];

// Helper: load schedules
function loadSchedules() {
    try {
        if (!fs.existsSync(SCHEDULES_FILE)) {
            fs.writeFileSync(SCHEDULES_FILE, JSON.stringify([], null, 2));
            return [];
        }
        const data = fs.readFileSync(SCHEDULES_FILE, 'utf-8');
        return JSON.parse(data || '[]');
    } catch (err) {
        console.error('Error loading schedules:', err);
        return [];
    }
}

// Helper: save schedules
function saveSchedules(schedules) {
    try {
        fs.writeFileSync(SCHEDULES_FILE, JSON.stringify(schedules, null, 2));
    } catch (err) {
        console.error('Error saving schedules:', err);
    }
}

// Format Indonesian phone numbers to JID
function formatToJid(target, type) {
    if (type === 'group') {
        if (!target.endsWith('@g.us')) {
            return `${target}@g.us`;
        }
        return target;
    }

    // Direct phone number
    let clean = target.replace(/[^0-9]/g, '');
    if (clean.startsWith('0')) {
        clean = '62' + clean.slice(1);
    } else if (clean.startsWith('8')) {
        clean = '628' + clean.slice(1);
    }
    return `${clean}@s.whatsapp.net`;
}

// Connect to WhatsApp
async function connectToWhatsApp() {
    connectionStatus = 'connecting';
    qrCodeDataUrl = null;

    if (!fs.existsSync(AUTH_DIR)) {
        fs.mkdirSync(AUTH_DIR, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: true,
        browser: ['WA Auto Scheduler', 'Chrome', '1.0.0'],
        syncFullHistory: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            try {
                qrCodeDataUrl = await QRCode.toDataURL(qr, { margin: 2, scale: 7 });
                connectionStatus = 'connecting';
            } catch (err) {
                console.error('Failed to generate QR data URL:', err);
            }
        }

        if (connection === 'open') {
            connectionStatus = 'open';
            qrCodeDataUrl = null;
            userPhone = sock.user?.id ? sock.user.id.split(':')[0] : null;
            console.log(`[WA] Terhubung sebagai: ${userPhone}`);
            refreshGroups();
        } else if (connection === 'close') {
            connectionStatus = 'close';
            userPhone = null;
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            console.log(`[WA] Koneksi terputus (status: ${statusCode}). Reconnect: ${shouldReconnect}`);

            if (shouldReconnect) {
                setTimeout(connectToWhatsApp, 5000);
            } else {
                console.log('[WA] Sesi telah logout.');
                // Clean auth dir
                try {
                    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
                } catch (e) {}
                setTimeout(connectToWhatsApp, 3000);
            }
        }
    });
}

// Refresh WhatsApp groups
async function refreshGroups() {
    if (!sock || connectionStatus !== 'open') return [];
    try {
        const groups = await sock.groupFetchAllParticipating();
        cachedGroups = Object.values(groups).map((g) => ({
            id: g.id,
            subject: g.subject || 'Tanpa Nama',
            size: g.participants?.length || 0
        })).sort((a, b) => a.subject.localeCompare(b.subject));
        return cachedGroups;
    } catch (err) {
        console.error('Failed to fetch groups:', err);
        return cachedGroups;
    }
}

// Background scheduler runner (checks every 10 seconds)
setInterval(async () => {
    if (!sock || connectionStatus !== 'open') return;

    const schedules = loadSchedules();
    const now = new Date();
    let hasChanges = false;

    for (const item of schedules) {
        if (item.status === 'pending') {
            const scheduledTime = new Date(item.scheduledAt);
            if (scheduledTime <= now) {
                console.log(`[Scheduler] Mengirim pesan terjadwal #${item.id} ke ${item.targetName} (${item.target})...`);
                try {
                    const jid = formatToJid(item.target, item.targetType);
                    await sock.sendMessage(jid, { text: item.message });
                    item.status = 'sent';
                    item.sentAt = new Date().toISOString();
                    console.log(`[Scheduler] Pesan #${item.id} BERHASIL terkirim!`);
                } catch (err) {
                    console.error(`[Scheduler] Pesan #${item.id} GAGAL:`, err.message);
                    item.status = 'failed';
                    item.error = err.message;
                }
                hasChanges = true;
            }
        }
    }

    if (hasChanges) {
        saveSchedules(schedules);
    }
}, 10000);

// API Endpoints
// 1. Get status & QR code
app.get('/api/status', (req, res) => {
    res.json({
        status: connectionStatus,
        userPhone,
        qr: qrCodeDataUrl
    });
});

// 2. Get list of groups
app.get('/api/groups', async (req, res) => {
    if (connectionStatus !== 'open') {
        return res.json({ groups: [] });
    }
    const groups = await refreshGroups();
    res.json({ groups });
});

// 3. Get all schedules
app.get('/api/schedules', (req, res) => {
    const schedules = loadSchedules();
    res.json({ schedules });
});

// 4. Create new schedule
app.post('/api/schedules', (req, res) => {
    const { target, targetType, targetName, message, scheduledAt } = req.body;

    if (!target || !message || !scheduledAt) {
        return res.status(400).json({ error: 'Target, pesan, dan waktu jadwal wajib diisi!' });
    }

    const schedules = loadSchedules();
    const newSchedule = {
        id: 'SCH_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
        target: target.trim(),
        targetType: targetType || 'contact',
        targetName: targetName || target,
        message: message.trim(),
        scheduledAt: new Date(scheduledAt).toISOString(),
        createdAt: new Date().toISOString(),
        status: 'pending',
        sentAt: null,
        error: null
    };

    schedules.unshift(newSchedule);
    saveSchedules(schedules);

    res.json({ success: true, schedule: newSchedule });
});

// 5. Delete or cancel schedule
app.delete('/api/schedules/:id', (req, res) => {
    const { id } = req.params;
    let schedules = loadSchedules();
    const beforeCount = schedules.length;
    schedules = schedules.filter(s => s.id !== id);

    if (schedules.length === beforeCount) {
        return res.status(404).json({ error: 'Jadwal tidak ditemukan' });
    }

    saveSchedules(schedules);
    res.json({ success: true });
});

// 6. Send message immediately (Instant Send)
app.post('/api/send-now', async (req, res) => {
    if (!sock || connectionStatus !== 'open') {
        return res.status(400).json({ error: 'WhatsApp belum terhubung!' });
    }

    const { target, targetType, message } = req.body;
    if (!target || !message) {
        return res.status(400).json({ error: 'Target dan pesan wajib diisi!' });
    }

    try {
        const jid = formatToJid(target.trim(), targetType || 'contact');
        await sock.sendMessage(jid, { text: message });
        res.json({ success: true, message: 'Pesan berhasil langsung dikirim!' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 7. Logout / unlink session
app.post('/api/logout', async (req, res) => {
    try {
        if (sock) {
            await sock.logout();
        }
        try {
            fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        } catch (e) {}
        connectionStatus = 'close';
        qrCodeDataUrl = null;
        userPhone = null;
        res.json({ success: true, message: 'Sesi WhatsApp berhasil diputus.' });
        setTimeout(connectToWhatsApp, 1500);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Start server and initialize WhatsApp
app.listen(PORT, '0.0.0.0', () => {
    console.log(`====================================================`);
    console.log(`🚀 WA Auto Scheduler Server berjalan di:`);
    console.log(`   - Local PC : http://localhost:${PORT}`);
    console.log(`   - Akses HP : Buka IP Wi-Fi PC Anda di port ${PORT}`);
    console.log(`====================================================`);
    connectToWhatsApp();
});
