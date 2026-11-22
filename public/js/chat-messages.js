// ==========================================
// 💬 MESAJLAŞMA, YANITLAMA, DOSYA YÜKLEME, ETİKETLEME & POLLING MODÜLÜ
// ==========================================

let cachedCreatePostConfig = null;
try {
    const savedCfg = localStorage.getItem('mc_create_post_cfg');
    if (savedCfg) cachedCreatePostConfig = JSON.parse(savedCfg);
} catch (e) {}

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
        return `<span onclick="event.stopPropagation(); if (typeof openUserProfileFromPostViewer === 'function') { openUserProfileFromPostViewer(decodeURIComponent('${encoded}'), null, null, event); } else { openUserProfileByUsername(decodeURIComponent('${encoded}')); }" class="bg-mc-primary/25 text-[#93c5fd] px-1.5 py-0.5 rounded text-xs font-medium cursor-pointer hover:bg-mc-primary/40 hover:text-white transition-colors">@${cleanUname}</span>`;
    });

    formatted = formatted.replace(/##(.*?)##/g, function (match, rawVal) {
        const val = (rawVal || "").trim();
        if (!val) return match;
        let displayChannelName = val;
        let matchedChannel = globalChannels.find(c => String(c.id) === val || (c.name && c.name.trim().toLowerCase() === val.toLowerCase()));
        if (matchedChannel && matchedChannel.name) displayChannelName = matchedChannel.name;
        const safeRef = val.replace(/'/g, "\\'");
        return `<span onclick="closeProfilePostDetailViewer(true); closeUserPostsFeedModal(false); navigateToMentionedChannel('${safeRef}', event)" class="inline-flex items-center gap-0.5 bg-mc-primary/25 text-[#93c5fd] px-1.5 py-0.5 rounded text-xs font-semibold cursor-pointer hover:bg-mc-primary/40 hover:text-white transition-colors"><span class="opacity-80">#</span><span>${displayChannelName}</span></span>`;
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

    if (msg.replyData) return { replyData: msg.replyData, cleanText };
    if (localReplyMap[msgIdStr]) return { replyData: localReplyMap[msgIdStr], cleanText };
    if (parsed.replyData) return { replyData: parsed.replyData, cleanText };

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

    knownUsersMap.forEach((u) => {
        const cleanUname = stripEmojis(u.username) || u.username;
        if (!cleanUname) return;
        const escaped = cleanUname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(?<!@)@${escaped}\\b`, 'gi');
        formattedText = formattedText.replace(regex, `@@${cleanUname}@@`);
    });

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
    if (typeof closeAllEmojiPickers === 'function') closeAllEmojiPickers();

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

function setReplyMessage(msgId, e) {
    if (e) e.stopPropagation();
    if (typeof closeAllEmojiPickers === 'function') closeAllEmojiPickers();
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
    if (typeof closeAllEmojiPickers === 'function') closeAllEmojiPickers();
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
    if (typeof closeAllEmojiPickers === 'function') closeAllEmojiPickers();
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
                if (typeof syncReactionsFromServerMsg === 'function') syncReactionsFromServerMsg(msg);
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
            if (typeof syncReactionsFromServerMsg === 'function') syncReactionsFromServerMsg(msg);

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
                if (typeof renderReactions === 'function') {
                    renderReactions(idStr, existingDom.querySelector(`#reactions-container-${CSS.escape(idStr)}`));
                }
            }
        });

        refreshRenderedReplyHeaders();
        updateImageGallery();
        if (!document.getElementById('imageViewerModal')?.classList.contains('hidden') && typeof renderViewerReactions === 'function') {
            renderViewerReactions();
        }
        if (typeof activeReactionModalMsgId !== 'undefined' && activeReactionModalMsgId && typeof renderReactionDetailsModalContent === 'function') {
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
                    if (typeof syncReactionsFromServerMsg === 'function') syncReactionsFromServerMsg(msg);
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
    const cleanU = stripEmojis(username) || username;
    if (mentionState.startIndex === -1) {
        insertEmojiToChatInput(`@@${cleanU}@@ `);
        return;
    }
    const cursor = textarea.selectionStart || textarea.value.length;
    const before = textarea.value.slice(0, mentionState.startIndex);
    const after = textarea.value.slice(cursor);
    const inserted = `@@${cleanU}@@ `;
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
    if (typeof closeAllEmojiPickers === 'function') closeAllEmojiPickers();
    if (isHidden) {
        if (typeof initInputEmojiGrid === 'function') initInputEmojiGrid();
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
            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1-1v3M4 7h16"/></svg>
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

    const pickerHtml = typeof buildCategorizedReactionPickerHTML === 'function' ? buildCategorizedReactionPickerHTML(msgIdStr) : '';

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

        <div id="emoji-picker-${msgIdStr}" class="emoji-picker-popover hidden absolute right-2 top-7 bg-[#232428] border border-white/15 p-3 rounded-xl shadow-2xl z-30 w-64 max-h-64 overflow-y-auto" onclick="event.stopPropagation()">
            ${pickerHtml}
        </div>
    `;

    if (typeof renderReactions === 'function') {
        renderReactions(msgIdStr, msgDiv.querySelector(`#reactions-container-${CSS.escape(msgIdStr)}`));
    }
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