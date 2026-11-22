// ==========================================
// 😍 EMOJİ TEPKİLERİ (REACTIONS), TEPKİ DETAYLARI & GÖRSEL GALERİSİ MODÜLÜ
// ==========================================

function openImageViewer(msgId) {
    if (typeof updateImageGallery === 'function') updateImageGallery();
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
        const fetched = typeof fetchOlderMessages === 'function' ? await fetchOlderMessages() : false;
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

    const avatar = msg.pictureUrl
        ? getNextImageUrl(msg.pictureUrl, 128)
        : 'https://ui-avatars.com/api/?background=2b2d31&color=fff&name=' + encodeURIComponent(msg.userName);
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
            setTimeout(() => {
                if (typeof pollNewMessages === 'function') pollNewMessages();
            }, 300);
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