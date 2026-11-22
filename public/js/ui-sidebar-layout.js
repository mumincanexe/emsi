// ==========================================
// 🗂️ KANAL AĞACI, SOL MENÜ, ALT BAŞLIKLAR & ANA EKRAN DÜZENİ (LAYOUT)
// ==========================================

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
                        if (pic && typeof patchAvatarImagesInDom === 'function') {
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
        if (typeof closeImageViewer === 'function') closeImageViewer();
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
    if (typeof closeAllEmojiPickers === 'function') closeAllEmojiPickers();
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
            if (typeof pollNewMessages === 'function') pollNewMessages();
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
    setTimeout(() => {
        if (typeof applyDynamicGridLayout === 'function') {
            requestAnimationFrame(applyDynamicGridLayout);
        }
    }, 310);
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
    setTimeout(() => {
        if (typeof applyDynamicGridLayout === 'function') {
            requestAnimationFrame(applyDynamicGridLayout);
        }
    }, 50);
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
        if (typeof updateVideoUI === 'function') updateVideoUI();
        if (typeof applyDynamicGridLayout === 'function') requestAnimationFrame(applyDynamicGridLayout);
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
            if (typeof updateVideoUI === 'function') updateVideoUI();
            if (typeof applyDynamicGridLayout === 'function') requestAnimationFrame(applyDynamicGridLayout);
        }
    } else {
        startChatPolling(channel.id);
        syncMainLayout();
    }

    renderSidebar(true);
    scrollChannelIntoSidebarView(channel.id);
}