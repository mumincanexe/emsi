// ==========================================
// 👤 GİRİŞ, PROFİL VE AVATAR ÇÖZÜMLEME MODÜLÜ
// ==========================================

var pendingAvatarFetches = new Set();
var failedAvatarLookups = new Map(); // username -> timestamp

function getCachedUserAvatarByUsername(rawUsername) {
    if (!rawUsername) return null;
    const clean = String(rawUsername).trim().replace(/\s*\(Sen\)\s*$/i, '').replace(/^@+/, '');
    if (!clean) return null;
    const cleanLower = clean.toLowerCase();

    if (typeof currentLoggedUserInfo !== 'undefined' && currentLoggedUserInfo) {
        const myUname = String(currentLoggedUserInfo.username || '').trim().toLowerCase();
        if (myUname === cleanLower && currentLoggedUserInfo.pictureUrl) {
            return getDirectMediaUrl(currentLoggedUserInfo.pictureUrl);
        }
    }

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

async function ensureUserAvatarLoadedAsync(rawUsername) {
    if (!rawUsername) return;
    const clean = String(rawUsername).trim().replace(/\s*\(Sen\)\s*$/i, '').replace(/^@+/, '');
    if (!clean || clean === 'Kullanıcı' || clean === 'Sen') return;

    const existingPic = getCachedUserAvatarByUsername(clean);
    if (existingPic) {
        patchAvatarImagesInDom(clean, existingPic);
        return;
    }

    const keyLower = clean.toLowerCase();
    if (pendingAvatarFetches.has(keyLower)) return;

    const lastFail = failedAvatarLookups.get(keyLower);
    if (lastFail && Date.now() - lastFail < 30000) return;

    pendingAvatarFetches.add(keyLower);

    try {
        if (typeof fetchActiveChannels === 'function') {
            await fetchActiveChannels();
        }

        let resolvedPic = getCachedUserAvatarByUsername(clean);

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

function patchAvatarImagesInDom(username, directPicUrl) {
    if (!username || !directPicUrl) return;
    const targetLower = String(username).trim().replace(/\s*\(Sen\)\s*$/i, '').toLowerCase();
    const optimizedUrl = typeof getOptimizedImageUrl === 'function' ? getOptimizedImageUrl(directPicUrl, 128) : directPicUrl;

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
                if (typeof mapCityNameToId === 'function') {
                    const matchedCity = mapCityNameToId(myApiData.city);
                    if (matchedCity && !selectedEventCityId) {
                        selectedEventCityId = matchedCity;
                        userCityFetched = true;
                    }
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