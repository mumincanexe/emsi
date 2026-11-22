let workingReadEndpoint = localStorage.getItem('mc_working_read_ep') || null;
// Etkinlik modülü durum değişkenleri
var selectedEventCityId = typeof selectedEventCityId !== 'undefined' ? selectedEventCityId : null;
var userCityFetched = typeof userCityFetched !== 'undefined' ? userCityFetched : false;
var currentOpenEventId = typeof currentOpenEventId !== 'undefined' ? currentOpenEventId : null;
var eventsListCache = new Map();

// Kamera Görünüm & Pinleme Durum Değişkenleri
var hideNonVideoParticipants = localStorage.getItem('mc_hide_no_cam') === 'true';
var hideAllCamerasMode = localStorage.getItem('mc_hide_all_cams') === 'true';
var pinnedParticipantIds = new Set(); // En fazla 4 kişi pinlenebilir
const MAX_PINNED_CAMERAS = 4;

// Bağlantı & RTC İstatistik Değişkenleri
var rtcStatsInterval = null;
var prevRtcStatsSnapshot = { bytesSent: 0, bytesReceived: 0, timestamp: 0 };
var isDiagnosticsPanelOpen = false;

// Anlık Avatar Çözümleme Önbelleği (Tekrarlayan API isteklerini önler)
var pendingAvatarFetches = new Set();
var failedAvatarLookups = new Map(); // username -> timestamp

window.addEventListener('DOMContentLoaded', () => {
    injectGlobalVideoAndAvatarFixStyles();
    initDraggablePopup();
    initInputEmojiGrid();
    initSidebarHoverLock();
    injectCameraAndDiagnosticsSettings();
    hookUpdateVideoUIForDynamicGrid();

    window.addEventListener('resize', () => {
        requestAnimationFrame(applyDynamicGridLayout);
    });

    const chatEl = document.getElementById('chatMessages');
    if (chatEl) {
        chatEl.addEventListener('scroll', function () {
            if (this.scrollTop <= 10) fetchOlderMessages();
            const isNearBottom = this.scrollHeight - this.clientHeight <= this.scrollTop + 130;
            if (isNearBottom) unreadMessagesCount = 0;
            updateScrollBottomButtonUI(isNearBottom);
        });
    }

    const token = localStorage.getItem('mc_token');
    if (token) {
        loadUserProfileUI();
        showApp();
        ensureChairoHubConnected();
        fetchActiveChannels();
        startPolling();
    } else {
        showLogin();
    }
});

// 1. KESİN ÇÖZÜM: Dikey veya yatay hiçbir kameranın büyütülüp kırpılmaması için Global CSS Kuralı
function injectGlobalVideoAndAvatarFixStyles() {
    if (document.getElementById('mcGlobalVideoContainStyle')) return;
    const style = document.createElement('style');
    style.id = 'mcGlobalVideoContainStyle';
    style.innerHTML = `
        /* Hiçbir kamera sığdırmak için büyütülmesin (zoom/crop olmasın), kenarlarında boşluk kalsın */
        #videoArea video,
        #videoGrid video,
        #spotlightMain video {
            object-fit: contain !important;
            background-color: #111214 !important;
            width: 100% !important;
            height: 100% !important;
            max-width: 100% !important;
            max-height: 100% !important;
        }
    `;
    document.head.appendChild(style);
}

// 2. KESİN ÇÖZÜM: Kamerasız kullanıcı girdiğinde baş harf (ui-avatars) yerine gerçek profil resmini anında bulup değiştiren sistem
function getCachedUserAvatarByUsername(rawUsername) {
    if (!rawUsername) return null;
    const clean = String(rawUsername).trim().replace(/\s*\(Sen\)\s*$/i, '').replace(/^@+/, '');
    if (!clean) return null;
    const cleanLower = clean.toLowerCase();

    // 1. Giriş yapmış kullanıcının kendisi mi?
    if (typeof currentLoggedUserInfo !== 'undefined' && currentLoggedUserInfo) {
        const myUname = String(currentLoggedUserInfo.username || '').trim().toLowerCase();
        if (myUname === cleanLower && currentLoggedUserInfo.pictureUrl) {
            return getDirectMediaUrl(currentLoggedUserInfo.pictureUrl);
        }
    }

    // 2. knownUsersMap içinde var mı?
    if (typeof findKnownUserByUsername === 'function') {
        const known = findKnownUserByUsername(clean);
        if (known && known.pictureUrl) return getDirectMediaUrl(known.pictureUrl);
    }
    if (typeof knownUsersMap !== 'undefined' && knownUsersMap instanceof Map) {
        for (const [k, val] of knownUsersMap.entries()) {
            const kClean = typeof stripEmojis === 'function' ? stripEmojis(k) : k;
            if (String(k).toLowerCase() === cleanLower || String(kClean).toLowerCase() === cleanLower) {
                if (val && val.pictureUrl) return getDirectMediaUrl(val.pictureUrl);
            }
        }
    }

    // 3. globalChannels içindeki voiceParticipants listesinde var mı?
    if (Array.isArray(globalChannels)) {
        for (const ch of globalChannels) {
            for (const vp of (ch.voiceParticipants || [])) {
                if (vp.username && vp.pictureUrl) {
                    const vpClean = typeof stripEmojis === 'function' ? stripEmojis(vp.username) : vp.username;
                    if (vp.username.toLowerCase() === cleanLower || vpClean.toLowerCase() === cleanLower) {
                        return getDirectMediaUrl(vp.pictureUrl);
                    }
                }
            }
        }
    }

    // 4. Sohbet mesajlarında (messagesMap) bu kullanıcının resmi var mı?
    if (typeof messagesMap !== 'undefined' && messagesMap instanceof Map) {
        for (const m of messagesMap.values()) {
            const mUser = String(m.userName || m.username || '').trim();
            if (mUser.toLowerCase() === cleanLower && m.pictureUrl) {
                return getDirectMediaUrl(m.pictureUrl);
            }
        }
    }

    return null;
}

// Kullanıcı odaya girdiğinde resmi henüz önbellekte yoksa API'den anında çeker ve DOM'daki <img> etiketlerini günceller
async function ensureUserAvatarLoadedAsync(rawUsername) {
    if (!rawUsername) return;
    const clean = String(rawUsername).trim().replace(/\s*\(Sen\)\s*$/i, '').replace(/^@+/, '');
    if (!clean || clean === 'Kullanıcı' || clean === 'Sen') return;

    // Zaten önbellekte varsa doğrudan DOM'u güncelle
    const existingPic = getCachedUserAvatarByUsername(clean);
    if (existingPic) {
        patchAvatarImagesInDom(clean, existingPic);
        return;
    }

    const keyLower = clean.toLowerCase();
    if (pendingAvatarFetches.has(keyLower)) return;

    // Son 30 saniye içinde denendi ve bulunamadıysa tekrar yorma
    const lastFail = failedAvatarLookups.get(keyLower);
    if (lastFail && Date.now() - lastFail < 30000) return;

    pendingAvatarFetches.add(keyLower);

    try {
        // 1. Önce kanal listesini hızlıca tazele (yeni giren kişinin pictureUrl'si kanal API'sinde hemen gelir)
        if (typeof fetchActiveChannels === 'function') {
            await fetchActiveChannels();
        }

        let resolvedPic = getCachedUserAvatarByUsername(clean);

        // 2. Hâlâ bulunamadıysa doğrudan kullanıcı API'sinden çek
        if (!resolvedPic) {
            const apiData = await fetchUserInfoFromApi(null, clean);
            if (apiData && apiData.pictureUrl) {
                resolvedPic = getDirectMediaUrl(apiData.pictureUrl);
                if (typeof knownUsersMap !== 'undefined') {
                    knownUsersMap.set(clean, {
                        ...(typeof findKnownUserByUsername === 'function' ? (findKnownUserByUsername(clean) || {}) : {}),
                        userId: apiData.id || null,
                        username: apiData.username || clean,
                        pictureUrl: resolvedPic
                    });
                }
            }
        }

        if (resolvedPic) {
            patchAvatarImagesInDom(clean, resolvedPic);
            renderSidebar(true);
        } else {
            failedAvatarLookups.set(keyLower, Date.now());
        }
    } catch (e) {
        failedAvatarLookups.set(keyLower, Date.now());
    } finally {
        pendingAvatarFetches.delete(keyLower);
    }
}

// Ekranda (videoGrid ve sol menüde) ilk iki harf (ui-avatars.com) gösteren tüm <img> etiketlerini gerçek profil resmiyle değiştirir
function patchAvatarImagesInDom(username, directPicUrl) {
    if (!username || !directPicUrl) return;
    const targetLower = String(username).trim().replace(/\s*\(Sen\)\s*$/i, '').toLowerCase();
    const optimizedUrl = typeof getOptimizedImageUrl === 'function' ? getOptimizedImageUrl(directPicUrl, 128) : directPicUrl;

    // 1. Video Grid içindeki kartların avatarlarını güncelle
    const videoArea = document.getElementById('videoArea');
    if (videoArea) {
        const cards = videoArea.querySelectorAll('[data-participant-id], .group');
        cards.forEach(card => {
            const cardKey = String(card.dataset.participantId || '').trim().replace(/\s*\(Sen\)\s*$/i, '').toLowerCase();
            const nameEl = card.querySelector('.truncate, [class*="bottom-"] span, span');
            const nameText = nameEl ? nameEl.textContent.trim().replace(/\s*\(Sen\)\s*$/i, '').toLowerCase() : '';

            if (cardKey === targetLower || nameText === targetLower) {
                const imgs = card.querySelectorAll('img');
                imgs.forEach(img => {
                    if (img.src !== optimizedUrl && img.src !== directPicUrl) {
                        img.src = optimizedUrl;
                    }
                });
            }
        });
    }

    // 2. Sol menüdeki (sidebar) kullanıcı satırlarının avatarlarını güncelle
    const sidebar = document.getElementById('sidebarChannels');
    if (sidebar) {
        const imgs = sidebar.querySelectorAll('img');
        imgs.forEach(img => {
            const row = img.closest('div.group\\/user');
            if (row) {
                const span = row.querySelector('span');
                const rowName = span ? span.textContent.trim().replace(/\s*\(Sen\)\s*$/i, '').toLowerCase() : '';
                if (rowName === targetLower) {
                    const smallUrl = typeof getOptimizedImageUrl === 'function' ? getOptimizedImageUrl(directPicUrl, 64) : directPicUrl;
                    if (img.src !== smallUrl) img.src = smallUrl;
                }
            }
        });
    }
}

// SOL KANAL MENÜSÜ / KİŞİ LİSTESİ ÜZERİNE GELİNDİĞİNDE LİSTE SIRALAMASINI DONDURUR
function initSidebarHoverLock() {
    const sidebar = document.getElementById('sidebarChannels');
    if (!sidebar) return;

    sidebar.addEventListener('mouseenter', () => {
        isHoveringParticipantList = true;
    });

    sidebar.addEventListener('mouseleave', () => {
        isHoveringParticipantList = false;
        renderSidebar(true);
    });
}

// ==========================================
// 📡 BAĞLANTI DURUMU, PAKET KAYBI VE SUNUCU TANILAMA MODÜLÜ
// ==========================================

function toggleConnectionDiagnosticsPanel() {
    isDiagnosticsPanelOpen = !isDiagnosticsPanelOpen;
    const panel = document.getElementById('mcDiagnosticsCollapsiblePanel');
    const chevron = document.getElementById('mcDiagnosticsChevron');

    if (panel) {
        if (isDiagnosticsPanelOpen) {
            panel.classList.remove('hidden');
            if (chevron) chevron.classList.add('rotate-180');
            startRtcStatsMonitoring();
        } else {
            panel.classList.add('hidden');
            if (chevron) chevron.classList.remove('rotate-180');
            stopRtcStatsMonitoring();
        }
    }
}

function startRtcStatsMonitoring() {
    stopRtcStatsMonitoring();
    collectAndRenderRtcDiagnostics();
    rtcStatsInterval = setInterval(() => {
        const deviceModal = document.getElementById('deviceSettingsModal');
        if (!deviceModal || deviceModal.classList.contains('hidden') || !isDiagnosticsPanelOpen) {
            stopRtcStatsMonitoring();
            return;
        }
        collectAndRenderRtcDiagnostics();
    }, 1500);
}

function stopRtcStatsMonitoring() {
    if (rtcStatsInterval) {
        clearInterval(rtcStatsInterval);
        rtcStatsInterval = null;
    }
}

function extractActivePeerConnections() {
    const pcs = [];
    try {
        if (typeof room !== 'undefined' && room && room.engine) {
            const engine = room.engine;
            if (engine.pcManager) {
                if (engine.pcManager.publisher && engine.pcManager.publisher.pc) {
                    pcs.push({ label: 'Publisher', pc: engine.pcManager.publisher.pc });
                }
                if (engine.pcManager.subscriber && engine.pcManager.subscriber.pc) {
                    pcs.push({ label: 'Subscriber', pc: engine.pcManager.subscriber.pc });
                }
            } else {
                if (engine.publisher && engine.publisher.pc) {
                    pcs.push({ label: 'Publisher', pc: engine.publisher.pc });
                }
                if (engine.subscriber && engine.subscriber.pc) {
                    pcs.push({ label: 'Subscriber', pc: engine.subscriber.pc });
                }
            }
        }
    } catch (e) {}
    return pcs;
}

async function measureApiPingMs() {
    const start = performance.now();
    try {
        const token = localStorage.getItem('mc_token');
        const target = (typeof apiBaseUrl !== 'undefined' && apiBaseUrl)
            ? `${apiBaseUrl}/get-active-channel`
            : 'https://api.meetingchallenge.com/Channel/get-active-channel';
        await fetch(target, {
            method: 'HEAD',
            headers: token ? { 'Authorization': `Bearer ${token}` } : {},
            cache: 'no-store'
        });
        return Math.round(performance.now() - start);
    } catch (e) {
        return null;
    }
}

async function collectAndRenderRtcDiagnostics() {
    const statusBadge = document.getElementById('diagOverallStatusBadge');
    const rttEl = document.getElementById('diagRttValue');
    const lossEl = document.getElementById('diagPacketLossValue');
    const jitterEl = document.getElementById('diagJitterValue');
    const bitrateEl = document.getElementById('diagBitrateValue');
    const serverEl = document.getElementById('diagServerInfoValue');
    const codecEl = document.getElementById('diagCodecProtocolValue');
    const hubEl = document.getElementById('diagSignalRStatusValue');

    if (!rttEl) return;

    const isVoiceActive = Boolean(typeof activeVoiceChannelId !== 'undefined' && activeVoiceChannelId && typeof room !== 'undefined' && room);
    const pcs = extractActivePeerConnections();

    let rttMs = null;
    let jitterMs = 0;
    let packetsLost = 0;
    let packetsTotal = 0;
    let totalBytesSent = 0;
    let totalBytesRecv = 0;
    let transportProtocol = 'UDP';
    let candidateType = 'Doğrudan';
    let remoteIpAddress = '';
    const codecsSet = new Set();

    if (isVoiceActive && pcs.length > 0) {
        for (const item of pcs) {
            try {
                const stats = await item.pc.getStats();
                stats.forEach(report => {
                    if (report.type === 'candidate-pair' && (report.nominated || report.state === 'succeeded')) {
                        if (typeof report.currentRoundTripTime === 'number') {
                            rttMs = Math.round(report.currentRoundTripTime * 1000);
                        }
                    }
                    if (report.type === 'remote-candidate') {
                        if (report.protocol) transportProtocol = String(report.protocol).toUpperCase();
                        if (report.candidateType) candidateType = report.candidateType;
                        if (report.address || report.ip) remoteIpAddress = report.address || report.ip;
                    }
                    if (report.type === 'inbound-rtp') {
                        packetsLost += Number(report.packetsLost || 0);
                        packetsTotal += Number(report.packetsReceived || 0) + Number(report.packetsLost || 0);
                        totalBytesRecv += Number(report.bytesReceived || 0);
                        if (typeof report.jitter === 'number') {
                            const j = Math.round(report.jitter * 1000);
                            if (j > jitterMs) jitterMs = j;
                        }
                    }
                    if (report.type === 'outbound-rtp') {
                        totalBytesSent += Number(report.bytesSent || 0);
                        packetsTotal += Number(report.packetsSent || 0);
                    }
                    if (report.type === 'codec' && report.mimeType) {
                        const shortCodec = String(report.mimeType).split('/')[1];
                        if (shortCodec) codecsSet.add(shortCodec.toUpperCase());
                    }
                });
            } catch (e) {}
        }
    }

    if (rttMs === null) {
        rttMs = await measureApiPingMs();
    }

    const now = performance.now();
    let upKbps = 0;
    let downKbps = 0;
    if (prevRtcStatsSnapshot.timestamp > 0 && now > prevRtcStatsSnapshot.timestamp) {
        const dtSec = (now - prevRtcStatsSnapshot.timestamp) / 1000;
        if (totalBytesSent >= prevRtcStatsSnapshot.bytesSent) {
            upKbps = Math.round(((totalBytesSent - prevRtcStatsSnapshot.bytesSent) * 8) / 1000 / dtSec);
        }
        if (totalBytesRecv >= prevRtcStatsSnapshot.bytesReceived) {
            downKbps = Math.round(((totalBytesRecv - prevRtcStatsSnapshot.bytesReceived) * 8) / 1000 / dtSec);
        }
    }
    prevRtcStatsSnapshot = { bytesSent: totalBytesSent, bytesReceived: totalBytesRecv, timestamp: now };

    const lossPercent = packetsTotal > 0 ? ((Math.max(0, packetsLost) / packetsTotal) * 100).toFixed(1) : '0.0';

    let qualityLabel = 'Mükemmel';
    let qualityClass = 'bg-mc-green/20 text-mc-green border-mc-green/30';
    if (!isVoiceActive) {
        qualityLabel = 'Ses Kanalına Bağlı Değil (API Aktif)';
        qualityClass = 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30';
    } else if ((rttMs && rttMs > 220) || Number(lossPercent) > 5) {
        qualityLabel = 'Zayıf Bağlantı';
        qualityClass = 'bg-mc-red/20 text-mc-red border-mc-red/30';
    } else if ((rttMs && rttMs > 120) || Number(lossPercent) > 1.5) {
        qualityLabel = 'Orta Kalite';
        qualityClass = 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30';
    }

    if (statusBadge) {
        statusBadge.className = `text-[10px] font-bold px-2 py-0.5 rounded-full border ${qualityClass}`;
        statusBadge.innerText = qualityLabel;
    }

    rttEl.innerHTML = rttMs !== null
        ? `<span class="${rttMs < 90 ? 'text-mc-green' : (rttMs < 170 ? 'text-yellow-400' : 'text-mc-red')}">${rttMs} ms</span>`
        : '<span class="text-gray-400">Ölçülüyor...</span>';

    lossEl.innerHTML = isVoiceActive
        ? `<span class="${Number(lossPercent) < 1 ? 'text-mc-green' : (Number(lossPercent) < 4 ? 'text-yellow-400' : 'text-mc-red')}">%${lossPercent}</span> <span class="text-[10px] text-gray-400 font-normal">(${packetsLost} pk)</span>`
        : '<span class="text-gray-400">%0.0 (0 pk)</span>';

    jitterEl.innerText = isVoiceActive ? `${jitterMs} ms` : '0 ms';
    bitrateEl.innerText = isVoiceActive ? `↑ ${upKbps} kbps / ↓ ${downKbps} kbps` : '↑ 0 kbps / ↓ 0 kbps';

    let roomServerText = 'API: api.meetingchallenge.com';
    if (isVoiceActive) {
        const chName = (typeof activeVoiceChannelName !== 'undefined' && activeVoiceChannelName) ? activeVoiceChannelName : 'Ses Odası';
        const sfuHost = (room?.engine?.url || remoteIpAddress || 'LiveKit SFU').replace(/^wss?:\/\//i, '').split('/')[0];
        roomServerText = `${chName} • ${sfuHost}`;
    }
    serverEl.innerText = roomServerText;

    const codecList = codecsSet.size > 0 ? Array.from(codecsSet).slice(0, 3).join(', ') : 'OPUS / VP8';
    codecEl.innerText = isVoiceActive ? `${transportProtocol} (${candidateType}) • ${codecList}` : 'HTTPS / WSS • Hazır';

    let hubStateText = 'Aktif (Senkronize)';
    if (typeof chairoHubConnection !== 'undefined' && chairoHubConnection && chairoHubConnection.state) {
        hubStateText = `SignalR: ${chairoHubConnection.state}`;
    }
    hubEl.innerText = hubStateText;
}

// ==========================================
// 🎥 SIFIR BOŞLUKLU VİDEO GRİD, DİKEY KAMERA KORUMASI, GİZLEME & PİNLEME MODÜLÜ
// ==========================================

function toggleHideNonVideoParticipants() {
    hideNonVideoParticipants = !hideNonVideoParticipants;
    localStorage.setItem('mc_hide_no_cam', String(hideNonVideoParticipants));
    syncCameraSettingsButtonsUI();
    if (typeof updateVideoUI === 'function') updateVideoUI();
    requestAnimationFrame(applyDynamicGridLayout);
}

function toggleHideAllCamerasMode() {
    hideAllCamerasMode = !hideAllCamerasMode;
    localStorage.setItem('mc_hide_all_cams', String(hideAllCamerasMode));
    syncCameraSettingsButtonsUI();
    if (typeof toggleHideAllCameras === 'function') {
        try { toggleHideAllCameras(hideAllCamerasMode); } catch (e) {}
    }
    if (typeof updateVideoUI === 'function') updateVideoUI();
    requestAnimationFrame(applyDynamicGridLayout);
}

function togglePinParticipant(participantKey, domEvent) {
    if (domEvent) domEvent.stopPropagation();
    if (!participantKey) return;
    const key = String(participantKey).trim();

    if (pinnedParticipantIds.has(key)) {
        pinnedParticipantIds.delete(key);
    } else {
        if (pinnedParticipantIds.size >= MAX_PINNED_CAMERAS) {
            showPinLimitToast(`En fazla ${MAX_PINNED_CAMERAS} kamera sabitleyebilirsiniz.`);
            return;
        }
        pinnedParticipantIds.add(key);
    }
    requestAnimationFrame(applyDynamicGridLayout);
}

function clearAllPinnedParticipants() {
    pinnedParticipantIds.clear();
    requestAnimationFrame(applyDynamicGridLayout);
}

function showPinLimitToast(msg) {
    let toast = document.getElementById('mcPinToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'mcPinToast';
        toast.className = 'fixed top-16 left-1/2 -translate-x-1/2 z-[9999] bg-[#111214]/95 text-white text-xs font-semibold px-4 py-2 rounded-lg border border-mc-primary/40 shadow-2xl transition-opacity duration-200 pointer-events-none';
        document.body.appendChild(toast);
    }
    toast.innerText = msg;
    toast.style.opacity = '1';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
        toast.style.opacity = '0';
    }, 2200);
}

function syncCameraSettingsButtonsUI() {
    const updateSwitch = (btnId, knobId, isActive) => {
        const btn = document.getElementById(btnId);
        const knob = document.getElementById(knobId);
        if (!btn || !knob) return;
        if (isActive) {
            btn.classList.remove('bg-[#1e1f22]');
            btn.classList.add('bg-mc-green');
            knob.classList.add('translate-x-5');
            knob.classList.remove('translate-x-0.5');
        } else {
            btn.classList.add('bg-[#1e1f22]');
            btn.classList.remove('bg-mc-green');
            knob.classList.remove('translate-x-5');
            knob.classList.add('translate-x-0.5');
        }
    };

    updateSwitch('btnToggleHideNoCamSettings', 'knobHideNoCamSettings', hideNonVideoParticipants);
    updateSwitch('btnToggleHideAllCamsSettings', 'knobHideAllCamsSettings', hideAllCamerasMode);
}

function injectCameraAndDiagnosticsSettings() {
    const deviceModal = document.getElementById('deviceSettingsModal');
    if (!deviceModal) return;

    // index.html içinde zaten #unifiedCameraSettingsGroup mevcutsa sadece buton durumlarını senkronize et
    if (document.getElementById('unifiedCameraSettingsGroup')) {
        syncCameraSettingsButtonsUI();
        return;
    }

    // Başlık satırına dokunmadan doğrudan #deviceSettingsBody içine yerleştir
    const targetContainer = document.getElementById('deviceSettingsBody') || deviceModal;

    const existingCheckboxes = targetContainer.querySelectorAll('input[type="checkbox"]');
    existingCheckboxes.forEach(cb => {
        const parentRow = cb.closest('div');
        if (parentRow && /kamera/i.test(parentRow.innerText || '')) {
            parentRow.style.display = 'none';
        }
    });

    const wrapper = document.createElement('div');
    wrapper.id = 'unifiedCameraSettingsGroup';
    wrapper.className = 'flex flex-col gap-2.5 pt-3 border-t border-white/10';
    wrapper.innerHTML = `
        <div class="text-[11px] font-bold text-gray-400 uppercase tracking-wider px-0.5">Kamera & Bağlantı Ayarları</div>

        <!-- 1. Tüm Kameraları Gizle -->
        <div class="flex items-center justify-between p-3 rounded-xl bg-[#2b2d31] hover:bg-[#313338] transition-colors border border-white/5">
            <div class="flex items-center gap-2.5 pr-2 min-w-0">
                <div class="p-2 rounded-lg bg-mc-primary/15 text-mc-primary shrink-0">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"></path>
                        <line x1="3" y1="3" x2="21" y2="21" stroke-width="2"></line>
                    </svg>
                </div>
                <div class="min-w-0">
                    <div class="text-xs font-bold text-white">Tüm Kameraları Gizle</div>
                    <div class="text-[11px] text-gray-400 leading-snug">Kamera yayınlarını kapatıp sadece profil kartlarını göster</div>
                </div>
            </div>
            <button type="button" id="btnToggleHideAllCamsSettings" onclick="toggleHideAllCamerasMode()"
                class="w-11 h-6 rounded-full transition-colors duration-200 relative flex items-center shrink-0 cursor-pointer ${hideAllCamerasMode ? 'bg-mc-green' : 'bg-[#1e1f22]'} border border-white/10">
                <span id="knobHideAllCamsSettings" class="w-4 h-4 rounded-full bg-white shadow-md transform transition-transform duration-200 ${hideAllCamerasMode ? 'translate-x-5' : 'translate-x-0.5'}"></span>
            </button>
        </div>

        <!-- 2. Kamerası Olmayanları Gizle -->
        <div class="flex items-center justify-between p-3 rounded-xl bg-[#2b2d31] hover:bg-[#313338] transition-colors border border-white/5">
            <div class="flex items-center gap-2.5 pr-2 min-w-0">
                <div class="p-2 rounded-lg bg-mc-primary/15 text-mc-primary shrink-0">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"></path>
                    </svg>
                </div>
                <div class="min-w-0">
                    <div class="text-xs font-bold text-white">Kamerası Olmayanları Gizle</div>
                    <div class="text-[11px] text-gray-400 leading-snug">Ekranda yalnızca kamerası açık olan kullanıcıları göster</div>
                </div>
            </div>
            <button type="button" id="btnToggleHideNoCamSettings" onclick="toggleHideNonVideoParticipants()"
                class="w-11 h-6 rounded-full transition-colors duration-200 relative flex items-center shrink-0 cursor-pointer ${hideNonVideoParticipants ? 'bg-mc-green' : 'bg-[#1e1f22]'} border border-white/10">
                <span id="knobHideNoCamSettings" class="w-4 h-4 rounded-full bg-white shadow-md transform transition-transform duration-200 ${hideNonVideoParticipants ? 'translate-x-5' : 'translate-x-0.5'}"></span>
            </button>
        </div>

        <!-- 3. Bağlantı Durumu ve Sunucu Bilgileri -->
        <div class="flex flex-col rounded-xl bg-[#2b2d31] border border-white/5 overflow-hidden">
            <button type="button" onclick="toggleConnectionDiagnosticsPanel()"
                class="w-full flex items-center justify-between p-3 hover:bg-[#313338] transition-colors cursor-pointer text-left">
                <div class="flex items-center gap-2.5 pr-2 min-w-0">
                    <div class="p-2 rounded-lg bg-mc-green/15 text-mc-green shrink-0">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path>
                        </svg>
                    </div>
                    <div class="min-w-0">
                        <div class="text-xs font-bold text-white">Bağlantı Durumu & Sunucu Bilgisi</div>
                        <div class="text-[11px] text-gray-400 leading-snug">Ping, paket kaybı, jitter, bitrate ve sunucu detayları</div>
                    </div>
                </div>
                <svg id="mcDiagnosticsChevron" class="w-4 h-4 text-gray-400 transition-transform duration-200 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"></path>
                </svg>
            </button>

            <div id="mcDiagnosticsCollapsiblePanel" class="hidden px-3 pb-3 pt-2 border-t border-white/5 bg-[#1e1f22]/70 flex flex-col gap-2">
                <div class="flex items-center justify-between gap-2">
                    <span class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Canlı Ağ & RTC Telemetrisi</span>
                    <span id="diagOverallStatusBadge" class="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-mc-green/20 text-mc-green border-mc-green/30">Kontrol Ediliyor...</span>
                </div>

                <div class="grid grid-cols-2 gap-1.5 text-xs">
                    <div class="bg-[#111214] p-2 rounded-lg border border-white/5">
                        <div class="text-[10px] text-gray-400 font-semibold">Gecikme (Ping / RTT)</div>
                        <div id="diagRttValue" class="text-xs font-bold text-white mt-0.5">-- ms</div>
                    </div>
                    <div class="bg-[#111214] p-2 rounded-lg border border-white/5">
                        <div class="text-[10px] text-gray-400 font-semibold">Paket Kaybı (Loss)</div>
                        <div id="diagPacketLossValue" class="text-xs font-bold text-white mt-0.5">%0.0</div>
                    </div>
                    <div class="bg-[#111214] p-2 rounded-lg border border-white/5">
                        <div class="text-[10px] text-gray-400 font-semibold">Titreşim (Jitter)</div>
                        <div id="diagJitterValue" class="text-xs font-bold text-gray-200 mt-0.5">0 ms</div>
                    </div>
                    <div class="bg-[#111214] p-2 rounded-lg border border-white/5">
                        <div class="text-[10px] text-gray-400 font-semibold">Anlık Veri (Bitrate)</div>
                        <div id="diagBitrateValue" class="text-[11px] font-bold text-gray-200 mt-0.5 truncate">↑ 0 / ↓ 0 kbps</div>
                    </div>
                </div>

                <div class="bg-[#111214] p-2.5 rounded-lg border border-white/5 flex flex-col gap-1 text-[11px]">
                    <div class="flex items-center justify-between gap-2">
                        <span class="text-gray-400 font-medium shrink-0">Sunucu:</span>
                        <span id="diagServerInfoValue" class="text-gray-200 font-semibold truncate">API: api.meetingchallenge.com</span>
                    </div>
                    <div class="flex items-center justify-between gap-2">
                        <span class="text-gray-400 font-medium shrink-0">Protokol & Codec:</span>
                        <span id="diagCodecProtocolValue" class="text-indigo-300 font-semibold truncate">UDP • OPUS / VP8</span>
                    </div>
                    <div class="flex items-center justify-between gap-2">
                        <span class="text-gray-400 font-medium shrink-0">Mesajlaşma (Hub):</span>
                        <span id="diagSignalRStatusValue" class="text-mc-green font-semibold truncate">Aktif</span>
                    </div>
                </div>
            </div>
        </div>
    `;
    targetContainer.appendChild(wrapper);
    syncCameraSettingsButtonsUI();
}

function calculateOptimalGridDimensions(count, containerWidth, containerHeight) {
    if (count <= 0) return { cols: 1, rows: 1 };

    const isMobile = window.innerWidth < 640;
    const isPopup = document.getElementById('videoArea')?.classList.contains('floating-popup');

    if (isPopup) {
        const cols = count <= 1 ? 1 : (count <= 4 ? 2 : (count <= 9 ? 3 : 4));
        const rows = Math.ceil(count / cols);
        return { cols, rows };
    }

    if (isMobile) {
        let cols = 1;
        if (count <= 2) cols = 1;
        else if (count <= 6) cols = 2;
        else if (count <= 15) cols = 3;
        else cols = 4;
        const rows = Math.ceil(count / cols);
        return { cols, rows };
    }

    const W = Math.max(containerWidth || 800, 320);
    const H = Math.max(containerHeight || 600, 240);
    const targetAspect = 16 / 9;

    let bestCols = 1;
    let bestRows = 1;
    let maxCardArea = 0;

    for (let cols = 1; cols <= count; cols++) {
        const rows = Math.ceil(count / cols);
        const maxTileW = W / cols;
        const maxTileH = H / rows;

        if (maxTileW <= 0 || maxTileH <= 0) continue;

        let tileW = maxTileW;
        let tileH = tileW / targetAspect;

        if (tileH > maxTileH) {
            tileH = maxTileH;
            tileW = tileH * targetAspect;
        }

        const area = tileW * tileH;
        if (area > maxCardArea) {
            maxCardArea = area;
            bestCols = cols;
            bestRows = rows;
        }
    }

    return { cols: bestCols, rows: bestRows };
}

function extractCardParticipantKey(card, fallbackIdx) {
    if (card.dataset.participantId) return card.dataset.participantId;
    if (card.dataset.username) return card.dataset.username;
    if (card.dataset.sid) return card.dataset.sid;
    if (card.id && !card.id.startsWith('mc-')) return card.id;

    const nameEl = card.querySelector('.truncate, [class*="bottom-"] span, span');
    if (nameEl && nameEl.textContent) {
        const clean = nameEl.textContent.trim().replace(/\s*\(Sen\)\s*$/i, '');
        if (clean) {
            card.dataset.participantId = clean;
            return clean;
        }
    }
    const fallback = `user-card-${fallbackIdx}`;
    card.dataset.participantId = fallback;
    return fallback;
}

// Dikey ve yatay tüm kameralarda sığdırmak için büyütmeyi (crop/zoom) engeller, kenarda boşluk bırakır
function applySmartVideoObjectFit(videoTag) {
    if (!videoTag) return;

    const enforceContain = () => {
        // Tailwind'in object-cover sınıfı varsa kaldır, object-contain ekle
        videoTag.classList.remove('object-cover');
        videoTag.classList.add('object-contain');
        videoTag.style.setProperty('object-fit', 'contain', 'important');
        videoTag.style.setProperty('background-color', '#111214', 'important');
        videoTag.style.width = '100%';
        videoTag.style.height = '100%';
    };

    enforceContain();

    if (!videoTag._hasOrientationListener) {
        videoTag.addEventListener('loadedmetadata', enforceContain);
        videoTag.addEventListener('LoadedData', enforceContain);
        videoTag.addEventListener('resize', enforceContain);
        videoTag._hasOrientationListener = true;
    }
}

function decorateCardWithPinAndZeroGapStyle(card, pKey, isPinned, isCompact, isUltraCompact, isExtremeCompact) {
    card.style.minHeight = '0';
    card.style.minWidth = '0';
    card.style.height = '100%';
    card.style.width = '100%';
    card.style.margin = '0';
    card.style.borderRadius = '0';
    card.style.border = '0.5px solid rgba(255,255,255,0.06)';
    card.style.backgroundColor = '#111214';
    card.style.overflow = 'hidden';
    
    // Kartın içeriğini merkeze almak için Flexbox özellikleri ekliyoruz
    card.style.display = 'flex';
    card.style.flexDirection = 'column';
    card.style.alignItems = 'center';
    card.style.justifyContent = 'center';
    card.style.position = 'relative';

    const videoTag = card.querySelector('video');
    if (videoTag) {
        applySmartVideoObjectFit(videoTag);

        if (hideAllCamerasMode) {
            videoTag.style.opacity = '0';
            videoTag.style.pointerEvents = 'none';
        } else {
            videoTag.style.opacity = '1';
            videoTag.style.pointerEvents = '';
        }
    }

    // Kamerasız kullanıcı girdiğinde ui-avatars (ilk iki harf) görünüyorsa gerçek profil resmini anında bul ve değiştir
    const avatarImg = card.querySelector('img');
    if (avatarImg && pKey && !pKey.startsWith('user-card-')) {
        const currentSrc = avatarImg.getAttribute('src') || '';
        if (!currentSrc || currentSrc.includes('ui-avatars.com')) {
            const cachedPic = getCachedUserAvatarByUsername(pKey);
            if (cachedPic) {
                avatarImg.src = typeof getOptimizedImageUrl === 'function' ? getOptimizedImageUrl(cachedPic, 128) : cachedPic;
            } else {
                ensureUserAvatarLoadedAsync(pKey);
            }
        }
    }

    let pinBtn = card.querySelector('.mc-pin-cam-btn');
    if (!pinBtn) {
        pinBtn = document.createElement('button');
        pinBtn.type = 'button';
        card.appendChild(pinBtn);
    }

    pinBtn.onclick = (e) => togglePinParticipant(pKey, e);
    pinBtn.title = isPinned ? 'Sabitlemeyi Kaldır' : 'Kamerayı Üste Sabitle (Maks 4)';
    pinBtn.className = `mc-pin-cam-btn absolute top-1.5 right-1.5 z-20 p-1.5 rounded-md transition-all cursor-pointer flex items-center gap-1 text-[10px] font-bold ${
        isPinned
            ? 'bg-mc-primary text-white opacity-100 shadow-md'
            : 'bg-black/60 text-gray-200 hover:bg-mc-primary hover:text-white opacity-0 group-hover:opacity-100'
    }`;

    if (!card.classList.contains('group')) {
        card.classList.add('group');
    }

    pinBtn.innerHTML = isPinned
        ? `<svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>`
        : `<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>`;

    if (avatarImg) {
        // Resmin her zaman yuvarlak ve düzgün görünmesi için stilleri zorluyoruz
        avatarImg.style.objectFit = 'cover';
        avatarImg.style.borderRadius = '50%';
        
        // Tailwind sınıflarının ezmesini engellemek için aspect ratio ekliyoruz
        avatarImg.style.aspectRatio = '1 / 1';
        
        // Gerekirse resmin üstündeki absolute/relative pozisyonlamaları sıfırlıyoruz
        avatarImg.style.position = 'static';
        avatarImg.style.transform = 'none';

        if (!isPinned) {
            if (isExtremeCompact) {
                avatarImg.style.width = '1.75rem';
                avatarImg.style.height = '1.75rem';
            } else if (isUltraCompact) {
                avatarImg.style.width = '2.25rem';
                avatarImg.style.height = '2.25rem';
            } else if (isCompact) {
                avatarImg.style.width = '3rem';
                avatarImg.style.height = '3rem';
            } else {
                // Varsayılan boyut
                avatarImg.style.width = '4rem'; 
                avatarImg.style.height = '4rem';
            }
        } else {
            // Pinlendiğinde daha büyük göster
            avatarImg.style.width = '6rem';
            avatarImg.style.height = '6rem';
        }
    }

    const nameBadge = card.querySelector('.truncate, [class*="bottom-"]');
    if (nameBadge && !isPinned) {
        nameBadge.style.fontSize = isExtremeCompact ? '9px' : (isUltraCompact ? '10px' : (isCompact ? '11px' : ''));
        nameBadge.style.padding = isUltraCompact ? '1px 4px' : '';
        
        // İsim etiketini kartın altına sabitlemek istiyorsan:
        nameBadge.style.position = 'absolute';
        nameBadge.style.bottom = '4px';
        nameBadge.style.left = '50%';
        nameBadge.style.transform = 'translateX(-50%)';
        nameBadge.style.maxWidth = '90%';
        nameBadge.style.textAlign = 'center';
    } else if (nameBadge && isPinned) {
        nameBadge.style.fontSize = '';
        nameBadge.style.padding = '';
        
        nameBadge.style.position = 'absolute';
        nameBadge.style.bottom = '8px';
        nameBadge.style.left = '50%';
        nameBadge.style.transform = 'translateX(-50%)';
    }
}

function applyDynamicGridLayout() {
    injectGlobalVideoAndAvatarFixStyles();
    injectCameraAndDiagnosticsSettings();

    const videoArea = document.getElementById('videoArea');
    if (!videoArea || videoArea.classList.contains('hidden')) return;

    if (!videoArea.classList.contains('floating-popup')) {
        videoArea.style.padding = '0';
    }

    const gridEl = document.getElementById('videoGrid')
        || document.getElementById('participantsGrid')
        || videoArea.querySelector('.grid')
        || videoArea;

    if (!gridEl) return;

    const existingPinnedStage = document.getElementById('mcPinnedTopStage');
    const existingBottomStage = document.getElementById('mcUnpinnedBottomStage');
    if (existingPinnedStage) {
        Array.from(existingPinnedStage.children).forEach(ch => gridEl.appendChild(ch));
        existingPinnedStage.remove();
    }
    if (existingBottomStage) {
        Array.from(existingBottomStage.children).forEach(ch => gridEl.appendChild(ch));
        existingBottomStage.remove();
    }

    const allCards = Array.from(gridEl.children).filter(el =>
        el.id !== 'popupDragHeader' &&
        el.id !== 'noCameraEmptyMessage' &&
        el.id !== 'mcPinnedTopStage' &&
        el.id !== 'mcUnpinnedBottomStage' &&
        !el.classList.contains('popup-header')
    );

    if (allCards.length === 0) return;

    const currentCardKeys = new Set();

    allCards.forEach((card, idx) => {
        const pKey = extractCardParticipantKey(card, idx);
        currentCardKeys.add(pKey);

        const videoTag = card.querySelector('video');
        const hasActiveVideo = Boolean(
            card.dataset.hasVideo === 'true' ||
            (videoTag && !videoTag.classList.contains('hidden') && videoTag.style.display !== 'none' && (videoTag.srcObject || videoTag.src))
        );
        card.dataset.computedHasCam = hasActiveVideo ? '1' : '0';

        if (hideNonVideoParticipants && !hasActiveVideo) {
            card.style.display = 'none';
        } else {
            card.style.display = '';
        }
    });

    Array.from(pinnedParticipantIds).forEach(k => {
        if (!currentCardKeys.has(k)) pinnedParticipantIds.delete(k);
    });

    allCards.sort((a, b) => {
        const keyA = a.dataset.participantId;
        const keyB = b.dataset.participantId;
        const pinA = pinnedParticipantIds.has(keyA);
        const pinB = pinnedParticipantIds.has(keyB);
        if (pinA !== pinB) return pinA ? -1 : 1;

        const camA = a.dataset.computedHasCam === '1';
        const camB = b.dataset.computedHasCam === '1';
        if (camA !== camB) return camA ? -1 : 1;
        return 0;
    });

    const visibleCards = allCards.filter(c => c.style.display !== 'none');
    const visibleCount = visibleCards.length;

    let emptyMsg = document.getElementById('noCameraEmptyMessage');
    if (visibleCount === 0 && hideNonVideoParticipants) {
        if (!emptyMsg) {
            emptyMsg = document.createElement('div');
            emptyMsg.id = 'noCameraEmptyMessage';
            emptyMsg.className = 'col-span-full flex flex-col items-center justify-center text-gray-400 py-12 gap-2 select-none w-full h-full';
            emptyMsg.innerHTML = `
                <svg class="w-10 h-10 text-gray-500" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"></path>
                    <line x1="3" y1="3" x2="21" y2="21" stroke-width="2"></line>
                </svg>
                <div class="text-sm font-semibold text-gray-300">Kamerası açık kimse yok</div>
                <button type="button" onclick="toggleHideNonVideoParticipants()" class="mt-1 px-3 py-1.5 rounded-lg bg-[#2b2d31] hover:bg-[#35373c] text-xs text-mc-primary font-semibold transition-colors cursor-pointer">
                    Tüm Katılımcıları Göster (${allCards.length})
                </button>
            `;
            gridEl.appendChild(emptyMsg);
        } else {
            const btn = emptyMsg.querySelector('button');
            if (btn) btn.innerText = `Tüm Katılımcıları Göster (${allCards.length})`;
        }
        emptyMsg.style.display = 'flex';
        return;
    } else if (emptyMsg) {
        emptyMsg.style.display = 'none';
    }

    const pinnedCards = visibleCards.filter(c => pinnedParticipantIds.has(c.dataset.participantId)).slice(0, MAX_PINNED_CAMERAS);
    const unpinnedCards = visibleCards.filter(c => !pinnedCards.includes(c));

    if (pinnedCards.length > 0) {
        gridEl.style.display = 'flex';
        gridEl.style.flexDirection = 'column';
        gridEl.style.gap = '0px';
        gridEl.style.padding = '0px';
        gridEl.style.height = '100%';
        gridEl.style.width = '100%';
        gridEl.style.overflow = 'hidden';

        const topStage = document.createElement('div');
        topStage.id = 'mcPinnedTopStage';
        topStage.style.display = 'grid';
        topStage.style.gap = '0px';
        topStage.style.width = '100%';
        topStage.style.height = unpinnedCards.length > 0 ? '72%' : '100%';
        topStage.style.minHeight = '0';
        topStage.style.overflow = 'hidden';

        const pCount = pinnedCards.length;
        if (pCount === 1) {
            topStage.style.gridTemplateColumns = 'minmax(0, 1fr)';
            topStage.style.gridTemplateRows = 'minmax(0, 1fr)';
        } else if (pCount === 2) {
            const isMobile = window.innerWidth < 640;
            topStage.style.gridTemplateColumns = isMobile ? 'minmax(0, 1fr)' : 'repeat(2, minmax(0, 1fr))';
            topStage.style.gridTemplateRows = isMobile ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 1fr)';
        } else {
            topStage.style.gridTemplateColumns = 'repeat(2, minmax(0, 1fr))';
            topStage.style.gridTemplateRows = 'repeat(2, minmax(0, 1fr))';
        }

        pinnedCards.forEach((card, idx) => {
            decorateCardWithPinAndZeroGapStyle(card, card.dataset.participantId, true, false, false, false);
            if (pCount === 3 && idx === 2) {
                card.style.gridColumn = 'span 2';
            } else {
                card.style.gridColumn = '';
            }
            topStage.appendChild(card);
        });

        gridEl.appendChild(topStage);

        if (unpinnedCards.length > 0) {
            const bottomStage = document.createElement('div');
            bottomStage.id = 'mcUnpinnedBottomStage';
            bottomStage.style.display = 'grid';
            bottomStage.style.gap = '0px';
            bottomStage.style.width = '100%';
            bottomStage.style.height = '28%';
            bottomStage.style.minHeight = '0';
            bottomStage.style.overflow = 'hidden';
            bottomStage.style.borderTop = '1px solid rgba(255,255,255,0.1)';

            const rect = gridEl.getBoundingClientRect();
            const bottomH = (rect.height || 600) * 0.28;
            const { cols, rows } = calculateOptimalGridDimensions(unpinnedCards.length, rect.width, bottomH);

            bottomStage.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
            bottomStage.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;

            const isCompact = unpinnedCards.length > 4;
            const isUltra = unpinnedCards.length > 8;
            const isExtreme = unpinnedCards.length > 14;

            unpinnedCards.forEach(card => {
                card.style.gridColumn = '';
                decorateCardWithPinAndZeroGapStyle(card, card.dataset.participantId, false, isCompact, isUltra, isExtreme);
                bottomStage.appendChild(card);
            });

            gridEl.appendChild(bottomStage);
        }

        allCards.filter(c => c.style.display === 'none').forEach(c => gridEl.appendChild(c));
        return;
    }

    allCards.forEach(card => {
        card.style.gridColumn = '';
        gridEl.appendChild(card);
    });

    const rect = gridEl.getBoundingClientRect();
    const { cols, rows } = calculateOptimalGridDimensions(visibleCount, rect.width, rect.height);

    gridEl.style.display = 'grid';
    gridEl.style.flexDirection = '';
    gridEl.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
    gridEl.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
    gridEl.style.gap = '0px';
    gridEl.style.padding = '0px';
    gridEl.style.height = '100%';
    gridEl.style.width = '100%';
    gridEl.style.overflow = 'hidden';

    const isCompact = visibleCount > 9;
    const isUltraCompact = visibleCount > 16;
    const isExtremeCompact = visibleCount > 25;

    visibleCards.forEach(card => {
        decorateCardWithPinAndZeroGapStyle(
            card,
            card.dataset.participantId,
            false,
            isCompact,
            isUltraCompact,
            isExtremeCompact
        );
    });
}

function hookUpdateVideoUIForDynamicGrid() {
    const wrapFn = () => {
        if (typeof window.updateVideoUI === 'function' && !window.updateVideoUI._isGridWrapped) {
            const originalUpdateVideoUI = window.updateVideoUI;
            window.updateVideoUI = function (...args) {
                const res = originalUpdateVideoUI.apply(this, args);
                requestAnimationFrame(applyDynamicGridLayout);
                return res;
            };
            window.updateVideoUI._isGridWrapped = true;
        }
    };
    wrapFn();
    window.addEventListener('load', () => {
        injectGlobalVideoAndAvatarFixStyles();
        injectCameraAndDiagnosticsSettings();
        wrapFn();
    });
}

// ==========================================
// 📜 NORMLAR (KURALLAR) MODÜLÜ
// ==========================================
async function openNormsModal() {
    const modal = document.getElementById('normsModal');
    const contentEl = document.getElementById('normsModalContent');
    if (!modal || !contentEl) return;

    modal.classList.remove('hidden');
    if (typeof normsLoadedOnce !== 'undefined' && normsLoadedOnce) return;

    contentEl.innerHTML = `<div class="text-center text-gray-400 py-8 animate-pulse">Topluluk normları yükleniyor...</div>`;
    try {
        const res = await fetch(normsMarkdownUrl, { cache: 'no-cache' });
        if (!res.ok) throw new Error("norms.md bulunamadı");
        const mdText = await res.text();
        contentEl.innerHTML = typeof parseMarkdownToHtml === 'function' 
            ? parseMarkdownToHtml(mdText) 
            : `<pre class="whitespace-pre-wrap text-sm text-gray-300">${mdText}</pre>`;
        normsLoadedOnce = true;
    } catch (err) {
        const fallbackMd = `
### ÜYELERİMİZDEN BEKLENTİLERİMİZ
1. Emsi güven ve sevgi bağını önde tutar. Topluluktaki güven ve sevgi ortamına zarar verebilecek herhangi bir davranışa tolerans gösterilmez.
2. Toplulukta edinebileceğimiz en büyük donanım çevreyle geçinebilme becerimizin olmasıdır. Bir toplum içinde yaşıyoruz ve bu toplumdaki kimliğimiz insanlarla iletişimimize göre şekillenir.
3. Topluluğumuzda açık iletişime önem veririz. Bir sorun yaşıyorsak bunu güzel bir dil ile direkt iletişim kurarak çözmeye çalışırız.
4. Emsi bir bütündür. Emsi içinde farklı gruplar yoktur, farklı iletişim kanalları vardır.

### ORYANTASYON SÜRECİ VE TOPLULUĞUN İŞLEYİŞİ
1. Yeni katılan arkadaşlarımızı oryantasyon ekibimiz karşılar ve bir haftalık ilk oryantasyon etabının ardından toplulukla tanışmaya ve bir araya gelmeye başlarız.
2. Topluluğun bir parçası olmak, toplulukta aktif olmaktan, buraya zaman ayırmaktan geçiyor. Her gün burada bir paylaşım yaparak ya da paylaşımlara emojiler bırakarak bizlerle olduğunu hissettirebilirsin.

### GELENEK VE GÖRENEKLERİMİZ
1. **5 Ocak** Mami'nin farklı kültürlerden 1000 kişiyle tanışmak için Meeting Challenge'ı başlattığı gün olarak anılır.
2. **30 Mart** Discord grubumuzun kuruluşu ve Emsi'nin topluluk oluşunun yıl dönümü olarak kutlanır.
3. Her yıl sonu toplulukta yılın enleri seçilir ve yıl sonu balomuzda yapılan görkemli bir törenle yılın enlerine ödül verilir.

### TOPLULUK YÖNETİMİ NASIL KARAR ALIR?
1. Toplulukta şeffaf iletişimi önemseriz. Topluluk yönetiminin en temel sorumluluğu aldığı tüm kararları topluluğa açıklayabilmektir.
2. Topluluk yönetimi alınan şikayetleri değerlendirirken kişilerin topluluk içindeki konumlarını göz ardı etmez.
3. Şikayetler not alınır, veritabanında tutulur. Size şikayetlerinizle ilgili geri dönüş olmasa bile takibi yapılır ve gözleme tâbi tutulur.
        `;
        contentEl.innerHTML = typeof parseMarkdownToHtml === 'function' 
            ? parseMarkdownToHtml(fallbackMd) 
            : `<pre class="whitespace-pre-wrap text-sm text-gray-300">${fallbackMd}</pre>`;
        normsLoadedOnce = true;
    }
}

function closeNormsModal() {
    const modal = document.getElementById('normsModal');
    if (modal) modal.classList.add('hidden');
}

function initInputEmojiGrid() {
    const grid = document.getElementById('inputEmojiGrid');
    if (!grid) return;

    const customItems = Array.from(emojiCatalogMap.values()).filter(item => item.isCustom || item.url || item.category === "Özel Emojiler");

    let html = '';
    if (customItems.length > 0) {
        html += `
            <div class="mb-3">
                <div class="text-[10px] font-bold text-gray-400 uppercase tracking-wider px-1 mb-1 border-b border-white/5 pb-0.5">Özel Emojiler</div>
                <div class="grid grid-cols-6 gap-1">
                    ${customItems.map(item => {
                        const safeKey = String(item.key).replace(/'/g, "\\'");
                        return `<button type="button" title="${item.key}" onclick="insertEmojiToChatInput('${safeKey}')" class="hover:bg-white/10 p-1.5 rounded-lg text-lg transition-transform hover:scale-125 flex items-center justify-center">${renderEmojiItemVisual(item)}</button>`;
                    }).join('')}
                </div>
            </div>
        `;
    }

    html += INPUT_EMOJI_GROUPS.map(group => `
        <div class="mb-3 last:mb-0">
            <div class="text-[10px] font-bold text-gray-400 uppercase tracking-wider px-1 mb-1 border-b border-white/5 pb-0.5">${group.title}</div>
            <div class="grid grid-cols-6 gap-1">
                ${group.emojis.map(e => `
                    <button type="button" onclick="insertEmojiToChatInput('${e}')" class="hover:bg-white/10 p-1.5 rounded-lg text-lg transition-transform hover:scale-125 flex items-center justify-center">${e}</button>
                `).join('')}
            </div>
        </div>
    `).join('');

    grid.innerHTML = html;
}

async function loadUserProfileUI() {
    const token = localStorage.getItem('mc_token');
    const jwtPayload = token ? parseJwt(token) : null;
    const storedUsername = localStorage.getItem('mc_username') || '';
    const jwtUserName = (jwtPayload && (jwtPayload.UserName || jwtPayload.username)) || '';
    const fullName = jwtPayload ? `${(jwtPayload.Name || '').trim()} ${(jwtPayload.Surname || '').trim()}`.trim() : '';
    const userId = jwtPayload && (jwtPayload.Id || jwtPayload.id || jwtPayload.sub) ? Number(jwtPayload.Id || jwtPayload.id || jwtPayload.sub) : null;

    const displayUsername = storedUsername || jwtUserName || fullName || 'Kullanıcı';
    currentLoggedUserInfo = { userId, username: displayUsername, jwtUserName, fullName, city: null };

    const localNameEl = document.getElementById('localUserName');
    if (localNameEl) localNameEl.innerText = displayUsername;

    knownUsersMap.set(displayUsername, {
        username: displayUsername,
        userId,
        fullName: fullName || displayUsername,
        roles: jwtPayload && Array.isArray(jwtPayload.Role) ? jwtPayload.Role : [],
        pictureUrl: null,
        color: '#818cf8'
    });

    if (userId) {
        const myApiData = await fetchUserInfoFromApi(userId);
        if (myApiData && myApiData.username) {
            currentLoggedUserInfo.username = myApiData.username;
            if (myApiData.city) {
                currentLoggedUserInfo.city = myApiData.city;
                const matchedCity = mapCityNameToId(myApiData.city);
                if (matchedCity && !selectedEventCityId) {
                    selectedEventCityId = matchedCity;
                    userCityFetched = true;
                }
            }
            localStorage.setItem('mc_username', myApiData.username);
            if (localNameEl) localNameEl.innerText = myApiData.username;
            if (myApiData.pictureUrl) {
                const directPic = getDirectMediaUrl(myApiData.pictureUrl);
                currentLoggedUserInfo.pictureUrl = directPic;
                knownUsersMap.set(myApiData.username, {
                    ...(findKnownUserByUsername(myApiData.username) || {}),
                    userId,
                    username: myApiData.username,
                    pictureUrl: directPic
                });
                if (typeof updateMySidebarAvatar === 'function') {
                    updateMySidebarAvatar(directPic);
                }
            }
        }
    }
}

async function handleLogin(e) {
    e.preventDefault();
    const btn = document.getElementById('loginBtn');
    const errDiv = document.getElementById('loginError');
    btn.disabled = true; btn.innerText = "Bağlanılıyor..."; errDiv.classList.add('hidden');

    try {
        const response = await fetch(authApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userName: document.getElementById('usernameInput').value,
                password: document.getElementById('passwordInput').value
            })
        });
        const data = await response.json();
        if (data.httpStatusCode === 200 && data.data && data.data.accessToken) {
            localStorage.setItem('mc_token', data.data.accessToken.token);
            localStorage.setItem('mc_username', document.getElementById('usernameInput').value);
            await loadUserProfileUI();
            showApp();
            ensureChairoHubConnected();
            fetchActiveChannels();
            startPolling();
        } else throw new Error(data.message || "Giriş başarısız.");
    } catch (error) {
        errDiv.innerText = error.message;
        errDiv.classList.remove('hidden');
    } finally {
        btn.disabled = false;
        btn.innerText = "Giriş Yap";
    }
}

function showLogoutModal() { document.getElementById('logoutModal').classList.remove('hidden'); }
function closeLogoutModal() { document.getElementById('logoutModal').classList.add('hidden'); }
function confirmLogout() {
    closeLogoutModal();
    stopRtcStatsMonitoring();
    localStorage.removeItem('mc_token');
    localStorage.removeItem('mc_username');
    leaveRoom();
    if (pollingInterval) clearInterval(pollingInterval);
    if (chatPollingInterval) clearInterval(chatPollingInterval);
    showLogin();
}

function showLogin() {
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('appScreen').style.display = 'none';
}
function showApp() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('appScreen').style.display = 'flex';
}

function openMyProfile() {
    const username = currentLoggedUserInfo.username || localStorage.getItem('mc_username');
    const info = findKnownUserByUsername(username) || {};
    openUserProfileModal(currentLoggedUserInfo.userId || info.userId || null, username, info.pictureUrl || null);
}

function openViewerUserProfile() {
    const msg = imageGalleryList[currentViewerIndex];
    if (!msg) return;
    const uid = extractUserIdFromObject(msg, true);
    openUserProfileModal(uid, msg.userName, msg.pictureUrl);
}

function openUserProfileByUsername(rawUsername) {
    if (!rawUsername) return;
    const cleanUsername = String(rawUsername).trim().replace(/^@+/, '');
    if (!cleanUsername) return;

    const info = findKnownUserByUsername(cleanUsername) || {};
    let resolvedId = info.userId || null;
    let resolvedPic = info.pictureUrl || null;
    let canonicalName = info.username || cleanUsername;

    const targetLower = cleanUsername.toLowerCase();

    if (!resolvedId) {
        for (const m of messagesMap.values()) {
            const mUser = String(m.userName || m.username || '').trim();
            if (mUser.toLowerCase() === targetLower) {
                canonicalName = mUser;
                resolvedId = extractUserIdFromObject(m, true);
                if (!resolvedPic && m.pictureUrl) resolvedPic = m.pictureUrl;
                if (resolvedId) break;
            }
        }
    }

    if (!resolvedId && Array.isArray(globalChannels)) {
        for (const ch of globalChannels) {
            for (const vp of (ch.voiceParticipants || [])) {
                if (vp.username && vp.username.toLowerCase() === targetLower) {
                    canonicalName = vp.username;
                    resolvedId = extractUserIdFromObject(vp, false);
                    if (!resolvedPic && vp.pictureUrl) resolvedPic = vp.pictureUrl;
                    if (resolvedId) break;
                }
            }
            if (resolvedId) break;
        }
    }

    openUserProfileModal(resolvedId, canonicalName, resolvedPic);
}

async function fetchUserInfoFromApi(targetUserId, targetUsername = null) {
    const token = localStorage.getItem('mc_token');
    if (!token) return null;

    const headers = { 'accept': 'application/json', 'authorization': `Bearer ${token}`, 'lang': 'tr' };
    const candidateUrls = [];

    if (targetUserId) {
        candidateUrls.push(`https://api.meetingchallenge.com/User/get-user-info?userId=${encodeURIComponent(targetUserId)}`);
        if (typeof userApiUrl !== 'undefined') {
            candidateUrls.push(`${userApiUrl}?userId=${encodeURIComponent(targetUserId)}`);
        }
    }
    if (targetUsername) {
        const cleanU = String(targetUsername).trim().replace(/^@+/, '');
        if (typeof userApiUrl !== 'undefined') {
            candidateUrls.push(`${userApiUrl}?userName=${encodeURIComponent(cleanU)}`);
            candidateUrls.push(`${userApiUrl}?username=${encodeURIComponent(cleanU)}`);
        }
        if (typeof apiRootUrl !== 'undefined') {
            candidateUrls.push(`${apiRootUrl}/User/get-user-by-username?userName=${encodeURIComponent(cleanU)}`);
        }
    }

    for (const url of candidateUrls) {
        try {
            const resGet = await fetch(url, { method: 'GET', headers });
            if (resGet.ok) {
                const json = await resGet.json();
                if (json && (json.data || json.id || json.username)) return json.data || json;
            }
        } catch (e) {}

        try {
            const resPost = await fetch(url, { method: 'POST', headers });
            if (resPost.ok) {
                const json = await resPost.json();
                if (json && (json.data || json.id || json.username)) return json.data || json;
            }
        } catch (e) {}
    }

    return null;
}

async function openUserProfileModal(userId, username = "Kullanıcı", fallbackAvatar = null) {
    const modal = document.getElementById('userProfileModal');
    const loader = document.getElementById('profileModalLoader');
    const bioWrapper = document.getElementById('profileBioWrapper');
    const bioEl = document.getElementById('profileModalBio');
    const rolesEl = document.getElementById('profileModalRoles');
    const extraFieldsEl = document.getElementById('profileExtraFields');

    const cleanUsername = String(username || "Kullanıcı").trim().replace(/^@+/, '');
    const known = findKnownUserByUsername(cleanUsername) || {};
    const resolvedAvatarPath = fallbackAvatar || known.pictureUrl || getCachedUserAvatarByUsername(cleanUsername) || null;
    const resolvedUserId = userId || known.userId || (typeof extractUserIdFromMediaUrl === 'function' ? extractUserIdFromMediaUrl(resolvedAvatarPath) : null) || null;

    currentProfileModalUser = {
        userId: resolvedUserId,
        username: cleanUsername || known.username || "Kullanıcı",
        pictureUrl: resolvedAvatarPath
    };

    const initialAvatarUrl = resolvedAvatarPath
        ? getDirectMediaUrl(resolvedAvatarPath)
        : `https://ui-avatars.com/api/?background=2b2d31&color=fff&size=256&name=${encodeURIComponent(currentProfileModalUser.username)}`;

    document.getElementById('profileModalAvatar').src = initialAvatarUrl;
    document.getElementById('profileModalFullName').innerText = known.fullName || currentProfileModalUser.username;
    document.getElementById('profileModalUsername').innerText = `@${currentProfileModalUser.username}`;

    bioWrapper.classList.add('hidden');
    extraFieldsEl.innerHTML = '';
    rolesEl.innerHTML = '<span class="text-gray-500 text-xs italic">Yükleniyor...</span>';
    modal.classList.remove('hidden');

    const token = localStorage.getItem('mc_token');
    if (!token) return;
    loader.classList.remove('hidden');

    try {
        let targetId = resolvedUserId;
        if (!targetId && currentProfileModalUser.username) {
            const targetUnameLower = currentProfileModalUser.username.toLowerCase();
            for (const m of messagesMap.values()) {
                if (m.userName && m.userName.toLowerCase() === targetUnameLower) {
                    const foundId = extractUserIdFromObject(m, true);
                    if (foundId) { targetId = foundId; break; }
                }
            }
        }

        const uData = await fetchUserInfoFromApi(targetId, currentProfileModalUser.username);
        if (uData && typeof uData === 'object') {
            const firstName = (uData.name || '').trim();
            const lastName = (uData.surname || '').trim();
            const fullName = (`${firstName} ${lastName}`).trim() || uData.username || currentProfileModalUser.username;
            const uname = uData.username || uData.userName || currentProfileModalUser.username;
            const pic = uData.pictureUrl ? getDirectMediaUrl(uData.pictureUrl) : resolvedAvatarPath;

            currentProfileModalUser.username = uname;
            currentProfileModalUser.pictureUrl = pic;
            currentProfileModalUser.userId = uData.id || targetId || (typeof extractUserIdFromMediaUrl === 'function' ? extractUserIdFromMediaUrl(pic) : null);

            knownUsersMap.set(uname, {
                ...(findKnownUserByUsername(uname) || {}),
                userId: currentProfileModalUser.userId,
                username: uname,
                fullName,
                pictureUrl: pic,
                roles: Array.isArray(uData.roles) ? uData.roles : []
            });

            document.getElementById('profileModalFullName').innerText = fullName;
            document.getElementById('profileModalUsername').innerText = `@${uname}`;
            if (pic) {
                document.getElementById('profileModalAvatar').src = getDirectMediaUrl(pic);
                patchAvatarImagesInDom(uname, pic);
            }

            const bioText = (uData.about || '').toString().trim();
            if (bioText) {
                bioEl.innerText = bioText;
                bioWrapper.classList.remove('hidden');
            }

            const extraItems = [];
            if (uData.showVocation !== false && (uData.vocation || '').trim()) {
                extraItems.push({ label: '💼 Meslek', val: uData.vocation.trim() });
            }
            if (uData.showCity !== false && (uData.city || '').trim()) {
                extraItems.push({ label: '📍 Konum', val: uData.city.trim() });
            }
            const rawBirthDay = uData.birthDay || null;
            const horoscopeVal = (uData.horoscope || getZodiacSignFromDate(rawBirthDay) || '').toString().trim();
            if (horoscopeVal) extraItems.push({ label: '✨ Burç', val: horoscopeVal });

            if (rawBirthDay) {
                const formattedBirth = formatBirthDateForProfile(rawBirthDay, uData.showBirthDay === true);
                if (formattedBirth) extraItems.push({ label: '🎂 Doğum Tarihi', val: formattedBirth });
            }

            extraFieldsEl.innerHTML = extraItems.map(item => `
                <div class="bg-[#111214] p-2.5 rounded-lg border border-white/5">
                    <div class="text-[10px] font-bold text-gray-400 uppercase">${item.label}</div>
                    <div class="text-xs text-gray-100 font-medium truncate mt-0.5" title="${item.val}">${item.val}</div>
                </div>
            `).join('');

            let apiRoles = Array.isArray(uData.roles) ? uData.roles : [];
            if (apiRoles.length > 0) {
                rolesEl.innerHTML = apiRoles.map(r => {
                    const rName = typeof r === 'object' ? (r.name || r.title || '') : String(r);
                    return rName ? `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-[#111214] text-gray-200 border border-white/10"><span class="w-2 h-2 rounded-full bg-mc-primary shrink-0"></span><span>${rName}</span></span>` : '';
                }).join('');
            } else {
                rolesEl.innerHTML = `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-[#111214] text-gray-300 border border-white/10"><span class="w-2 h-2 rounded-full bg-mc-green"></span>Üye</span>`;
            }
        } else {
            rolesEl.innerHTML = `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-[#111214] text-gray-300 border border-white/10"><span class="w-2 h-2 rounded-full bg-mc-green"></span>Üye</span>`;
        }
    } catch (err) {
        rolesEl.innerHTML = `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-[#111214] text-gray-300 border border-white/10"><span class="w-2 h-2 rounded-full bg-mc-green"></span>Üye</span>`;
    } finally {
        loader.classList.add('hidden');
    }
}

function closeUserProfileModal() { document.getElementById('userProfileModal').classList.add('hidden'); }

function openAvatarZoomModal() {
    if (!currentProfileModalUser) return;
    const rawPic = currentProfileModalUser.pictureUrl;
    const highResUrl = rawPic ? getDirectMediaUrl(rawPic) : document.getElementById('profileModalAvatar').src;
    document.getElementById('avatarZoomImg').src = highResUrl;
    document.getElementById('avatarZoomModal').classList.remove('hidden');
}

function closeAvatarZoomModal() { document.getElementById('avatarZoomModal').classList.add('hidden'); }

// ================= TÜM KATEGORİLERİ VE KANALLARI ÇEKEN FONKSİYON ================= //
async function fetchActiveChannels() {
    const token = localStorage.getItem('mc_token');
    if (!token) return confirmLogout();
    try {
        const res = await fetch(`${apiBaseUrl}/get-active-channel`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.status === 401) return confirmLogout();
        const result = await res.json();
        if (result.httpStatusCode === 200 && result.data) {
            const flattenedList = flattenChannelsFromApi(result.data);

            globalChannels = flattenedList.map(ch => {
                if (ch.id === activeViewingChannelId || locallyReadChannelIds.has(ch.id) || locallyReadChannelIds.has(Number(ch.id))) {
                    return { ...ch, isRead: true };
                }
                return ch;
            });

            globalChannels.forEach(ch => {
                (ch.voiceParticipants || []).forEach(vp => {
                    if (vp.username) {
                        const existing = findKnownUserByUsername(vp.username) || {};
                        const extractedId = extractUserIdFromObject(vp, false) || existing.userId || null;
                        const pic = vp.pictureUrl ? getDirectMediaUrl(vp.pictureUrl) : existing.pictureUrl;
                        knownUsersMap.set(vp.username, {
                            ...existing,
                            userId: extractedId,
                            username: vp.username,
                            cleanUsername: stripEmojis(vp.username) || vp.username,
                            pictureUrl: pic,
                            color: '#fff'
                        });
                        if (pic) {
                            patchAvatarImagesInDom(vp.username, pic);
                        }
                        if (pic && stripEmojis(vp.username).toLowerCase() === stripEmojis(currentLoggedUserInfo.username || '').toLowerCase()) {
                            currentLoggedUserInfo.pictureUrl = pic;
                            if (typeof updateMySidebarAvatar === 'function') {
                                updateMySidebarAvatar(pic);
                            }
                        }
                    }
                });
            });

            renderSidebar();
        }
    } catch (err) {
        console.error("Kanal listesi alınırken hata oluştu:", err);
    }
}

function flattenChannelsFromApi(rawList) {
    if (!Array.isArray(rawList)) return [];
    const map = new Map();

    function traverse(items, fallbackParentId = 0) {
        items.forEach(item => {
            if (!item || item.id == null) return;
            const id = Number(item.id);
            const parentId = Number(
                item.parentChannelId ?? item.parentId ?? item.categoryId ?? fallbackParentId ?? 0
            );

            const normalizedItem = {
                ...item,
                id,
                parentChannelId: parentId
            };

            map.set(id, normalizedItem);

            const nestedArrays = [
                item.subChannels,
                item.children,
                item.channels,
                item.childChannels,
                item.inverseParentChannel
            ];
            nestedArrays.forEach(arr => {
                if (Array.isArray(arr) && arr.length > 0) {
                    traverse(arr, id);
                }
            });
        });
    }

    traverse(rawList, 0);
    return Array.from(map.values());
}

// ================= KANAL VE KATEGORİ AĞACI OLUŞTURUCU ================= //
function buildTree(flatChannels) {
    if (!Array.isArray(flatChannels) || flatChannels.length === 0) return [];
    const tree = [];
    const lookup = new Map();

    flatChannels.forEach(c => {
        const id = Number(c.id);
        lookup.set(id, { ...c, id, children: [] });
    });

    lookup.forEach(node => {
        const id = node.id;
        const parentId = Number(node.parentChannelId || 0);

        if (parentId > 0 && parentId !== id && lookup.has(parentId)) {
            lookup.get(parentId).children.push(node);
        } else {
            tree.push(node);
        }
    });

    const sortNodes = (nodes) => {
        nodes.sort((a, b) => {
            const orderA = Number(a.orderId ?? a.order ?? 0);
            const orderB = Number(b.orderId ?? b.order ?? 0);
            if (orderB !== orderA) return orderB - orderA;
            return Number(a.id) - Number(b.id);
        });
        nodes.forEach(n => {
            if (n.children && n.children.length > 0) {
                sortNodes(n.children);
            }
        });
    };

    sortNodes(tree);
    return tree;
}

function toggleCategory(categoryId, e) {
    if (e) e.stopPropagation();
    const id = Number(categoryId);
    if (collapsedCategories.has(id)) {
        collapsedCategories.delete(id);
    } else {
        collapsedCategories.add(id);
    }
    renderSidebar(true);
}

function renderSidebar(forceRender = false) {
    const sidebar = document.getElementById('sidebarChannels');
    if (!sidebar) return;

    if (isHoveringParticipantList && !forceRender && sidebar.children.length > 0) return;

    const prevScrollTop = sidebar.scrollTop;
    sidebar.innerHTML = '';
    const tree = buildTree(globalChannels);
    tree.forEach((node, index) => renderNode(node, 0, sidebar, index));
    sidebar.scrollTop = prevScrollTop;
}

function renderNode(node, depth, container, index = 0) {
    const nodeId = Number(node.id);
    const isCollapsed = collapsedCategories.has(nodeId);
    const hasChildren = Array.isArray(node.children) && node.children.length > 0;

    const isExplicitCategory = Boolean(node.isCategory || node.isFolder || node.isHeader);
    const isCategoryHeader = depth === 0 && !node.isVoiceChannel && (hasChildren || isExplicitCategory);

    if (isCategoryHeader) {
        const catWrapper = document.createElement('div');
        catWrapper.className = "flex flex-col shrink-0";

        const catDiv = document.createElement('div');
        const topMarginClass = index === 0 ? 'mt-1' : 'mt-3.5 pt-1.5 border-t border-white/5';
        catDiv.className = `flex items-center px-3.5 ${topMarginClass} mb-1 text-[11px] font-bold tracking-wider text-gray-400 hover:text-gray-200 cursor-pointer uppercase select-none transition-colors group`;
        catDiv.onclick = (e) => toggleCategory(nodeId, e);
        catDiv.innerHTML = `
            <svg class="w-3 h-3 mr-1 shrink-0 transition-transform duration-200 ${isCollapsed ? '-rotate-90' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 9l-7 7-7-7"></path>
            </svg>
            <span class="truncate flex-1">${node.name}</span>
        `;
        catWrapper.appendChild(catDiv);

        if (!isCollapsed && hasChildren) {
            const childrenContainer = document.createElement('div');
            childrenContainer.className = "flex flex-col space-y-0.5";
            node.children.forEach((child, idx) => renderNode(child, depth + 1, childrenContainer, idx));
            catWrapper.appendChild(childrenContainer);
        }

        container.appendChild(catWrapper);
    } else {
        const channelWrap = document.createElement('div');
        channelWrap.id = `sidebar-channel-wrap-${nodeId}`;
        channelWrap.className = "flex flex-col shrink-0";

        const isViewing = (nodeId === Number(activeViewingChannelId));
        const isVoiceConnected = (Boolean(node.isVoiceChannel) && nodeId === Number(activeVoiceChannelId));
        const isUnread = (node.isRead === false);
        const paddingLeft = depth <= 1 ? 'pl-2' : (depth === 2 ? 'pl-6' : 'pl-9');

        const chDiv = document.createElement('div');
        chDiv.className = `flex items-center px-2 py-1.5 mx-2 my-0 rounded-lg cursor-pointer transition-colors group relative ${isViewing ? 'bg-mc-active text-white' : 'text-gray-400 hover:bg-mc-hover hover:text-gray-200'}`;

        const iconSvg = node.isVoiceChannel
            ? `<svg class="w-4 h-4 shrink-0 mr-1.5 ${isVoiceConnected ? 'text-mc-green' : ((isUnread && !isViewing) ? 'text-gray-200' : 'text-gray-400 group-hover:text-gray-200')}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"></path></svg>`
            : `<span class="text-gray-500 group-hover:text-gray-300 shrink-0 mr-1.5 text-base leading-none font-light ${(isUnread && !isViewing) ? 'text-gray-200' : ''}">#</span>`;

        const participantCount = (node.voiceParticipants && node.voiceParticipants.length > 0)
            ? `<span class="text-[10px] font-bold text-gray-300 ml-1.5 shrink-0 bg-[#1e1f22] px-1.5 py-0.5 rounded-full shadow-sm">${node.voiceParticipants.length}</span>`
            : '';

        const unreadDot = (isUnread && !isViewing)
            ? `<div class="w-[7px] h-[7px] bg-mc-primary rounded-full shrink-0 ml-1.5 shadow-[0_0_4px_rgba(88,101,242,0.8)]"></div>`
            : '';

        const voicePulse = isVoiceConnected
            ? `<div class="w-2 h-2 bg-mc-green rounded-full shrink-0 animate-pulse ml-1.5"></div>`
            : '';

        const toggleBtn = hasChildren
            ? `<button type="button" class="ml-1 p-0.5 rounded text-gray-400 hover:text-white hover:bg-white/10 transition-colors" onclick="toggleCategory(${nodeId}, event)" title="Alt Kanalları Aç/Kapat"><svg class="w-3.5 h-3.5 transition-transform duration-200 ${isCollapsed ? '-rotate-90' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 9l-7 7-7-7"></path></svg></button>`
            : '';

        const chatHoverBtn = node.isVoiceChannel
            ? `<button type="button" class="ml-auto p-1 rounded text-gray-400 hover:text-white hover:bg-white/10 opacity-0 group-hover:opacity-100 transition-all cursor-pointer" title="Kanal Sohbetini Aç" onclick="event.stopPropagation(); channelNavigationStack=[]; updateBackNavigationUI(); activeViewingChannelId = ${nodeId}; syncMainLayout(); startChatPolling(${nodeId}); renderSidebar(true); scrollChannelIntoSidebarView(${nodeId});"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path></svg></button>`
            : '';

        chDiv.innerHTML = `
            <div class="flex items-center w-full min-w-0 ${paddingLeft}">
                ${iconSvg}
                <span class="truncate flex-1 text-[14px] ${(isUnread && !isViewing) ? 'text-white font-semibold' : 'font-medium'}">${node.name}</span>
                ${participantCount}
                ${voicePulse || unreadDot}
                ${chatHoverBtn}
                ${toggleBtn}
            </div>
        `;

        chDiv.onclick = () => handleChannelClick(node);
        channelWrap.appendChild(chDiv);

        if (node.isVoiceChannel) {
            const participantsArray = buildSidebarParticipants(node, isVoiceConnected);
            if (participantsArray.length > 0) {
                const usersDiv = document.createElement('div');
                usersDiv.id = `sidebar-users-${nodeId}`;
                usersDiv.className = `flex flex-col gap-0.5 mt-0.5 mb-1.5 ${depth <= 1 ? 'pl-[28px]' : 'pl-[40px]'} pr-2`;

                usersDiv.onmouseenter = () => { isHoveringParticipantList = true; };

                participantsArray.forEach(p => {
                    const userRow = document.createElement('div');
                    userRow.className = "flex items-center gap-2 px-2 py-1 rounded-md hover:bg-[#35373c] transition-colors cursor-pointer group/user relative";
                    const cleanName = p.rawUsername || p.name.replace(' (Sen)', '');

                    userRow.onclick = (ev) => {
                        ev.stopPropagation();
                        const uid = p.userId || (typeof extractUserIdFromMediaUrl === 'function' ? extractUserIdFromMediaUrl(p.pictureUrl) : null) || null;
                        openUserProfileModal(uid, cleanName, p.pictureUrl);
                    };

                    if (!p.isLocal) {
                        userRow.oncontextmenu = (ev) => {
                            openUserVolumeContextMenu(cleanName, ev);
                            return false;
                        };
                    }

                    const volPercent = !p.isLocal ? Math.round(getParticipantVolume(cleanName) * 100) : 100;
                    const volBadgeHtml = (!p.isLocal && volPercent < 100)
                        ? `<span class="text-[10px] font-bold text-indigo-400 bg-[#1e1f22] px-1.5 py-0.5 rounded shrink-0">${volPercent}%</span>`
                        : '';

                    const camIcon = p.isCameraOn
                        ? `<svg class="w-3.5 h-3.5 shrink-0 text-mc-green opacity-80" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>`
                        : '';

                    const micIcon = p.isMuted
                        ? `<svg class="w-3.5 h-3.5 shrink-0 text-mc-red opacity-80" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="22"/></svg>`
                        : `<svg class="w-3.5 h-3.5 shrink-0 text-mc-green opacity-80" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>`;

                    const resolvedPic = p.pictureUrl || getCachedUserAvatarByUsername(cleanName);
                    if (!resolvedPic) {
                        ensureUserAvatarLoadedAsync(cleanName);
                    }
                    const pAvatarUrl = resolvedPic
                        ? getOptimizedImageUrl(resolvedPic, 64)
                        : ('https://ui-avatars.com/api/?background=2b2d31&color=fff&name=' + encodeURIComponent(cleanName));

                    userRow.innerHTML = `
                        <div class="relative shrink-0">
                            <img src="${pAvatarUrl}" class="w-5 h-5 rounded-full bg-[#1e1f22] object-cover border-[1.5px] ${p.isSpeaking ? 'border-mc-green' : 'border-transparent'}">
                            ${p.isSpeaking ? '<div class="absolute -top-0.5 -right-0.5 w-2 h-2 bg-mc-green rounded-full border border-mc-sidebar"></div>' : ''}
                        </div>
                        <span class="truncate flex-1 text-[13px] ${p.isSpeaking ? 'text-white font-medium' : 'text-[#b5bac1] group-hover/user:text-gray-200'}" title="${!p.isLocal ? 'Sağ tık: Ses seviyesini ayarla' : ''}">${p.name}</span>
                        ${volBadgeHtml}
                        ${camIcon}
                        ${micIcon}
                    `;
                    usersDiv.appendChild(userRow);
                });
                channelWrap.appendChild(usersDiv);
            }
        }

        if (!isCollapsed && hasChildren) {
            const subChildrenContainer = document.createElement('div');
            subChildrenContainer.className = "flex flex-col space-y-0.5";
            node.children.forEach((child, idx) => renderNode(child, depth + 1, subChildrenContainer, idx));
            channelWrap.appendChild(subChildrenContainer);
        }

        container.appendChild(channelWrap);
    }
}

async function markChannelAsRead(channelId, latestPostId = null) {
    if (!channelId) return;
    locallyReadChannelIds.add(Number(channelId));
    locallyReadChannelIds.add(String(channelId));

    const chObj = globalChannels.find(c => String(c.id) === String(channelId));
    if (chObj) chObj.isRead = true;
    renderSidebar(true);

    const token = localStorage.getItem('mc_token');
    if (!token) return;

    const cid = Number(channelId) || channelId;
    const pid = Number(latestPostId || newestPostId) || 0;
    const bodyPayload = JSON.stringify({ channelId: cid, id: cid, postId: pid, lastPostId: pid });

    if (workingReadEndpoint) {
        const url = workingReadEndpoint.replace('{cid}', cid).replace('{pid}', pid);
        fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: bodyPayload
        }).catch(() => {});
        return;
    }

    const candidateReadUrls = [
        `${apiBaseUrl}/read-channel?channelId=${cid}`,
        `${apiBaseUrl}/mark-as-read?channelId=${cid}`,
        `${apiBaseUrl}/set-channel-read?channelId=${cid}`,
        `${postBaseUrl}/read-posts?channelId=${cid}`,
        `${postBaseUrl}/mark-as-read?channelId=${cid}`
    ];

    for (const url of candidateReadUrls) {
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: bodyPayload
            });
            if (res.status !== 404 && res.status !== 405) {
                workingReadEndpoint = url.replace(String(cid), '{cid}');
                localStorage.setItem('mc_working_read_ep', workingReadEndpoint);
                break;
            }
        } catch (e) {}
    }
}

function navigateToMentionedChannel(channelRef, e) {
    if (e) e.stopPropagation();
    if (!channelRef) return;
    const cleanRef = String(channelRef).trim();

    let target = globalChannels.find(c => String(c.id) === cleanRef) ||
                 globalChannels.find(c => c.name && c.name.trim().toLowerCase() === cleanRef.toLowerCase()) ||
                 globalChannels.find(c => c.name && c.name.toLowerCase().includes(cleanRef.toLowerCase()));

    if (target) {
        closeImageViewer();
        handleChannelClick(target);
    }
}

function openSubChannelThread(subChannelId, subChannelName, e) {
    if (e) e.stopPropagation();
    if (!subChannelId) return;

    const currentCh = globalChannels.find(c => c.id === activeViewingChannelId);
    channelNavigationStack.push({
        id: activeViewingChannelId,
        name: currentCh ? currentCh.name : (document.getElementById('activeRoomNameTop').innerText || "Kanal")
    });

    activeViewingChannelId = Number(subChannelId);
    document.getElementById('activeRoomNameTop').innerHTML = `
        <svg class="w-4 h-4 text-mc-primary shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"/></svg>
        <span class="font-bold text-white truncate">${subChannelName || 'Alt Başlık'}</span>
    `;

    updateBackNavigationUI();
    startChatPolling(Number(subChannelId));
    syncMainLayout();
    renderSidebar(true);
}

function goBackChannel() {
    if (channelNavigationStack.length === 0) return;
    const prev = channelNavigationStack.pop();
    const targetChannel = globalChannels.find(c => Number(c.id) === Number(prev.id));

    updateBackNavigationUI();

    if (targetChannel) {
        handleChannelClick(targetChannel, true);
    } else if (prev.id) {
        activeViewingChannelId = prev.id;
        document.getElementById('activeRoomNameTop').innerHTML = `<span class="font-bold text-white truncate">${prev.name}</span>`;
        startChatPolling(prev.id);
        syncMainLayout();
        renderSidebar(true);
    }
}

function updateBackNavigationUI() {
    const topBackBtn = document.getElementById('topBackChannelBtn');
    if (!topBackBtn) return;
    if (channelNavigationStack.length > 0) {
        topBackBtn.classList.remove('hidden');
        topBackBtn.classList.add('flex');
    } else {
        topBackBtn.classList.add('hidden');
        topBackBtn.classList.remove('flex');
    }
}

function openCreateThreadModal(postId, e) {
    if (e) e.stopPropagation();
    closeAllEmojiPickers();
    pendingThreadPostId = Number(postId) || postId;
    const msg = messagesMap.get(String(postId));
    const { cleanText } = parseReplyFromContent(msg ? (msg.content || "") : "");
    const defaultName = cleanText ? cleanText.slice(0, 28).trim() : "Yeni Alt Başlık";
    document.getElementById('threadTitleInput').value = defaultName;
    document.getElementById('threadContentInput').value = "";
    document.getElementById('createThreadModal').classList.remove('hidden');
    setTimeout(() => document.getElementById('threadTitleInput').focus(), 50);
}

function closeCreateThreadModal() {
    pendingThreadPostId = null;
    document.getElementById('createThreadModal').classList.add('hidden');
}

async function submitCreateThread(e) {
    e.preventDefault();
    if (!pendingThreadPostId) return;
    const title = document.getElementById('threadTitleInput').value.trim();
    const content = document.getElementById('threadContentInput').value.trim();
    if (!title || !content) return;

    const btn = document.getElementById('createThreadSubmitBtn');
    btn.disabled = true;
    btn.innerText = "Oluşturuluyor...";

    try {
        if (typeof createSubChannelForPost === 'function') {
            await createSubChannelForPost(Number(pendingThreadPostId), title, content);
        }
        closeCreateThreadModal();
        setTimeout(() => {
            pollNewMessages();
            fetchActiveChannels();
        }, 400);
    } finally {
        btn.disabled = false;
        btn.innerText = "Oluştur";
    }
}

function isMobileView() { return window.innerWidth < 768; }

function toggleChannelSidebar() {
    const sidebar = document.getElementById('channelSidebar');
    const backdrop = document.getElementById('mobileBackdrop');
    const toggleBtn = document.getElementById('sidebarToggleBtn');

    if (isMobileView()) {
        const isClosed = sidebar.classList.contains('-translate-x-full');
        if (isClosed) {
            sidebar.classList.remove('-translate-x-full');
            backdrop.classList.remove('hidden');
        } else {
            sidebar.classList.add('-translate-x-full');
            backdrop.classList.add('hidden');
        }
    } else {
        if (sidebar.classList.contains('md:w-0')) {
            sidebar.classList.remove('md:w-0', 'md:overflow-hidden', 'md:border-none');
            sidebar.classList.add('w-[280px]');
            toggleBtn.classList.add('md:hidden');
        } else {
            sidebar.classList.add('md:w-0', 'md:overflow-hidden', 'md:border-none');
            sidebar.classList.remove('w-[280px]');
            toggleBtn.classList.remove('md:hidden');
        }
    }
    setTimeout(() => requestAnimationFrame(applyDynamicGridLayout), 310);
}

function closeMobileDrawers() {
    const sidebar = document.getElementById('channelSidebar');
    const backdrop = document.getElementById('mobileBackdrop');
    sidebar.classList.add('-translate-x-full');
    backdrop.classList.add('hidden');
    if (isMobileView() && activeViewingChannelId === activeVoiceChannelId && !isPopupForced) {
        isChatOpenOnVoice = false;
        syncMainLayout();
    }
}

function toggleChatSidebar() {
    isChatOpenOnVoice = !isChatOpenOnVoice;
    syncMainLayout();
    setTimeout(() => requestAnimationFrame(applyDynamicGridLayout), 50);
}

function toggleVideoPopupMode() {
    if (!activeVoiceChannelId) return;
    const viewingChannel = globalChannels.find(c => c.id === activeViewingChannelId);
    if (viewingChannel && !viewingChannel.isVoiceChannel) {
        isPopupForced = false;
        goToActiveVoiceChannel();
        return;
    }
    isPopupForced = !isPopupForced;
    syncMainLayout();
}

function syncMainLayout() {
    const viewingChannel = globalChannels.find(c => c.id === activeViewingChannelId);
    const isViewingSubChannel = Boolean(activeViewingChannelId && !viewingChannel);
    const videoArea = document.getElementById('videoArea');
    const chatSidebar = document.getElementById('chatSidebar');
    const mobileChatHeader = document.getElementById('mobileChatHeader');
    const chatToggleBtnTop = document.getElementById('chatToggleBtnTop');
    const popupToggleBtnTop = document.getElementById('popupToggleBtnTop');

    if (!viewingChannel && !isViewingSubChannel) {
        document.getElementById('emptyState').style.display = 'flex';
        document.getElementById('mainContentArea').style.display = 'none';
        chatToggleBtnTop.classList.add('hidden');
        popupToggleBtnTop.classList.add('hidden');
        return;
    }

    document.getElementById('emptyState').style.display = 'none';
    document.getElementById('mainContentArea').style.display = 'flex';

    const hasActiveVoice = Boolean(activeVoiceChannelId);
    const isViewingActiveVoice = viewingChannel && viewingChannel.isVoiceChannel && (viewingChannel.id === activeVoiceChannelId);

    if (hasActiveVoice) popupToggleBtnTop.classList.remove('hidden');
    else popupToggleBtnTop.classList.add('hidden');

    if (isViewingActiveVoice && !isPopupForced) {
        resetPopupPosition(videoArea);
        videoArea.className = "flex-1 overflow-hidden p-0 relative transition-all duration-300 flex flex-col min-w-0 min-h-0";
        chatToggleBtnTop.classList.remove('hidden');

        if (isChatOpenOnVoice) {
            if (isMobileView()) {
                chatSidebar.className = "fixed inset-y-0 right-0 w-full sm:w-[360px] bg-[#313338] flex flex-col z-40 shadow-2xl";
                mobileChatHeader.classList.remove('hidden');
                mobileChatHeader.classList.add('flex');
            } else {
                chatSidebar.className = "w-[350px] lg:w-[390px] overflow-hidden bg-[#313338] flex flex-col border-l border-white/5 shrink-0 relative";
                mobileChatHeader.classList.add('hidden');
            }
        } else {
            chatSidebar.className = "hidden";
            mobileChatHeader.classList.add('hidden');
        }
    } else {
        chatToggleBtnTop.classList.add('hidden');
        mobileChatHeader.classList.add('hidden');
        chatSidebar.className = "flex-1 overflow-hidden bg-[#313338] flex flex-col relative min-w-0 min-h-0";

        if (hasActiveVoice) {
            videoArea.className = "floating-popup";
            document.getElementById('popupHeaderTitle').innerText = activeVoiceChannelName || "Ses Kanalı";
        } else {
            resetPopupPosition(videoArea);
            videoArea.className = "hidden";
        }
    }

    if (hasActiveVoice) {
        document.getElementById('controlBar').style.display = 'flex';
        document.getElementById('controlBarChannelName').innerText = activeVoiceChannelName || "Ses Aktif";
        updateVideoUI();
        requestAnimationFrame(applyDynamicGridLayout);
    } else {
        document.getElementById('controlBar').style.display = 'none';
        updateTopActiveSpeakersUI();
    }
}

function resetPopupPosition(el) {
    el.style.left = '';
    el.style.top = '';
    el.style.right = '';
    el.style.bottom = '';
}

function initDraggablePopup() {
    const popup = document.getElementById('videoArea');
    const header = document.getElementById('popupDragHeader');
    if (!popup || !header) return;
    let isDragging = false, startX = 0, startY = 0, initialLeft = 0, initialTop = 0;

    const onStart = (e) => {
        if (!popup.classList.contains('floating-popup') || e.target.closest('button')) return;
        isDragging = true;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        const rect = popup.getBoundingClientRect();
        startX = clientX;
        startY = clientY;
        initialLeft = rect.left;
        initialTop = rect.top;
        popup.style.bottom = 'auto';
        popup.style.right = 'auto';
        popup.style.left = `${initialLeft}px`;
        popup.style.top = `${initialTop}px`;
    };

    const onMove = (e) => {
        if (!isDragging) return;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        const dx = clientX - startX;
        const dy = clientY - startY;
        const maxLeft = window.innerWidth - popup.offsetWidth - 8;
        const maxTop = window.innerHeight - popup.offsetHeight - 8;
        popup.style.left = `${Math.max(8, Math.min(maxLeft, initialLeft + dx))}px`;
        popup.style.top = `${Math.max(8, Math.min(maxTop, initialTop + dy))}px`;
    };

    const onEnd = () => { isDragging = false; };

    header.addEventListener('mousedown', onStart);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);
    header.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('resize', () => { if (activeViewingChannelId) syncMainLayout(); });
}

function goToActiveVoiceChannel() {
    if (activeVoiceChannelId && globalChannels) {
        isPopupForced = false;
        const activeChannel = globalChannels.find(c => c.id === activeVoiceChannelId);
        if (activeChannel) handleChannelClick(activeChannel);
    }
}

function startPolling() {
    if (pollingInterval) clearInterval(pollingInterval);
    pollingInterval = setInterval(fetchActiveChannels, 3000);
}

function updateTopActiveSpeakersUI() {
    const badge = document.getElementById('topActiveSpeakersBadge');
    const textEl = document.getElementById('topActiveSpeakersText');
    if (!badge || !textEl) return;

    if (!room || !activeVoiceChannelId) {
        badge.classList.add('hidden');
        badge.classList.remove('flex');
        return;
    }

    let speakingNames = [];
    if (room.localParticipant && room.localParticipant.isSpeaking) {
        const localUsername = currentLoggedUserInfo.username || localStorage.getItem('mc_username') || room.localParticipant.identity || 'Sen';
        speakingNames.push(localUsername);
    }
    if (room.participants) {
        room.participants.forEach(p => {
            if (p.isSpeaking && !isParticipantLocallyMuted(p.identity)) {
                speakingNames.push(p.identity || 'Kullanıcı');
            }
        });
    }

    if (speakingNames.length > 0) {
        textEl.innerText = speakingNames.join(', ');
        badge.classList.remove('hidden');
        badge.classList.add('flex');
    } else {
        badge.classList.add('hidden');
        badge.classList.remove('flex');
    }
}

function scrollChannelIntoSidebarView(channelId) {
    setTimeout(() => {
        const sidebar = document.getElementById('sidebarChannels');
        const chWrapper = document.getElementById(`sidebar-channel-wrap-${channelId}`);
        if (!sidebar || !chWrapper) return;

        const usersList = document.getElementById(`sidebar-users-${channelId}`);
        const targetEl = usersList || chWrapper;

        const sidebarRect = sidebar.getBoundingClientRect();
        const wrapRect = chWrapper.getBoundingClientRect();
        const targetRect = targetEl.getBoundingClientRect();

        if (wrapRect.top < sidebarRect.top + 16) {
            chWrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else if (targetRect.bottom > sidebarRect.bottom - 16) {
            targetEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }, 80);
}

function buildSidebarParticipants(channel, isVoiceConnected) {
    let mapped = [], apiParticipants = channel.voiceParticipants || [];
    const localUsername = currentLoggedUserInfo.username || localStorage.getItem('mc_username') || '';

    if (isVoiceConnected && room && room.participants) {
        let currentParticipants = [];
        if (room.localParticipant) currentParticipants.push(room.localParticipant);
        room.participants.forEach(p => currentParticipants.push(p));
        mapped = currentParticipants.map(p => {
            let rawUsername = p.identity || "Kullanıcı";
            let name = rawUsername;
            let picUrl = null;
            let userId = null;
            if (p.isLocal) {
                if (localUsername) rawUsername = localUsername;
                let match = apiParticipants.find(ap => ap.username === rawUsername);
                if (match) { picUrl = match.pictureUrl; userId = extractUserIdFromObject(match, false); }
                name = rawUsername + " (Sen)";
            } else {
                let match = apiParticipants.find(ap => ap.username === rawUsername);
                if (match) { picUrl = match.pictureUrl; userId = extractUserIdFromObject(match, false); }
            }

            // API listesinde henüz yoksa önbellekten (knownUsersMap / mesajlar) bul, yine yoksa arka planda çek
            if (!picUrl) {
                picUrl = getCachedUserAvatarByUsername(rawUsername);
                if (!picUrl) {
                    ensureUserAvatarLoadedAsync(rawUsername);
                }
            }

            return {
                sid: getParticipantSid(p),
                isLocal: Boolean(p.isLocal),
                userId,
                rawUsername,
                name,
                isSpeaking: p.isSpeaking,
                isMuted: isParticipantMicMuted(p),
                isCameraOn: hasVideo(p),
                pictureUrl: picUrl
            };
        });

        if (isHoveringParticipantList && frozenParticipantOrderMap.has(channel.id)) {
            const frozenOrder = frozenParticipantOrderMap.get(channel.id);
            mapped.sort((a, b) => {
                const idxA = frozenOrder.indexOf(a.rawUsername);
                const idxB = frozenOrder.indexOf(b.rawUsername);
                if (idxA === -1 && idxB === -1) return 0;
                if (idxA === -1) return 1;
                if (idxB === -1) return -1;
                return idxA - idxB;
            });
        } else {
            mapped.sort((a, b) => {
                if (Boolean(a.isCameraOn) !== Boolean(b.isCameraOn)) {
                    return a.isCameraOn ? -1 : 1;
                }
                if (a.isSpeaking !== b.isSpeaking) return a.isSpeaking ? -1 : 1;
                let ixA = recentSpeakerSids.indexOf(a.sid);
                let ixB = recentSpeakerSids.indexOf(b.sid);
                if (ixA !== -1 && ixB === -1) return -1;
                if (ixA === -1 && ixB !== -1) return 1;
                if (ixA !== -1 && ixB !== -1) return ixA - ixB;
                return 0;
            });
            frozenParticipantOrderMap.set(channel.id, mapped.map(item => item.rawUsername));
        }
    } else {
        mapped = apiParticipants.map(p => ({
            sid: p.username,
            isLocal: Boolean(localUsername && p.username && p.username.toLowerCase() === localUsername.toLowerCase()),
            userId: extractUserIdFromObject(p, false),
            rawUsername: p.username,
            name: p.username,
            isSpeaking: false,
            isMuted: p.isMuted,
            isCameraOn: Boolean(p.isVideoEnabled),
            pictureUrl: p.pictureUrl || getCachedUserAvatarByUsername(p.username)
        }));

        if (isHoveringParticipantList && frozenParticipantOrderMap.has(channel.id)) {
            const frozenOrder = frozenParticipantOrderMap.get(channel.id);
            mapped.sort((a, b) => {
                const idxA = frozenOrder.indexOf(a.rawUsername);
                const idxB = frozenOrder.indexOf(b.rawUsername);
                if (idxA === -1 && idxB === -1) return 0;
                if (idxA === -1) return 1;
                if (idxB === -1) return -1;
                return idxA - idxB;
            });
        } else {
            mapped.sort((a, b) => {
                if (Boolean(a.isCameraOn) !== Boolean(b.isCameraOn)) {
                    return a.isCameraOn ? -1 : 1;
                }
                return 0;
            });
            frozenParticipantOrderMap.set(channel.id, mapped.map(item => item.rawUsername));
        }
    }
    return mapped;
}

async function handleChannelClick(channel, preserveStack = false) {
    if (isMobileView()) {
        document.getElementById('channelSidebar').classList.add('-translate-x-full');
        document.getElementById('mobileBackdrop').classList.add('hidden');
    }

    if (!preserveStack) {
        channelNavigationStack = [];
        updateBackNavigationUI();
    }

    activeViewingChannelId = channel.id;
    channel.isRead = true;
    markChannelAsRead(channel.id);

    const headerIcon = channel.isVoiceChannel
        ? `<svg class="w-5 h-5 text-mc-green shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"></path></svg>`
        : `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4 text-mc-primary shrink-0"><line x1="4" x2="20" y1="9" y2="9"></line><line x1="4" x2="20" y1="15" y2="15"></line><line x1="10" x2="8" y1="3" y2="21"></line><line x1="16" x2="14" y1="3" y2="21"></line></svg>`;

    document.getElementById('activeRoomNameTop').innerHTML = `${headerIcon} <span class="font-bold text-white truncate">${channel.name}</span>`;

    if (channel.isVoiceChannel) {
        isPopupForced = false;
        if (activeVoiceChannelId !== channel.id) {
            pinnedParticipantIds.clear();
            await joinVoiceChannel(channel.id, channel.name);
        } else {
            startChatPolling(channel.id);
            syncMainLayout();
            updateVideoUI();
            requestAnimationFrame(applyDynamicGridLayout);
        }
    } else {
        startChatPolling(channel.id);
        syncMainLayout();
    }

    renderSidebar(true);
    scrollChannelIntoSidebarView(channel.id);
}

function handleGlobalBodyClick(e) {
    if (!e.target.closest('.emoji-picker-popover') && !e.target.closest('.emoji-trigger-btn')) {
        closeAllEmojiPickers();
    }
    if (!e.target.closest('#mentionPopup') && e.target.id !== 'chatInput') {
        hideMentionPopup();
    }
    if (!e.target.closest('#deviceSettingsModal') && !e.target.closest('#btnDeviceSettings')) {
        stopRtcStatsMonitoring();
        closeDeviceModal();
    }
}

// --- YARDIMCI FONKSİYON: Tarih Formatlayıcı ---
function formatApiDate(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('tr-TR', {
        day: 'numeric', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

// ==========================================
// 🔔 BİLDİRİMLER (NOTIFICATIONS) MODÜLÜ
// ==========================================
function setNotificationStatus(hasUnread) {
    const badge = document.getElementById('notificationBadge');
    const icon = document.getElementById('notificationIcon');
    if (!badge || !icon) return;

    if (hasUnread) {
        badge.classList.remove('hidden');
        icon.classList.add('text-white', 'animate-pulse');
        icon.classList.remove('text-gray-400');
    } else {
        badge.classList.add('hidden');
        icon.classList.remove('text-white', 'animate-pulse');
        icon.classList.add('text-gray-400');
    }
}

async function fetchAndRenderNotifications() {
    const token = localStorage.getItem('mc_token');
    const container = document.querySelector('#notificationsModal .overflow-y-auto');
    if (!token || !container) return;

    container.innerHTML = '<div class="text-center text-gray-500 py-10 animate-pulse">Bildirimler yükleniyor...</div>';

    try {
        const res = await fetch('https://api.meetingchallenge.com/User/get-notifications-pagination?lastNotificationId=0&limit=13', {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const result = await res.json();

        if (result.httpStatusCode === 200 && Array.isArray(result.data)) {
            if (result.data.length === 0) {
                container.innerHTML = '<div class="text-center text-gray-500 py-10">Henüz yeni bildiriminiz yok.</div>';
                setNotificationStatus(false);
                return;
            }

            let html = '<div class="flex flex-col gap-2">';
            let hasUnread = false;

            result.data.forEach(item => {
                if (item.isRead === false) hasUnread = true;
                const readClass = item.isRead ? 'bg-[#2b2d31] opacity-80' : 'bg-[#35373c] border-l-4 border-mc-primary shadow-md';
                
                html += `
                    <div class="p-3 rounded-lg flex flex-col gap-1 transition-colors cursor-default hover:bg-[#35373c] ${readClass}">
                        <div class="font-bold text-white text-sm flex items-center gap-1.5">
                            <span class="text-mc-primary">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"></path></svg>
                            </span>
                            ${item.title || 'Meeting Challenge'}
                        </div>
                        <div class="text-gray-300 text-xs leading-relaxed">
                            ${item.body}
                        </div>
                        <div class="text-[10px] text-gray-500 font-medium text-right mt-1">
                            ${formatApiDate(item.createDate)}
                        </div>
                    </div>
                `;
            });
            html += '</div>';
            container.innerHTML = html;
            setNotificationStatus(hasUnread);
        } else {
            throw new Error("Veri formatı hatalı");
        }
    } catch (err) {
        container.innerHTML = '<div class="text-center text-mc-red py-10">Bildirimler yüklenemedi.</div>';
    }
}

function openNotificationsModal() {
    document.getElementById('notificationsModal').classList.remove('hidden');
    fetchAndRenderNotifications();
}

function closeNotificationsModal() { 
    document.getElementById('notificationsModal').classList.add('hidden'); 
    setNotificationStatus(false);
}

// ==========================================
// 📅 GELİŞMİŞ ETKİNLİKLER (EVENTS) MODÜLÜ
// ==========================================

var EVENT_CITIES = [
    { id: "34", name: "İstanbul", aliases: ["istanbul", "i̇stanbul"] },
    { id: "35", name: "İzmir", aliases: ["izmir", "i̇zmir"] },
    { id: "6",  name: "Ankara", aliases: ["ankara"] },
    { id: "41", name: "Kocaeli", aliases: ["kocaeli", "izmit"] }
];

function mapCityNameToId(cityName) {
    if (!cityName) return null;
    const normalized = String(cityName).trim().toLocaleLowerCase('tr-TR');
    for (const c of EVENT_CITIES) {
        if (c.name.toLocaleLowerCase('tr-TR') === normalized || c.aliases.includes(normalized)) {
            return c.id;
        }
    }
    return null;
}

async function resolveUserDefaultEventCity() {
    if (selectedEventCityId) return selectedEventCityId;

    const token = localStorage.getItem('mc_token');
    if (!token) {
        selectedEventCityId = "34";
        return selectedEventCityId;
    }

    let uid = (typeof currentLoggedUserInfo !== 'undefined' && currentLoggedUserInfo.userId)
        ? currentLoggedUserInfo.userId
        : null;

    if (!uid && typeof parseJwt === 'function') {
        const jwtPayload = parseJwt(token);
        if (jwtPayload) {
            uid = Number(jwtPayload.Id || jwtPayload.id || jwtPayload.sub) || null;
        }
    }

    if (uid && !userCityFetched) {
        try {
            const res = await fetch(`https://api.meetingchallenge.com/User/get-user-info?userId=${encodeURIComponent(uid)}`, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'Authorization': `Bearer ${token}`
                }
            });
            const json = await res.json();
            const userData = (json && json.data) ? json.data : json;
            if (userData && userData.city) {
                const mappedId = mapCityNameToId(userData.city);
                if (mappedId) {
                    selectedEventCityId = mappedId;
                }
                if (typeof currentLoggedUserInfo !== 'undefined') {
                    currentLoggedUserInfo.city = userData.city;
                }
            }
        } catch (err) {
            console.warn("Kullanıcı şehir bilgisi alınamadı, varsayılan İstanbul seçiliyor:", err);
        } finally {
            userCityFetched = true;
        }
    }

    if (!selectedEventCityId) selectedEventCityId = "34";
    return selectedEventCityId;
}

function selectEventCity(cityId) {
    selectedEventCityId = String(cityId);
    currentOpenEventId = null;
    fetchAndRenderEvents();
}

function renderEventCitySelectorHeader() {
    return `
        <div class="flex items-center justify-between gap-2 mb-3 pb-2.5 border-b border-white/10 flex-wrap">
            <span class="text-[11px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                <svg class="w-3.5 h-3.5 text-mc-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                Şehir Seçimi
            </span>
            <div class="flex items-center gap-1.5 flex-wrap">
                ${EVENT_CITIES.map(c => {
                    const isActive = String(selectedEventCityId) === String(c.id);
                    return `
                        <button type="button" onclick="selectEventCity('${c.id}')" 
                            class="px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${isActive ? 'bg-mc-primary text-white shadow-sm' : 'bg-[#1e1f22] text-gray-400 hover:bg-[#35373c] hover:text-gray-200'}">
                            ${c.name}
                        </button>
                    `;
                }).join('')}
            </div>
        </div>
    `;
}

function isUserJoinedEvent(eventObj) {
    if (!eventObj) return false;
    if (eventObj.isJoined === true) return true;
    if (Number(eventObj.eventJoinStatus) === 2) return true;
    const statusText = String(eventObj.eventJoinStatusName || '').toLocaleLowerCase('tr-TR');
    if (statusText.includes('katıldın') || statusText.includes('katildin')) return true;

    const myId = typeof currentLoggedUserInfo !== 'undefined' ? Number(currentLoggedUserInfo.userId) : null;
    const myUname = String((typeof currentLoggedUserInfo !== 'undefined' && currentLoggedUserInfo.username) || localStorage.getItem('mc_username') || '').trim().toLowerCase();

    if (Array.isArray(eventObj.eventUsers)) {
        return eventObj.eventUsers.some(u => {
            if (myId && Number(u.id) === myId) return true;
            if (myUname && u.username && String(u.username).trim().toLowerCase() === myUname) return true;
            return false;
        });
    }
    return false;
}

async function fetchEventDetailFromApi(eventId) {
    const token = localStorage.getItem('mc_token');
    if (!token || !eventId) return null;

    const url = `https://api.meetingchallenge.com/Event/get-event-by-id?eventId=${encodeURIComponent(eventId)}`;
    const headers = {
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`,
        'lang': 'tr'
    };

    try {
        const resGet = await fetch(url, { method: 'GET', headers });
        if (resGet.ok) {
            const json = await resGet.json();
            if (json && (json.data || json.id || json.name)) {
                return json.data || json;
            }
        }
    } catch (err) {
        console.warn("GET get-event-by-id hatası:", err);
    }

    try {
        const resPost = await fetch(url, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ eventId: Number(eventId), id: Number(eventId) })
        });
        if (resPost.ok) {
            const json = await resPost.json();
            if (json && (json.data || json.id || json.name)) {
                return json.data || json;
            }
        }
    } catch (err) {
        console.warn("POST get-event-by-id hatası:", err);
    }

    if (eventsListCache.has(Number(eventId))) {
        return eventsListCache.get(Number(eventId));
    }

    return null;
}

async function fetchAndRenderEvents() {
    const token = localStorage.getItem('mc_token');
    const container = document.querySelector('#eventsModal .overflow-y-auto');
    if (!token || !container) return;

    currentOpenEventId = null;
    await resolveUserDefaultEventCity();

    container.innerHTML = `
        ${renderEventCitySelectorHeader()}
        <div class="text-center text-gray-500 py-10 animate-pulse">Etkinlikler yükleniyor...</div>
    `;

    const today = new Date();
    const datePayload = today.toISOString().split('T')[0] + 'T00:00:00';

    try {
        const res = await fetch('https://api.meetingchallenge.com/Event/get-events-by-date', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                date: datePayload,
                cityId: String(selectedEventCityId)
            })
        });
        const result = await res.json();

        if (result.httpStatusCode === 200 && Array.isArray(result.data)) {
            if (result.data.length === 0) {
                const selectedCityObj = EVENT_CITIES.find(c => c.id === String(selectedEventCityId));
                const cityNameLabel = selectedCityObj ? selectedCityObj.name : 'bu şehir';
                container.innerHTML = `
                    ${renderEventCitySelectorHeader()}
                    <div class="text-center text-gray-400 py-12 flex flex-col items-center gap-2">
                        <svg class="w-10 h-10 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                        <span>${cityNameLabel} için yaklaşan etkinlik bulunmuyor.</span>
                    </div>
                `;
                return;
            }

            let html = renderEventCitySelectorHeader();
            html += '<div class="flex flex-col gap-3">';

            result.data.forEach(item => {
                eventsListCache.set(Number(item.id), item);

                const pCount = item.participants ?? (Array.isArray(item.eventUsers) ? item.eventUsers.length : 0);
                const capacity = item.capacity || 'Sınırsız';
                const joined = isUserJoinedEvent(item);
                const isFull = typeof item.capacity === 'number' && pCount >= item.capacity && !joined;

                const joinBtnClass = joined
                    ? 'bg-mc-green/20 hover:bg-mc-red text-mc-green hover:text-white border border-mc-green/30 hover:border-mc-red'
                    : (isFull ? 'bg-gray-700 text-gray-400 cursor-not-allowed' : 'bg-mc-primary hover:bg-indigo-500 text-white shadow-sm');

                const joinBtnContent = joined
                    ? `<span class="group-hover/joinbtn:hidden">✓ Katıldın</span><span class="hidden group-hover/joinbtn:inline">Vazgeç</span>`
                    : (isFull ? 'Kontenjan Dolu' : 'Katıl');

                html += `
                    <div onclick="openEventDetails(${item.id})" class="bg-[#2b2d31] p-3.5 rounded-xl border border-white/5 flex flex-col gap-2.5 hover:bg-[#35373c] hover:border-white/10 transition-all cursor-pointer group">
                        <div class="flex justify-between items-start gap-2">
                            <div class="font-bold text-white text-[15px] group-hover:text-mc-primary transition-colors leading-tight">
                                ${item.name}
                            </div>
                            <div class="text-[11px] font-bold bg-mc-primary/20 text-mc-primary px-2 py-1 rounded-md shrink-0 flex items-center gap-1">
                                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                                ${pCount} / ${capacity}
                            </div>
                        </div>

                        <div class="flex items-center justify-between gap-2 flex-wrap pt-1 border-t border-white/5">
                            <div class="text-gray-400 text-[12px] flex items-center gap-3 font-medium flex-wrap">
                                <span class="flex items-center gap-1">
                                    <svg class="w-3.5 h-3.5 text-mc-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                                    ${formatApiDate(item.eventDate)}
                                </span>
                                <span class="flex items-center gap-1">
                                    <svg class="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                                    ${item.locationName || item.cityName || 'Konum Belirtilmemiş'}
                                </span>
                            </div>

                            <div class="flex items-center gap-1.5 ml-auto">
                                <button type="button" 
                                    id="event-list-join-btn-${item.id}"
                                    title="${joined ? 'Katılımdan vazgeçmek için tıkla' : 'Etkinliğe katılmak için tıkla'}"
                                    ${isFull ? 'disabled' : ''}
                                    onclick="toggleEventJoin(${item.id}, ${joined}, event, false)" 
                                    class="group/joinbtn px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer min-w-[82px] text-center ${joinBtnClass}">
                                    ${joinBtnContent}
                                </button>
                                <span class="text-xs text-gray-400 group-hover:text-white px-2 py-1 rounded-md bg-white/5">Detay →</span>
                            </div>
                        </div>
                    </div>
                `;
            });
            html += '</div>';
            container.innerHTML = html;
        } else {
            throw new Error("Veri formatı hatalı");
        }
    } catch (err) {
        console.error("Etkinlik listesi hatası:", err);
        container.innerHTML = `
            ${renderEventCitySelectorHeader()}
            <div class="text-center text-mc-red py-10">Etkinlikler yüklenemedi.</div>
        `;
    }
}

async function openEventDetails(eventId) {
    const token = localStorage.getItem('mc_token');
    const container = document.querySelector('#eventsModal .overflow-y-auto');
    if (!token || !container || !eventId) return;

    currentOpenEventId = Number(eventId);
    container.innerHTML = `
        <div class="flex items-center gap-2 mb-3 pb-2 border-b border-white/10">
            <button type="button" onclick="fetchAndRenderEvents()" class="text-xs font-semibold text-gray-300 hover:text-white bg-[#1e1f22] hover:bg-[#35373c] px-2.5 py-1.5 rounded-lg flex items-center gap-1 transition-colors cursor-pointer">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path></svg>
                Etkinlik Listesine Dön
            </button>
        </div>
        <div class="text-center text-gray-400 py-12 animate-pulse">Etkinlik detayları yükleniyor...</div>
    `;

    try {
        const ev = await fetchEventDetailFromApi(eventId);
        if (!ev) {
            throw new Error("Etkinlik detayı alınamadı.");
        }

        const users = Array.isArray(ev.eventUsers) ? ev.eventUsers : [];
        const pCount = ev.participants ?? users.length;
        const capacity = ev.capacity || 'Sınırsız';
        const joined = isUserJoinedEvent(ev);
        const isFull = typeof ev.capacity === 'number' && pCount >= ev.capacity && !joined;

        const joinBtnClass = joined
            ? 'bg-mc-green/20 hover:bg-mc-red text-mc-green hover:text-white border border-mc-green/40 hover:border-mc-red'
            : (isFull ? 'bg-gray-700 text-gray-400 cursor-not-allowed' : 'bg-mc-primary hover:bg-indigo-500 text-white');

        const joinBtnContent = joined
            ? `<span class="group-hover/detailjoin:hidden">✓ ${ev.eventJoinStatusName || 'Katıldın'} (Vazgeçmek için tıkla)</span><span class="hidden group-hover/detailjoin:inline">✕ Katılımdan Vazgeç</span>`
            : (isFull ? 'Kontenjan Dolu' : 'Etkinliğe Katıl');

        const statusBadge = ev.eventJoinStatusName || joined
            ? `<span class="text-[11px] font-bold px-2.5 py-1 rounded-full ${joined ? 'bg-mc-green/20 text-mc-green border border-mc-green/30' : 'bg-white/10 text-gray-300'}">${ev.eventJoinStatusName || (joined ? 'Katıldın' : '')}</span>`
            : '';

        const channelBtnHtml = ev.channelId
            ? `<button type="button" onclick="openEventChannelFromModal(${ev.channelId})" class="px-3.5 py-2 rounded-lg text-xs font-semibold bg-[#1e1f22] hover:bg-[#35373c] text-gray-200 border border-white/10 flex items-center gap-1.5 transition-colors cursor-pointer">
                    <svg class="w-4 h-4 text-mc-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"></path></svg>
                    Etkinlik Kanalına Git
               </button>`
            : '';

        const participantsHtml = users.length > 0
            ? users.map(u => {
                let avatar = `https://ui-avatars.com/api/?background=1e1f22&color=fff&name=${encodeURIComponent(u.username || 'U')}`;
                if (u.pictureUrl) {
                    if (typeof getOptimizedImageUrl === 'function') {
                        avatar = getOptimizedImageUrl(u.pictureUrl, 64);
                    } else if (typeof getDirectMediaUrl === 'function') {
                        avatar = getDirectMediaUrl(u.pictureUrl);
                    } else if (String(u.pictureUrl).startsWith('http')) {
                        avatar = u.pictureUrl;
                    } else {
                        avatar = `https://api.meetingchallenge.com${u.pictureUrl}`;
                    }
                }

                const safeUname = String(u.username || 'Kullanıcı').replace(/'/g, "\\'");
                const safePic = u.pictureUrl ? String(u.pictureUrl).replace(/'/g, "\\'") : '';

                return `
                    <div onclick="closeEventsModal(); openUserProfileModal(${Number(u.id) || 'null'}, '${safeUname}', '${safePic}')" 
                         class="flex items-center gap-2 bg-[#1e1f22] hover:bg-[#35373c] p-2 rounded-lg border border-white/5 cursor-pointer transition-colors group/p">
                        <img src="${avatar}" alt="${u.username}" class="w-7 h-7 rounded-full object-cover bg-[#111214] shrink-0">
                        <div class="min-w-0 flex-1">
                            <div class="text-xs font-semibold text-gray-200 group-hover/p:text-white truncate">@${u.username}</div>
                        </div>
                    </div>
                `;
            }).join('')
            : '<div class="text-xs text-gray-500 italic col-span-full py-3 text-center">Henüz katılımcı bulunmuyor. İlk katılan sen ol!</div>';

        container.innerHTML = `
            <div class="flex flex-col gap-3.5">
                <div class="flex items-center justify-between gap-2 pb-2 border-b border-white/10">
                    <button type="button" onclick="fetchAndRenderEvents()" class="text-xs font-semibold text-gray-300 hover:text-white bg-[#1e1f22] hover:bg-[#35373c] px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path></svg>
                        Listeye Dön
                    </button>
                    ${statusBadge}
                </div>

                <div class="bg-[#2b2d31] p-4 rounded-xl border border-white/5 flex flex-col gap-3">
                    <div class="flex items-start justify-between gap-3">
                        <div>
                            <h3 class="text-lg font-bold text-white leading-snug">${ev.name || 'Etkinlik'}</h3>
                            ${ev.createdBy ? `<div class="text-xs text-gray-400 mt-0.5">Organizatör: <span class="text-gray-200 font-semibold">${ev.createdBy}</span></div>` : ''}
                        </div>
                        <div class="text-xs font-bold bg-mc-primary/20 text-mc-primary px-2.5 py-1 rounded-lg shrink-0 flex items-center gap-1">
                            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                            ${pCount} / ${capacity}
                        </div>
                    </div>

                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                        <div class="bg-[#1e1f22] p-2.5 rounded-lg border border-white/5 flex items-center gap-2.5">
                            <svg class="w-4 h-4 text-mc-primary shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                            <div>
                                <div class="text-[10px] text-gray-400 uppercase font-bold">Etkinlik Tarihi</div>
                                <div class="text-gray-100 font-semibold">${formatApiDate(ev.eventDate)}</div>
                            </div>
                        </div>
                        <div class="bg-[#1e1f22] p-2.5 rounded-lg border border-white/5 flex items-center gap-2.5">
                            <svg class="w-4 h-4 text-mc-green shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                            <div class="min-w-0">
                                <div class="text-[10px] text-gray-400 uppercase font-bold">Mekan / Şehir</div>
                                <div class="text-gray-100 font-semibold truncate" title="${ev.locationName || ''} ${ev.cityName ? '(' + ev.cityName + ')' : ''}">
                                    ${ev.locationName ? `${ev.locationName}${ev.cityName ? ' • ' + ev.cityName : ''}` : (ev.cityName || 'Belirtilmemiş')}
                                </div>
                            </div>
                        </div>
                    </div>

                    ${ev.description ? `
                        <div class="bg-[#1e1f22] p-3 rounded-lg border border-white/5">
                            <div class="text-[10px] font-bold text-gray-400 uppercase mb-1">Etkinlik Açıklaması</div>
                            <div class="text-xs text-gray-200 whitespace-pre-line leading-relaxed">${ev.description}</div>
                        </div>
                    ` : ''}

                    <div class="flex items-center gap-2 flex-wrap pt-1">
                        <button type="button" 
                            id="event-detail-join-btn-${ev.id}"
                            ${isFull ? 'disabled' : ''}
                            onclick="toggleEventJoin(${ev.id}, ${joined}, event, true)" 
                            class="group/detailjoin flex-1 py-2 px-4 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow-md ${joinBtnClass}">
                            ${joinBtnContent}
                        </button>
                        ${channelBtnHtml}
                    </div>
                </div>

                <div class="bg-[#2b2d31] p-3.5 rounded-xl border border-white/5 flex flex-col gap-2.5">
                    <div class="flex items-center justify-between">
                        <span class="text-xs font-bold text-gray-300 uppercase tracking-wider">Katılımcılar (${users.length})</span>
                    </div>
                    <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-60 overflow-y-auto pr-1">
                        ${participantsHtml}
                    </div>
                </div>
            </div>
        `;
    } catch (err) {
        console.error("Etkinlik detayları yüklenirken hata:", err);
        container.innerHTML = `
            <div class="flex items-center gap-2 mb-3 pb-2 border-b border-white/10">
                <button type="button" onclick="fetchAndRenderEvents()" class="text-xs font-semibold text-gray-300 hover:text-white bg-[#1e1f22] px-2.5 py-1.5 rounded-lg flex items-center gap-1 cursor-pointer">
                    ← Listeye Dön
                </button>
            </div>
            <div class="text-center text-mc-red py-10">Etkinlik detayları yüklenemedi.</div>
        `;
    }
}

async function toggleEventJoin(eventId, isCurrentlyJoined, domEvent, isFromDetailView = false) {
    if (domEvent) domEvent.stopPropagation();
    const token = localStorage.getItem('mc_token');
    if (!token || !eventId) return;

    const btnId = isFromDetailView ? `event-detail-join-btn-${eventId}` : `event-list-join-btn-${eventId}`;
    const btn = document.getElementById(btnId);
    const originalHtml = btn ? btn.innerHTML : '';

    if (btn) {
        btn.disabled = true;
        btn.innerText = "İşleniyor...";
    }

    const actionEndpoint = isCurrentlyJoined ? 'leave-event' : 'join-event';
    const targetUrl = `https://api.meetingchallenge.com/Event/${actionEndpoint}?eventId=${encodeURIComponent(eventId)}`;
    const headers = {
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    };

    try {
        let res = await fetch(targetUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify({ eventId: Number(eventId) })
        });

        if (res.status === 405 || res.status === 404) {
            res = await fetch(targetUrl, { method: 'GET', headers });
        }

        const result = await res.json().catch(() => ({}));

        if (res.ok || result.httpStatusCode === 200) {
            if (isFromDetailView || currentOpenEventId === Number(eventId)) {
                await openEventDetails(eventId);
            } else {
                await fetchAndRenderEvents();
            }
            if (typeof fetchActiveChannels === 'function') {
                fetchActiveChannels();
            }
        } else {
            alert(result.message || "İşlem gerçekleştirilemedi.");
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = originalHtml;
            }
        }
    } catch (err) {
        console.error(`Etkinlik ${actionEndpoint} hatası:`, err);
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    }
}

function openEventChannelFromModal(channelId) {
    if (!channelId) return;
    closeEventsModal();
    const targetCh = globalChannels.find(c => Number(c.id) === Number(channelId));
    if (targetCh) {
        handleChannelClick(targetCh);
    } else {
        activeViewingChannelId = Number(channelId);
        startChatPolling(Number(channelId));
        syncMainLayout();
        renderSidebar(true);
    }
}

function openEventsModal() {
    document.getElementById('eventsModal').classList.remove('hidden');
    fetchAndRenderEvents();
}

function closeEventsModal() { 
    document.getElementById('eventsModal').classList.add('hidden'); 
    currentOpenEventId = null;
}

// ==========================================
// 💬 DM (Direkt Mesajlar) MODÜLÜ
// ==========================================
function openDMsModal() { document.getElementById('dmsModal').classList.remove('hidden'); }
function closeDMsModal() { document.getElementById('dmsModal').classList.add('hidden'); }