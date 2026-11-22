let cachedCreatePostConfig = null;
try {
    const savedCfg = localStorage.getItem('mc_create_post_cfg');
    if (savedCfg) cachedCreatePostConfig = JSON.parse(savedCfg);
} catch (e) {}

// --- YARDIMCI FONKSİYON: NEXT IMAGE URL ---
function getNextImageUrl(path, width = 640) {
    if (!path) return '';
    const fullUrl = path.startsWith('http') ? path : `https://api.meetingchallenge.com${path}`;
    return `https://meetingchallenge.com/_next/image?url=${encodeURIComponent(fullUrl)}&w=${width}&q=75`;
}

// --- PROFİL GÖNDERİLERİ, BAHSEDİLMELER VE DETAY GÖRÜNTÜLEYİCİ STATE YÖNETİMİ ---
let profilePostsState = {
    userId: null,
    username: '',
    fullName: '',
    pictureUrl: null,
    activeTab: 'posts', // 'posts' -> get-posts-by-user | 'mentions' -> get-posts-by-mention
    selectedChannelId: 0,
    mediaFilter: 'all', // 'all' | 'media'
    lastPostId: 0,
    hasMore: true,
    isLoading: false,
    posts: [],
    channelsCache: [],
    viewerIndex: -1,
    viewerLoadingNext: false
};

// Sol alttaki profil resmini günceller
function updateMySidebarAvatar(picUrl, fallbackName = null) {
    const avatarImg = document.getElementById('mySidebarAvatarImg');
    if (!avatarImg) return;
    const uname = fallbackName || currentLoggedUserInfo.username || localStorage.getItem('mc_username') || 'Me';
    if (picUrl) {
        avatarImg.src = getDirectMediaUrl(picUrl);
        localStorage.setItem('mc_user_avatar', getDirectMediaUrl(picUrl));
    } else {
        const cached = localStorage.getItem('mc_user_avatar');
        avatarImg.src = cached || `https://ui-avatars.com/api/?background=1e1f22&color=fff&name=${encodeURIComponent(stripEmojis(uname) || uname)}`;
    }
}

async function loadUserProfileUI() {
    const token = localStorage.getItem('mc_token');
    const jwtPayload = token ? parseJwt(token) : null;
    const storedUsername = localStorage.getItem('mc_username') || '';
    const jwtUserName = (jwtPayload && (jwtPayload.UserName || jwtPayload.username || jwtPayload.unique_name)) || '';
    const fullName = jwtPayload ? `${(jwtPayload.Name || '').trim()} ${(jwtPayload.Surname || '').trim()}`.trim() : '';

    // JWT içindeki tüm olası ID alanlarını kontrol et
    const rawJwtId = jwtPayload ? (
        jwtPayload.Id || jwtPayload.id || jwtPayload.sub || jwtPayload.userId || jwtPayload.UserId ||
        jwtPayload['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier']
    ) : null;
    const userId = rawJwtId && !isNaN(Number(rawJwtId)) ? Number(rawJwtId) : null;

    const jwtPic = jwtPayload ? (jwtPayload.PictureUrl || jwtPayload.pictureUrl || jwtPayload.avatar || null) : null;
    const displayUsername = storedUsername || jwtUserName || fullName || 'Kullanıcı';

    currentLoggedUserInfo = {
        userId,
        username: displayUsername,
        jwtUserName,
        fullName,
        pictureUrl: jwtPic ? getDirectMediaUrl(jwtPic) : (localStorage.getItem('mc_user_avatar') || null)
    };

    document.getElementById('localUserName').innerText = displayUsername;
    updateMySidebarAvatar(currentLoggedUserInfo.pictureUrl, displayUsername);

    knownUsersMap.set(displayUsername, {
        username: displayUsername,
        cleanUsername: stripEmojis(displayUsername) || displayUsername,
        userId,
        fullName: fullName || displayUsername,
        roles: jwtPayload && Array.isArray(jwtPayload.Role) ? jwtPayload.Role : [],
        pictureUrl: currentLoggedUserInfo.pictureUrl,
        color: '#818cf8'
    });

    const myApiData = await fetchUserInfoFromApi(userId, displayUsername, true);
    if (myApiData) {
        const apiUname = myApiData.username || myApiData.userName || displayUsername;
        const apiId = myApiData.id || myApiData.userId || userId;
        const apiPic = myApiData.pictureUrl ? getDirectMediaUrl(myApiData.pictureUrl) : currentLoggedUserInfo.pictureUrl;

        currentLoggedUserInfo.userId = apiId ? Number(apiId) : currentLoggedUserInfo.userId;
        currentLoggedUserInfo.username = apiUname;
        currentLoggedUserInfo.pictureUrl = apiPic;

        localStorage.setItem('mc_username', apiUname);
        document.getElementById('localUserName').innerText = apiUname;
        updateMySidebarAvatar(apiPic, apiUname);

        knownUsersMap.set(apiUname, {
            ...(findKnownUserByUsername(apiUname) || {}),
            userId: currentLoggedUserInfo.userId,
            username: apiUname,
            cleanUsername: stripEmojis(apiUname) || apiUname,
            pictureUrl: apiPic
        });
    }
}

function openMyProfile() {
    const username = currentLoggedUserInfo.username || localStorage.getItem('mc_username');
    const info = findKnownUserByUsername(username) || {};
    openUserProfileModal(
        currentLoggedUserInfo.userId || info.userId || null,
        username,
        currentLoggedUserInfo.pictureUrl || info.pictureUrl || null,
        true
    );
}

// ETİKETLENEN KULLANICININ PROFİLİNİ AÇARKEN ASLA KENDİ PROFİLİNE DÜŞMEMESİNİ SAĞLAYAN ÇÖZÜM
async function openUserProfileByUsername(rawUsername) {
    if (!rawUsername) return;
    const cleanInput = String(rawUsername).trim().replace(/^@+/, '');
    const strippedTarget = stripEmojis(cleanInput).toLowerCase();
    if (!cleanInput) return;

    const myNames = [
        currentLoggedUserInfo.username,
        currentLoggedUserInfo.jwtUserName,
        localStorage.getItem('mc_username')
    ].filter(Boolean).map(s => stripEmojis(s).toLowerCase());

    if (myNames.includes(strippedTarget)) {
        openMyProfile();
        return;
    }

    const info = findKnownUserByUsername(cleanInput) || {};
    let resolvedId = info.userId || null;
    let resolvedPic = info.pictureUrl || null;
    let canonicalName = info.username || cleanInput;

    // 1. Mevcut kanal mesajlarında bu kullanıcıyı ara
    if (!resolvedId) {
        for (const m of messagesMap.values()) {
            const mUser = String(m.userName || m.username || '').trim();
            if (mUser.toLowerCase() === cleanInput.toLowerCase() || stripEmojis(mUser).toLowerCase() === strippedTarget) {
                canonicalName = mUser;
                resolvedId = extractUserIdFromObject(m, true);
                if (!resolvedPic && m.pictureUrl) resolvedPic = getDirectMediaUrl(m.pictureUrl);
                if (resolvedId) break;
            }
        }
    }

    // 2. Ses kanallarındaki katılımcılarda ara
    if (!resolvedId && Array.isArray(globalChannels)) {
        for (const ch of globalChannels) {
            for (const vp of (ch.voiceParticipants || [])) {
                const vpUser = String(vp.username || '').trim();
                if (vpUser.toLowerCase() === cleanInput.toLowerCase() || stripEmojis(vpUser).toLowerCase() === strippedTarget) {
                    canonicalName = vpUser;
                    resolvedId = extractUserIdFromObject(vp, false);
                    if (!resolvedPic && vp.pictureUrl) resolvedPic = getDirectMediaUrl(vp.pictureUrl);
                    if (resolvedId) break;
                }
            }
            if (resolvedId) break;
        }
    }

    openUserProfileModal(resolvedId, canonicalName, resolvedPic, false);
}

async function fetchUserInfoFromApi(targetUserId, targetUsername = null, isSelfRequest = false) {
    const token = localStorage.getItem('mc_token');
    if (!token) return null;

    const headers = { 'accept': 'application/json', 'authorization': `Bearer ${token}`, 'lang': 'tr' };
    const candidateUrls = [];

    if (targetUserId && Number(targetUserId) > 0) {
        candidateUrls.push(`${userApiUrl}?userId=${encodeURIComponent(targetUserId)}`);
    }
    if (targetUsername && !targetUserId) {
        const cleanU = String(targetUsername).trim().replace(/^@+/, '');
        candidateUrls.push(`${userApiUrl}?userName=${encodeURIComponent(cleanU)}`);
        candidateUrls.push(`${userApiUrl}?username=${encodeURIComponent(cleanU)}`);
    }
    if (isSelfRequest && candidateUrls.length === 0) {
        candidateUrls.push(userApiUrl);
    }

    const isMatchingTarget = (uObj) => {
        if (!uObj || typeof uObj !== 'object') return false;
        if (isSelfRequest) return true;
        if (targetUserId && uObj.id && Number(uObj.id) === Number(targetUserId)) return true;

        if (targetUsername) {
            const reqStripped = stripEmojis(targetUsername).toLowerCase();
            const resUname = stripEmojis(uObj.username || uObj.userName || '').toLowerCase();
            if (reqStripped && resUname && reqStripped === resUname) return true;

            const myStripped = stripEmojis(currentLoggedUserInfo.username || '').toLowerCase();
            if (resUname === myStripped && reqStripped !== myStripped) return false;
        }
        return Boolean(targetUserId);
    };

    for (const url of candidateUrls) {
        try {
            const resGet = await fetch(url, { method: 'GET', headers });
            if (resGet.ok) {
                const json = await resGet.json();
                const uObj = json ? (json.data || json) : null;
                if (uObj && (uObj.id || uObj.username) && isMatchingTarget(uObj)) return uObj;
            }
        } catch (e) {}

        try {
            const resPost = await fetch(url, { method: 'POST', headers });
            if (resPost.ok) {
                const json = await resPost.json();
                const uObj = json ? (json.data || json) : null;
                if (uObj && (uObj.id || uObj.username) && isMatchingTarget(uObj)) return uObj;
            }
        } catch (e) {}
    }

    return null;
}

// --- AKTİF KANALLARI ÇEKME (get-active-channel) ---
async function ensureProfileChannelsLoaded() {
    if (Array.isArray(globalChannels) && globalChannels.length > 0) {
        profilePostsState.channelsCache = globalChannels;
        return globalChannels;
    }
    if (profilePostsState.channelsCache.length > 0) {
        return profilePostsState.channelsCache;
    }

    const token = localStorage.getItem('mc_token');
    if (!token) return [];

    try {
        const res = await fetch('https://api.meetingchallenge.com/Channel/get-active-channel', {
            method: 'GET',
            headers: { 'accept': 'application/json', 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            const json = await res.json();
            if (json && Array.isArray(json.data)) {
                profilePostsState.channelsCache = json.data;
                if (typeof globalChannels !== 'undefined' && (!globalChannels || globalChannels.length === 0)) {
                    globalChannels = json.data;
                }
                return json.data;
            }
        }
    } catch (err) {}
    return [];
}

// --- PROFİL KARTINDA ROLLER LİSTESİNİN HEMEN ALTINA BUTONLARI SABİTLER ---
function injectProfileFeedActionButtons() {
    const modal = document.getElementById('userProfileModal');
    if (!modal) return;

    const rolesEl = document.getElementById('profileModalRoles');
    const extraFieldsEl = document.getElementById('profileExtraFields');
    const bioWrapper = document.getElementById('profileBioWrapper');
    const usernameEl = document.getElementById('profileModalUsername');

    let btnWrapper = document.getElementById('profileOpenFeedButtonsWrapper');
    if (btnWrapper) btnWrapper.remove();

    btnWrapper = document.createElement('div');
    btnWrapper.id = 'profileOpenFeedButtonsWrapper';
    btnWrapper.className = 'w-full mt-3 pt-3 border-t border-white/10 grid grid-cols-2 gap-2.5 shrink-0 z-10';
    btnWrapper.innerHTML = `
        <button type="button" onclick="openUserPostsFeedModal('posts', event)" class="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-[#111214] hover:bg-mc-primary text-white border border-mc-primary/40 hover:border-mc-primary transition-all text-xs font-bold shadow-md cursor-pointer group">
            <svg class="w-4 h-4 text-indigo-400 group-hover:text-white transition-colors shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z"/>
            </svg>
            <span>Gönderiler</span>
        </button>
        <button type="button" onclick="openUserPostsFeedModal('mentions', event)" class="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-[#111214] hover:bg-mc-primary text-white border border-mc-primary/40 hover:border-mc-primary transition-all text-xs font-bold shadow-md cursor-pointer group">
            <svg class="w-4 h-4 text-indigo-400 group-hover:text-white transition-colors shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207"/>
            </svg>
            <span>Bahsedilmeler</span>
        </button>
    `;

    // Doğrudan roller listesinin veya ekstra alanların hemen sonrasına ekle
    if (rolesEl && rolesEl.parentElement) {
        const rolesContainer = rolesEl.closest('.mb-4, .mt-4, .space-y-2') || rolesEl;
        rolesContainer.insertAdjacentElement('afterend', btnWrapper);
    } else if (extraFieldsEl) {
        extraFieldsEl.insertAdjacentElement('afterend', btnWrapper);
    } else if (bioWrapper) {
        bioWrapper.insertAdjacentElement('afterend', btnWrapper);
    } else if (usernameEl && usernameEl.parentElement) {
        usernameEl.parentElement.appendChild(btnWrapper);
    } else {
        const innerCard = modal.querySelector('div > div') || modal.firstElementChild;
        if (innerCard) innerCard.appendChild(btnWrapper);
    }
}

// --- BAĞIMSIZ AÇILIR MODAL: GÖNDERİLER & BAHSEDİLMELER LİSTESİ ---
function ensureUserPostsFeedModalDOM() {
    let modal = document.getElementById('userPostsFeedModal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'userPostsFeedModal';
    modal.className = 'hidden fixed inset-0 z-[130] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4';
    modal.onclick = (e) => {
        if (e.target === modal) closeUserPostsFeedModal();
    };

    modal.innerHTML = `
        <div class="bg-[#1e1f22] border border-white/10 rounded-2xl w-full max-w-2xl max-h-[86vh] flex flex-col shadow-2xl overflow-hidden" onclick="event.stopPropagation()">
            <!-- Modal Üst Başlık -->
            <div class="flex items-center justify-between px-4 py-3.5 bg-[#111214] border-b border-white/10 shrink-0">
                <div class="flex items-center gap-3 min-w-0">
                    <img id="feedModalUserAvatar" src="" class="w-9 h-9 rounded-full object-cover bg-gray-700 border border-white/10 shrink-0">
                    <div class="min-w-0">
                        <div id="feedModalUserFullName" class="text-sm font-bold text-white truncate">Kullanıcı</div>
                        <div id="feedModalUserHandle" class="text-[11px] text-gray-400 truncate">@kullanici</div>
                    </div>
                </div>
                <button type="button" onclick="closeUserPostsFeedModal()" class="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors cursor-pointer" title="Kapat">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
                    </svg>
                </button>
            </div>

            <!-- Sekmeler ve Filtreler -->
            <div class="p-3.5 bg-[#18191c] border-b border-white/10 space-y-2.5 shrink-0">
                <!-- Sekmeler: Gönderiler & Bahsedilmeler -->
                <div class="flex items-center gap-1.5 bg-[#111214] p-1 rounded-xl border border-white/5">
                    <button type="button" id="profileTabPostsBtn" onclick="switchProfileFeedTab('posts')" class="flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all bg-mc-primary text-white shadow cursor-pointer">
                        📝 Gönderiler
                    </button>
                    <button type="button" id="profileTabMentionsBtn" onclick="switchProfileFeedTab('mentions')" class="flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all text-gray-400 hover:text-white cursor-pointer">
                        🏷️ Bahsedilmeler
                    </button>
                </div>

                <!-- Filtre Barı: Kanal Seçimi & Medya Filtresi -->
                <div class="flex flex-wrap items-center gap-2">
                    <select id="profileChannelFilterSelect" onchange="handleProfileChannelFilterChange(this.value)" class="flex-1 min-w-[160px] bg-[#111214] text-gray-200 text-xs rounded-lg px-3 py-2 border border-white/10 focus:outline-none focus:border-mc-primary cursor-pointer">
                        <option value="0">Tüm Kanallar</option>
                    </select>

                    <div class="flex items-center bg-[#111214] p-0.5 rounded-lg border border-white/10 text-xs">
                        <button type="button" id="profileFilterAllBtn" onclick="setProfileMediaFilter('all')" class="px-3 py-1.5 rounded-md font-semibold bg-mc-primary text-white transition-colors cursor-pointer">
                            Tümü
                        </button>
                        <button type="button" id="profileFilterMediaBtn" onclick="setProfileMediaFilter('media')" class="px-3 py-1.5 rounded-md font-semibold text-gray-400 hover:text-white transition-colors flex items-center gap-1 cursor-pointer">
                            <span>📷</span><span>Görseller</span>
                        </button>
                    </div>
                </div>
            </div>

            <!-- Gönderi Listesi (Sonsuz Kaydırma Alanı) -->
            <div id="profilePostsListContainer" class="flex-1 overflow-y-auto p-3.5 space-y-2.5 custom-scrollbar"></div>

            <!-- Alt Yükleniyor Göstergesi -->
            <div id="profilePostsLoader" class="hidden text-center text-indigo-400 text-xs py-2.5 bg-[#111214]/90 border-t border-white/5 animate-pulse font-medium shrink-0">
                Yükleniyor...
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    const listContainer = document.getElementById('profilePostsListContainer');
    if (listContainer) {
        listContainer.addEventListener('scroll', () => {
            if (listContainer.scrollTop + listContainer.clientHeight >= listContainer.scrollHeight - 60) {
                if (!profilePostsState.isLoading && profilePostsState.hasMore) {
                    fetchProfilePostsBatch(false);
                }
            }
        });
    }

    return modal;
}

// --- GÖNDERİ DETAY & BÜYÜK RESİM GÖRÜNTÜLEYİCİ (SINIRSIZ ÖNCEKİ / SONRAKİ + ALT BAŞLIK DESTEKLİ) ---
function ensureProfilePostDetailModalDOM() {
    let modal = document.getElementById('profilePostDetailModal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'profilePostDetailModal';
    modal.className = 'hidden fixed inset-0 z-[150] flex items-center justify-center bg-black/90 backdrop-blur-md p-2 sm:p-6';
    modal.onclick = (e) => {
        if (e.target === modal) closeProfilePostDetailViewer();
    };

    modal.innerHTML = `
        <!-- Sol (Önceki) Ok Butonu -->
        <button type="button" id="profileDetailPrevBtn" onclick="navigateProfilePostViewer(-1, event)" class="fixed left-2 sm:left-5 top-1/2 -translate-y-1/2 z-[160] w-11 h-11 rounded-full bg-[#111214]/90 hover:bg-mc-primary text-white border border-white/15 flex items-center justify-center shadow-2xl transition-all cursor-pointer disabled:opacity-30 disabled:pointer-events-none" title="Önceki Gönderi (Sol Ok)">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/></svg>
        </button>

        <!-- Sağ (Sonraki - Sınırsız) Ok Butonu -->
        <button type="button" id="profileDetailNextBtn" onclick="navigateProfilePostViewer(1, event)" class="fixed right-2 sm:right-5 top-1/2 -translate-y-1/2 z-[160] w-11 h-11 rounded-full bg-[#111214]/90 hover:bg-mc-primary text-white border border-white/15 flex items-center justify-center shadow-2xl transition-all cursor-pointer disabled:opacity-30 disabled:pointer-events-none" title="Sonraki Gönderi (Sağ Ok)">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>
        </button>

        <!-- Ana Kart: Sol Görsel, Sağ Detay/Yazı/Alt Başlık -->
        <div class="bg-[#1e1f22] border border-white/15 rounded-2xl w-full max-w-5xl h-[85vh] flex flex-col md:flex-row overflow-hidden shadow-2xl relative" onclick="event.stopPropagation()">
            
            <!-- Sol Bölüm: Büyük Görsel veya Metin Odaklı Görünüm -->
            <div id="profileDetailLeftPane" class="flex-1 bg-black/95 flex items-center justify-center relative overflow-hidden min-h-[260px]">
                <img id="profileDetailImage" src="" class="max-w-full max-h-full object-contain select-none transition-transform duration-200" alt="Gönderi Görseli">
                <a id="profileDetailOpenOriginalImg" href="#" target="_blank" rel="noopener noreferrer" class="hidden absolute bottom-3 left-3 px-2.5 py-1.5 rounded-lg bg-black/75 hover:bg-black text-gray-200 hover:text-white text-[11px] font-semibold border border-white/15 flex items-center gap-1.5 backdrop-blur-sm transition-colors">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
                    <span>Orijinal Boyutta Aç</span>
                </a>
                <div id="profileDetailNoImagePlaceholder" class="hidden p-8 text-center max-w-lg">
                    <div class="w-14 h-14 rounded-2xl bg-mc-primary/15 border border-mc-primary/30 text-indigo-400 flex items-center justify-center mx-auto mb-3">
                        <svg class="w-7 h-7" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"/></svg>
                    </div>
                    <div id="profileDetailLargeTextQuote" class="text-base sm:text-lg text-gray-100 font-medium leading-relaxed whitespace-pre-wrap break-words"></div>
                </div>
            </div>

            <!-- Sağ Bölüm: Gönderi Sahibi, Kanal, Açıklama, Alt Başlık (Thread) ve Butonlar -->
            <div class="w-full md:w-[370px] lg:w-[400px] bg-[#18191c] border-t md:border-t-0 md:border-l border-white/10 flex flex-col shrink-0">
                <!-- Üst Bar -->
                <div class="p-3.5 bg-[#111214] border-b border-white/10 flex items-center justify-between gap-2">
                    <div class="flex items-center gap-2.5 min-w-0">
                        <img id="profileDetailUserAvatar" src="" class="w-9 h-9 rounded-full object-cover bg-gray-700 shrink-0">
                        <div class="min-w-0">
                            <div id="profileDetailUserName" class="text-xs font-bold text-white truncate">Kullanıcı</div>
                            <div id="profileDetailTime" class="text-[11px] text-gray-400 truncate">Tarih</div>
                        </div>
                    </div>
                    <div class="flex items-center gap-1.5">
                        <span id="profileDetailCounterBadge" class="text-[11px] font-bold px-2 py-0.5 rounded-md bg-white/5 text-gray-300 border border-white/10">1 / 20</span>
                        <button type="button" onclick="closeProfilePostDetailViewer()" class="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors cursor-pointer" title="Kapat (Esc)">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
                        </button>
                    </div>
                </div>

                <!-- Kanal Breadcrumb Bilgisi -->
                <div class="px-3.5 py-2 bg-[#141518] border-b border-white/5 flex items-center justify-between gap-2">
                    <span id="profileDetailChannelBadge" class="text-[11px] font-bold text-indigo-400 truncate">#Kanal</span>
                </div>

                <!-- Gönderi Metni, Bahsedilenler ve Alt Başlık Alanı -->
                <div class="flex-1 overflow-y-auto p-4 space-y-3.5 custom-scrollbar">
                    <div id="profileDetailContentText" class="text-sm text-gray-100 whitespace-pre-wrap break-words leading-relaxed"></div>
                    
                    <!-- Etiketlenen Kullanıcılar -->
                    <div id="profileDetailMentionsBox" class="hidden pt-2 border-t border-white/5">
                        <div class="text-[10px] font-bold text-gray-400 uppercase mb-1.5">Bahsedilenler</div>
                        <div id="profileDetailMentionsList" class="flex flex-wrap gap-1.5"></div>
                    </div>

                    <!-- Alt Başlık (SubChannel / Thread) Kutusu -->
                    <div id="profileDetailSubChannelBox" class="hidden pt-2 border-t border-white/10">
                        <div class="text-[10px] font-bold text-indigo-400 uppercase mb-1.5 flex items-center gap-1">
                            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"/></svg>
                            <span>Alt Başlık (Thread) Açılmış</span>
                        </div>
                        <div id="profileDetailSubChannelCard" class="p-3 rounded-xl bg-[#111214] border border-mc-primary/40 hover:border-mc-primary transition-all cursor-pointer"></div>
                    </div>
                </div>

                <!-- Alt Aksiyon ve Önceki/Sonraki Kontrolleri -->
                <div class="p-3.5 bg-[#111214] border-t border-white/10 space-y-2">
                    <button type="button" id="profileDetailGoToMsgBtn" class="w-full py-2.5 px-4 rounded-xl bg-mc-primary hover:bg-[#4752C4] text-white text-xs font-bold flex items-center justify-center gap-2 shadow-lg transition-colors cursor-pointer">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 9l3 3m0 0l-3 3m3-3H8m13 0a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                        <span>Kanalda Mesaja Git</span>
                    </button>

                    <div class="grid grid-cols-2 gap-2">
                        <button type="button" id="profileDetailBottomPrevBtn" onclick="navigateProfilePostViewer(-1, event)" class="py-2 px-3 rounded-lg bg-[#1e1f22] hover:bg-white/10 text-gray-200 text-xs font-semibold flex items-center justify-center gap-1.5 border border-white/10 transition-colors cursor-pointer disabled:opacity-40 disabled:pointer-events-none">
                            <span>← Önceki</span>
                        </button>
                        <button type="button" id="profileDetailBottomNextBtn" onclick="navigateProfilePostViewer(1, event)" class="py-2 px-3 rounded-lg bg-[#1e1f22] hover:bg-white/10 text-gray-200 text-xs font-semibold flex items-center justify-center gap-1.5 border border-white/10 transition-colors cursor-pointer disabled:opacity-40 disabled:pointer-events-none">
                            <span id="profileDetailBottomNextText">Sonraki →</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    return modal;
}

function handleProfileDetailKeyDown(e) {
    const modal = document.getElementById('profilePostDetailModal');
    if (!modal || modal.classList.contains('hidden')) return;

    if (e.key === 'Escape') {
        e.preventDefault();
        closeProfilePostDetailViewer();
    } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        navigateProfilePostViewer(-1, e);
    } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        navigateProfilePostViewer(1, e);
    }
}

function openProfilePostDetailViewer(postId, e = null) {
    if (e) e.stopPropagation();

    const filtered = getFilteredProfilePosts();
    const idx = filtered.findIndex(p => Number(p.id) === Number(postId));
    if (idx === -1) return;

    profilePostsState.viewerIndex = idx;
    const modal = ensureProfilePostDetailModalDOM();
    modal.classList.remove('hidden');

    document.removeEventListener('keydown', handleProfileDetailKeyDown);
    document.addEventListener('keydown', handleProfileDetailKeyDown);

    renderProfilePostDetailViewer();
}

function closeProfilePostDetailViewer() {
    const modal = document.getElementById('profilePostDetailModal');
    if (modal) modal.classList.add('hidden');
    document.removeEventListener('keydown', handleProfileDetailKeyDown);
}

// Önceki / Sonraki Sınırsız Gezinme Fonksiyonu
async function navigateProfilePostViewer(direction, e = null) {
    if (e) e.stopPropagation();
    if (profilePostsState.viewerLoadingNext) return;

    let filtered = getFilteredProfilePosts();
    const targetIdx = profilePostsState.viewerIndex + direction;

    if (targetIdx < 0) return;

    // Eğer listenin sonuna gelindiyse ve sunucuda daha fazla gönderi varsa otomatik olarak yeni paketi çek!
    if (targetIdx >= filtered.length) {
        if (!profilePostsState.hasMore) return;

        profilePostsState.viewerLoadingNext = true;
        const nextTextEl = document.getElementById('profileDetailBottomNextText');
        if (nextTextEl) nextTextEl.innerText = 'Yükleniyor...';

        // Filtreye uyan yeni bir öğe gelene kadar veya liste bitene kadar çek
        let guard = 0;
        while (targetIdx >= getFilteredProfilePosts().length && profilePostsState.hasMore && guard < 4) {
            guard++;
            await fetchProfilePostsBatch(false);
        }

        profilePostsState.viewerLoadingNext = false;
        if (nextTextEl) nextTextEl.innerText = 'Sonraki →';

        filtered = getFilteredProfilePosts();
        if (targetIdx >= filtered.length) {
            renderProfilePostDetailViewer();
            return;
        }
    }

    profilePostsState.viewerIndex = targetIdx;
    renderProfilePostDetailViewer();
}

async function renderProfilePostDetailViewer() {
    const filtered = getFilteredProfilePosts();
    const post = filtered[profilePostsState.viewerIndex];
    if (!post) return;

    const imgEl = document.getElementById('profileDetailImage');
    const openOrigEl = document.getElementById('profileDetailOpenOriginalImg');
    const noImgEl = document.getElementById('profileDetailNoImagePlaceholder');
    const largeQuoteEl = document.getElementById('profileDetailLargeTextQuote');

    const { cleanText } = parseReplyFromContent(post.content || '');
    const formattedContent = formatMessageText(cleanText);

    if (post.attachmentUrl && String(post.attachmentUrl).trim() !== '') {
        const highResUrl = getNextImageUrl(post.attachmentUrl, 1200);
        const directUrl = typeof getDirectMediaUrl === 'function'
            ? getDirectMediaUrl(post.attachmentUrl)
            : (post.attachmentUrl.startsWith('http') ? post.attachmentUrl : `https://api.meetingchallenge.com${post.attachmentUrl}`);

        imgEl.src = highResUrl;
        imgEl.classList.remove('hidden');
        openOrigEl.href = directUrl;
        openOrigEl.classList.remove('hidden');
        noImgEl.classList.add('hidden');
    } else {
        imgEl.src = '';
        imgEl.classList.add('hidden');
        openOrigEl.classList.add('hidden');
        noImgEl.classList.remove('hidden');
        largeQuoteEl.innerHTML = formattedContent || '<span class="text-gray-500 italic">Metin içeriği yok</span>';
    }

    const avatar = post.pictureUrl
        ? getNextImageUrl(post.pictureUrl, 128)
        : `https://ui-avatars.com/api/?background=2b2d31&color=fff&name=${encodeURIComponent(post.userName || 'U')}`;

    document.getElementById('profileDetailUserAvatar').src = avatar;
    document.getElementById('profileDetailUserName').innerText = post.userName || 'Kullanıcı';

    const smartTime = typeof formatSmartTimestamp === 'function'
        ? formatSmartTimestamp(post.createDate)
        : { display: new Date(post.createDate).toLocaleString('tr-TR'), full: post.createDate };

    const timeEl = document.getElementById('profileDetailTime');
    timeEl.innerText = smartTime.full || smartTime.display;

    const breadcrumb = resolvePostChannelBreadcrumb(post);
    document.getElementById('profileDetailChannelBadge').innerText = breadcrumb;

    document.getElementById('profileDetailCounterBadge').innerText =
        `${profilePostsState.viewerIndex + 1} / ${filtered.length}${profilePostsState.hasMore ? '+' : ''}`;

    const contentEl = document.getElementById('profileDetailContentText');
    contentEl.innerHTML = formattedContent || '<span class="text-gray-500 italic text-xs">Görsel paylaşımı (Açıklama yok)</span>';

    // Bahsedilenler (Mentions)
    const mentionsBox = document.getElementById('profileDetailMentionsBox');
    const mentionsListEl = document.getElementById('profileDetailMentionsList');
    if (Array.isArray(post.mentionList) && post.mentionList.length > 0) {
        mentionsBox.classList.remove('hidden');
        mentionsListEl.innerHTML = post.mentionList.map(m => {
            const mPic = m.pictureUrl ? getNextImageUrl(m.pictureUrl, 48) : `https://ui-avatars.com/api/?background=1e1f22&color=fff&name=${encodeURIComponent(m.username)}`;
            const enc = encodeURIComponent(m.username);
            return `
                <button type="button" onclick="closeProfilePostDetailViewer(); closeUserPostsFeedModal(); openUserProfileByUsername(decodeURIComponent('${enc}'))" class="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-mc-primary/20 hover:bg-mc-primary/40 text-[#93c5fd] hover:text-white text-xs font-medium border border-mc-primary/30 transition-colors cursor-pointer">
                    <img src="${mPic}" class="w-4 h-4 rounded-full object-cover">
                    <span>@${m.username}</span>
                </button>
            `;
        }).join('');
    } else {
        mentionsBox.classList.add('hidden');
        mentionsListEl.innerHTML = '';
    }

    // Alt Başlık (SubChannel / Thread) Kontrolü
    renderProfileDetailSubChannelSection(post);

    // Önceki / Sonraki Buton Durumları
    const hasPrev = profilePostsState.viewerIndex > 0;
    const hasNext = (profilePostsState.viewerIndex < filtered.length - 1) || profilePostsState.hasMore;

    document.getElementById('profileDetailPrevBtn').disabled = !hasPrev;
    document.getElementById('profileDetailBottomPrevBtn').disabled = !hasPrev;
    document.getElementById('profileDetailNextBtn').disabled = !hasNext;
    document.getElementById('profileDetailBottomNextBtn').disabled = !hasNext;

    // Mesaja Git Butonu
    const goBtn = document.getElementById('profileDetailGoToMsgBtn');
    goBtn.onclick = (ev) => {
        closeProfilePostDetailViewer();
        navigateToPostFromProfile(post.id, Number(post.channelId) || 0, Number(post.parentChannelId) || 0, ev);
    };

    // Arka planda get-post-by-id çağırarak subChannelInfo (Alt Başlık) bilgisini tazele
    fetchAndEnrichPostDetailForViewer(post);
}

function renderProfileDetailSubChannelSection(post) {
    const subBox = document.getElementById('profileDetailSubChannelBox');
    const subCard = document.getElementById('profileDetailSubChannelCard');
    if (!subBox || !subCard) return;

    const subInfo = post.subChannelInfo || post.subChannelData || null;
    const isInsideSubThread = Number(post.parentChannelId) > 0 && Number(post.channelId) !== Number(post.parentChannelId);

    if (subInfo && Number(subInfo.id) > 0) {
        subBox.classList.remove('hidden');
        const safeThreadName = (subInfo.name || 'Alt Başlık').replace(/'/g, "\\'");
        const msgCountText = subInfo.messageCount !== undefined ? `${subInfo.messageCount} mesaj` : 'Alt başlığı görüntüle';
        subCard.onclick = (ev) => {
            ev.stopPropagation();
            closeProfilePostDetailViewer();
            closeUserPostsFeedModal();
            const profileModal = document.getElementById('userProfileModal');
            if (profileModal) profileModal.classList.add('hidden');
            if (typeof openSubChannelThread === 'function') {
                openSubChannelThread(subInfo.id, safeThreadName, ev);
            } else {
                navigateToPostFromProfile(post.id, subInfo.id, post.channelId, ev);
            }
        };
        subCard.innerHTML = `
            <div class="flex items-center justify-between gap-2">
                <div class="min-w-0">
                    <div class="text-xs font-bold text-white truncate">🧵 ${subInfo.name || 'Alt Başlık'}</div>
                    <div class="text-[11px] text-gray-400 mt-0.5">${msgCountText}</div>
                </div>
                <span class="px-2.5 py-1 rounded-lg bg-mc-primary text-white text-[11px] font-bold shrink-0">Aç →</span>
            </div>
        `;
    } else if (isInsideSubThread) {
        subBox.classList.remove('hidden');
        const threadTitle = (post.channelName && post.channelName !== '.') ? post.channelName : `Alt Başlık #${post.channelId}`;
        const safeThreadName = String(threadTitle).replace(/'/g, "\\'");
        subCard.onclick = (ev) => {
            ev.stopPropagation();
            closeProfilePostDetailViewer();
            closeUserPostsFeedModal();
            const profileModal = document.getElementById('userProfileModal');
            if (profileModal) profileModal.classList.add('hidden');
            if (typeof openSubChannelThread === 'function') {
                openSubChannelThread(Number(post.channelId), safeThreadName, ev);
            } else {
                navigateToPostFromProfile(post.id, Number(post.channelId), Number(post.parentChannelId), ev);
            }
        };
        subCard.innerHTML = `
            <div class="flex items-center justify-between gap-2">
                <div class="min-w-0">
                    <div class="text-xs font-bold text-white truncate">🧵 ${threadTitle}</div>
                    <div class="text-[11px] text-gray-400 mt-0.5">Üst Kanal: ${post.parentChannelName || '#' + post.parentChannelId}</div>
                </div>
                <span class="px-2.5 py-1 rounded-lg bg-mc-primary text-white text-[11px] font-bold shrink-0">Başlığa Git →</span>
            </div>
        `;
    } else {
        subBox.classList.add('hidden');
        subCard.innerHTML = '';
    }
}

async function fetchAndEnrichPostDetailForViewer(post) {
    if (!post || !post.id || post._detailFetched) return;
    post._detailFetched = true;

    const token = localStorage.getItem('mc_token');
    if (!token) return;

    const url = `https://api.meetingchallenge.com/Post/get-post-by-id?postId=${encodeURIComponent(post.id)}`;
    try {
        await fetch(url, { method: 'OPTIONS', headers: { 'Authorization': `Bearer ${token}` } });
    } catch (_) {}

    try {
        const res = await fetch(url, {
            method: 'GET',
            headers: { 'accept': 'application/json', 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            const json = await res.json();
            const detail = json ? (json.data || json) : null;
            if (detail && typeof detail === 'object') {
                if (detail.subChannelInfo) post.subChannelInfo = detail.subChannelInfo;
                if (detail.emojiList) post.emojiList = detail.emojiList;

                const currentFiltered = getFilteredProfilePosts();
                const activePost = currentFiltered[profilePostsState.viewerIndex];
                if (activePost && Number(activePost.id) === Number(post.id)) {
                    renderProfileDetailSubChannelSection(post);
                }
            }
        }
    } catch (_) {}
}

async function openUserPostsFeedModal(initialTab = 'posts', e = null) {
    if (e) e.stopPropagation();

    const modal = ensureUserPostsFeedModalDOM();

    const targetUid = currentProfileModalUser?.userId || profilePostsState.userId;
    const targetUname = currentProfileModalUser?.username || profilePostsState.username || 'Kullanıcı';
    const cleanUname = stripEmojis(targetUname) || targetUname;
    const known = findKnownUserByUsername(targetUname) || {};
    const fullName = document.getElementById('profileModalFullName')?.innerText || known.fullName || targetUname;
    const avatarSrc = document.getElementById('profileModalAvatar')?.src ||
        (currentProfileModalUser?.pictureUrl ? getDirectMediaUrl(currentProfileModalUser.pictureUrl) : `https://ui-avatars.com/api/?background=2b2d31&color=fff&name=${encodeURIComponent(cleanUname)}`);

    profilePostsState.userId = targetUid;
    profilePostsState.username = targetUname;
    profilePostsState.fullName = fullName;
    profilePostsState.pictureUrl = avatarSrc;
    profilePostsState.activeTab = initialTab === 'mentions' ? 'mentions' : 'posts';
    profilePostsState.selectedChannelId = 0;
    profilePostsState.mediaFilter = 'all';

    document.getElementById('feedModalUserAvatar').src = avatarSrc;
    document.getElementById('feedModalUserFullName').innerText = fullName;
    document.getElementById('feedModalUserHandle').innerText = `@${cleanUname}`;

    updateProfileFeedTabUI();
    updateProfileMediaFilterUI();

    modal.classList.remove('hidden');

    await populateProfileChannelFilterDropdown();
    resetAndLoadProfilePosts();
}

function closeUserPostsFeedModal() {
    const modal = document.getElementById('userPostsFeedModal');
    if (modal) modal.classList.add('hidden');
}

function updateProfileFeedTabUI() {
    const postsBtn = document.getElementById('profileTabPostsBtn');
    const mentionsBtn = document.getElementById('profileTabMentionsBtn');
    if (!postsBtn || !mentionsBtn) return;

    if (profilePostsState.activeTab === 'posts') {
        postsBtn.className = 'flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all bg-mc-primary text-white shadow cursor-pointer';
        mentionsBtn.className = 'flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all text-gray-400 hover:text-white cursor-pointer';
    } else {
        mentionsBtn.className = 'flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all bg-mc-primary text-white shadow cursor-pointer';
        postsBtn.className = 'flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all text-gray-400 hover:text-white cursor-pointer';
    }
}

function updateProfileMediaFilterUI() {
    const allBtn = document.getElementById('profileFilterAllBtn');
    const mediaBtn = document.getElementById('profileFilterMediaBtn');
    if (!allBtn || !mediaBtn) return;

    if (profilePostsState.mediaFilter === 'all') {
        allBtn.className = 'px-3 py-1.5 rounded-md font-semibold bg-mc-primary text-white transition-colors cursor-pointer';
        mediaBtn.className = 'px-3 py-1.5 rounded-md font-semibold text-gray-400 hover:text-white transition-colors flex items-center gap-1 cursor-pointer';
    } else {
        mediaBtn.className = 'px-3 py-1.5 rounded-md font-semibold bg-mc-primary text-white transition-colors flex items-center gap-1 cursor-pointer';
        allBtn.className = 'px-3 py-1.5 rounded-md font-semibold text-gray-400 hover:text-white transition-colors cursor-pointer';
    }
}

async function populateProfileChannelFilterDropdown() {
    const selectEl = document.getElementById('profileChannelFilterSelect');
    if (!selectEl) return;

    const channels = await ensureProfileChannelsLoaded();
    const channelMap = new Map();
    channels.forEach(ch => channelMap.set(Number(ch.id), ch));

    const parents = channels.filter(c => !c.parentChannelId || Number(c.parentChannelId) === 0);
    const children = channels.filter(c => c.parentChannelId && Number(c.parentChannelId) > 0 && !c.isVoiceChannel);

    let html = `<option value="0">Tüm Kanallar</option>`;

    parents.forEach(parent => {
        const subList = children.filter(c => Number(c.parentChannelId) === Number(parent.id));
        if (subList.length > 0) {
            const cleanParentName = (parent.name || 'Kategori').trim();
            html += `<optgroup label="${cleanParentName.replace(/"/g, '&quot;')}">`;
            subList.forEach(sub => {
                const subName = (sub.name || '').trim();
                html += `<option value="${sub.id}"># ${subName}</option>`;
            });
            html += `</optgroup>`;
        }
    });

    const orphans = children.filter(c => !channelMap.has(Number(c.parentChannelId)));
    if (orphans.length > 0) {
        html += `<optgroup label="Diğer Kanallar">`;
        orphans.forEach(sub => {
            html += `<option value="${sub.id}"># ${(sub.name || '').trim()}</option>`;
        });
        html += `</optgroup>`;
    }

    selectEl.innerHTML = html;
    selectEl.value = String(profilePostsState.selectedChannelId || 0);
}

function switchProfileFeedTab(tabName) {
    if (profilePostsState.activeTab === tabName) return;
    profilePostsState.activeTab = tabName;
    updateProfileFeedTabUI();
    resetAndLoadProfilePosts();
}

function handleProfileChannelFilterChange(channelIdVal) {
    profilePostsState.selectedChannelId = Number(channelIdVal) || 0;
    resetAndLoadProfilePosts();
}

function setProfileMediaFilter(filterType) {
    if (profilePostsState.mediaFilter === filterType) return;
    profilePostsState.mediaFilter = filterType;
    updateProfileMediaFilterUI();

    renderProfilePostsList();
    const listContainer = document.getElementById('profilePostsListContainer');
    if (listContainer && listContainer.scrollHeight <= listContainer.clientHeight && profilePostsState.hasMore && !profilePostsState.isLoading) {
        fetchProfilePostsBatch(false);
    }
}

function resetAndLoadProfilePosts() {
    profilePostsState.lastPostId = 0;
    profilePostsState.hasMore = true;
    profilePostsState.posts = [];
    const listContainer = document.getElementById('profilePostsListContainer');
    if (listContainer) {
        listContainer.scrollTop = 0;
        listContainer.innerHTML = '';
    }
    fetchProfilePostsBatch(true);
}

function getFilteredProfilePosts() {
    return profilePostsState.posts.filter(post => {
        if (profilePostsState.mediaFilter === 'media') {
            if (!post.attachmentUrl || String(post.attachmentUrl).trim() === '') return false;
        }
        if (profilePostsState.selectedChannelId > 0) {
            const pChId = Number(post.channelId);
            const pParentChId = Number(post.parentChannelId);
            if (pChId !== profilePostsState.selectedChannelId && pParentChId !== profilePostsState.selectedChannelId) {
                return false;
            }
        }
        return true;
    });
}

// get-active-channel listesinden parentChannelName ve kanal adını çözümler
function resolvePostChannelBreadcrumb(post) {
    const channels = profilePostsState.channelsCache || [];
    const chMap = new Map();
    channels.forEach(c => chMap.set(Number(c.id), c));

    let chName = (post.channelName || '').trim();
    let parentName = (post.parentChannelName || '').trim();

    const chObj = chMap.get(Number(post.channelId));
    if (chObj) {
        if (!chName || chName === '.') chName = (chObj.name || '').trim();
        if (!parentName && chObj.parentChannelId) {
            const parentObj = chMap.get(Number(chObj.parentChannelId));
            if (parentObj && parentObj.name) parentName = parentObj.name.trim();
        }
    }

    if (!parentName && post.parentChannelId) {
        const parentObj = chMap.get(Number(post.parentChannelId));
        if (parentObj && parentObj.name) parentName = parentObj.name.trim();
    }

    if (parentName && chName && parentName !== chName) {
        return `${parentName} › #${chName}`;
    }
    return chName ? `#${chName}` : 'Kanal';
}

// Gönderiler için get-posts-by-user, Bahsedilmeler için get-posts-by-mention kullanır
async function fetchProfilePostsBatch(isInitial = false) {
    if (!profilePostsState.userId || profilePostsState.isLoading || !profilePostsState.hasMore) return;

    const token = localStorage.getItem('mc_token');
    if (!token) return;

    profilePostsState.isLoading = true;
    const loader = document.getElementById('profilePostsLoader');
    if (loader) loader.classList.remove('hidden');

    try {
        await ensureProfileChannelsLoaded();

        const apiUrl = profilePostsState.activeTab === 'mentions'
            ? 'https://api.meetingchallenge.com/Post/get-posts-by-mention'
            : 'https://api.meetingchallenge.com/Post/get-posts-by-user';

        const payload = {
            userId: Number(profilePostsState.userId),
            postLimit: 20,
            channelId: Number(profilePostsState.selectedChannelId) || 0,
            lastPostId: Number(profilePostsState.lastPostId) || 0
        };

        const res = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(payload)
        });

        const result = await res.json();
        if (result && result.httpStatusCode === 200 && Array.isArray(result.data)) {
            const batch = result.data;
            if (batch.length < 20) {
                profilePostsState.hasMore = false;
            }
            if (batch.length > 0) {
                profilePostsState.lastPostId = batch[batch.length - 1].id;
                const existingIds = new Set(profilePostsState.posts.map(p => Number(p.id)));
                batch.forEach(item => {
                    if (!existingIds.has(Number(item.id))) {
                        profilePostsState.posts.push(item);
                    }
                    if (Array.isArray(item.mentionList)) {
                        item.mentionList.forEach(m => {
                            if (m && m.username) {
                                const ex = findKnownUserByUsername(m.username) || {};
                                knownUsersMap.set(m.username, {
                                    ...ex,
                                    userId: m.id || ex.userId || null,
                                    username: m.username,
                                    pictureUrl: m.pictureUrl || ex.pictureUrl || null
                                });
                            }
                        });
                    }
                });
            } else {
                profilePostsState.hasMore = false;
            }

            renderProfilePostsList();

            // Görsel filtresi açıkken ekranda az öğe varsa ve sunucuda devamı varsa otomatik çekmeye devam et
            const filteredNow = getFilteredProfilePosts();
            if (filteredNow.length < 5 && profilePostsState.hasMore) {
                profilePostsState.isLoading = false;
                await fetchProfilePostsBatch(false);
                return;
            }
        } else {
            profilePostsState.hasMore = false;
            renderProfilePostsList();
        }
    } catch (e) {
        profilePostsState.hasMore = false;
        renderProfilePostsList();
    } finally {
        profilePostsState.isLoading = false;
        if (loader) loader.classList.add('hidden');
    }
}

function renderProfilePostsList() {
    const listContainer = document.getElementById('profilePostsListContainer');
    if (!listContainer) return;

    const filtered = getFilteredProfilePosts();

    if (filtered.length === 0) {
        if (profilePostsState.isLoading) return;
        const emptyText = profilePostsState.activeTab === 'mentions'
            ? 'Bu kriterlere uygun bahsedilme bulunamadı.'
            : 'Bu kriterlere uygun gönderi bulunamadı.';
        listContainer.innerHTML = `
            <div class="text-center text-gray-400 text-xs py-12 bg-[#111214]/60 rounded-xl border border-white/5">
                ${emptyText}
            </div>
        `;
        return;
    }

    listContainer.innerHTML = filtered.map(post => {
        const postId = post.id;
        const avatar = post.pictureUrl
            ? getNextImageUrl(post.pictureUrl, 48)
            : `https://ui-avatars.com/api/?background=2b2d31&color=fff&name=${encodeURIComponent(post.userName || 'U')}`;

        const smartTime = typeof formatSmartTimestamp === 'function'
            ? formatSmartTimestamp(post.createDate)
            : { display: new Date(post.createDate).toLocaleString('tr-TR'), full: post.createDate };

        const breadcrumb = resolvePostChannelBreadcrumb(post);
        const { cleanText } = parseReplyFromContent(post.content || '');
        const formattedText = formatMessageText(cleanText);

        const attachmentHtml = post.attachmentUrl
            ? `<div class="mt-2.5 relative overflow-hidden rounded-xl border border-white/10 bg-black/40 max-h-60 flex items-center justify-center group/img">
                   <img src="${getNextImageUrl(post.attachmentUrl, 640)}" class="max-h-60 w-auto object-contain rounded-xl transition-transform duration-200 group-hover/img:scale-[1.02]" alt="Gönderi Eki" loading="lazy">
                   <span class="absolute bottom-2 right-2 px-2 py-1 rounded-md bg-black/75 text-white text-[10px] font-semibold flex items-center gap-1 opacity-85 group-hover/img:opacity-100">
                       🔍 Resmi Büyüt & Detay
                   </span>
               </div>`
            : '';

        const mentionsBadges = Array.isArray(post.mentionList) && post.mentionList.length > 0
            ? `<div class="flex flex-wrap items-center gap-1.5 mt-2">
                   ${post.mentionList.map(m => {
                       const mPic = m.pictureUrl ? getNextImageUrl(m.pictureUrl, 48) : `https://ui-avatars.com/api/?background=1e1f22&color=fff&name=${encodeURIComponent(m.username)}`;
                       return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-mc-primary/20 text-[#93c5fd] text-[11px] font-medium border border-mc-primary/30">
                                   <img src="${mPic}" class="w-3.5 h-3.5 rounded-full object-cover">
                                   @${m.username}
                               </span>`;
                   }).join('')}
               </div>`
            : '';

        const subInfo = post.subChannelInfo || post.subChannelData || null;
        const isSubThreadPost = (subInfo && Number(subInfo.id) > 0) || (Number(post.parentChannelId) > 0 && Number(post.channelId) !== Number(post.parentChannelId));
        const subThreadBadge = isSubThreadPost
            ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold">
                   🧵 ${subInfo?.name || (post.channelName !== '.' ? post.channelName : 'Alt Başlık')}
               </span>`
            : '';

        const targetChannelId = Number(post.channelId) || 0;
        const parentChannelId = Number(post.parentChannelId) || 0;

        return `
            <div onclick="openProfilePostDetailViewer(${postId}, event)" class="p-3 rounded-xl bg-[#111214] hover:bg-[#232428] border border-white/5 hover:border-mc-primary/50 transition-all cursor-pointer group">
                <div class="flex items-center justify-between gap-2 mb-1.5">
                    <div class="flex items-center gap-1.5 min-w-0 max-w-[72%]">
                        <span class="text-[11px] font-bold text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded-md truncate" title="${breadcrumb}">
                            ${breadcrumb}
                        </span>
                        ${subThreadBadge}
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                        <span class="text-[11px] text-gray-400" title="${smartTime.full}">${smartTime.display}</span>
                        <button type="button" onclick="navigateToPostFromProfile(${postId}, ${targetChannelId}, ${parentChannelId}, event)" class="px-2 py-0.5 rounded bg-white/5 hover:bg-mc-primary text-gray-300 hover:text-white text-[10px] font-semibold transition-colors cursor-pointer" title="Kanalda Mesaja Git">
                            Mesaja Git →
                        </button>
                    </div>
                </div>
                <div class="flex items-start gap-3 mt-1">
                    <img src="${avatar}" class="w-8 h-8 rounded-full object-cover shrink-0 mt-0.5 bg-gray-700">
                    <div class="flex-1 min-w-0">
                        <div class="text-xs font-bold text-gray-100 truncate group-hover:text-mc-primary transition-colors">${post.userName || ''}</div>
                        ${formattedText ? `<div class="text-[13px] text-gray-200 break-words whitespace-pre-wrap leading-relaxed mt-1">${formattedText}</div>` : ''}
                        ${mentionsBadges}
                        ${attachmentHtml}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// Profilden bir gönderiye "Mesaja Git" tıklandığında get-post-by-id çağrısı yapar ve kanala/mesaja odaklanır
async function navigateToPostFromProfile(postId, channelId, parentChannelId, e) {
    if (e) e.stopPropagation();
    if (!postId) return;

    const token = localStorage.getItem('mc_token');
    const postDetailUrl = `https://api.meetingchallenge.com/Post/get-post-by-id?postId=${encodeURIComponent(postId)}`;

    let resolvedChannelId = Number(channelId) || 0;
    let fetchedPostObj = null;

    try {
        // İstenilen OPTIONS metoduyla çağrı
        await fetch(postDetailUrl, {
            method: 'OPTIONS',
            headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        });
    } catch (_) {}

    try {
        const res = await fetch(postDetailUrl, {
            method: 'GET',
            headers: {
                'accept': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        });
        if (res.ok) {
            const json = await res.json();
            fetchedPostObj = json ? (json.data || json) : null;
            if (fetchedPostObj && fetchedPostObj.channelId) {
                resolvedChannelId = Number(fetchedPostObj.channelId);
            }
        }
    } catch (_) {}

    // Açık olan tüm profil ve detay modallarını kapat
    closeProfilePostDetailViewer();
    closeUserPostsFeedModal();
    const profileModal = document.getElementById('userProfileModal');
    if (profileModal) profileModal.classList.add('hidden');

    const channels = await ensureProfileChannelsLoaded();
    const isMainChannel = channels.some(c => Number(c.id) === resolvedChannelId);
    const targetChannelToOpen = (!isMainChannel && Number(parentChannelId) > 0)
        ? Number(parentChannelId)
        : resolvedChannelId;

    if (targetChannelToOpen > 0) {
        if (typeof selectChannel === 'function') {
            const chObj = channels.find(c => Number(c.id) === targetChannelToOpen);
            selectChannel(targetChannelToOpen, chObj ? chObj.name : '');
        } else if (typeof navigateToMentionedChannel === 'function') {
            navigateToMentionedChannel(String(targetChannelToOpen));
        } else {
            activeViewingChannelId = targetChannelToOpen;
            startChatPolling(targetChannelToOpen);
        }
    }

    setTimeout(async () => {
        await focusRepliedMessage(String(postId));
        let el = document.getElementById(`msg-${postId}`);
        if (!el && fetchedPostObj && fetchedPostObj.id) {
            messagesMap.set(String(fetchedPostObj.id), fetchedPostObj);
            const container = document.getElementById('chatMessages');
            if (container) {
                const newEl = createMessageHTML(fetchedPostObj);
                container.appendChild(newEl);
                newEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                newEl.classList.add('msg-highlight');
                setTimeout(() => newEl.classList.remove('msg-highlight'), 1800);
            }
        }
    }, 650);
}

async function openUserProfileModal(userId, username = "Kullanıcı", fallbackAvatar = null, isSelf = false) {
    const modal = document.getElementById('userProfileModal');
    const loader = document.getElementById('profileModalLoader');
    const bioWrapper = document.getElementById('profileBioWrapper');
    const bioEl = document.getElementById('profileModalBio');
    const rolesEl = document.getElementById('profileModalRoles');
    const extraFieldsEl = document.getElementById('profileExtraFields');

    const cleanUsername = String(username || "Kullanıcı").trim().replace(/^@+/, '');
    const displayCleanUsername = stripEmojis(cleanUsername) || cleanUsername;
    const known = findKnownUserByUsername(cleanUsername) || {};
    const resolvedAvatarPath = fallbackAvatar || known.pictureUrl || null;
    const resolvedUserId = userId || known.userId || extractUserIdFromMediaUrl(resolvedAvatarPath) || null;

    currentProfileModalUser = {
        userId: resolvedUserId,
        username: cleanUsername || known.username || "Kullanıcı",
        pictureUrl: resolvedAvatarPath
    };

    const initialAvatarUrl = resolvedAvatarPath
        ? getDirectMediaUrl(resolvedAvatarPath)
        : `https://ui-avatars.com/api/?background=2b2d31&color=fff&size=256&name=${encodeURIComponent(displayCleanUsername)}`;

    document.getElementById('profileModalAvatar').src = initialAvatarUrl;
    document.getElementById('profileModalFullName').innerText = known.fullName || cleanUsername;
    document.getElementById('profileModalUsername').innerText = `@${displayCleanUsername}`;

    bioWrapper.classList.add('hidden');
    extraFieldsEl.innerHTML = '';
    rolesEl.innerHTML = '<span class="text-gray-500 text-xs italic">Yükleniyor...</span>';
    modal.classList.remove('hidden');

    // Roller listesinin hemen altına Gönderiler & Bahsedilmeler butonlarını yerleştir
    injectProfileFeedActionButtons();

    const token = localStorage.getItem('mc_token');
    if (!token) return;
    loader.classList.remove('hidden');

    try {
        let targetId = resolvedUserId;
        if (!targetId && currentProfileModalUser.username) {
            const targetStripped = stripEmojis(currentProfileModalUser.username).toLowerCase();
            for (const m of messagesMap.values()) {
                if (m.userName && stripEmojis(m.userName).toLowerCase() === targetStripped) {
                    const foundId = extractUserIdFromObject(m, true);
                    if (foundId) { targetId = foundId; break; }
                }
            }
        }

        const uData = await fetchUserInfoFromApi(targetId, currentProfileModalUser.username, isSelf);
        if (uData && typeof uData === 'object') {
            const firstName = (uData.name || '').trim();
            const lastName = (uData.surname || '').trim();
            const fullName = (`${firstName} ${lastName}`).trim() || uData.username || currentProfileModalUser.username;
            const uname = uData.username || uData.userName || currentProfileModalUser.username;
            const pic = uData.pictureUrl ? getDirectMediaUrl(uData.pictureUrl) : resolvedAvatarPath;

            currentProfileModalUser.username = uname;
            currentProfileModalUser.pictureUrl = pic;
            currentProfileModalUser.userId = uData.id || targetId || extractUserIdFromMediaUrl(pic);

            knownUsersMap.set(uname, {
                ...(findKnownUserByUsername(uname) || {}),
                userId: currentProfileModalUser.userId,
                username: uname,
                cleanUsername: stripEmojis(uname) || uname,
                fullName,
                pictureUrl: pic,
                roles: Array.isArray(uData.roles) ? uData.roles : []
            });

            document.getElementById('profileModalFullName').innerText = fullName;
            document.getElementById('profileModalUsername').innerText = `@${stripEmojis(uname) || uname}`;
            if (pic) document.getElementById('profileModalAvatar').src = getDirectMediaUrl(pic);

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

        profilePostsState.userId = currentProfileModalUser.userId || targetId;
        profilePostsState.username = currentProfileModalUser.username;
        injectProfileFeedActionButtons();
    } catch (err) {
        rolesEl.innerHTML = `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-[#111214] text-gray-300 border border-white/10"><span class="w-2 h-2 rounded-full bg-mc-green"></span>Üye</span>`;
        injectProfileFeedActionButtons();
    } finally {
        loader.classList.add('hidden');
    }
}

function formatMessageText(text = "") {
    if (!text) return "";
    let cleanText = text.replace(/^>>\[.*?\]<<\n?/, '');
    const urlRegex = /(https?:\/\/[^\s]+)/g;

    let formatted = cleanText.replace(urlRegex, function (url) {
        let cleanUrl = url;
        let punctuation = '';
        if (/[.,;!?]$/.test(url)) {
            punctuation = url.slice(-1);
            cleanUrl = url.slice(0, -1);
        }
        return `<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer" class="text-mc-primary hover:text-blue-400 underline transition-colors break-all" onclick="event.stopPropagation()">${cleanUrl}</a>${punctuation}`;
    });

    formatted = formatted.replace(/@@([^@]+?)@@/g, function (match, rawUname) {
        const cleanUname = String(rawUname || "").trim().replace(/^@+/, '');
        if (!cleanUname) return match;
        const encoded = encodeURIComponent(cleanUname);
        return `<span onclick="event.stopPropagation(); closeProfilePostDetailViewer(); closeUserPostsFeedModal(); openUserProfileByUsername(decodeURIComponent('${encoded}'))" class="bg-mc-primary/25 text-[#93c5fd] px-1.5 py-0.5 rounded text-xs font-medium cursor-pointer hover:bg-mc-primary/40 hover:text-white transition-colors">@${cleanUname}</span>`;
    });

    formatted = formatted.replace(/##(.*?)##/g, function (match, rawVal) {
        const val = (rawVal || "").trim();
        if (!val) return match;
        let displayChannelName = val;
        let matchedChannel = globalChannels.find(c => String(c.id) === val || (c.name && c.name.trim().toLowerCase() === val.toLowerCase()));
        if (matchedChannel && matchedChannel.name) displayChannelName = matchedChannel.name;
        const safeRef = val.replace(/'/g, "\\'");
        return `<span onclick="closeProfilePostDetailViewer(); closeUserPostsFeedModal(); navigateToMentionedChannel('${safeRef}', event)" class="inline-flex items-center gap-0.5 bg-mc-primary/25 text-[#93c5fd] px-1.5 py-0.5 rounded text-xs font-semibold cursor-pointer hover:bg-mc-primary/40 hover:text-white transition-colors"><span class="opacity-80">#</span><span>${displayChannelName}</span></span>`;
    });

    return formatted;
}

// Eski >>[...]<< kalıntısı varsa temizler, yoksa metni olduğu gibi döndürür
function parseReplyFromContent(rawContent = "") {
    if (!rawContent) return { replyData: null, cleanText: "" };
    const regex = /^\s*(?:>>|&gt;&gt;)\[(.*?)\|(.*?)\|([\s\S]*?)\](?:<<|&lt;&lt;)\r?\n?([\s\S]*)$/;
    const match = String(rawContent).match(regex);
    if (match) {
        return {
            replyData: { id: match[1].trim(), userName: stripEmojis(match[2].trim()) || match[2].trim(), snippet: match[3].trim() },
            cleanText: match[4]
        };
    }
    return { replyData: null, cleanText: String(rawContent) };
}

// Mesaj objesindeki ReplyTo / replyTo ID'sinden veya iç nesneden yanıtlanan mesajı bulur
function extractReplyInfo(msg) {
    if (!msg) return { replyData: null, cleanText: "" };
    const msgIdStr = String(msg.id);
    const raw = localEditedMessagesMap[msgIdStr] !== undefined
        ? localEditedMessagesMap[msgIdStr]
        : (msg.content || "");

    const parsed = parseReplyFromContent(raw);
    const cleanText = parsed.cleanText;

    const nestedReplyObj =
        msg.replyPost || msg.ReplyPost ||
        msg.repliedPost || msg.RepliedPost ||
        msg.replyToPost || msg.ReplyToPost ||
        msg.parentPost || msg.ParentPost ||
        (typeof msg.replyTo === 'object' ? msg.replyTo : null) ||
        (typeof msg.ReplyTo === 'object' ? msg.ReplyTo : null);

    const rawReplyId =
        (typeof msg.replyTo !== 'object' ? msg.replyTo : null) ??
        (typeof msg.ReplyTo !== 'object' ? msg.ReplyTo : null) ??
        msg.replyToId ?? msg.ReplyToId ??
        msg.replyPostId ?? msg.ReplyPostId ??
        msg.repliedPostId ?? msg.RepliedPostId ??
        msg.parentPostId ?? msg.ParentPostId ??
        (nestedReplyObj ? (nestedReplyObj.id || nestedReplyObj.Id || nestedReplyObj.postId || nestedReplyObj.PostId) : null);

    const replyIdNum = rawReplyId !== null && rawReplyId !== undefined ? Number(rawReplyId) : 0;

    if (replyIdNum > 0) {
        const replyIdStr = String(replyIdNum);
        const refMsg = messagesMap.get(replyIdStr) || nestedReplyObj;

        const refUser =
            (refMsg && (refMsg.userName || refMsg.username || refMsg.UserName || refMsg.authorName)) ||
            msg.replyUserName || msg.ReplyUserName ||
            msg.repliedUserName || msg.RepliedUserName ||
            msg.replyToUserName || msg.ReplyToUserName ||
            msg.parentPostUserName ||
            (localReplyMap[msgIdStr] && localReplyMap[msgIdStr].userName) ||
            (localReplyMap[`target:${replyIdStr}`] && localReplyMap[`target:${replyIdStr}`].userName) ||
            "Kullanıcı";

        const refRawContent =
            (refMsg && (refMsg.content ?? refMsg.Content ?? refMsg.message)) ??
            msg.replyContent ?? msg.ReplyContent ??
            msg.repliedContent ?? msg.RepliedContent ??
            msg.replyToContent ?? msg.ReplyToContent ??
            msg.parentPostContent ??
            (localReplyMap[msgIdStr] ? localReplyMap[msgIdStr].snippet : null) ??
            (localReplyMap[`target:${replyIdStr}`] ? localReplyMap[`target:${replyIdStr}`].snippet : null);

        const refAttachment =
            (refMsg && (refMsg.attachmentUrl || refMsg.AttachmentUrl)) ||
            msg.replyAttachmentUrl || msg.ReplyAttachmentUrl || null;

        let snippetText = "";
        if (refRawContent !== null && refRawContent !== undefined && String(refRawContent).trim() !== "") {
            snippetText = parseReplyFromContent(String(refRawContent)).cleanText.replace(/\s+/g, ' ').trim().slice(0, 80);
        } else if (refAttachment) {
            snippetText = "📷 Görsel / Ek";
        } else {
            snippetText = "Mesaja gitmek için tıklayın...";
        }

        const rData = {
            id: replyIdStr,
            userName: stripEmojis(refUser) || refUser,
            snippet: snippetText
        };

        localReplyMap[msgIdStr] = rData;
        if (refMsg) {
            localReplyMap[`target:${replyIdStr}`] = rData;
        }
        return { replyData: rData, cleanText };
    }

    if (msg.replyData) {
        return { replyData: msg.replyData, cleanText };
    }
    if (localReplyMap[msgIdStr]) {
        return { replyData: localReplyMap[msgIdStr], cleanText };
    }
    if (parsed.replyData) {
        return { replyData: parsed.replyData, cleanText };
    }

    return { replyData: null, cleanText };
}

function refreshRenderedReplyHeaders() {
    messagesMap.forEach((msg, idStr) => {
        const domEl = document.getElementById(`msg-${idStr}`);
        if (!domEl) return;
        const { replyData } = extractReplyInfo(msg);
        if (!replyData || !replyData.id) return;

        let replyHeaderEl = domEl.querySelector('.msg-reply-header');
        const headerInnerHtml = `
            <svg class="w-3.5 h-3.5 text-gray-500 group-hover/reply:text-mc-primary shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"/></svg>
            <span class="font-bold text-indigo-400 shrink-0">@${stripEmojis(replyData.userName) || replyData.userName}</span>
            <span class="truncate opacity-85 group-hover/reply:underline">${replyData.snippet}</span>
        `;

        if (replyHeaderEl) {
            replyHeaderEl.innerHTML = headerInnerHtml;
        } else {
            replyHeaderEl = document.createElement('div');
            replyHeaderEl.className = "msg-reply-header flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 mb-1 pl-3 cursor-pointer select-none group/reply";
            replyHeaderEl.onclick = (ev) => focusRepliedMessage(replyData.id, ev);
            replyHeaderEl.innerHTML = headerInnerHtml;
            domEl.insertBefore(replyHeaderEl, domEl.firstChild);
        }
    });
}

// YANITLAMA PAYLOAD'U DOĞRUDAN SIGNALR SendPost'A BAĞLANDI
async function handleSendMessage(e) {
    if (e) e.preventDefault();

    const targetChannelId = Number(currentChatChannelId || activeViewingChannelId);
    const input = document.getElementById('chatInput');
    const rawText = input ? input.value.trim() : '';

    if ((!rawText && !selectedChatFile) || !targetChannelId) return;

    const localUser = currentLoggedUserInfo.username || localStorage.getItem('mc_username') || 'Sen';
    const fileToUpload = selectedChatFile;
    const activeReply = replyingToMsg ? { ...replyingToMsg } : null;

    let formattedText = rawText;

    // 1. Kullanıcı etiketlerini emojisiz temiz kullanıcı adıyla @@kullanici@@ formatına çevir
    knownUsersMap.forEach((u) => {
        const cleanUname = stripEmojis(u.username) || u.username;
        if (!cleanUname) return;
        const escaped = cleanUname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(?<!@)@${escaped}\\b`, 'gi');
        formattedText = formattedText.replace(regex, `@@${cleanUname}@@`);
    });

    // 2. Kanal etiketlerini ##KanalAdı## formatına çevir
    globalChannels.forEach((ch) => {
        if (!ch.name) return;
        const escapedCh = ch.name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (!escapedCh) return;
        const chRegex = new RegExp(`(?<!#)#${escapedCh}\\b`, 'gi');
        formattedText = formattedText.replace(chRegex, `##${ch.name.trim()}##`);
    });

    let activeReplyData = null;
    const replyToPostId = activeReply && activeReply.id ? Number(activeReply.id) : null;

    if (activeReply && replyToPostId > 0) {
        const cleanSnippet = (activeReply.content || 'Mesaj').replace(/[\r\n|\[\]]+/g, ' ').trim().slice(0, 80);
        activeReplyData = {
            id: String(replyToPostId),
            userName: stripEmojis(activeReply.userName) || activeReply.userName,
            snippet: cleanSnippet
        };
        localReplyMap[`target:${replyToPostId}`] = activeReplyData;
        saveRepliesToStorage();
    }

    const tempId = `temp-${Date.now()}`;
    if (activeReplyData) localReplyMap[tempId] = activeReplyData;

    const optimisticObj = {
        id: tempId,
        userName: localUser,
        userNameColor: '#818cf8',
        pictureUrl: currentLoggedUserInfo.pictureUrl || null,
        content: formattedText,
        replyTo: replyToPostId,
        replyData: activeReplyData,
        attachmentUrl: selectedChatFileUrl || null,
        createDate: new Date().toISOString(),
        isOptimistic: true
    };

    const container = document.getElementById('chatMessages');
    if (container.innerHTML.includes('henüz mesaj yok') || container.innerHTML.includes('oldukça sessiz')) {
        container.innerHTML = '';
    }
    const tempEl = createMessageHTML(optimisticObj);
    tempEl.classList.add('optimistic-msg', 'opacity-60');
    tempEl.dataset.rawContent = formattedText.trim();
    container.appendChild(tempEl);
    scrollToBottomChat(true);

    if (input) {
        input.value = '';
        input.style.height = 'auto';
    }
    cancelReply();
    clearSelectedFile();
    updateSendButtonState();
    hideMentionPopup();
    closeAllEmojiPickers();

    try {
        if (fileToUpload) {
            const token = localStorage.getItem('mc_token');
            const uploadRes = await uploadChatAttachmentToServer(targetChannelId, formattedText, fileToUpload, token);
            if (!uploadRes.postCreated) {
                await sendPostViaSignalR(targetChannelId, formattedText, uploadRes.uploadedUrl, replyToPostId);
            }
        } else {
            await sendPostViaSignalR(targetChannelId, formattedText, "", replyToPostId);
        }

        tempEl.remove();
        await pollNewMessages();
        scrollToBottomChat(true);
    } catch (err) {
        tempEl.classList.remove('opacity-60');
        const statusBadge = tempEl.querySelector('.optimistic-status');
        if (statusBadge) {
            statusBadge.innerText = 'Gönderilemedi';
            statusBadge.classList.replace('text-gray-400', 'text-mc-red');
        }
    }
}

function extractUploadedAttachmentPath(data) {
    if (!data) return null;
    if (typeof data === 'string') {
        const trimmed = data.trim();
        if (trimmed.startsWith('/') || trimmed.startsWith('http') || trimmed.includes('Media/') || trimmed.includes('Attachment/')) {
            return trimmed;
        }
        return null;
    }
    if (typeof data === 'object') {
        const candidates = [
            data.attachmentUrl, data.AttachmentUrl, data.url, data.Url,
            data.filePath, data.FilePath, data.path, data.Path,
            data.fileUrl, data.FileUrl, data.mediaUrl, data.MediaUrl,
            data.fileName, data.FileName
        ];
        for (const c of candidates) {
            if (typeof c === 'string' && c.trim().length > 0) return c.trim();
        }
        if (data.data) return extractUploadedAttachmentPath(data.data);
    }
    return null;
}

async function uploadChatAttachmentToServer(channelId, content, fileToUpload, token) {
    const cid = Number(channelId) || channelId;

    const uploadOnlyEndpoints = [
        `${apiRootUrl}/Media/upload-attachment`,
        `${apiRootUrl}/Media/UploadAttachment`,
        `${apiRootUrl}/Media/upload`,
        `${apiRootUrl}/Media/Upload`,
        `${postBaseUrl}/upload-attachment`,
        `${postBaseUrl}/UploadAttachment`,
        `${postBaseUrl}/upload-media`,
        `${postBaseUrl}/upload`
    ];

    const fileFieldNames = ['file', 'File', 'formFile', 'FormFile', 'attachment', 'Attachment', 'image', 'picture'];

    for (const url of uploadOnlyEndpoints) {
        try {
            const fd = new FormData();
            fileFieldNames.forEach(field => fd.append(field, fileToUpload));
            fd.append('channelId', cid);
            fd.append('ChannelId', cid);

            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: fd
            });

            if (res.ok) {
                const text = await res.text();
                let parsed = null;
                try { parsed = JSON.parse(text); } catch (_) { parsed = text; }
                const extractedUrl = extractUploadedAttachmentPath(parsed);
                if (extractedUrl) {
                    return { uploadedUrl: extractedUrl, postCreated: false };
                }
            }
        } catch (e) {}
    }

    const postWithFileEndpoints = [
        `${postBaseUrl}/create-post-v2`,
        `${postBaseUrl}/create-post`,
        `${postBaseUrl}/add-post-v2`,
        `${postBaseUrl}/add-post`,
        `${postBaseUrl}/send-post`,
        `${postBaseUrl}/insert-post`,
        `${postBaseUrl}`
    ];

    for (const url of postWithFileEndpoints) {
        try {
            const fd = new FormData();
            fd.append('ChannelId', cid);
            fd.append('channelId', cid);
            fd.append('Content', content || "");
            fd.append('content', content || "");
            if (replyingToMsg && replyingToMsg.id) {
                fd.append('ParentPostId', Number(replyingToMsg.id) || 0);
                fd.append('parentPostId', Number(replyingToMsg.id) || 0);
            }
            fileFieldNames.forEach(field => fd.append(field, fileToUpload));

            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: fd
            });

            if (res.ok) {
                const text = await res.text();
                let parsed = null;
                try { parsed = JSON.parse(text); } catch (_) { parsed = text; }
                const extractedUrl = extractUploadedAttachmentPath(parsed);
                return { uploadedUrl: extractedUrl || "", postCreated: true };
            }
        } catch (e) {}
    }

    if (fileToUpload.type && fileToUpload.type.startsWith('image/')) {
        const base64Url = await compressImageToDataUrl(fileToUpload, 900, 0.78);
        if (base64Url) {
            return { uploadedUrl: base64Url, postCreated: false };
        }
    }

    throw new Error("Medya yüklenemedi.");
}

function compressImageToDataUrl(file, maxWidth = 900, quality = 0.78) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (ev) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let w = img.width;
                let h = img.height;
                if (w > maxWidth) {
                    h = Math.round((h * maxWidth) / w);
                    w = maxWidth;
                }
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, w, h);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.onerror = () => resolve(ev.target.result);
            img.src = ev.target.result;
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
    });
}

async function trySendPostRequest(url, mode, channelId, content, fileToUpload, token) {
    const cid = Number(channelId) || channelId;
    if (mode === 'formdata') {
        const formData = new FormData();
        formData.append('channelId', cid);
        formData.append('ChannelId', cid);
        formData.append('content', content);
        formData.append('Content', content);
        formData.append('message', content);
        if (fileToUpload) {
            formData.append('file', fileToUpload);
            formData.append('File', fileToUpload);
            formData.append('attachment', fileToUpload);
            formData.append('picture', fileToUpload);
        }
        return await fetch(url, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });
    } else {
        return await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({
                channelId: cid,
                content: content,
                message: content,
                text: content,
                parentPostId: replyingToMsg ? (Number(replyingToMsg.id) || 0) : 0
            })
        });
    }
}

async function dispatchCreatePostToBackend(channelId, content, fileToUpload, token) {
    if (cachedCreatePostConfig && !fileToUpload) {
        try {
            const res = await trySendPostRequest(cachedCreatePostConfig.url, cachedCreatePostConfig.mode, channelId, content, fileToUpload, token);
            if (res.ok) return res;
            if (res.status === 404 || res.status === 405) {
                cachedCreatePostConfig = null;
                localStorage.removeItem('mc_create_post_cfg');
            }
        } catch (e) {}
    }

    const candidateEndpoints = [
        `${postBaseUrl}/create-post-v2`,
        `${postBaseUrl}/add-post`,
        `${postBaseUrl}/add-post-v2`,
        `${postBaseUrl}/create`,
        `${postBaseUrl}/send-post`,
        `${postBaseUrl}/send-message`,
        `${postBaseUrl}/insert-post`,
        `${postBaseUrl}`,
        `${postBaseUrl}/create-post`,
        `${apiBaseUrl}/send-message`,
        `${apiBaseUrl}/create-post`
    ];

    const modes = fileToUpload ? ['formdata', 'json'] : ['json', 'formdata'];

    for (const url of candidateEndpoints) {
        for (const mode of modes) {
            try {
                const res = await trySendPostRequest(url, mode, channelId, content, fileToUpload, token);
                if (res.ok) {
                    cachedCreatePostConfig = { url, mode };
                    localStorage.setItem('mc_create_post_cfg', JSON.stringify(cachedCreatePostConfig));
                    return res;
                }
                if (res.status === 404 || res.status === 405) break;
            } catch (err) {}
        }
    }

    throw new Error("Mesaj gönderme adresi sunucuda bulunamadı.");
}

function setReplyMessage(msgId, e) {
    if (e) e.stopPropagation();
    closeAllEmojiPickers();
    const msg = messagesMap.get(String(msgId));
    if (!msg) return;
    const { cleanText } = extractReplyInfo(msg);
    replyingToMsg = {
        id: msg.id,
        userName: msg.userName,
        content: cleanText || (msg.attachmentUrl ? "📷 Görsel" : "Mesaj")
    };
    document.getElementById('replyPreviewUser').innerText = `@${msg.userName}`;
    document.getElementById('replyPreviewText').innerText = replyingToMsg.content;
    document.getElementById('replyPreviewBar').classList.remove('hidden');
    document.getElementById('chatInput').focus();
}

function cancelReply() {
    replyingToMsg = null;
    const bar = document.getElementById('replyPreviewBar');
    if (bar) bar.classList.add('hidden');
}

async function focusRepliedMessage(targetId, e) {
    if (e) e.stopPropagation();
    if (!targetId) return;

    let el = document.getElementById(`msg-${targetId}`);
    let attempts = 0;
    while (!el && hasMoreOlderMessages && attempts < 5) {
        attempts++;
        const loaded = await fetchOlderMessages();
        if (!loaded) break;
        el = document.getElementById(`msg-${targetId}`);
    }

    if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.remove('msg-highlight');
        void el.offsetWidth;
        el.classList.add('msg-highlight');
        setTimeout(() => el.classList.remove('msg-highlight'), 1800);
    }
}

function startEditMessage(msgId, e) {
    if (e) e.stopPropagation();
    closeAllEmojiPickers();
    const msgIdStr = String(msgId);
    const msg = messagesMap.get(msgIdStr);
    const msgEl = document.getElementById(`msg-${msgIdStr}`);
    if (!msg || !msgEl) return;

    const bodyEl = msgEl.querySelector('.msg-body-text');
    if (!bodyEl || msgEl.querySelector('.inline-edit-box')) return;

    const { replyData, cleanText } = extractReplyInfo(msg);
    bodyEl.classList.add('hidden');

    const editBox = document.createElement('div');
    editBox.className = "inline-edit-box mt-1.5 space-y-2";
    editBox.innerHTML = `
        <textarea class="edit-textarea w-full bg-[#1e1f22] border border-mc-primary/60 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-mc-primary resize-none" rows="2"></textarea>
        <div class="flex items-center justify-end gap-2 text-xs">
            <span class="text-[11px] text-gray-400 mr-auto">Esc ile iptal • Enter ile kaydet</span>
            <button type="button" class="cancel-edit-btn px-3 py-1 rounded bg-white/5 hover:bg-white/10 text-gray-300">İptal</button>
            <button type="button" class="save-edit-btn px-3 py-1 rounded bg-mc-primary hover:bg-[#4752C4] text-white font-semibold">Kaydet</button>
        </div>
    `;

    const textarea = editBox.querySelector('.edit-textarea');
    textarea.value = cleanText;

    editBox.querySelector('.cancel-edit-btn').onclick = (ev) => {
        ev.stopPropagation();
        editBox.remove();
        bodyEl.classList.remove('hidden');
    };

    const saveFn = async (ev) => {
        if (ev) ev.stopPropagation();
        const newClean = textarea.value.trim();
        if (!newClean) return;

        let finalContent = newClean;
        knownUsersMap.forEach((u) => {
            const escaped = u.username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`(?<!@)@${escaped}\\b`, 'gi');
            finalContent = finalContent.replace(regex, `@@${u.username}@@`);
        });

        if (replyData) {
            finalContent = `>>[${replyData.id}|${replyData.userName}|${replyData.snippet}]<<\n${finalContent}`;
        }

        const saveBtn = editBox.querySelector('.save-edit-btn');
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerText = "Kaydediliyor...";
        }

        msg.content = finalContent;
        msg.isEdited = true;
        localEditedMessagesMap[msgIdStr] = finalContent;
        saveEditedMessagesToStorage();

        const cleanDisplay = parseReplyFromContent(finalContent).cleanText;
        bodyEl.innerHTML = formatMessageText(cleanDisplay) + ` <span class="text-[10px] text-gray-400 italic select-none">(düzenlendi)</span>`;
        editBox.remove();
        bodyEl.classList.remove('hidden');

        try {
            await updatePostViaSignalR(Number(msgIdStr), finalContent, msg.attachmentUrl || "");
            await pollNewMessages();
        } catch (err) {}
    };

    editBox.querySelector('.save-edit-btn').onclick = saveFn;
    textarea.addEventListener('keydown', (ke) => {
        if (ke.key === 'Escape') {
            ke.preventDefault();
            editBox.remove();
            bodyEl.classList.remove('hidden');
        } else if (ke.key === 'Enter' && !ke.shiftKey) {
            ke.preventDefault();
            saveFn();
        }
    });

    bodyEl.parentElement.insertBefore(editBox, bodyEl.nextSibling);
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
}

async function handleDeleteMessage(msgId, e) {
    if (e) e.stopPropagation();
    closeAllEmojiPickers();
    const msgIdStr = String(msgId);
    const numericId = Number(msgIdStr);
    const msgEl = document.getElementById(`msg-${msgIdStr}`);
    if (msgEl) msgEl.style.opacity = '0.35';

    try { await deletePostViaSignalR(numericId); } catch (err) {}

    messagesMap.delete(msgIdStr);
    delete localEditedMessagesMap[msgIdStr];
    saveEditedMessagesToStorage();
    if (msgEl) msgEl.remove();
    updateImageGallery();
    await pollNewMessages();
}

function startChatPolling(channelId) {
    if (currentChatChannelId === channelId && chatPollingInterval) return;

    if (currentChatChannelId && currentChatChannelId !== channelId) {
        leaveSignalRChannel(currentChatChannelId);
    }

    if (chatPollingInterval) clearInterval(chatPollingInterval);

    currentChatChannelId = channelId;
    oldestPostId = null;
    newestPostId = null;
    hasMoreOlderMessages = true;
    unreadMessagesCount = 0;

    cancelReply();
    clearSelectedFile();
    hideMentionPopup();
    messagesMap.clear();
    updateImageGallery();

    joinSignalRChannel(channelId);

    const btn = document.getElementById('scrollToBottomBtn');
    if (btn) btn.classList.add('hidden');
    const container = document.getElementById('chatMessages');
    container.innerHTML = '<div class="text-center text-gray-500 text-sm mt-10 animate-pulse">Mesajlar yükleniyor...</div>';

    fetchInitialMessages(channelId);
    chatPollingInterval = setInterval(() => {
        if (activeViewingChannelId === channelId) pollNewMessages();
    }, 2500);
}

function updateImageGallery() {
    imageGalleryList = Array.from(messagesMap.values()).sort((a, b) => new Date(a.createDate) - new Date(b.createDate));
}

function registerUserFromMessage(msg) {
    if (msg && msg.userName) {
        const existing = findKnownUserByUsername(msg.userName) || {};
        const extractedId = extractUserIdFromObject(msg, true) || existing.userId || null;
        knownUsersMap.set(msg.userName, {
            ...existing,
            userId: extractedId ? Number(extractedId) : null,
            username: msg.userName,
            pictureUrl: msg.pictureUrl || existing.pictureUrl || null,
            color: msg.userNameColor || existing.color || '#fff'
        });
    }
}

async function fetchInitialMessages(channelId) {
    const token = localStorage.getItem('mc_token');
    try {
        const response = await fetch(postApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ channelId: Number(channelId) || channelId, lastPostId: 0, olderPostLimit: 30, newerPostLimit: 0 })
        });
        const result = await response.json();
        if (currentChatChannelId !== channelId) return;

        if (result.httpStatusCode === 200 && Array.isArray(result.data)) {
            const container = document.getElementById('chatMessages');
            container.innerHTML = '';
            if (result.data.length === 0) {
                hasMoreOlderMessages = false;
                markChannelAsRead(channelId, 0);
                container.innerHTML = '<div class="text-center text-gray-500 text-xs mt-12 flex flex-col items-center"><svg class="w-12 h-12 text-gray-600 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path></svg>Bu kanalda henüz mesaj yok.</div>';
                return;
            }
            newestPostId = result.data[0].id;
            oldestPostId = result.data[result.data.length - 1].id;
            hasMoreOlderMessages = result.data.length >= 30;

            result.data.forEach(msg => {
                const idStr = String(msg.id);
                if (localEditedMessagesMap[idStr] && msg.content === localEditedMessagesMap[idStr]) {
                    msg.isEdited = true;
                }
                messagesMap.set(idStr, msg);
                registerUserFromMessage(msg);
                syncReactionsFromServerMsg(msg);
            });
            updateImageGallery();
            appendChatMessages([...result.data].reverse());
            refreshRenderedReplyHeaders();
            container.scrollTop = container.scrollHeight;
            markChannelAsRead(channelId, newestPostId);
        }
    } catch (error) {}
}

async function pollNewMessages() {
    if (!currentChatChannelId) return;
    const token = localStorage.getItem('mc_token');
    const targetChannelId = currentChatChannelId;

    try {
        const response = await fetch(postApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ channelId: Number(targetChannelId) || targetChannelId, lastPostId: 0, olderPostLimit: 30, newerPostLimit: 0 })
        });
        const result = await response.json();
        if (currentChatChannelId !== targetChannelId || result.httpStatusCode !== 200 || !Array.isArray(result.data)) return;

        const container = document.getElementById('chatMessages');
        const isScrolledToBottom = container.scrollHeight - container.clientHeight <= container.scrollTop + 110;
        const latestBatch = result.data;

        if (latestBatch.length === 0) {
            if (messagesMap.size > 0) {
                messagesMap.clear();
                updateImageGallery();
                container.innerHTML = '<div class="text-center text-gray-500 text-xs mt-12 flex flex-col items-center">Bu kanalda henüz mesaj yok.</div>';
            }
            return;
        }

        newestPostId = latestBatch[0].id;
        if (!oldestPostId) oldestPostId = latestBatch[latestBatch.length - 1].id;

        const minWindowId = Math.min(...latestBatch.map(m => Number(m.id)));
        const validBatchIds = new Set(latestBatch.map(m => String(m.id)));

        Array.from(messagesMap.keys()).forEach(existingIdStr => {
            const numericId = Number(existingIdStr);
            if (!isNaN(numericId) && numericId >= minWindowId && !validBatchIds.has(existingIdStr)) {
                messagesMap.delete(existingIdStr);
                const domEl = document.getElementById(`msg-${existingIdStr}`);
                if (domEl) domEl.remove();
            }
        });

        let newlyAddedCount = 0;
        const chronological = [...latestBatch].reverse();

        chronological.forEach(msg => {
            const idStr = String(msg.id);
            const prevMsg = messagesMap.get(idStr);
            const existed = Boolean(prevMsg);

            if (prevMsg && prevMsg.content !== msg.content) {
                localEditedMessagesMap[idStr] = msg.content;
                msg.isEdited = true;
                saveEditedMessagesToStorage();
            }

            messagesMap.set(idStr, msg);
            registerUserFromMessage(msg);
            syncReactionsFromServerMsg(msg);

            document.querySelectorAll('.optimistic-msg').forEach(optEl => {
                if (optEl.dataset.rawContent === (msg.content || "").trim()) optEl.remove();
            });

            const existingDom = document.getElementById(`msg-${idStr}`);
            if (!existingDom) {
                if (container.innerHTML.includes('henüz mesaj yok') || container.innerHTML.includes('oldukça sessiz')) {
                    container.innerHTML = '';
                }
                container.appendChild(createMessageHTML(msg));
                if (!existed) newlyAddedCount++;
            } else if (!existingDom.querySelector('.inline-edit-box')) {
                const textContainer = existingDom.querySelector('.msg-body-text');
                if (textContainer) {
                    const { cleanText } = extractReplyInfo(msg);
                    const isEdited = localEditedMessagesMap[idStr] !== undefined || msg.isEdited;
                    const formatted = formatMessageText(cleanText) + (isEdited ? ` <span class="text-[10px] text-gray-400 italic select-none">(düzenlendi)</span>` : '');
                    if (textContainer.innerHTML !== formatted) textContainer.innerHTML = formatted;
                }
                renderReactions(idStr, existingDom.querySelector(`#reactions-container-${CSS.escape(idStr)}`));
            }
        });

        refreshRenderedReplyHeaders();
        updateImageGallery();
        if (!document.getElementById('imageViewerModal').classList.contains('hidden')) {
            renderViewerReactions();
        }
        if (activeReactionModalMsgId) {
            renderReactionDetailsModalContent();
        }

        if (newlyAddedCount > 0) {
            markChannelAsRead(targetChannelId, newestPostId);
            if (isScrolledToBottom) {
                scrollToBottomChat(true);
            } else {
                unreadMessagesCount += newlyAddedCount;
                updateScrollBottomButtonUI();
            }
        }
    } catch (e) {}
}

async function fetchOlderMessages() {
    if (!currentChatChannelId || !oldestPostId || isFetchingOlder || !hasMoreOlderMessages) return false;
    isFetchingOlder = true;
    let fetched = false;
    const loader = document.getElementById('olderMessagesLoader');
    if (loader) loader.classList.remove('hidden');

    const token = localStorage.getItem('mc_token');
    try {
        const response = await fetch(postApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ channelId: Number(currentChatChannelId) || currentChatChannelId, lastPostId: oldestPostId, olderPostLimit: 30, newerPostLimit: 0 })
        });
        const result = await response.json();
        if (result.httpStatusCode === 200 && Array.isArray(result.data)) {
            if (result.data.length > 0) {
                oldestPostId = result.data[result.data.length - 1].id;
                if (result.data.length < 30) hasMoreOlderMessages = false;

                result.data.forEach(msg => {
                    messagesMap.set(String(msg.id), msg);
                    registerUserFromMessage(msg);
                    syncReactionsFromServerMsg(msg);
                });
                updateImageGallery();
                const container = document.getElementById('chatMessages');
                const oldScrollHeight = container.scrollHeight;
                prependChatMessages([...result.data].reverse());
                refreshRenderedReplyHeaders();
                container.scrollTop = container.scrollHeight - oldScrollHeight;
                fetched = true;
            } else {
                hasMoreOlderMessages = false;
            }
        }
    } catch (e) {}
    if (loader) loader.classList.add('hidden');
    isFetchingOlder = false;
    return fetched;
}

function handleFileSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    selectedChatFile = file;
    const bar = document.getElementById('filePreviewBar');
    const img = document.getElementById('filePreviewImg');
    const icon = document.getElementById('filePreviewIcon');

    document.getElementById('filePreviewName').innerText = file.name;
    document.getElementById('filePreviewSize').innerText = `${(file.size / 1024).toFixed(1)} KB`;

    if (file.type.startsWith('image/')) {
        selectedChatFileUrl = URL.createObjectURL(file);
        img.src = selectedChatFileUrl;
        img.classList.remove('hidden');
        icon.classList.add('hidden');
    } else {
        selectedChatFileUrl = null;
        img.classList.add('hidden');
        icon.classList.remove('hidden');
    }
    bar.classList.remove('hidden');
    updateSendButtonState();
}

function clearSelectedFile() {
    selectedChatFile = null;
    selectedChatFileUrl = null;
    const fileInput = document.getElementById('chatFileInput');
    if (fileInput) fileInput.value = '';
    const bar = document.getElementById('filePreviewBar');
    if (bar) bar.classList.add('hidden');
    updateSendButtonState();
}

function updateSendButtonState() {
    const input = document.getElementById('chatInput');
    const btn = document.getElementById('sendBtn');
    if (!input || !btn) return;
    btn.disabled = !(input.value.trim().length > 0 || Boolean(selectedChatFile));
}

function handleChatInput(e) {
    const textarea = e.target;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    updateSendButtonState();

    const val = textarea.value;
    const cursor = textarea.selectionStart || 0;
    const textUntilCursor = val.slice(0, cursor);
    const match = textUntilCursor.match(/(?:^|\s)@([^\s@]*)$/);

    if (match) {
        const query = match[1].toLowerCase();
        const allUsers = Array.from(knownUsersMap.values());
        const filtered = allUsers.filter(u => u.username.toLowerCase().includes(query)).slice(0, 6);
        if (filtered.length > 0) {
            mentionState = {
                active: true,
                query,
                startIndex: textUntilCursor.lastIndexOf('@'),
                selectedIdx: 0,
                filtered
            };
            renderMentionPopup();
            return;
        }
    }
    hideMentionPopup();
}

function renderMentionPopup() {
    const popup = document.getElementById('mentionPopup');
    const list = document.getElementById('mentionList');
    if (!mentionState.active || mentionState.filtered.length === 0) {
        popup.classList.add('hidden');
        return;
    }
    popup.classList.remove('hidden');
    list.innerHTML = mentionState.filtered.map((u, idx) => {
        const avatar = u.pictureUrl
            ? getNextImageUrl(u.pictureUrl, 48)
            : `https://ui-avatars.com/api/?background=2b2d31&color=fff&name=${encodeURIComponent(u.username)}`;
        const activeClass = idx === mentionState.selectedIdx ? 'bg-mc-primary text-white' : 'text-gray-200 hover:bg-white/5';
        return `
            <button type="button" onclick="selectMentionUser('${u.username}')" class="w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${activeClass}">
                <img src="${avatar}" class="w-6 h-6 rounded-full object-cover">
                <span class="truncate font-medium">@${u.username}</span>
            </button>
        `;
    }).join('');
}

function selectMentionUser(username) {
    const textarea = document.getElementById('chatInput');
    if (!textarea) return;
    if (mentionState.startIndex === -1) {
        insertEmojiToChatInput(`@@${username}@@ `);
        return;
    }
    const cursor = textarea.selectionStart || textarea.value.length;
    const before = textarea.value.slice(0, mentionState.startIndex);
    const after = textarea.value.slice(cursor);
    const inserted = `@@${username}@@ `;
    textarea.value = before + inserted + after;
    hideMentionPopup();
    updateSendButtonState();
    textarea.focus();
    const pos = before.length + inserted.length;
    textarea.setSelectionRange(pos, pos);
}

function hideMentionPopup() {
    mentionState.active = false;
    const popup = document.getElementById('mentionPopup');
    if (popup) popup.classList.add('hidden');
}

function handleChatKeyDown(e) {
    if (mentionState.active && mentionState.filtered.length > 0) {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            mentionState.selectedIdx = (mentionState.selectedIdx + 1) % mentionState.filtered.length;
            renderMentionPopup();
            return;
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            mentionState.selectedIdx = mentionState.selectedIdx === 0 ? mentionState.filtered.length - 1 : mentionState.selectedIdx - 1;
            renderMentionPopup();
            return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            const chosen = mentionState.filtered[mentionState.selectedIdx];
            if (chosen) selectMentionUser(chosen.username);
            return;
        }
        if (e.key === 'Escape') {
            hideMentionPopup();
            return;
        }
    }

    if (e.key === 'Escape' && replyingToMsg) {
        cancelReply();
        return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendMessage(e);
    }
}

function toggleInputEmojiPicker(e) {
    if (e) e.stopPropagation();
    const picker = document.getElementById('inputEmojiPicker');
    const isHidden = picker.classList.contains('hidden');
    closeAllEmojiPickers();
    if (isHidden) {
        initInputEmojiGrid();
        picker.classList.remove('hidden');
    }
}

function insertEmojiToChatInput(emoji) {
    const textarea = document.getElementById('chatInput');
    if (!textarea) return;
    const start = textarea.selectionStart || 0;
    const end = textarea.selectionEnd || 0;
    const text = textarea.value;
    textarea.value = text.slice(0, start) + emoji + text.slice(end);
    updateSendButtonState();
    textarea.focus();
    textarea.setSelectionRange(start + emoji.length, start + emoji.length);
}

function updateScrollBottomButtonUI(isNearBottom = false) {
    const container = document.getElementById('chatMessages');
    const btn = document.getElementById('scrollToBottomBtn');
    const badge = document.getElementById('unreadBadgeText');
    if (!btn || !container) return;

    const near = isNearBottom || (container.scrollHeight - container.clientHeight <= container.scrollTop + 130);
    if (!near && container.scrollHeight > container.clientHeight) {
        btn.classList.remove('hidden');
        badge.innerText = unreadMessagesCount > 0 ? `${unreadMessagesCount} Yeni Mesaj` : 'En sona git';
    } else {
        btn.classList.add('hidden');
    }
}

function scrollToBottomChat(force = true) {
    const container = document.getElementById('chatMessages');
    unreadMessagesCount = 0;
    container.scrollTo({ top: container.scrollHeight, behavior: force ? 'smooth' : 'auto' });
    updateScrollBottomButtonUI(true);
}

// Galeri ve Görüntüleyici
function openImageViewer(msgId) {
    updateImageGallery();
    currentViewerIndex = imageGalleryList.findIndex(m => String(m.id) === String(msgId));
    if (currentViewerIndex === -1) return;

    document.getElementById('imageViewerModal').classList.remove('hidden');
    renderImageViewer();
    document.addEventListener('keydown', handleViewerKeys);
}

function closeImageViewer() {
    document.getElementById('imageViewerModal').classList.add('hidden');
    document.removeEventListener('keydown', handleViewerKeys);
}

function handleViewerKeys(e) {
    if (e.key === 'Escape') closeImageViewer();
    if (e.key === 'ArrowLeft') prevImage(e);
    if (e.key === 'ArrowRight') nextImage(e);
}

async function prevImage(e) {
    if (e) e.stopPropagation();
    if (currentViewerIndex > 0) {
        currentViewerIndex--;
        renderImageViewer();
    } else if (currentViewerIndex === 0) {
        const oldFirstMsgId = imageGalleryList[0].id;
        document.getElementById('viewerPrevBtn').style.opacity = '0.5';
        const fetched = await fetchOlderMessages();
        document.getElementById('viewerPrevBtn').style.opacity = '1';

        if (fetched) {
            const newIdx = imageGalleryList.findIndex(m => m.id === oldFirstMsgId);
            if (newIdx > 0) {
                currentViewerIndex = newIdx - 1;
                renderImageViewer();
            }
        }
    }
}

function nextImage(e) {
    if (e) e.stopPropagation();
    if (currentViewerIndex < imageGalleryList.length - 1) {
        currentViewerIndex++;
        renderImageViewer();
    }
}

function renderViewerReactions() {
    const msg = imageGalleryList[currentViewerIndex];
    if (!msg) return;
    const existingContainer = document.getElementById('viewerExistingReactions');
    if (existingContainer) renderReactions(String(msg.id), existingContainer);
}

function getPickerReactionItems() {
    return Array.from(emojiCatalogMap.values());
}

function getCategorizedReactionGroups() {
    const allItems = Array.from(emojiCatalogMap.values());
    const customItems = [];
    const standardGroupsMap = new Map([
        ["Yüzler & Duygular", []],
        ["Kalpler & Semboller", []],
        ["Kutlama & El İşaretleri", []]
    ]);

    allItems.forEach(item => {
        if (item.url || item.isCustom || item.category === "Özel Emojiler") {
            customItems.push(item);
        } else {
            const catName = item.category || "Yüzler & Duygular";
            if (!standardGroupsMap.has(catName)) standardGroupsMap.set(catName, []);
            standardGroupsMap.get(catName).push(item);
        }
    });

    const resultGroups = [];
    if (customItems.length > 0) {
        resultGroups.push({ title: "Özel Emojiler", items: customItems });
    }
    for (const [title, items] of standardGroupsMap.entries()) {
        if (items.length > 0) {
            resultGroups.push({ title, items });
        }
    }
    return resultGroups;
}

function buildCategorizedReactionPickerHTML(msgIdStr) {
    const groups = getCategorizedReactionGroups();
    return groups.map(group => `
        <div class="mb-2.5 last:mb-0">
            <div class="text-[10px] font-bold text-gray-400 uppercase tracking-wider px-1 mb-1 border-b border-white/5 pb-0.5">${group.title}</div>
            <div class="grid grid-cols-5 gap-1">
                ${group.items.map(item => {
                    const safeKey = String(item.key).replace(/'/g, "\\'");
                    return `<button type="button" title="${item.key}" onclick="toggleReaction('${msgIdStr}', '${safeKey}', event, ${item.emojiId})" class="hover:bg-white/10 p-1.5 rounded-lg transition-transform hover:scale-125 text-base flex items-center justify-center">${renderEmojiItemVisual(item)}</button>`;
                }).join('')}
            </div>
        </div>
    `).join('');
}

function renderEmojiItemVisual(item) {
    if (item.url) {
        const imgUrl = item.url.startsWith('http') ? item.url : `https://api.meetingchallenge.com${item.url}`;
        return `<img src="${imgUrl}" class="w-5 h-5 object-contain" alt="${item.key}">`;
    }
    if (item.unified) {
        try {
            return item.unified.split('-').map(hex => String.fromCodePoint(parseInt(hex, 16))).join('');
        } catch (e) {}
    }
    return item.display || item.key;
}

function renderImageViewer() {
    const msg = imageGalleryList[currentViewerIndex];
    if (!msg) return;

    const imgEl = document.getElementById('viewerImage');
    const textEl = document.getElementById('viewerTextOnly');
    const textContent = document.getElementById('viewerTextOnlyContent');
    const viewerContentEl = document.getElementById('viewerContent');

    const { cleanText } = extractReplyInfo(msg);
    let formattedContent = formatMessageText(cleanText);

    if (msg.attachmentUrl) {
        imgEl.src = getNextImageUrl(msg.attachmentUrl, 1080);
        imgEl.classList.remove('hidden');
        textEl.classList.add('hidden');
        viewerContentEl.innerHTML = formattedContent || '';
    } else {
        imgEl.classList.add('hidden');
        textEl.classList.remove('hidden');
        textContent.innerHTML = formattedContent || "";
        viewerContentEl.innerHTML = '';
    }

    const avatar = msg.pictureUrl ? getNextImageUrl(msg.pictureUrl, 128) : 'https://ui-avatars.com/api/?background=2b2d31&color=fff&name=' + encodeURIComponent(msg.userName);
    document.getElementById('viewerUserAvatar').src = avatar;
    document.getElementById('viewerUserName').innerText = msg.userName;
    document.getElementById('viewerUserName').style.color = msg.userNameColor || '#fff';

    const smartTime = formatSmartTimestamp(msg.createDate);
    const viewerTimeEl = document.getElementById('viewerTime');
    viewerTimeEl.innerText = smartTime.display;
    viewerTimeEl.title = smartTime.full;

    document.getElementById('viewerPrevBtn').style.display = 'block';
    document.getElementById('viewerNextBtn').style.display = currentViewerIndex < imageGalleryList.length - 1 ? 'block' : 'none';

    renderViewerReactions();

    const reactionBar = document.getElementById('viewerReactionBar');
    if (reactionBar) {
        reactionBar.innerHTML = `<div class="w-full max-h-40 overflow-y-auto px-1">${buildCategorizedReactionPickerHTML(String(msg.id))}</div>`;
    }
}

function toggleEmojiPicker(msgId, e) {
    if (e) e.stopPropagation();
    const picker = document.getElementById(`emoji-picker-${msgId}`);
    const wasHidden = picker ? picker.classList.contains('hidden') : true;
    closeAllEmojiPickers();
    if (picker && wasHidden) {
        picker.innerHTML = buildCategorizedReactionPickerHTML(String(msgId));
        picker.classList.remove('hidden');
    }
}

function closeAllEmojiPickers() {
    document.querySelectorAll('.emoji-picker-popover').forEach(el => el.classList.add('hidden'));
}

function resolveEmojiIdForReaction(emojiKey, entry = null, explicitEmojiId = null) {
    if (explicitEmojiId && !isNaN(Number(explicitEmojiId)) && Number(explicitEmojiId) > 0) return Number(explicitEmojiId);
    if (entry && entry.emojiId && !isNaN(Number(entry.emojiId))) return Number(entry.emojiId);
    const cat = emojiCatalogMap.get(String(emojiKey));
    if (cat && cat.emojiId) return Number(cat.emojiId);
    if (!isNaN(Number(emojiKey)) && Number(emojiKey) > 0) return Number(emojiKey);
    return 1;
}

function extractUsersFromServerReaction(r) {
    const result = [];
    const rawList = r.users || r.userList || r.reactedUsers || r.emojiUsers || r.senders || r.userNames || [];
    if (Array.isArray(rawList)) {
        rawList.forEach(u => {
            if (!u) return;
            if (typeof u === 'string') {
                const known = findKnownUserByUsername(u) || {};
                result.push({ username: u, userId: known.userId || null, pictureUrl: known.pictureUrl || null });
            } else if (typeof u === 'object') {
                const uname = u.userName || u.username || u.name || "Kullanıcı";
                const pic = u.pictureUrl || u.profilePictureUrl || u.avatarUrl || null;
                const uid = extractUserIdFromObject(u, false);
                if (uname) {
                    const existing = findKnownUserByUsername(uname) || {};
                    knownUsersMap.set(uname, { ...existing, username: uname, userId: uid || existing.userId, pictureUrl: pic || existing.pictureUrl });
                }
                result.push({ username: uname, userId: uid, pictureUrl: pic });
            }
        });
    }
    return result;
}

async function toggleReaction(msgId, emojiKey, e, explicitEmojiId = null) {
    if (e) e.stopPropagation();
    closeAllEmojiPickers();
    const key = String(msgId);
    const localUser = currentLoggedUserInfo.username || localStorage.getItem('mc_username') || 'Sen';
    const localInfo = findKnownUserByUsername(localUser) || {};

    if (!localReactionsMap[key]) localReactionsMap[key] = {};
    const entry = localReactionsMap[key][emojiKey];
    const resolvedEmojiId = resolveEmojiIdForReaction(emojiKey, entry, explicitEmojiId);
    const catalogItem = emojiCatalogMap.get(String(emojiKey)) || {};

    let isRemoving = false;
    if (!entry || entry.count <= 0) {
        localReactionsMap[key][emojiKey] = {
            count: 1,
            userReacted: true,
            emojiId: resolvedEmojiId,
            url: catalogItem.url || "",
            unified: catalogItem.unified || "",
            users: [{ username: localUser, userId: currentLoggedUserInfo.userId || localInfo.userId, pictureUrl: localInfo.pictureUrl || null }]
        };
    } else {
        if (entry.userReacted) {
            isRemoving = true;
            entry.count = Math.max(0, entry.count - 1);
            entry.userReacted = false;
            entry.users = (entry.users || []).filter(u => (typeof u === 'string' ? u : u.username) !== localUser);
            if (entry.count <= 0 && emojiKey !== DEFAULT_BLUE_HEART_KEY) {
                delete localReactionsMap[key][emojiKey];
            }
        } else {
            entry.count += 1;
            entry.userReacted = true;
            entry.emojiId = entry.emojiId || resolvedEmojiId;
            const currentUsers = Array.isArray(entry.users) ? entry.users : [];
            const exists = currentUsers.some(u => (typeof u === 'string' ? u : u.username) === localUser);
            if (!exists) {
                currentUsers.push({ username: localUser, userId: currentLoggedUserInfo.userId || localInfo.userId, pictureUrl: localInfo.pictureUrl || null });
            }
            entry.users = currentUsers;
        }
    }

    saveReactionsToStorage();
    renderReactions(key);
    if (!document.getElementById('imageViewerModal').classList.contains('hidden')) {
        renderViewerReactions();
    }
    if (activeReactionModalMsgId === key) {
        renderReactionDetailsModalContent();
    }

    const numericPostId = Number(key);
    if (!isNaN(numericPostId) && numericPostId > 0 && resolvedEmojiId > 0) {
        try {
            if (isRemoving) await removeEmojiPostViaSignalR(numericPostId, resolvedEmojiId);
            else await addEmojiPostViaSignalR(numericPostId, resolvedEmojiId);
            setTimeout(() => pollNewMessages(), 300);
        } catch (err) {}
    }
}

function syncReactionsFromServerMsg(msg) {
    if (!msg || (!msg.id && !msg.Id)) return;
    const msgId = String(msg.id || msg.Id);
    if (!localReactionsMap[msgId]) localReactionsMap[msgId] = {};

    const serverReactions = msg.emojiList || [];
    const localUser = currentLoggedUserInfo.username || localStorage.getItem('mc_username') || 'Sen';
    const localInfo = findKnownUserByUsername(localUser) || {};

    if (Array.isArray(serverReactions)) {
        const incomingKeys = new Set();
        serverReactions.forEach((r, idx) => {
            let emKey = r.key || String(r.emojiId || r.id || (idx + 1));
            if (!emKey) return;

            if (Number(r.emojiId || r.id) === 1 || String(r.unified).toLowerCase() === '1f499' || emKey === '💙') {
                emKey = DEFAULT_BLUE_HEART_KEY;
            }
            incomingKeys.add(emKey);

            const existing = localReactionsMap[msgId][emKey] || {};
            const resolvedEmojiId = Number(r.emojiId || r.id || existing.emojiId || emojiCatalogMap.get(emKey)?.emojiId || (idx + 1));
            const isCustomServerEmoji = Boolean(r.url) || emKey === DEFAULT_BLUE_HEART_KEY;

            if (!emojiCatalogMap.has(emKey)) {
                emojiCatalogMap.set(emKey, {
                    emojiId: resolvedEmojiId,
                    key: emKey,
                    display: emKey,
                    url: r.url || "",
                    unified: r.unified || "",
                    category: isCustomServerEmoji ? "Özel Emojiler" : "Yüzler & Duygular",
                    isCustom: isCustomServerEmoji
                });
            } else {
                const prevCat = emojiCatalogMap.get(emKey);
                if (r.emojiId || r.id) prevCat.emojiId = Number(r.emojiId || r.id);
                if (r.url) {
                    prevCat.url = r.url;
                    prevCat.isCustom = true;
                    prevCat.category = "Özel Emojiler";
                }
                if (r.unified) prevCat.unified = r.unified;
            }

            let parsedUsers = extractUsersFromServerReaction(r);
            if (parsedUsers.length === 0 && Array.isArray(existing.users)) {
                parsedUsers = existing.users;
            }

            const isSent = r.isSent !== undefined ? r.isSent : (existing.userReacted || false);
            if (isSent && !parsedUsers.some(u => (typeof u === 'string' ? u : u.username) === localUser)) {
                parsedUsers.unshift({ username: localUser, userId: currentLoggedUserInfo.userId || localInfo.userId, pictureUrl: localInfo.pictureUrl || null });
            }

            localReactionsMap[msgId][emKey] = {
                count: r.count !== undefined ? r.count : (existing.count || 1),
                userReacted: isSent,
                emojiId: resolvedEmojiId,
                url: r.url || existing.url || "",
                unified: r.unified || existing.unified || "",
                users: parsedUsers
            };
        });

        Object.keys(localReactionsMap[msgId]).forEach(k => {
            if (!incomingKeys.has(k)) delete localReactionsMap[msgId][k];
        });
    }

    if (msg.subChannelInfo && msg.subChannelInfo.id > 0) {
        msg.hasSubChannel = true;
        msg.subChannelData = msg.subChannelInfo;
    } else {
        msg.hasSubChannel = false;
        msg.subChannelData = null;
    }
}

function renderReactions(msgId, containerElement = null) {
    const msgIdStr = String(msgId);
    const container = containerElement || document.getElementById(`reactions-container-${msgIdStr}`);
    if (!container) return;

    const reactions = localReactionsMap[msgIdStr] || {};
    const otherKeys = Object.keys(reactions).filter(k => k !== DEFAULT_BLUE_HEART_KEY && reactions[k] && reactions[k].count > 0);
    const orderedKeys = [DEFAULT_BLUE_HEART_KEY, ...otherKeys];

    container.classList.remove('hidden');
    let htmlContent = '';

    orderedKeys.forEach(key => {
        const isBlueHeart = (key === DEFAULT_BLUE_HEART_KEY);
        const data = reactions[key] || {
            count: 0,
            userReacted: false,
            emojiId: 1,
            url: "",
            unified: "1f499",
            users: []
        };

        if (!isBlueHeart && (!data || data.count <= 0)) return;

        let emojiDisplay = key;
        if (data.url) {
            const imgUrl = data.url.startsWith('http') ? data.url : `https://api.meetingchallenge.com${data.url}`;
            emojiDisplay = `<img src="${imgUrl}" class="w-[18px] h-[18px] object-contain" alt="${key}">`;
        } else if (data.unified) {
            try {
                emojiDisplay = data.unified.split('-').map(hex => String.fromCodePoint(parseInt(hex, 16))).join('');
            } catch (e) {}
        }

        const activeClass = data.userReacted
            ? 'bg-mc-primary/25 border-mc-primary/50 text-white shadow-sm'
            : (data.count > 0 ? 'bg-[#232428] border-white/15 text-gray-200 hover:bg-[#35373c]' : 'bg-[#232428]/70 border-white/5 text-gray-400 hover:bg-[#35373c] hover:text-gray-200');

        const safeKey = String(key).replace(/'/g, "\\'");
        const emId = data.emojiId || resolveEmojiIdForReaction(key, data);

        htmlContent += `
            <button type="button" title="Tepki ver / kaldır (Sağ tık: Emojiler listesi)" onclick="toggleReaction('${msgIdStr}', '${safeKey}', event, ${emId})" oncontextmenu="openReactionDetailsModal('${msgIdStr}', '${safeKey}', event); return false;" class="flex items-center justify-center gap-1.5 px-2 py-0.5 rounded-full border transition-all cursor-pointer ${activeClass}">
                <span class="flex items-center justify-center leading-none text-sm">${emojiDisplay}</span>
                <span class="font-bold text-[11px]">${data.count || 0}</span>
            </button>
        `;
    });

    htmlContent += `
        <button type="button" onclick="openReactionDetailsModal('${msgIdStr}', 'ALL', event)" class="flex items-center justify-center gap-1 px-2.5 py-0.5 rounded-full border border-white/10 bg-[#232428]/80 hover:bg-[#35373c] text-gray-400 hover:text-white text-[11px] font-medium transition-colors cursor-pointer" title="Emojiler">
            <span>Emojiler</span>
        </button>
    `;

    container.innerHTML = htmlContent;
}

async function openReactionDetailsModal(msgId, initialTab = 'ALL', e = null) {
    if (e) e.stopPropagation();
    closeAllEmojiPickers();
    activeReactionModalMsgId = String(msgId);
    activeReactionModalTab = initialTab || 'ALL';

    const modal = document.getElementById('reactionDetailsModal');
    if (modal) modal.classList.remove('hidden');

    renderReactionDetailsModalContent();
    await fetchPostReactionUsersFromApi(activeReactionModalMsgId);
}

function closeReactionDetailsModal() {
    activeReactionModalMsgId = null;
    const modal = document.getElementById('reactionDetailsModal');
    if (modal) modal.classList.add('hidden');
}

function selectReactionModalTab(tabKey, e) {
    if (e) e.stopPropagation();
    activeReactionModalTab = tabKey;
    renderReactionDetailsModalContent();
}

async function fetchPostReactionUsersFromApi(msgId) {
    const token = localStorage.getItem('mc_token');
    if (!token || !msgId) return;

    const candidateUrls = [
        `${postBaseUrl}/get-post-emojis?postId=${msgId}`,
        `${postBaseUrl}/get-emoji-users?postId=${msgId}`,
        `${postBaseUrl}/get-post-reactions?postId=${msgId}`
    ];

    for (const url of candidateUrls) {
        try {
            const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
            if (res.ok) {
                const json = await res.json();
                const list = json.data || json;
                if (Array.isArray(list) && list.length > 0) {
                    const reactions = localReactionsMap[String(msgId)] || {};
                    list.forEach(item => {
                        const key = item.key || item.emoji || DEFAULT_BLUE_HEART_KEY;
                        if (reactions[key]) {
                            const extracted = extractUsersFromServerReaction(item);
                            if (extracted.length > 0) reactions[key].users = extracted;
                        }
                    });
                    if (activeReactionModalMsgId === String(msgId)) {
                        renderReactionDetailsModalContent();
                    }
                }
                break;
            }
        } catch (e) {}
    }
}

function renderReactionDetailsModalContent() {
    if (!activeReactionModalMsgId) return;
    const msgIdStr = String(activeReactionModalMsgId);
    const reactions = localReactionsMap[msgIdStr] || {};

    const addedKeys = Object.keys(reactions).filter(k => reactions[k] && reactions[k].count > 0);
    addedKeys.sort((a, b) => (a === DEFAULT_BLUE_HEART_KEY ? -1 : (b === DEFAULT_BLUE_HEART_KEY ? 1 : 0)));

    if (activeReactionModalTab !== 'ALL' && !addedKeys.includes(activeReactionModalTab)) {
        activeReactionModalTab = 'ALL';
    }

    let totalCount = 0;
    addedKeys.forEach(k => { totalCount += (reactions[k]?.count || 0); });

    const tabsEl = document.getElementById('reactionModalTabs');
    const usersListEl = document.getElementById('reactionModalUsersList');
    if (!tabsEl || !usersListEl) return;

    if (addedKeys.length === 0) {
        tabsEl.classList.add('hidden');
        tabsEl.innerHTML = '';
        usersListEl.innerHTML = `
            <div class="text-center text-gray-400 text-xs py-10">
                Bu mesaja henüz hiç emoji eklenmemiş.
            </div>
        `;
        return;
    }

    tabsEl.classList.remove('hidden');
    let tabsHtml = `
        <button type="button" onclick="selectReactionModalTab('ALL', event)" class="px-3 py-1 rounded-lg text-xs font-bold transition-colors shrink-0 ${activeReactionModalTab === 'ALL' ? 'bg-mc-primary text-white' : 'bg-[#1e1f22] text-gray-400 hover:text-white'}">
            Tümü (${totalCount})
        </button>
    `;

    addedKeys.forEach(k => {
        const rData = reactions[k];
        const safeKey = String(k).replace(/'/g, "\\'");
        const visual = renderEmojiItemVisual({ key: k, display: k, url: rData.url, unified: rData.unified });
        const isTabActive = activeReactionModalTab === k;
        tabsHtml += `
            <button type="button" onclick="selectReactionModalTab('${safeKey}', event)" class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold transition-colors shrink-0 ${isTabActive ? 'bg-mc-primary text-white' : 'bg-[#1e1f22] text-gray-300 hover:bg-white/10'}">
                <span>${visual}</span>
                <span>${rData.count}</span>
            </button>
        `;
    });
    tabsEl.innerHTML = tabsHtml;

    const keysToShow = activeReactionModalTab === 'ALL' ? addedKeys : [activeReactionModalTab];
    let rowsHtml = '';

    keysToShow.forEach(k => {
        const rData = reactions[k];
        if (!rData || !rData.count || rData.count <= 0) return;

        const visual = renderEmojiItemVisual({ key: k, display: k, url: rData.url, unified: rData.unified });
        const usersArr = Array.isArray(rData.users) ? rData.users : [];

        usersArr.forEach(u => {
            const uname = typeof u === 'string' ? u : (u.username || 'Kullanıcı');
            const known = findKnownUserByUsername(uname) || {};
            const pic = (typeof u === 'object' && u.pictureUrl) ? u.pictureUrl : known.pictureUrl;
            const avatar = pic
                ? getNextImageUrl(pic, 48)
                : `https://ui-avatars.com/api/?background=1e1f22&color=fff&name=${encodeURIComponent(uname)}`;
            const encodedUname = encodeURIComponent(uname);

            rowsHtml += `
                <div onclick="closeReactionDetailsModal(); openUserProfileByUsername(decodeURIComponent('${encodedUname}'))" class="flex items-center justify-between p-2 rounded-xl bg-[#232428] hover:bg-[#35373c] transition-colors cursor-pointer group">
                    <div class="flex items-center gap-2.5 min-w-0">
                        <img src="${avatar}" class="w-8 h-8 rounded-full object-cover bg-[#1e1f22]">
                        <div class="truncate">
                            <div class="text-sm font-semibold text-white group-hover:underline truncate">${known.fullName || uname}</div>
                            <div class="text-[11px] text-gray-400 truncate">@${uname}</div>
                        </div>
                    </div>
                    <span class="text-lg shrink-0 ml-2">${visual}</span>
                </div>
            `;
        });

        const remainingCount = Math.max(0, (rData.count || 0) - usersArr.length);
        if (remainingCount > 0) {
            rowsHtml += `
                <div class="flex items-center justify-between p-2.5 rounded-xl bg-[#232428]/60 border border-white/5 text-xs text-gray-300">
                    <span>+${remainingCount} kişi</span>
                    <span class="text-base">${visual}</span>
                </div>
            `;
        }
    });

    usersListEl.innerHTML = rowsHtml;
}

function createMessageHTML(msg) {
    const msgIdStr = String(msg.id);
    const isOwnMessage = isMyMessage(msg);
    const knownUser = findKnownUserByUsername(msg.userName) || {};
    const extractedUserId = extractUserIdFromObject(msg, true) || knownUser.userId || null;

    const avatar = msg.pictureUrl
        ? getNextImageUrl(msg.pictureUrl, 48)
        : 'https://ui-avatars.com/api/?background=2b2d31&color=fff&name=' + encodeURIComponent(msg.userName);

    const attachmentHtml = msg.attachmentUrl
        ? `<img src="${getNextImageUrl(msg.attachmentUrl, 640)}" class="chat-image-attachment mt-2" alt="Ek" onclick="event.stopPropagation(); openImageViewer('${msgIdStr}')">`
        : '';

    const smartTime = formatSmartTimestamp(msg.createDate);
    const { replyData, cleanText } = extractReplyInfo(msg);
    const isEdited = localEditedMessagesMap[msgIdStr] !== undefined || msg.isEdited;
    const formattedContent = formatMessageText(cleanText) + (isEdited ? ` <span class="text-[10px] text-gray-400 italic select-none">(düzenlendi)</span>` : '');

    const msgDiv = document.createElement('div');
    msgDiv.id = `msg-${msgIdStr}`;
    msgDiv.className = "flex flex-col hover:bg-[#2b2d31]/80 p-2 -mx-1 rounded-xl transition-colors group relative";

    const safeUserName = (msg.userName || '').replace(/'/g, "\\'");
    const safePicUrl = (msg.pictureUrl || '').replace(/'/g, "\\'");

    let repliedHeaderHtml = '';
    if (replyData && replyData.id) {
        repliedHeaderHtml = `
            <div onclick="focusRepliedMessage('${replyData.id}', event)" class="msg-reply-header flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 mb-1 pl-3 cursor-pointer select-none group/reply">
                <svg class="w-3.5 h-3.5 text-gray-500 group-hover/reply:text-mc-primary shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"/></svg>
                <span class="font-bold text-indigo-400 shrink-0">@${stripEmojis(replyData.userName) || replyData.userName}</span>
                <span class="truncate opacity-85 group-hover/reply:underline">${replyData.snippet}</span>
            </div>
        `;
    }

    const ownButtonsHtml = isOwnMessage ? `
        <button type="button" onclick="startEditMessage('${msgIdStr}', event)" class="p-1.5 text-gray-300 hover:text-white hover:bg-white/10 rounded-lg text-xs flex items-center justify-center transition-colors" title="Mesajı Düzenle">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
        </button>
        <button type="button" onclick="handleDeleteMessage('${msgIdStr}', event)" class="p-1.5 text-gray-300 hover:text-mc-red hover:bg-white/10 rounded-lg text-xs flex items-center justify-center transition-colors" title="Mesajı Sil">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
        </button>
    ` : '';

    let subChannelHtml = '';
    if (msg.hasSubChannel && msg.subChannelData) {
        const safeThreadName = (msg.subChannelData.name || 'Alt Başlık').replace(/'/g, "\\'");
        subChannelHtml = `
            <div class="mt-2 bg-[#1e1f22] border border-white/5 rounded-lg px-3 py-2 cursor-pointer hover:bg-white/5 transition-colors inline-block" onclick="openSubChannelThread(${msg.subChannelData.id}, '${safeThreadName}', event)">
                <div class="flex items-center gap-2 text-xs font-bold text-mc-primary">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"></path></svg>
                    ${msg.subChannelData.name} <span class="text-gray-500 font-normal ml-1">(${msg.subChannelData.messageCount} mesaj)</span>
                </div>
            </div>
        `;
    }

    msgDiv.innerHTML = `
        ${repliedHeaderHtml}
        <div class="flex gap-3 items-start">
            <img src="${avatar}" onclick="event.stopPropagation(); openUserProfileModal(${extractedUserId || 'null'}, '${safeUserName}', '${safePicUrl}')" class="w-10 h-10 rounded-full bg-gray-700 shrink-0 object-cover mt-0.5 cursor-pointer hover:opacity-80 transition-opacity" title="Profili Gör">
            <div class="flex-1 min-w-0">
                <div class="flex items-baseline gap-2">
                    <span onclick="event.stopPropagation(); openUserProfileModal(${extractedUserId || 'null'}, '${safeUserName}', '${safePicUrl}')" class="font-semibold text-[14px] truncate cursor-pointer hover:underline" style="color: ${msg.userNameColor || '#fff'}" title="Kullanıcı Profilini Aç">${msg.userName}</span>
                    <span class="text-[11px] text-gray-400 cursor-help" title="${smartTime.full}">${smartTime.display}</span>
                    ${msg.isOptimistic ? '<span class="optimistic-status text-[10px] text-gray-400 italic">Gönderiliyor...</span>' : ''}
                </div>
                <div class="msg-body-text text-[14px] text-gray-200 whitespace-pre-wrap break-words leading-relaxed mt-0.5">${formattedContent}</div>
                ${attachmentHtml}
                <div id="reactions-container-${msgIdStr}" class="flex flex-wrap items-center gap-1.5 mt-2"></div>
                ${subChannelHtml}
            </div>
        </div>

        <div class="emoji-trigger-btn absolute right-2 -top-2.5 hidden group-hover:flex items-center gap-1 bg-[#232428] border border-white/10 rounded-lg p-1 shadow-xl z-20">
            <button type="button" onclick="setReplyMessage('${msgIdStr}', event)" class="p-1.5 text-gray-300 hover:text-white hover:bg-white/10 rounded-lg text-xs flex items-center justify-center transition-colors" title="Yanıtla">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"/></svg>
            </button>
            <button type="button" onclick="openCreateThreadModal('${msgIdStr}', event)" class="p-1.5 text-gray-300 hover:text-white hover:bg-white/10 rounded-lg text-xs flex items-center justify-center transition-colors" title="Alt Başlık Aç">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"/></svg>
            </button>
            <button type="button" onclick="toggleEmojiPicker('${msgIdStr}', event)" class="p-1.5 text-gray-300 hover:text-white hover:bg-white/10 rounded-lg text-xs flex items-center justify-center transition-colors" title="Emoji Ekle">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" x2="9.01" y1="9" y2="9"/><line x1="15" x2="15.01" y1="9" y2="9"/></svg>
            </button>
            <button type="button" onclick="openReactionDetailsModal('${msgIdStr}', 'ALL', event)" class="p-1.5 text-gray-300 hover:text-white hover:bg-white/10 rounded-lg text-xs flex items-center justify-center transition-colors" title="Emojiler">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
            </button>
            ${ownButtonsHtml}
        </div>

        <!-- Kategorili Emoji Seçici Popover -->
        <div id="emoji-picker-${msgIdStr}" class="emoji-picker-popover hidden absolute right-2 top-7 bg-[#232428] border border-white/15 p-3 rounded-xl shadow-2xl z-30 w-64 max-h-64 overflow-y-auto" onclick="event.stopPropagation()">
            ${buildCategorizedReactionPickerHTML(msgIdStr)}
        </div>
    `;

    renderReactions(msgIdStr, msgDiv.querySelector(`#reactions-container-${CSS.escape(msgIdStr)}`));
    return msgDiv;
}

function appendChatMessages(messages) {
    const container = document.getElementById('chatMessages');
    if (container.innerHTML.includes('henüz mesaj yok') || container.innerHTML.includes('oldukça sessiz')) {
        container.innerHTML = '';
    }
    messages.forEach(msg => {
        if (!document.getElementById(`msg-${msg.id}`)) {
            container.appendChild(createMessageHTML(msg));
        }
    });
}

function prependChatMessages(messages) {
    const container = document.getElementById('chatMessages');
    const fragment = document.createDocumentFragment();
    messages.forEach(msg => {
        if (!document.getElementById(`msg-${msg.id}`)) {
            fragment.appendChild(createMessageHTML(msg));
        }
    });
    container.insertBefore(fragment, container.firstChild);
}