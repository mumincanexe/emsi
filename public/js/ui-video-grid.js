// ==========================================
// 🎥 DİNAMİK VİDEO GRİD, SAHNE MODU, DİKEY KAMERA KORUMASI & SIRALAMA MODÜLÜ
// ==========================================

// Sahne Modu durumu (Sadece sağ üstteki butondan açılır/kapanır)
var isStageModeActive = localStorage.getItem('mc_stage_mode') === 'true';

// Kamera açma ve odaya katılma zamanlarını takip eden haritalar (FIFO sıralama için)
var participantJoinOrderMap = typeof participantJoinOrderMap !== 'undefined' ? participantJoinOrderMap : new Map();
var participantCamOnOrderMap = typeof participantCamOnOrderMap !== 'undefined' ? participantCamOnOrderMap : new Map();
var joinSequenceCounter = typeof joinSequenceCounter !== 'undefined' ? joinSequenceCounter : 1;
var camSequenceCounter = typeof camSequenceCounter !== 'undefined' ? camSequenceCounter : 1;

// Kullanıcının Admin / Moderatör olup olmadığını kontrol eder
function isUserAdminOrMod(rawUsername, userObj = null) {
    if (!rawUsername) return false;
    const clean = String(rawUsername).trim().replace(/\s*\(Sen\)\s*$/i, '').replace(/^@+/, '');
    if (!clean) return false;
    const cleanLower = clean.toLowerCase();

    const checkRoleList = (roles) => {
        if (!Array.isArray(roles)) return false;
        return roles.some(r => {
            const rName = (typeof r === 'object' ? (r.name || r.title || r.roleName || '') : String(r)).toLowerCase();
            return /admin|mod|yönetici|yonetici|kurucu|owner|staff|yetkili|rehber|oryantasyon|lider/.test(rName);
        });
    };

    if (userObj) {
        if (userObj.isAdmin || userObj.isModerator || userObj.isMod || userObj.isStaff) return true;
        if (checkRoleList(userObj.roles || userObj.userRoles)) return true;
        if (typeof userObj.role === 'string' && checkRoleList([userObj.role])) return true;
    }

    if (typeof findKnownUserByUsername === 'function') {
        const known = findKnownUserByUsername(clean);
        if (known) {
            if (known.isAdmin || known.isModerator || known.isMod) return true;
            if (checkRoleList(known.roles)) return true;
        }
    }
    if (typeof knownUsersMap !== 'undefined' && knownUsersMap instanceof Map) {
        for (const [k, val] of knownUsersMap.entries()) {
            const kClean = typeof stripEmojis === 'function' ? stripEmojis(k) : k;
            if (String(k).toLowerCase() === cleanLower || String(kClean).toLowerCase() === cleanLower) {
                if (val && (val.isAdmin || val.isModerator || checkRoleList(val.roles))) return true;
            }
        }
    }

    if (typeof globalChannels !== 'undefined' && Array.isArray(globalChannels)) {
        for (const ch of globalChannels) {
            for (const vp of (ch.voiceParticipants || [])) {
                if (vp.username && vp.username.toLowerCase() === cleanLower) {
                    if (vp.isAdmin || vp.isModerator || checkRoleList(vp.roles)) return true;
                }
            }
        }
    }

    if (typeof messagesMap !== 'undefined' && messagesMap instanceof Map) {
        for (const m of messagesMap.values()) {
            const mUser = String(m.userName || m.username || '').trim().toLowerCase();
            if (mUser === cleanLower) {
                if (m.isAdmin || m.isModerator || checkRoleList(m.roles || m.userRoles)) return true;
            }
        }
    }

    return false;
}

// Katılım ve Kamera açma sırasını günceller
function trackParticipantOrderTimestamps(usernameKey, hasActiveCam) {
    if (!usernameKey) return;
    const key = String(usernameKey).trim().replace(/\s*\(Sen\)\s*$/i, '').toLowerCase();
    if (!key) return;

    if (!participantJoinOrderMap.has(key)) {
        participantJoinOrderMap.set(key, joinSequenceCounter++);
    }

    if (hasActiveCam) {
        if (!participantCamOnOrderMap.has(key)) {
            participantCamOnOrderMap.set(key, camSequenceCounter++);
        }
    } else {
        participantCamOnOrderMap.delete(key);
    }
}

function getParticipantJoinOrder(usernameKey) {
    const key = String(usernameKey || '').trim().replace(/\s*\(Sen\)\s*$/i, '').toLowerCase();
    return participantJoinOrderMap.get(key) ?? 999999;
}

function getParticipantCamOrder(usernameKey) {
    const key = String(usernameKey || '').trim().replace(/\s*\(Sen\)\s*$/i, '').toLowerCase();
    return participantCamOnOrderMap.get(key) ?? 999999;
}

// Sağ üst bara Sahne Modu butonunu ekler ve durumunu senkronize eder
function ensureStageModeButtonInTopBar() {
    let stageBtn = document.getElementById('stageModeToggleBtnTop');
    if (!stageBtn) {
        const anchorBtn = document.getElementById('popupToggleBtnTop') || document.getElementById('chatToggleBtnTop');
        if (!anchorBtn || !anchorBtn.parentElement) return null;

        stageBtn = document.createElement('button');
        stageBtn.id = 'stageModeToggleBtnTop';
        stageBtn.type = 'button';
        stageBtn.onclick = () => toggleStageMode();
        anchorBtn.parentElement.insertBefore(stageBtn, anchorBtn);
    }

    const hasActiveVoice = Boolean(typeof activeVoiceChannelId !== 'undefined' && activeVoiceChannelId);
    const viewingChannel = (typeof globalChannels !== 'undefined' && Array.isArray(globalChannels))
        ? globalChannels.find(c => c.id === activeViewingChannelId)
        : null;
    const isViewingActiveVoice = Boolean(viewingChannel && viewingChannel.isVoiceChannel && viewingChannel.id === activeVoiceChannelId);

    if (hasActiveVoice && isViewingActiveVoice && !isPopupForced) {
        stageBtn.classList.remove('hidden');
        stageBtn.classList.add('flex');
    } else {
        stageBtn.classList.add('hidden');
        stageBtn.classList.remove('flex');
    }

    stageBtn.title = isStageModeActive
        ? 'Sahne Modu Açık (Kapatmak için tıkla)'
        : 'Sahne Modunu Aç (Kamera açanları otomatik büyüt)';

    stageBtn.className = `${stageBtn.classList.contains('hidden') ? 'hidden' : 'flex'} items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer border ${
        isStageModeActive
            ? 'bg-mc-primary text-white border-mc-primary shadow-md'
            : 'bg-[#2b2d31] text-gray-300 hover:text-white hover:bg-[#35373c] border-white/10'
    }`;

    stageBtn.innerHTML = `
        <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <rect x="2" y="3" width="20" height="12" rx="2" ry="2"></rect>
            <rect x="2" y="17" width="6" height="4" rx="1"></rect>
            <rect x="9" y="17" width="6" height="4" rx="1"></rect>
            <rect x="16" y="17" width="6" height="4" rx="1"></rect>
        </svg>
        <span class="hidden sm:inline">Sahne Modu</span>
    `;

    return stageBtn;
}

function toggleStageMode(forceState = null) {
    if (typeof forceState === 'boolean') {
        isStageModeActive = forceState;
    } else {
        isStageModeActive = !isStageModeActive;
    }
    localStorage.setItem('mc_stage_mode', String(isStageModeActive));
    ensureStageModeButtonInTopBar();
    requestAnimationFrame(applyDynamicGridLayout);
}

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

    if (document.getElementById('unifiedCameraSettingsGroup')) {
        syncCameraSettingsButtonsUI();
        return;
    }

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

// Ekran boyutuna göre tek sütuna düşmeyi engelleyen, ideal satır/sütun hesaplayıcı
function calculateOptimalGridDimensions(count, containerWidth, containerHeight) {
    if (count <= 1) return { cols: 1, rows: 1 };

    const isMobile = window.innerWidth < 640;
    const isPopup = document.getElementById('videoArea')?.classList.contains('floating-popup');

    if (isPopup) {
        const cols = count === 2 ? 2 : (count <= 4 ? 2 : (count <= 9 ? 3 : 4));
        const rows = Math.ceil(count / cols);
        return { cols, rows };
    }

    if (isMobile) {
        const cols = count === 2 ? 1 : (count <= 6 ? 2 : (count <= 12 ? 3 : 4));
        const rows = Math.ceil(count / cols);
        return { cols, rows };
    }

    const W = containerWidth > 100 ? containerWidth : Math.max(window.innerWidth - 320, 640);
    const H = containerHeight > 100 ? containerHeight : Math.max(window.innerHeight - 120, 480);
    const targetAspect = 16 / 9;

    let bestCols = Math.ceil(Math.sqrt(count));
    let bestRows = Math.ceil(count / bestCols);
    let maxCardArea = 0;

    const minCols = count >= 2 ? 2 : 1;

    for (let cols = minCols; cols <= count; cols++) {
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

        const emptySlots = (cols * rows) - count;
        const fillFactor = 1 - (emptySlots / (cols * rows)) * 0.15;
        const effectiveArea = (tileW * tileH) * fillFactor;

        if (effectiveArea > maxCardArea) {
            maxCardArea = effectiveArea;
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
        const clean = nameEl.textContent.trim().replace(/^★\s*/, '').replace(/\s*\(Sen\)\s*$/i, '');
        if (clean) {
            card.dataset.participantId = clean;
            return clean;
        }
    }
    const fallback = `user-card-${fallbackIdx}`;
    card.dataset.participantId = fallback;
    return fallback;
}

// Dikey ve yatay kameralarda büyütmeyi (crop) engeller; dikey kameralarda yanlardan boşluk bırakır
function applySmartVideoObjectFit(videoTag) {
    if (!videoTag) return;

    const enforceContain = () => {
        videoTag.classList.remove('object-cover');
        videoTag.classList.add('object-contain');
        videoTag.style.setProperty('object-fit', 'contain', 'important');
        videoTag.style.setProperty('object-position', 'center center', 'important');
        videoTag.style.setProperty('background-color', '#111214', 'important');
        videoTag.style.width = '100%';
        videoTag.style.height = '100%';
        videoTag.style.maxWidth = '100%';
        videoTag.style.maxHeight = '100%';
        videoTag.style.margin = '0 auto';
    };

    enforceContain();

    if (!videoTag._hasOrientationListener) {
        videoTag.addEventListener('loadedmetadata', enforceContain);
        videoTag.addEventListener('loadeddata', enforceContain);
        videoTag.addEventListener('resize', enforceContain);
        videoTag._hasOrientationListener = true;
    }
}

function decorateCardWithPinAndZeroGapStyle(card, pKey, isPinned, isCompact, isUltraCompact, isExtremeCompact, isScrollableTile = false) {
    card.classList.remove('col-span-full', 'col-span-2', 'col-span-3', 'col-span-4');

    card.style.minWidth = '0';
    card.style.width = '100%';
    card.style.margin = '0';
    card.style.borderRadius = '0';
    card.style.border = '0.5px solid rgba(255,255,255,0.06)';
    card.style.backgroundColor = '#111214';
    card.style.overflow = 'hidden';

    if (isScrollableTile) {
        card.style.height = isExtremeCompact ? '76px' : (isUltraCompact ? '92px' : '108px');
        card.style.minHeight = card.style.height;
    } else {
        card.style.minHeight = '0';
        card.style.height = '100%';
    }

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

    const isStaff = isUserAdminOrMod(pKey);
    const nameBadge = card.querySelector('.truncate, [class*="bottom-"]');
    if (nameBadge && isStaff && !nameBadge.dataset.modBadgeInjected) {
        nameBadge.dataset.modBadgeInjected = '1';
        const shieldHtml = `<span class="inline-flex items-center text-mc-primary mr-1" title="Yetkili (Admin / Mod)">★</span>`;
        nameBadge.innerHTML = shieldHtml + nameBadge.innerHTML;
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
        avatarImg.style.objectFit = 'cover';
        avatarImg.style.borderRadius = '50%';
        avatarImg.style.aspectRatio = '1 / 1';
        avatarImg.style.position = 'static';
        avatarImg.style.transform = 'none';

        if (!isPinned) {
            if (isExtremeCompact || isScrollableTile) {
                avatarImg.style.width = '2.25rem';
                avatarImg.style.height = '2.25rem';
            } else if (isUltraCompact) {
                avatarImg.style.width = '2.75rem';
                avatarImg.style.height = '2.75rem';
            } else if (isCompact) {
                avatarImg.style.width = '3.25rem';
                avatarImg.style.height = '3.25rem';
            } else {
                avatarImg.style.width = '4.25rem';
                avatarImg.style.height = '4.25rem';
            }
        } else {
            avatarImg.style.width = '5.5rem';
            avatarImg.style.height = '5.5rem';
        }
    }

    if (nameBadge && !isPinned) {
        nameBadge.style.fontSize = (isExtremeCompact || isScrollableTile) ? '10px' : (isUltraCompact ? '10.5px' : (isCompact ? '11px' : ''));
        nameBadge.style.padding = isUltraCompact ? '1px 4px' : '';
        nameBadge.style.position = 'absolute';
        nameBadge.style.bottom = '4px';
        nameBadge.style.left = '50%';
        nameBadge.style.transform = 'translateX(-50%)';
        nameBadge.style.maxWidth = '92%';
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
    ensureStageModeButtonInTopBar();

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

    // Önceki sahne kapsayıcılarını temizleyip kartları ana gridEl içine geri topla
    ['mcPinnedTopStage', 'mcUnpinnedBottomStage', 'mcActiveCamStage', 'mcNoCamScrollStage'].forEach(stageId => {
        const stage = document.getElementById(stageId);
        if (stage) {
            Array.from(stage.children).forEach(ch => gridEl.appendChild(ch));
            stage.remove();
        }
    });

    const allCards = Array.from(gridEl.children).filter(el =>
        el.id !== 'popupDragHeader' &&
        el.id !== 'noCameraEmptyMessage' &&
        !el.id.startsWith('mc') &&
        !el.classList.contains('popup-header')
    );

    if (allCards.length === 0) return;

    const currentCardKeys = new Set();

    allCards.forEach((card, idx) => {
        const pKey = extractCardParticipantKey(card, idx);
        currentCardKeys.add(pKey);

        const videoTag = card.querySelector('video');
        const hasActiveVideo = Boolean(
            !hideAllCamerasMode && (
                card.dataset.hasVideo === 'true' ||
                (videoTag && !videoTag.classList.contains('hidden') && videoTag.style.display !== 'none' && (videoTag.srcObject || videoTag.src))
            )
        );
        card.dataset.computedHasCam = hasActiveVideo ? '1' : '0';
        card.dataset.isModOrAdmin = isUserAdminOrMod(pKey) ? '1' : '0';

        trackParticipantOrderTimestamps(pKey, hasActiveVideo);

        if (hideNonVideoParticipants && !hasActiveVideo) {
            card.style.display = 'none';
        } else {
            card.style.display = '';
        }
    });

    Array.from(pinnedParticipantIds).forEach(k => {
        if (!currentCardKeys.has(k)) pinnedParticipantIds.delete(k);
    });

    // İSTENEN SIRALAMA:
    // 1. Pinlenenler -> 2. Kamera Açıklar (en üstte) -> 3. Mod/Admin -> 4. Kamera Açma Sırası -> 5. Katılma Sırası
    allCards.sort((a, b) => {
        const keyA = a.dataset.participantId;
        const keyB = b.dataset.participantId;

        const pinA = pinnedParticipantIds.has(keyA);
        const pinB = pinnedParticipantIds.has(keyB);
        if (pinA !== pinB) return pinA ? -1 : 1;

        const camA = a.dataset.computedHasCam === '1';
        const camB = b.dataset.computedHasCam === '1';
        if (camA !== camB) return camA ? -1 : 1;

        const modA = a.dataset.isModOrAdmin === '1';
        const modB = b.dataset.isModOrAdmin === '1';
        if (modA !== modB) return modA ? -1 : 1;

        if (camA && camB) {
            const camOrderDiff = getParticipantCamOrder(keyA) - getParticipantCamOrder(keyB);
            if (camOrderDiff !== 0) return camOrderDiff;
        }

        return getParticipantJoinOrder(keyA) - getParticipantJoinOrder(keyB);
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

    const areaRect = videoArea.getBoundingClientRect();
    const totalW = areaRect.width > 100 ? areaRect.width : Math.max(window.innerWidth - 320, 640);
    const totalH = areaRect.height > 100 ? areaRect.height : Math.max(window.innerHeight - 120, 480);

    const pinnedCards = visibleCards.filter(c => pinnedParticipantIds.has(c.dataset.participantId)).slice(0, MAX_PINNED_CAMERAS);

    // DURUM 1: Pinlenmiş kamera varsa (Üstte Pinlenenler, Altta Kaydırmalı Diğerleri)
    if (pinnedCards.length > 0) {
        const unpinnedCards = visibleCards.filter(c => !pinnedCards.includes(c));

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
        const { cols: pCols, rows: pRows } = calculateOptimalGridDimensions(pCount, totalW, totalH * 0.72);
        topStage.style.gridTemplateColumns = `repeat(${pCols}, minmax(0, 1fr))`;
        topStage.style.gridTemplateRows = `repeat(${pRows}, minmax(0, 1fr))`;

        pinnedCards.forEach((card, idx) => {
            decorateCardWithPinAndZeroGapStyle(card, card.dataset.participantId, true, false, false, false, false);
            if (pCount === 3 && pCols === 2 && idx === 2) {
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
            bottomStage.style.overflowY = 'auto';
            bottomStage.style.overflowX = 'hidden';
            bottomStage.style.borderTop = '1px solid rgba(255,255,255,0.1)';

            const cols = Math.min(Math.max(unpinnedCards.length, 2), window.innerWidth < 640 ? 3 : 6);
            bottomStage.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
            bottomStage.style.gridAutoRows = '100px';

            unpinnedCards.forEach(card => {
                card.style.gridColumn = '';
                decorateCardWithPinAndZeroGapStyle(card, card.dataset.participantId, false, true, true, false, true);
                bottomStage.appendChild(card);
            });
            gridEl.appendChild(bottomStage);
        }

        allCards.filter(c => c.style.display === 'none').forEach(c => gridEl.appendChild(c));
        return;
    }

    // DURUM 2: SAHNE MODU AKTİFSE (Sadece sağ üstteki Sahne Modu butonu açıkken çalışır)
    // Kamera açanlar üst sahnede otomatik büyür, kamerası kapalı olanlar altta kaydırmalı (scrollable) şeritte durur
    const activeCamCards = visibleCards.filter(c => c.dataset.computedHasCam === '1');
    const noCamCards = visibleCards.filter(c => c.dataset.computedHasCam !== '1');

    if (isStageModeActive && activeCamCards.length > 0) {
        gridEl.style.display = 'flex';
        gridEl.style.flexDirection = 'column';
        gridEl.style.gap = '0px';
        gridEl.style.padding = '0px';
        gridEl.style.height = '100%';
        gridEl.style.width = '100%';
        gridEl.style.overflow = 'hidden';

        const hasNoCamStrip = noCamCards.length > 0;
        const camStageRatio = hasNoCamStrip ? 0.78 : 1.0;

        // Üst Sahne: Kamerası Açık Olanlar Otomatik Büyür
        const camStage = document.createElement('div');
        camStage.id = 'mcActiveCamStage';
        camStage.style.display = 'grid';
        camStage.style.gap = '0px';
        camStage.style.width = '100%';
        camStage.style.height = hasNoCamStrip ? '78%' : '100%';
        camStage.style.minHeight = '0';
        camStage.style.overflow = 'hidden';

        const { cols: cCols, rows: cRows } = calculateOptimalGridDimensions(activeCamCards.length, totalW, totalH * camStageRatio);
        camStage.style.gridTemplateColumns = `repeat(${cCols}, minmax(0, 1fr))`;
        camStage.style.gridTemplateRows = `repeat(${cRows}, minmax(0, 1fr))`;

        const isCamCompact = activeCamCards.length > 6;
        activeCamCards.forEach((card, idx) => {
            decorateCardWithPinAndZeroGapStyle(card, card.dataset.participantId, false, isCamCompact, false, false, false);
            if (activeCamCards.length === 3 && cCols === 2 && idx === 2) {
                card.style.gridColumn = 'span 2';
            } else {
                card.style.gridColumn = '';
            }
            camStage.appendChild(card);
        });
        gridEl.appendChild(camStage);

        // Alt Sahne: Kamerası Kapalı Olanlar (Kaydırmalı Şerit)
        if (hasNoCamStrip) {
            const noCamStage = document.createElement('div');
            noCamStage.id = 'mcNoCamScrollStage';
            noCamStage.style.display = 'grid';
            noCamStage.style.gap = '0px';
            noCamStage.style.width = '100%';
            noCamStage.style.height = '22%';
            noCamStage.style.minHeight = '0';
            noCamStage.style.overflowY = 'auto';
            noCamStage.style.overflowX = 'hidden';
            noCamStage.style.borderTop = '1px solid rgba(255,255,255,0.1)';

            const noCamCols = window.innerWidth < 640
                ? Math.min(noCamCards.length, 3)
                : Math.min(Math.max(noCamCards.length, 3), 6);

            noCamStage.style.gridTemplateColumns = `repeat(${noCamCols}, minmax(0, 1fr))`;
            noCamStage.style.gridAutoRows = '92px';

            noCamCards.forEach(card => {
                card.style.gridColumn = '';
                decorateCardWithPinAndZeroGapStyle(card, card.dataset.participantId, false, true, true, false, true);
                noCamStage.appendChild(card);
            });
            gridEl.appendChild(noCamStage);
        }

        allCards.filter(c => c.style.display === 'none').forEach(c => gridEl.appendChild(c));
        return;
    }

    // DURUM 3: STANDART GRİD MODU (Sahne Modu Kapalıyken)
    // Kameralılar en üst sıralarda yer alır, ekran boyutuna göre ideal satır ve sütuna bölünür.
    // Kişi sayısı çok fazlaysa (> 20) tüm grid dikey kaydırmalı olur.
    allCards.forEach(card => {
        card.style.gridColumn = '';
        gridEl.appendChild(card);
    });

    const isScrollableMassGrid = visibleCount > 20;

    gridEl.style.display = 'grid';
    gridEl.style.flexDirection = '';
    gridEl.style.gap = '0px';
    gridEl.style.padding = '0px';
    gridEl.style.height = '100%';
    gridEl.style.width = '100%';

    if (isScrollableMassGrid) {
        const massCols = window.innerWidth < 640 ? 3 : 5;
        gridEl.style.gridTemplateColumns = `repeat(${massCols}, minmax(0, 1fr))`;
        gridEl.style.gridTemplateRows = '';
        gridEl.style.gridAutoRows = '130px';
        gridEl.style.overflowY = 'auto';
        gridEl.style.overflowX = 'hidden';

        visibleCards.forEach(card => {
            decorateCardWithPinAndZeroGapStyle(card, card.dataset.participantId, false, true, false, false, true);
        });
    } else {
        const { cols, rows } = calculateOptimalGridDimensions(visibleCount, totalW, totalH);
        gridEl.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
        gridEl.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
        gridEl.style.gridAutoRows = '';
        gridEl.style.overflow = 'hidden';

        const isCompact = visibleCount > 9;
        const isUltraCompact = visibleCount > 14;
        const isExtremeCompact = visibleCount > 18;

        visibleCards.forEach(card => {
            decorateCardWithPinAndZeroGapStyle(
                card,
                card.dataset.participantId,
                false,
                isCompact,
                isUltraCompact,
                isExtremeCompact,
                false
            );
        });
    }
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
        ensureStageModeButtonInTopBar();
        wrapFn();
    });
}