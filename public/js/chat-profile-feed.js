// ==========================================
// 👤 PROFİL MODALI, GÖNDERİLER & BAHSEDİLMELER, ZOOM DESTEKLİ DETAY EKRANI VE MODAL GEÇMİŞİ (BACK STACK)
// ==========================================

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
    viewerSource: 'profile', // 'profile' | 'channel'
    viewerList: [],
    viewerIndex: -1,
    viewerLoadingNext: false
};

// --- MODAL GEÇMİŞİ YIĞINI (GERİ DÖNÜŞ SİSTEMİ) ---
let modalNavigationHistory = [];
let isNavigatingBackInModals = false;

// --- DETAY GÖRSELİ ZOOM & SÜRÜKLEME (PAN) DURUMU ---
let detailImageZoomState = {
    scale: 1,
    posX: 0,
    posY: 0,
    isDragging: false,
    startX: 0,
    startY: 0
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

    const localNameEl = document.getElementById('localUserName');
    if (localNameEl) localNameEl.innerText = displayUsername;
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

        if (myApiData.city) {
            currentLoggedUserInfo.city = myApiData.city;
            if (typeof mapCityNameToId === 'function' && typeof selectedEventCityId !== 'undefined' && !selectedEventCityId) {
                selectedEventCityId = mapCityNameToId(myApiData.city);
            }
        }

        localStorage.setItem('mc_username', apiUname);
        if (localNameEl) localNameEl.innerText = apiUname;
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
    modalNavigationHistory = [];
    const username = currentLoggedUserInfo.username || localStorage.getItem('mc_username');
    const info = findKnownUserByUsername(username) || {};
    openUserProfileModal(
        currentLoggedUserInfo.userId || info.userId || null,
        username,
        currentLoggedUserInfo.pictureUrl || info.pictureUrl || null,
        true
    );
}

async function openUserProfileByUsername(rawUsername, preserveHistory = false) {
    if (!rawUsername) return;
    if (!preserveHistory) modalNavigationHistory = [];

    const cleanInput = String(rawUsername).trim().replace(/^@+/, '');
    const strippedTarget = stripEmojis(cleanInput).toLowerCase();
    if (!cleanInput) return;

    const myNames = [
        currentLoggedUserInfo.username,
        currentLoggedUserInfo.jwtUserName,
        localStorage.getItem('mc_username')
    ].filter(Boolean).map(s => stripEmojis(s).toLowerCase());

    if (myNames.includes(strippedTarget)) {
        const username = currentLoggedUserInfo.username || localStorage.getItem('mc_username');
        const info = findKnownUserByUsername(username) || {};
        openUserProfileModal(
            currentLoggedUserInfo.userId || info.userId || null,
            username,
            currentLoggedUserInfo.pictureUrl || info.pictureUrl || null,
            true
        );
        return;
    }

    const info = findKnownUserByUsername(cleanInput) || {};
    let resolvedId = info.userId || null;
    let resolvedPic = info.pictureUrl || null;
    let canonicalName = info.username || cleanInput;

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

// ==========================================
// 🔙 MODAL GEÇMİŞİ VE GERİ DÖNÜŞ YÖNETİCİSİ
// ==========================================

function renderProfileModalBackButton() {
    const modal = document.getElementById('userProfileModal');
    if (!modal) return;

    let backBtn = document.getElementById('profileModalHistoryBackBtn');
    const hasHistory = modalNavigationHistory.length > 0;

    if (!hasHistory) {
        if (backBtn) backBtn.classList.add('hidden');
        return;
    }

    const innerCard = modal.querySelector('.relative, .bg-\\[\\#2b2d31\\], .bg-\\[\\#1e1f22\\]') || modal.firstElementChild;
    if (!innerCard) return;

    if (!backBtn) {
        backBtn = document.createElement('button');
        backBtn.id = 'profileModalHistoryBackBtn';
        backBtn.type = 'button';
        backBtn.onclick = (e) => {
            e.stopPropagation();
            navigateBackFromProfileModal();
        };
        innerCard.appendChild(backBtn);
    }

    backBtn.className = 'absolute top-3 left-3 z-30 flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-black/60 hover:bg-mc-primary text-gray-100 hover:text-white text-xs font-bold border border-white/15 shadow-lg backdrop-blur-sm transition-all cursor-pointer';
    backBtn.innerHTML = `
        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/>
        </svg>
        <span>Geri</span>
    `;
    backBtn.classList.remove('hidden');
}

async function navigateBackFromProfileModal() {
    const profileModal = document.getElementById('userProfileModal');
    if (profileModal) profileModal.classList.add('hidden');

    if (modalNavigationHistory.length === 0) return;

    isNavigatingBackInModals = true;
    const prevState = modalNavigationHistory.pop();

    try {
        if (prevState.type === 'detail_viewer') {
            // Önce varsa arkasındaki gönderi listesi durumunu geri yükle
            if (prevState.feedSnapshot) {
                Object.assign(profilePostsState, prevState.feedSnapshot);
                if (prevState.wasFeedModalOpen) {
                    const feedModal = ensureUserPostsFeedModalDOM();
                    document.getElementById('feedModalUserAvatar').src = profilePostsState.pictureUrl || '';
                    document.getElementById('feedModalUserFullName').innerText = profilePostsState.fullName || profilePostsState.username;
                    document.getElementById('feedModalUserHandle').innerText = `@${stripEmojis(profilePostsState.username) || profilePostsState.username}`;
                    updateProfileFeedTabUI();
                    updateProfileMediaFilterUI();
                    renderProfilePostsList();
                }
            }
            profilePostsState.viewerSource = prevState.viewerSource;
            profilePostsState.viewerList = prevState.viewerList;
            profilePostsState.viewerIndex = prevState.viewerIndex;

            const detailModal = ensureProfilePostDetailModalDOM();
            detailModal.classList.remove('hidden');
            document.removeEventListener('keydown', handleProfileDetailKeyDown);
            document.addEventListener('keydown', handleProfileDetailKeyDown);
            renderProfilePostDetailViewer();
        } else if (prevState.type === 'feed_modal') {
            Object.assign(profilePostsState, prevState.feedSnapshot);
            const feedModal = ensureUserPostsFeedModalDOM();
            document.getElementById('feedModalUserAvatar').src = profilePostsState.pictureUrl || '';
            document.getElementById('feedModalUserFullName').innerText = profilePostsState.fullName || profilePostsState.username;
            document.getElementById('feedModalUserHandle').innerText = `@${stripEmojis(profilePostsState.username) || profilePostsState.username}`;
            updateProfileFeedTabUI();
            updateProfileMediaFilterUI();
            renderProfilePostsList();
            feedModal.classList.remove('hidden');
        } else if (prevState.type === 'profile_modal') {
            await openUserProfileModal(prevState.userId, prevState.username, prevState.pictureUrl, prevState.isSelf);
        }
    } finally {
        isNavigatingBackInModals = false;
        renderProfileModalBackButton();
    }
}

// Detay ekranından veya gönderi listesinden bir kullanıcının profiline tıklanınca mevcut modalları kapatıp geçmişe kaydeder
function openUserProfileFromPostViewer(rawUsername, userId = null, pictureUrl = null, e = null) {
    if (e) e.stopPropagation();
    if (!rawUsername) return;

    const detailModal = document.getElementById('profilePostDetailModal');
    const feedModal = document.getElementById('userPostsFeedModal');

    const wasDetailOpen = Boolean(detailModal && !detailModal.classList.contains('hidden'));
    const wasFeedOpen = Boolean(feedModal && !feedModal.classList.contains('hidden'));

    if (wasDetailOpen) {
        modalNavigationHistory.push({
            type: 'detail_viewer',
            viewerSource: profilePostsState.viewerSource,
            viewerList: [...profilePostsState.viewerList],
            viewerIndex: profilePostsState.viewerIndex,
            wasFeedModalOpen: wasFeedOpen,
            feedSnapshot: {
                userId: profilePostsState.userId,
                username: profilePostsState.username,
                fullName: profilePostsState.fullName,
                pictureUrl: profilePostsState.pictureUrl,
                activeTab: profilePostsState.activeTab,
                selectedChannelId: profilePostsState.selectedChannelId,
                mediaFilter: profilePostsState.mediaFilter,
                lastPostId: profilePostsState.lastPostId,
                hasMore: profilePostsState.hasMore,
                posts: [...profilePostsState.posts]
            }
        });
        detailModal.classList.add('hidden');
        document.removeEventListener('keydown', handleProfileDetailKeyDown);
    } else if (wasFeedOpen) {
        modalNavigationHistory.push({
            type: 'feed_modal',
            feedSnapshot: {
                userId: profilePostsState.userId,
                username: profilePostsState.username,
                fullName: profilePostsState.fullName,
                pictureUrl: profilePostsState.pictureUrl,
                activeTab: profilePostsState.activeTab,
                selectedChannelId: profilePostsState.selectedChannelId,
                mediaFilter: profilePostsState.mediaFilter,
                lastPostId: profilePostsState.lastPostId,
                hasMore: profilePostsState.hasMore,
                posts: [...profilePostsState.posts]
            }
        });
    }

    if (feedModal) feedModal.classList.add('hidden');

    if (userId) {
        openUserProfileModal(userId, rawUsername, pictureUrl, false);
    } else {
        openUserProfileByUsername(rawUsername, true);
    }
}

async function fetchUserInfoFromApi(targetUserId, targetUsername = null, isSelfRequest = false) {
    const token = localStorage.getItem('mc_token');
    if (!token) return null;

    const headers = { 'accept': 'application/json', 'authorization': `Bearer ${token}`, 'lang': 'tr' };
    const candidateUrls = [];

    if (targetUserId && Number(targetUserId) > 0) {
        candidateUrls.push(`https://api.meetingchallenge.com/User/get-user-info?userId=${encodeURIComponent(targetUserId)}`);
        if (typeof userApiUrl !== 'undefined') {
            candidateUrls.push(`${userApiUrl}?userId=${encodeURIComponent(targetUserId)}`);
        }
    }
    if (targetUsername && !targetUserId) {
        const cleanU = String(targetUsername).trim().replace(/^@+/, '');
        if (typeof userApiUrl !== 'undefined') {
            candidateUrls.push(`${userApiUrl}?userName=${encodeURIComponent(cleanU)}`);
            candidateUrls.push(`${userApiUrl}?username=${encodeURIComponent(cleanU)}`);
        }
        if (typeof apiRootUrl !== 'undefined') {
            candidateUrls.push(`${apiRootUrl}/User/get-user-by-username?userName=${encodeURIComponent(cleanU)}`);
        }
    }
    if (isSelfRequest && candidateUrls.length === 0 && typeof userApiUrl !== 'undefined') {
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
                const flat = typeof flattenChannelsFromApi === 'function' ? flattenChannelsFromApi(json.data) : json.data;
                profilePostsState.channelsCache = flat;
                if (typeof globalChannels !== 'undefined' && (!globalChannels || globalChannels.length === 0)) {
                    globalChannels = flat;
                }
                return flat;
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
    if (!btnWrapper) {
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
    }

    if (rolesEl && rolesEl.parentElement) {
        const rolesSection = rolesEl.parentElement;
        if (rolesSection.nextElementSibling !== btnWrapper) {
            rolesSection.insertAdjacentElement('afterend', btnWrapper);
        }
    } else if (extraFieldsEl) {
        extraFieldsEl.insertAdjacentElement('afterend', btnWrapper);
    } else if (bioWrapper) {
        bioWrapper.insertAdjacentElement('afterend', btnWrapper);
    } else if (usernameEl && usernameEl.parentElement) {
        usernameEl.parentElement.appendChild(btnWrapper);
    } else {
        const innerCard = modal.querySelector('div > div') || modal.firstElementChild;
        if (innerCard && !innerCard.contains(btnWrapper)) innerCard.appendChild(btnWrapper);
    }
}

function initProfileModalButtonsObserver() {
    const attach = () => {
        const modal = document.getElementById('userProfileModal');
        if (!modal || modal._hasFeedButtonsObserver) return;
        modal._hasFeedButtonsObserver = true;

        injectProfileFeedActionButtons();

        const observer = new MutationObserver(() => {
            if (!modal.classList.contains('hidden')) {
                if (!document.getElementById('profileOpenFeedButtonsWrapper')) {
                    injectProfileFeedActionButtons();
                }
                renderProfileModalBackButton();
            }
        });
        observer.observe(modal, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true });
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', attach);
    } else {
        attach();
    }
    window.addEventListener('load', attach);
}
initProfileModalButtonsObserver();

// --- BAĞIMSIZ AÇILIR MODAL: GÖNDERİLER & BAHSEDİLMELER LİSTESİ ---
function ensureUserPostsFeedModalDOM() {
    let modal = document.getElementById('userPostsFeedModal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'userPostsFeedModal';
    modal.className = 'hidden fixed inset-0 z-[130] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4';
    modal.onclick = (e) => {
        if (e.target === modal) closeUserPostsFeedModal(true);
    };

    modal.innerHTML = `
        <div class="bg-[#1e1f22] border border-white/10 rounded-2xl w-full max-w-2xl max-h-[86vh] flex flex-col shadow-2xl overflow-hidden" onclick="event.stopPropagation()">
            <!-- Modal Üst Başlık -->
            <div class="flex items-center justify-between px-4 py-3.5 bg-[#111214] border-b border-white/10 shrink-0">
                <div class="flex items-center gap-2.5 min-w-0">
                    <button type="button" onclick="closeUserPostsFeedModal(true)" class="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-mc-primary text-gray-200 hover:text-white text-xs font-bold border border-white/10 transition-colors cursor-pointer shrink-0" title="Profile Geri Dön">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/>
                        </svg>
                        <span>Profile Dön</span>
                    </button>
                    <img id="feedModalUserAvatar" src="" onclick="closeUserPostsFeedModal(true)" class="w-9 h-9 rounded-full object-cover bg-gray-700 border border-white/10 shrink-0 cursor-pointer hover:opacity-80">
                    <div class="min-w-0 cursor-pointer" onclick="closeUserPostsFeedModal(true)">
                        <div id="feedModalUserFullName" class="text-sm font-bold text-white hover:underline truncate">Kullanıcı</div>
                        <div id="feedModalUserHandle" class="text-[11px] text-gray-400 truncate">@kullanici</div>
                    </div>
                </div>
                <button type="button" onclick="closeUserPostsFeedModal(false)" class="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors cursor-pointer" title="Tamamen Kapat">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
                    </svg>
                </button>
            </div>

            <!-- Sekmeler ve Filtreler -->
            <div class="p-3.5 bg-[#18191c] border-b border-white/10 space-y-2.5 shrink-0">
                <div class="flex items-center gap-1.5 bg-[#111214] p-1 rounded-xl border border-white/5">
                    <button type="button" id="profileTabPostsBtn" onclick="switchProfileFeedTab('posts')" class="flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all bg-mc-primary text-white shadow cursor-pointer">
                        📝 Gönderiler
                    </button>
                    <button type="button" id="profileTabMentionsBtn" onclick="switchProfileFeedTab('mentions')" class="flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all text-gray-400 hover:text-white cursor-pointer">
                        🏷️ Bahsedilmeler
                    </button>
                </div>

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

// ==========================================
// 🔍 GÖRSEL ZOOM VE SÜRÜKLEME (PAN) FONKSİYONLARI
// ==========================================

function resetDetailImageZoom() {
    detailImageZoomState.scale = 1;
    detailImageZoomState.posX = 0;
    detailImageZoomState.posY = 0;
    detailImageZoomState.isDragging = false;
    applyDetailImageZoomTransform();
}

function adjustDetailImageZoom(delta, e = null) {
    if (e) e.stopPropagation();
    const nextScale = Math.min(4, Math.max(1, Number((detailImageZoomState.scale + delta).toFixed(2))));
    detailImageZoomState.scale = nextScale;
    if (nextScale <= 1) {
        detailImageZoomState.posX = 0;
        detailImageZoomState.posY = 0;
    }
    applyDetailImageZoomTransform();
}

function applyDetailImageZoomTransform() {
    const imgEl = document.getElementById('profileDetailImage');
    const zoomBadgeEl = document.getElementById('profileDetailZoomLevelBtn');
    const leftPane = document.getElementById('profileDetailLeftPane');

    if (zoomBadgeEl) {
        zoomBadgeEl.innerText = `${Math.round(detailImageZoomState.scale * 100)}%`;
    }
    if (!imgEl) return;

    imgEl.style.transform = `translate(${detailImageZoomState.posX}px, ${detailImageZoomState.posY}px) scale(${detailImageZoomState.scale})`;
    if (leftPane) {
        leftPane.style.cursor = detailImageZoomState.scale > 1
            ? (detailImageZoomState.isDragging ? 'grabbing' : 'grab')
            : 'zoom-in';
    }
}

function initDetailImageZoomInteractions(leftPane, imgEl) {
    if (!leftPane || !imgEl || leftPane._zoomInitialized) return;
    leftPane._zoomInitialized = true;

    // Fare tekerleği (Wheel) ile zoom
    leftPane.addEventListener('wheel', (e) => {
        if (imgEl.classList.contains('hidden')) return;
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.25 : -0.25;
        adjustDetailImageZoom(delta);
    }, { passive: false });

    // Çift tıklama ile 1x <-> 2.25x hızlı geçiş
    leftPane.addEventListener('dblclick', (e) => {
        if (e.target.closest('button') || e.target.closest('a') || imgEl.classList.contains('hidden')) return;
        e.preventDefault();
        if (detailImageZoomState.scale > 1) {
            resetDetailImageZoom();
        } else {
            detailImageZoomState.scale = 2.25;
            applyDetailImageZoomTransform();
        }
    });

    // Yakınlaştırılmış resmi fareyle sürükleme (Pan)
    leftPane.addEventListener('mousedown', (e) => {
        if (e.target.closest('button') || e.target.closest('a') || detailImageZoomState.scale <= 1) return;
        e.preventDefault();
        detailImageZoomState.isDragging = true;
        detailImageZoomState.startX = e.clientX - detailImageZoomState.posX;
        detailImageZoomState.startY = e.clientY - detailImageZoomState.posY;
        imgEl.style.transition = 'none';
        applyDetailImageZoomTransform();
    });

    window.addEventListener('mousemove', (e) => {
        if (!detailImageZoomState.isDragging) return;
        detailImageZoomState.posX = e.clientX - detailImageZoomState.startX;
        detailImageZoomState.posY = e.clientY - detailImageZoomState.startY;
        applyDetailImageZoomTransform();
    });

    window.addEventListener('mouseup', () => {
        if (!detailImageZoomState.isDragging) return;
        detailImageZoomState.isDragging = false;
        if (imgEl) imgEl.style.transition = 'transform 0.15s ease-out';
        applyDetailImageZoomTransform();
    });
}

// --- BİRLEŞİK GÖNDERİ DETAY & BÜYÜK RESİM GÖRÜNTÜLEYİCİ (ZOOM + SINIRSIZ ÖNCEKİ / SONRAKİ + PROFİL TIKLAMA) ---
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

        <!-- Ana Kart: Sol Görsel (Zoom Destekli), Sağ Detay/Yazı/Alt Başlık/Tepkiler -->
        <div class="bg-[#1e1f22] border border-white/15 rounded-2xl w-full max-w-5xl h-[86vh] flex flex-col md:flex-row overflow-hidden shadow-2xl relative" onclick="event.stopPropagation()">
            
            <!-- Sol Bölüm: Büyük Görsel & Zoom Kontrolleri veya Metin Odaklı Görünüm -->
            <div id="profileDetailLeftPane" class="flex-1 bg-black/95 flex items-center justify-center relative overflow-hidden min-h-[280px] select-none">
                <img id="profileDetailImage" src="" draggable="false" class="max-w-full max-h-full object-contain select-none transition-transform duration-150 ease-out" alt="Gönderi Görseli">
                
                <!-- Zoom Kontrol Çubuğu & Orijinal Boyutta Aç -->
                <div id="profileDetailZoomControls" class="hidden absolute bottom-3 left-3 right-3 flex items-center justify-between gap-2 pointer-events-none z-20">
                    <div class="flex items-center gap-1 bg-black/80 border border-white/15 rounded-xl p-1 backdrop-blur-md pointer-events-auto shadow-lg">
                        <button type="button" onclick="adjustDetailImageZoom(-0.35, event)" class="w-7 h-7 rounded-lg hover:bg-white/15 text-gray-200 hover:text-white flex items-center justify-center font-bold text-base transition-colors cursor-pointer" title="Uzaklaştır (-)">−</button>
                        <button type="button" id="profileDetailZoomLevelBtn" onclick="resetDetailImageZoom()" class="px-2 h-7 rounded-lg hover:bg-white/15 text-gray-200 hover:text-white text-[11px] font-bold transition-colors cursor-pointer" title="Yakınlaştırmayı Sıfırla (Çift Tık)">100%</button>
                        <button type="button" onclick="adjustDetailImageZoom(0.35, event)" class="w-7 h-7 rounded-lg hover:bg-white/15 text-gray-200 hover:text-white flex items-center justify-center font-bold text-base transition-colors cursor-pointer" title="Yakınlaştır (+)">+</button>
                    </div>

                    <a id="profileDetailOpenOriginalImg" href="#" target="_blank" rel="noopener noreferrer" class="pointer-events-auto px-2.5 py-1.5 rounded-xl bg-black/80 hover:bg-mc-primary text-gray-200 hover:text-white text-[11px] font-semibold border border-white/15 flex items-center gap-1.5 backdrop-blur-md transition-colors shadow-lg">
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
                        <span>Orijinal Aç</span>
                    </a>
                </div>

                <div id="profileDetailNoImagePlaceholder" class="hidden p-8 text-center max-w-lg">
                    <div class="w-14 h-14 rounded-2xl bg-mc-primary/15 border border-mc-primary/30 text-indigo-400 flex items-center justify-center mx-auto mb-3">
                        <svg class="w-7 h-7" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"/></svg>
                    </div>
                    <div id="profileDetailLargeTextQuote" class="text-base sm:text-lg text-gray-100 font-medium leading-relaxed whitespace-pre-wrap break-words"></div>
                </div>
            </div>

            <!-- Sağ Bölüm: Gönderi Sahibi, Kanal, Açıklama, Alt Başlık (Thread) ve Butonlar -->
            <div class="w-full md:w-[370px] lg:w-[400px] bg-[#18191c] border-t md:border-t-0 md:border-l border-white/10 flex flex-col shrink-0">
                <div class="p-3.5 bg-[#111214] border-b border-white/10 flex items-center justify-between gap-2">
                    <div id="profileDetailAuthorClickArea" class="flex items-center gap-2.5 min-w-0 cursor-pointer group/author" title="Kullanıcı Profilini Aç">
                        <img id="profileDetailUserAvatar" src="" class="w-9 h-9 rounded-full object-cover bg-gray-700 shrink-0 group-hover/author:ring-2 group-hover/author:ring-mc-primary transition-all">
                        <div class="min-w-0">
                            <div id="profileDetailUserName" class="text-xs font-bold text-white group-hover/author:text-mc-primary group-hover/author:underline truncate transition-colors">Kullanıcı</div>
                            <div id="profileDetailTime" class="text-[11px] text-gray-400 truncate">Tarih</div>
                        </div>
                    </div>
                    <div class="flex items-center gap-1.5 shrink-0">
                        <span id="profileDetailCounterBadge" class="text-[11px] font-bold px-2 py-0.5 rounded-md bg-white/5 text-gray-300 border border-white/10">1 / 20</span>
                        <button type="button" onclick="closeProfilePostDetailViewer()" class="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors cursor-pointer" title="Geri / Kapat (Esc)">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
                        </button>
                    </div>
                </div>

                <div class="px-3.5 py-2 bg-[#141518] border-b border-white/5 flex items-center justify-between gap-2">
                    <span id="profileDetailChannelBadge" class="text-[11px] font-bold text-indigo-400 truncate">#Kanal</span>
                </div>

                <div class="flex-1 overflow-y-auto p-4 space-y-3.5 custom-scrollbar">
                    <div id="profileDetailContentText" class="text-sm text-gray-100 whitespace-pre-wrap break-words leading-relaxed"></div>
                    
                    <div id="profileDetailMentionsBox" class="hidden pt-2 border-t border-white/5">
                        <div class="text-[10px] font-bold text-gray-400 uppercase mb-1.5">Bahsedilenler</div>
                        <div id="profileDetailMentionsList" class="flex flex-wrap gap-1.5"></div>
                    </div>

                    <div id="profileDetailSubChannelBox" class="hidden pt-2 border-t border-white/10">
                        <div class="text-[10px] font-bold text-indigo-400 uppercase mb-1.5 flex items-center gap-1">
                            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"/></svg>
                            <span>Alt Başlık (Thread) Açılmış</span>
                        </div>
                        <div id="profileDetailSubChannelCard" class="p-3 rounded-xl bg-[#111214] border border-mc-primary/40 hover:border-mc-primary transition-all cursor-pointer"></div>
                    </div>

                    <!-- Mesaj Tepkileri (Reactions) -->
                    <div id="profileDetailReactionsSection" class="pt-2 border-t border-white/10">
                        <div id="profileDetailReactionsContainer" class="flex flex-wrap items-center gap-1.5"></div>
                    </div>
                </div>

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

    const leftPane = document.getElementById('profileDetailLeftPane');
    const imgEl = document.getElementById('profileDetailImage');
    initDetailImageZoomInteractions(leftPane, imgEl);

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
    } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        adjustDetailImageZoom(0.3);
    } else if (e.key === '-') {
        e.preventDefault();
        adjustDetailImageZoom(-0.3);
    } else if (e.key === '0') {
        e.preventDefault();
        resetDetailImageZoom();
    }
}

function getActiveViewerList() {
    if (profilePostsState.viewerSource === 'channel') {
        return profilePostsState.viewerList || [];
    }
    return getFilteredProfilePosts();
}

// Profilden (Gönderiler / Bahsedilmeler) bir posta tıklanınca açar
function openProfilePostDetailViewer(postId, e = null) {
    if (e) e.stopPropagation();

    profilePostsState.viewerSource = 'profile';
    const filtered = getFilteredProfilePosts();
    const idx = filtered.findIndex(p => Number(p.id) === Number(postId));
    if (idx === -1) return;

    profilePostsState.viewerList = filtered;
    profilePostsState.viewerIndex = idx;

    // Arkadaki Gönderiler/Bahsedilmeler modalını gizle, detay kapatılınca geri açılacak
    const feedModal = document.getElementById('userPostsFeedModal');
    const wasFeedOpen = Boolean(feedModal && !feedModal.classList.contains('hidden'));
    if (wasFeedOpen) {
        modalNavigationHistory.push({
            type: 'feed_modal',
            feedSnapshot: {
                userId: profilePostsState.userId,
                username: profilePostsState.username,
                fullName: profilePostsState.fullName,
                pictureUrl: profilePostsState.pictureUrl,
                activeTab: profilePostsState.activeTab,
                selectedChannelId: profilePostsState.selectedChannelId,
                mediaFilter: profilePostsState.mediaFilter,
                lastPostId: profilePostsState.lastPostId,
                hasMore: profilePostsState.hasMore,
                posts: [...profilePostsState.posts]
            }
        });
        feedModal.classList.add('hidden');
    }

    const modal = ensureProfilePostDetailModalDOM();
    modal.classList.remove('hidden');

    document.removeEventListener('keydown', handleProfileDetailKeyDown);
    document.addEventListener('keydown', handleProfileDetailKeyDown);

    renderProfilePostDetailViewer();
}

// Kanal içi sohbetteki bir resme/posta tıklanınca da AYNI detay ekranını açar
function openUnifiedChannelPostViewer(msgId, e = null) {
    if (e) e.stopPropagation();

    if (typeof updateImageGallery === 'function') updateImageGallery();
    const list = Array.isArray(imageGalleryList) && imageGalleryList.length > 0
        ? imageGalleryList
        : Array.from(messagesMap.values());

    const idx = list.findIndex(m => String(m.id) === String(msgId));
    if (idx === -1) return;

    modalNavigationHistory = [];
    profilePostsState.viewerSource = 'channel';
    profilePostsState.viewerList = list;
    profilePostsState.viewerIndex = idx;

    const modal = ensureProfilePostDetailModalDOM();
    modal.classList.remove('hidden');

    document.removeEventListener('keydown', handleProfileDetailKeyDown);
    document.addEventListener('keydown', handleProfileDetailKeyDown);

    renderProfilePostDetailViewer();
}

function closeProfilePostDetailViewer(clearAllHistory = false) {
    const modal = document.getElementById('profilePostDetailModal');
    if (modal) modal.classList.add('hidden');
    document.removeEventListener('keydown', handleProfileDetailKeyDown);
    resetDetailImageZoom();

    if (clearAllHistory) {
        modalNavigationHistory = [];
        return;
    }

    // Eğer Gönderiler/Bahsedilmeler listesinden gelindiyse listeyi geri aç
    if (modalNavigationHistory.length > 0) {
        const lastItem = modalNavigationHistory[modalNavigationHistory.length - 1];
        if (lastItem && lastItem.type === 'feed_modal') {
            modalNavigationHistory.pop();
            Object.assign(profilePostsState, lastItem.feedSnapshot);
            const feedModal = ensureUserPostsFeedModalDOM();
            feedModal.classList.remove('hidden');
        }
    }
}

// Önceki / Sonraki Sınırsız Gezinme Fonksiyonu
async function navigateProfilePostViewer(direction, e = null) {
    if (e) e.stopPropagation();
    if (profilePostsState.viewerLoadingNext) return;

    // Kanal sohbetinden açıldıysa:
    if (profilePostsState.viewerSource === 'channel') {
        let list = getActiveViewerList();
        const targetIdx = profilePostsState.viewerIndex + direction;

        if (targetIdx < 0) {
            if (typeof hasMoreOlderMessages !== 'undefined' && hasMoreOlderMessages && typeof fetchOlderMessages === 'function') {
                const currentFirstId = list[0]?.id;
                profilePostsState.viewerLoadingNext = true;
                const fetched = await fetchOlderMessages();
                profilePostsState.viewerLoadingNext = false;
                if (fetched && typeof updateImageGallery === 'function') {
                    updateImageGallery();
                    profilePostsState.viewerList = imageGalleryList;
                    const newIdx = imageGalleryList.findIndex(m => String(m.id) === String(currentFirstId));
                    if (newIdx > 0) {
                        profilePostsState.viewerIndex = newIdx - 1;
                        renderProfilePostDetailViewer();
                    }
                }
            }
            return;
        }
        if (targetIdx >= list.length) return;
        profilePostsState.viewerIndex = targetIdx;
        renderProfilePostDetailViewer();
        return;
    }

    // Profil Gönderiler / Bahsedilmeler listesinden açıldıysa:
    let filtered = getFilteredProfilePosts();
    const targetIdx = profilePostsState.viewerIndex + direction;

    if (targetIdx < 0) return;

    if (targetIdx >= filtered.length) {
        if (!profilePostsState.hasMore) return;

        profilePostsState.viewerLoadingNext = true;
        const nextTextEl = document.getElementById('profileDetailBottomNextText');
        if (nextTextEl) nextTextEl.innerText = 'Yükleniyor...';

        let guard = 0;
        while (targetIdx >= getFilteredProfilePosts().length && profilePostsState.hasMore && guard < 4) {
            guard++;
            await fetchProfilePostsBatch(false);
        }

        profilePostsState.viewerLoadingNext = false;
        if (nextTextEl) nextTextEl.innerText = 'Sonraki →';

        filtered = getFilteredProfilePosts();
        profilePostsState.viewerList = filtered;
        if (targetIdx >= filtered.length) {
            renderProfilePostDetailViewer();
            return;
        }
    }

    profilePostsState.viewerIndex = targetIdx;
    renderProfilePostDetailViewer();
}

async function renderProfilePostDetailViewer() {
    const activeList = getActiveViewerList();
    const post = activeList[profilePostsState.viewerIndex];
    if (!post) return;

    resetDetailImageZoom();

    const imgEl = document.getElementById('profileDetailImage');
    const zoomControlsEl = document.getElementById('profileDetailZoomControls');
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
        if (zoomControlsEl) zoomControlsEl.classList.remove('hidden');
        openOrigEl.href = directUrl;
        openOrigEl.classList.remove('hidden');
        noImgEl.classList.add('hidden');
    } else {
        imgEl.src = '';
        imgEl.classList.add('hidden');
        if (zoomControlsEl) zoomControlsEl.classList.add('hidden');
        openOrigEl.classList.add('hidden');
        noImgEl.classList.remove('hidden');
        largeQuoteEl.innerHTML = formattedContent || '<span class="text-gray-500 italic">Metin içeriği yok</span>';
    }

    const postAuthorName = post.userName || post.username || 'Kullanıcı';
    const postAuthorId = typeof extractUserIdFromObject === 'function' ? extractUserIdFromObject(post, true) : (post.userId || null);
    const avatar = post.pictureUrl
        ? getNextImageUrl(post.pictureUrl, 128)
        : `https://ui-avatars.com/api/?background=2b2d31&color=fff&name=${encodeURIComponent(postAuthorName)}`;

    document.getElementById('profileDetailUserAvatar').src = avatar;
    const userNameEl = document.getElementById('profileDetailUserName');
    userNameEl.innerText = postAuthorName;
    userNameEl.style.color = post.userNameColor || '#ffffff';

    // Gönderi sahibinin adına veya resmine tıklanınca mevcut modalı kapatıp profilini aç (Geri dönülebilir)
    const authorClickArea = document.getElementById('profileDetailAuthorClickArea');
    if (authorClickArea) {
        authorClickArea.onclick = (ev) => {
            openUserProfileFromPostViewer(postAuthorName, postAuthorId, post.pictureUrl || null, ev);
        };
    }

    const smartTime = typeof formatSmartTimestamp === 'function'
        ? formatSmartTimestamp(post.createDate)
        : { display: new Date(post.createDate).toLocaleString('tr-TR'), full: post.createDate };

    const timeEl = document.getElementById('profileDetailTime');
    timeEl.innerText = smartTime.full || smartTime.display;

    const breadcrumb = resolvePostChannelBreadcrumb(post);
    document.getElementById('profileDetailChannelBadge').innerText = breadcrumb;

    const hasMoreFlag = profilePostsState.viewerSource === 'profile' ? profilePostsState.hasMore : false;
    document.getElementById('profileDetailCounterBadge').innerText =
        `${profilePostsState.viewerIndex + 1} / ${activeList.length}${hasMoreFlag ? '+' : ''}`;

    const contentEl = document.getElementById('profileDetailContentText');
    contentEl.innerHTML = formattedContent || '<span class="text-gray-500 italic text-xs">Görsel paylaşımı (Açıklama yok)</span>';

    const mentionsBox = document.getElementById('profileDetailMentionsBox');
    const mentionsListEl = document.getElementById('profileDetailMentionsList');
    if (Array.isArray(post.mentionList) && post.mentionList.length > 0) {
        mentionsBox.classList.remove('hidden');
        mentionsListEl.innerHTML = post.mentionList.map(m => {
            const mPic = m.pictureUrl ? getNextImageUrl(m.pictureUrl, 48) : `https://ui-avatars.com/api/?background=1e1f22&color=fff&name=${encodeURIComponent(m.username)}`;
            const enc = encodeURIComponent(m.username);
            const mId = m.id ? Number(m.id) : 'null';
            const safePic = (m.pictureUrl || '').replace(/'/g, "\\'");
            return `
                <button type="button" onclick="openUserProfileFromPostViewer(decodeURIComponent('${enc}'), ${mId}, '${safePic}', event)" class="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-mc-primary/20 hover:bg-mc-primary/40 text-[#93c5fd] hover:text-white text-xs font-medium border border-mc-primary/30 transition-colors cursor-pointer">
                    <img src="${mPic}" class="w-4 h-4 rounded-full object-cover">
                    <span>@${m.username}</span>
                </button>
            `;
        }).join('');
    } else {
        mentionsBox.classList.add('hidden');
        mentionsListEl.innerHTML = '';
    }

    renderProfileDetailSubChannelSection(post);

    // Tepkileri (Reactions) detay modalında da göster
    const reactionsContainer = document.getElementById('profileDetailReactionsContainer');
    if (reactionsContainer && typeof renderReactions === 'function') {
        if (typeof syncReactionsFromServerMsg === 'function') syncReactionsFromServerMsg(post);
        renderReactions(String(post.id), reactionsContainer);
    }

    const hasPrev = profilePostsState.viewerIndex > 0 || (profilePostsState.viewerSource === 'channel' && typeof hasMoreOlderMessages !== 'undefined' && hasMoreOlderMessages);
    const hasNext = (profilePostsState.viewerIndex < activeList.length - 1) || (profilePostsState.viewerSource === 'profile' && profilePostsState.hasMore);

    document.getElementById('profileDetailPrevBtn').disabled = !hasPrev;
    document.getElementById('profileDetailBottomPrevBtn').disabled = !hasPrev;
    document.getElementById('profileDetailNextBtn').disabled = !hasNext;
    document.getElementById('profileDetailBottomNextBtn').disabled = !hasNext;

    const goBtn = document.getElementById('profileDetailGoToMsgBtn');
    const targetChId = Number(post.channelId || currentChatChannelId || activeViewingChannelId) || 0;
    const parentChId = Number(post.parentChannelId) || 0;
    goBtn.onclick = (ev) => {
        closeProfilePostDetailViewer(true);
        navigateToPostFromProfile(post.id, targetChId, parentChId, ev);
    };

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
            closeProfilePostDetailViewer(true);
            closeUserPostsFeedModal(false);
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
            closeProfilePostDetailViewer(true);
            closeUserPostsFeedModal(false);
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
                if (detail.emojiList) {
                    post.emojiList = detail.emojiList;
                    if (typeof syncReactionsFromServerMsg === 'function') syncReactionsFromServerMsg(post);
                }

                const activeList = getActiveViewerList();
                const activePost = activeList[profilePostsState.viewerIndex];
                if (activePost && Number(activePost.id) === Number(post.id)) {
                    renderProfileDetailSubChannelSection(post);
                    const reactionsContainer = document.getElementById('profileDetailReactionsContainer');
                    if (reactionsContainer && typeof renderReactions === 'function') {
                        renderReactions(String(post.id), reactionsContainer);
                    }
                }
            }
        }
    } catch (_) {}
}

// Profilden Gönderiler veya Bahsedilmeler açıldığında Profil modalını kapatır ve geçmişe kaydeder
async function openUserPostsFeedModal(initialTab = 'posts', e = null) {
    if (e) e.stopPropagation();

    const modal = ensureUserPostsFeedModalDOM();
    const profileModal = document.getElementById('userProfileModal');

    const rawHandleText = (document.getElementById('profileModalUsername')?.innerText || '').trim().replace(/^@+/, '');
    const targetUname = currentProfileModalUser?.username || rawHandleText || profilePostsState.username || 'Kullanıcı';
    const cleanUname = stripEmojis(targetUname) || targetUname;
    const known = findKnownUserByUsername(targetUname) || findKnownUserByUsername(cleanUname) || {};

    let targetUid = currentProfileModalUser?.userId || known.userId || profilePostsState.userId || null;

    if (!targetUid && cleanUname && cleanUname !== 'Kullanıcı') {
        const fetchedUser = await fetchUserInfoFromApi(null, cleanUname, false);
        if (fetchedUser && fetchedUser.id) {
            targetUid = Number(fetchedUser.id);
            if (currentProfileModalUser) currentProfileModalUser.userId = targetUid;
        }
    }

    const fullName = document.getElementById('profileModalFullName')?.innerText || known.fullName || targetUname;
    const avatarSrc = document.getElementById('profileModalAvatar')?.src ||
        (currentProfileModalUser?.pictureUrl ? getDirectMediaUrl(currentProfileModalUser.pictureUrl) : `https://ui-avatars.com/api/?background=2b2d31&color=fff&name=${encodeURIComponent(cleanUname)}`);

    // Profil modalı açıksa kapat ve geri dönüldüğünde açılmak üzere geçmişe kaydet
    if (profileModal && !profileModal.classList.contains('hidden')) {
        modalNavigationHistory.push({
            type: 'profile_modal',
            userId: targetUid,
            username: targetUname,
            pictureUrl: currentProfileModalUser?.pictureUrl || avatarSrc,
            isSelf: false
        });
        profileModal.classList.add('hidden');
    }

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

function closeUserPostsFeedModal(reopenPreviousProfile = true) {
    const modal = document.getElementById('userPostsFeedModal');
    if (modal) modal.classList.add('hidden');

    if (!reopenPreviousProfile) {
        modalNavigationHistory = [];
        return;
    }

    // Geçmişte profil modalı varsa onu geri aç
    if (modalNavigationHistory.length > 0) {
        const prev = modalNavigationHistory.pop();
        if (prev && prev.type === 'profile_modal') {
            isNavigatingBackInModals = true;
            openUserProfileModal(prev.userId, prev.username, prev.pictureUrl, prev.isSelf).finally(() => {
                isNavigatingBackInModals = false;
                renderProfileModalBackButton();
            });
        }
    }
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

function resolvePostChannelBreadcrumb(post) {
    const channels = profilePostsState.channelsCache || [];
    const chMap = new Map();
    channels.forEach(c => chMap.set(Number(c.id), c));

    const fallbackChId = Number(post.channelId || currentChatChannelId || activeViewingChannelId) || 0;
    let chName = (post.channelName || '').trim();
    let parentName = (post.parentChannelName || '').trim();

    const chObj = chMap.get(fallbackChId);
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
        const postAuthor = post.userName || 'Kullanıcı';
        const postAuthorId = typeof extractUserIdFromObject === 'function' ? extractUserIdFromObject(post, true) : (post.userId || null);
        const safeAuthor = postAuthor.replace(/'/g, "\\'");
        const safePic = (post.pictureUrl || '').replace(/'/g, "\\'");

        const avatar = post.pictureUrl
            ? getNextImageUrl(post.pictureUrl, 48)
            : `https://ui-avatars.com/api/?background=2b2d31&color=fff&name=${encodeURIComponent(postAuthor)}`;

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
                       const encM = encodeURIComponent(m.username);
                       const mId = m.id ? Number(m.id) : 'null';
                       const mSafePic = (m.pictureUrl || '').replace(/'/g, "\\'");
                       return `<span onclick="openUserProfileFromPostViewer(decodeURIComponent('${encM}'), ${mId}, '${mSafePic}', event)" class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-mc-primary/20 hover:bg-mc-primary/40 text-[#93c5fd] hover:text-white text-[11px] font-medium border border-mc-primary/30 transition-colors cursor-pointer">
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
                    <img src="${avatar}" onclick="openUserProfileFromPostViewer('${safeAuthor}', ${postAuthorId || 'null'}, '${safePic}', event)" class="w-8 h-8 rounded-full object-cover shrink-0 mt-0.5 bg-gray-700 hover:ring-2 hover:ring-mc-primary transition-all" title="Kullanıcı Profilini Aç">
                    <div class="flex-1 min-w-0">
                        <span onclick="openUserProfileFromPostViewer('${safeAuthor}', ${postAuthorId || 'null'}, '${safePic}', event)" class="inline-block text-xs font-bold text-gray-100 hover:text-mc-primary hover:underline truncate transition-colors" title="Kullanıcı Profilini Aç">${postAuthor}</span>
                        ${formattedText ? `<div class="text-[13px] text-gray-200 break-words whitespace-pre-wrap leading-relaxed mt-1">${formattedText}</div>` : ''}
                        ${mentionsBadges}
                        ${attachmentHtml}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

async function navigateToPostFromProfile(postId, channelId, parentChannelId, e) {
    if (e) e.stopPropagation();
    if (!postId) return;

    const token = localStorage.getItem('mc_token');
    const postDetailUrl = `https://api.meetingchallenge.com/Post/get-post-by-id?postId=${encodeURIComponent(postId)}`;

    let resolvedChannelId = Number(channelId) || 0;
    let fetchedPostObj = null;

    try {
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

    modalNavigationHistory = [];
    closeProfilePostDetailViewer(true);
    closeUserPostsFeedModal(false);
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
    // Eğer başka bir modal açıkken (detay veya liste) burası doğrudan çağrıldıysa o modalları kapat
    const detailModal = document.getElementById('profilePostDetailModal');
    const feedModal = document.getElementById('userPostsFeedModal');
    if (!isNavigatingBackInModals) {
        if (detailModal && !detailModal.classList.contains('hidden')) {
            openUserProfileFromPostViewer(username, userId, fallbackAvatar);
            return;
        }
        if (feedModal && !feedModal.classList.contains('hidden')) {
            openUserProfileFromPostViewer(username, userId, fallbackAvatar);
            return;
        }
    }

    const modal = document.getElementById('userProfileModal');
    const loader = document.getElementById('profileModalLoader');
    const bioWrapper = document.getElementById('profileBioWrapper');
    const bioEl = document.getElementById('profileModalBio');
    const rolesEl = document.getElementById('profileModalRoles');
    const extraFieldsEl = document.getElementById('profileExtraFields');

    const cleanUsername = String(username || "Kullanıcı").trim().replace(/^@+/, '');
    const displayCleanUsername = stripEmojis(cleanUsername) || cleanUsername;
    const known = findKnownUserByUsername(cleanUsername) || {};
    const resolvedAvatarPath = fallbackAvatar || known.pictureUrl || (typeof getCachedUserAvatarByUsername === 'function' ? getCachedUserAvatarByUsername(cleanUsername) : null) || null;
    const resolvedUserId = userId || known.userId || (typeof extractUserIdFromMediaUrl === 'function' ? extractUserIdFromMediaUrl(resolvedAvatarPath) : null) || null;

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

    injectProfileFeedActionButtons();
    renderProfileModalBackButton();

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
            currentProfileModalUser.userId = uData.id || targetId || (typeof extractUserIdFromMediaUrl === 'function' ? extractUserIdFromMediaUrl(pic) : null);

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
            if (pic) {
                document.getElementById('profileModalAvatar').src = getDirectMediaUrl(pic);
                if (typeof patchAvatarImagesInDom === 'function') patchAvatarImagesInDom(uname, pic);
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

        profilePostsState.userId = currentProfileModalUser.userId || targetId;
        profilePostsState.username = currentProfileModalUser.username;
        injectProfileFeedActionButtons();
        renderProfileModalBackButton();
    } catch (err) {
        rolesEl.innerHTML = `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-[#111214] text-gray-300 border border-white/10"><span class="w-2 h-2 rounded-full bg-mc-green"></span>Üye</span>`;
        injectProfileFeedActionButtons();
        renderProfileModalBackButton();
    } finally {
        loader.classList.add('hidden');
    }
}

// Profil modalı kapatıldığında eğer geçmişte önceki bir modal varsa (ör. detay ekranından profile gelindiyse) ona geri döner
function closeUserProfileModal() {
    const modal = document.getElementById('userProfileModal');
    if (modal) modal.classList.add('hidden');

    if (modalNavigationHistory.length > 0) {
        navigateBackFromProfileModal();
    }
}

// Sohbet içi görsellere tıklandığında da birleşik detay ekranını aç
window.openImageViewer = function (msgId) {
    openUnifiedChannelPostViewer(msgId);
};

// Diğer JS dosyaları daha sonra yüklense bile bu gelişmiş profil fonksiyonlarının korunmasını garantile
const _enhancedOpenUserProfileModal = openUserProfileModal;
const _enhancedCloseUserProfileModal = closeUserProfileModal;
const _enhancedOpenMyProfile = openMyProfile;
const _enhancedOpenUserProfileByUsername = openUserProfileByUsername;
const _enhancedLoadUserProfileUI = loadUserProfileUI;

window.addEventListener('DOMContentLoaded', () => {
    window.openUserProfileModal = _enhancedOpenUserProfileModal;
    window.closeUserProfileModal = _enhancedCloseUserProfileModal;
    window.openMyProfile = _enhancedOpenMyProfile;
    window.openUserProfileByUsername = _enhancedOpenUserProfileByUsername;
    window.loadUserProfileUI = _enhancedLoadUserProfileUI;
    window.openImageViewer = function (msgId) {
        openUnifiedChannelPostViewer(msgId);
    };
});