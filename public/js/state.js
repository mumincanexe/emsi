const apiRootUrl = "https://api.meetingchallenge.com";
const authApiUrl = "https://api.meetingchallenge.com/Auth/Login";
const apiBaseUrl = "https://api.meetingchallenge.com/Channel";
const postBaseUrl = "https://api.meetingchallenge.com/Post";
const postApiUrl = "https://api.meetingchallenge.com/Post/get-posts-v2";
const userApiUrl = "https://api.meetingchallenge.com/User/get-user-info";
const livekitServerUrl = "wss://stream.meetingchallenge.com";
const normsMarkdownUrl = "norms.md";
const MAX_PARTICIPANT_VOLUME = 2.0; 

let room = null;
let isMicEnabled = false;
let isCamEnabled = false;
let normsLoadedOnce = false;

// Seçili Donanım ID'leri
let selectedMicDeviceId = localStorage.getItem('mc_mic_device_id') || '';
let selectedCamDeviceId = localStorage.getItem('mc_cam_device_id') || '';
let selectedSpeakerDeviceId = localStorage.getItem('mc_speaker_device_id') || '';

// Kameraları Gizleme Durumu
let hideAllCameraStreams = localStorage.getItem('mc_hide_all_cameras') === 'true';

// Sağ Tık Ses Menüsü Otomatik Kapanma Zamanlayıcısı
let volumeMenuCloseTimer = null;

// Kişi Bazlı Ses Seviyesi (Min: 0.05 [%5], Max: 1.0 [%100])
const MIN_PARTICIPANT_VOLUME = 0.05;
let participantVolumesMap = {};
let activeVolumeContextUsername = null;

try {
    const savedVols = localStorage.getItem('mc_participant_volumes_v1');
    if (savedVols) {
        const parsed = JSON.parse(savedVols);
        Object.keys(parsed).forEach(k => {
            participantVolumesMap[k] = Math.max(MIN_PARTICIPANT_VOLUME, Math.min(1, Number(parsed[k]) || 1));
        });
    }
} catch (e) {
    participantVolumesMap = {};
}

function saveParticipantAudioPrefs() {
    try {
        localStorage.setItem('mc_participant_volumes_v1', JSON.stringify(participantVolumesMap));
    } catch (e) {}
}

// Yanıtlanan (Reply) Mesajları Kalıcı Tutma Haritası
let localReplyMap = {};
try {
    const savedReplies = localStorage.getItem('mc_replies_map_v1');
    if (savedReplies) localReplyMap = JSON.parse(savedReplies);
} catch (e) {
    localReplyMap = {};
}

function saveRepliesToStorage() {
    try { localStorage.setItem('mc_replies_map_v1', JSON.stringify(localReplyMap)); } catch (e) {}
}

// Kişi listesinin üzerine gelindiğinde sıralamayı dondurmak için durum değişkenleri
let isHoveringParticipantList = false;
let frozenParticipantOrderMap = new Map();

let globalChannels = [];
let activeVoiceChannelId = null;
let activeVoiceChannelName = "";
let activeViewingChannelId = null;
let focusedParticipantSid = null;
let channelNavigationStack = [];

let isPopupForced = false;
let isChatOpenOnVoice = window.innerWidth >= 1024;

let recentSpeakerSids = [];
let pollingInterval = null;
let uiSyncInterval = null;
let chatPollingInterval = null;
let currentJoinTokenId = 0;

let collapsedCategories = new Set();
let locallyReadChannelIds = new Set();

let currentLoggedUserInfo = {
    userId: null,
    username: "",
    jwtUserName: "",
    fullName: ""
};

const DEFAULT_BLUE_HEART_KEY = "💙";

const DEFAULT_REACTION_ITEMS = [
    { emojiId: 1, key: "💙", display: "💙", url: "", unified: "1f499", category: "Özel Emojiler", isCustom: true },
    { emojiId: 3, key: "😂", display: "😂", url: "", unified: "1f602", category: "Yüzler & Duygular" },
    { emojiId: 4, key: "😮", display: "😮", url: "", unified: "1f62e", category: "Yüzler & Duygular" },
    { emojiId: 5, key: "😢", display: "😢", url: "", unified: "1f622", category: "Yüzler & Duygular" },
    { emojiId: 9, key: "😍", display: "😍", url: "", unified: "1f60d", category: "Yüzler & Duygular" },
    { emojiId: 10, key: "🥹", display: "🥹", url: "", unified: "1f979", category: "Yüzler & Duygular" },
    { emojiId: 11, key: "😎", display: "😎", url: "", unified: "1f60e", category: "Yüzler & Duygular" },
    { emojiId: 12, key: "🤔", display: "🤔", url: "", unified: "1f914", category: "Yüzler & Duygular" },
    { emojiId: 13, key: "🥳", display: "🥳", url: "", unified: "1f973", category: "Yüzler & Duygular" },
    { emojiId: 2, key: "❤️", display: "❤️", url: "", unified: "2764-fe0f", category: "Kalpler & Semboller" },
    { emojiId: 6, key: "🔥", display: "🔥", url: "", unified: "1f525", category: "Kalpler & Semboller" },
    { emojiId: 14, key: "✨", display: "✨", url: "", unified: "2728", category: "Kalpler & Semboller" },
    { emojiId: 15, key: "💯", display: "💯", url: "", unified: "1f4af", category: "Kalpler & Semboller" },
    { emojiId: 16, key: "⚡", display: "⚡", url: "", unified: "26a1", category: "Kalpler & Semboller" },
    { emojiId: 17, key: "✅", display: "✅", url: "", unified: "2705", category: "Kalpler & Semboller" },
    { emojiId: 18, key: "🚀", display: "🚀", url: "", unified: "1f680", category: "Kalpler & Semboller" },
    { emojiId: 19, key: "🏆", display: "🏆", url: "", unified: "1f3c6", category: "Kalpler & Semboller" },
    { emojiId: 8, key: "👍", display: "👍", url: "", unified: "1f44d", category: "Kutlama & El İşaretleri" },
    { emojiId: 7, key: "🎉", display: "🎉", url: "", unified: "1f389", category: "Kutlama & El İşaretleri" },
    { emojiId: 20, key: "👏", display: "👏", url: "", unified: "1f44f", category: "Kutlama & El İşaretleri" },
    { emojiId: 21, key: "🙌", display: "🙌", url: "", unified: "1f64c", category: "Kutlama & El İşaretleri" },
    { emojiId: 22, key: "🙏", display: "🙏", url: "", unified: "1f64f", category: "Kutlama & El İşaretleri" },
    { emojiId: 23, key: "🤝", display: "🤝", url: "", unified: "1f91d", category: "Kutlama & El İşaretleri" },
    { emojiId: 24, key: "🫡", display: "🫡", url: "", unified: "1fae1", category: "Kutlama & El İşaretleri" },
    { emojiId: 25, key: "👀", display: "👀", url: "", unified: "1f440", category: "Kutlama & El İşaretleri" }
];

let emojiCatalogMap = new Map();
DEFAULT_REACTION_ITEMS.forEach(item => emojiCatalogMap.set(String(item.key), item));

let localReactionsMap = {};
let localEditedMessagesMap = {};
try {
    const savedReactions = localStorage.getItem('mc_reactions_v1');
    if (savedReactions) localReactionsMap = JSON.parse(savedReactions);
    const savedEdits = localStorage.getItem('mc_edited_msgs_v1');
    if (savedEdits) localEditedMessagesMap = JSON.parse(savedEdits);
} catch (e) {
    localReactionsMap = {};
    localEditedMessagesMap = {};
}

function saveReactionsToStorage() {
    try { localStorage.setItem('mc_reactions_v1', JSON.stringify(localReactionsMap)); } catch (e) {}
}

function saveEditedMessagesToStorage() {
    try { localStorage.setItem('mc_edited_msgs_v1', JSON.stringify(localEditedMessagesMap)); } catch (e) {}
}

let messagesMap = new Map();
let imageGalleryList = [];
let currentViewerIndex = -1;

let activeReactionModalMsgId = null;
let activeReactionModalTab = 'ALL';

let replyingToMsg = null;
let selectedChatFile = null;
let selectedChatFileUrl = null;
let unreadMessagesCount = 0;
let knownUsersMap = new Map();
let mentionState = { active: false, query: "", startIndex: -1, selectedIdx: 0, filtered: [] };
let currentProfileModalUser = null;
let pendingThreadPostId = null;

let oldestPostId = null;
let newestPostId = null;
let isFetchingOlder = false;
let hasMoreOlderMessages = true;
let currentChatChannelId = null;

const INPUT_EMOJI_GROUPS = [
    {
        title: "Yüzler & Duygular",
        emojis: ["😀", "😂", "🥹", "😍", "😎", "🥳", "🤔", "🤩", "🫡", "😡", "🤯", "😢"]
    },
    {
        title: "Kalpler & Semboller",
        emojis: ["💙", "❤️", "🔥", "✨", "💯", "⚡", "✅", "❌", "🚀", "🎯", "🏆", "💬"]
    },
    {
        title: "El İşaretleri & Kutlama",
        emojis: ["👍", "👎", "👏", "🙌", "🙏", "🤝", "🎉", "👀"]
    }
];

function getDirectMediaUrl(rawPath) {
    if (!rawPath || typeof rawPath !== 'string') return '';
    let cleanUrl = rawPath.trim();
    if (!cleanUrl) return '';
    if (cleanUrl.startsWith('blob:') || cleanUrl.startsWith('data:')) return cleanUrl;

    if (cleanUrl.includes('_next/image')) {
        try {
            const urlObj = new URL(cleanUrl, apiRootUrl);
            const encodedTarget = urlObj.searchParams.get('url');
            if (encodedTarget) cleanUrl = decodeURIComponent(encodedTarget);
        } catch (e) {
            const match = cleanUrl.match(/[?&]url=([^&]+)/);
            if (match && match[1]) {
                try { cleanUrl = decodeURIComponent(match[1]); } catch (_) { cleanUrl = match[1]; }
            }
        }
    }

    if (cleanUrl.startsWith('/')) {
        cleanUrl = apiRootUrl + cleanUrl;
    } else if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
        cleanUrl = apiRootUrl + '/' + cleanUrl.replace(/^\/+/, '');
    }

    cleanUrl = cleanUrl.replace(/(\/Media\/(?:Attachment|Profile)\/\d+\/)resized_/gi, '$1');
    cleanUrl = cleanUrl.replace(/\/resized_([^/?#]+)(\?.*)?$/i, '/$1$2');
    return cleanUrl;
}

function getOptimizedImageUrl(path, width = 64) {
    return getDirectMediaUrl(path);
}

// Kullanıcı adlarından ve etiketlerden tüm emojileri temizler
function stripEmojis(str = "") {
    if (!str) return "";
    return String(str)
        .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D]/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
}

// YALNIZCA /Media/Profile/{userId}/ yolundan kesin kullanıcı ID'si çıkarır (Attachment yollarından yanlış ID çekmeyi önler)
function extractUserIdFromMediaUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return null;
    const target = getDirectMediaUrl(rawUrl) || rawUrl;
    const match =
        target.match(/\/Media\/Profile\/(\d+)\//i) ||
        target.match(/\/Profile\/(\d+)\//i);

    if (match && match[1] && Number(match[1]) > 0) return Number(match[1]);
    return null;
}

function extractUserIdFromPictureUrl(picUrl) {
    return extractUserIdFromMediaUrl(picUrl);
}

function extractUserIdFromObject(obj, isPostObject = false) {
    if (!obj) return null;
    const candidates = [
        obj.userId, obj.UserId, obj.authorId, obj.AuthorId,
        obj.createdByUserId, obj.CreatedByUserId, obj.senderId,
        obj.memberId, obj.ownerId, obj.appUserId
    ];
    if (!isPostObject && obj.id) candidates.push(obj.id);

    for (const c of candidates) {
        if (c !== undefined && c !== null && !isNaN(Number(c)) && Number(c) > 0) return Number(c);
    }
    if (obj.user && (obj.user.id || obj.user.userId)) return Number(obj.user.id || obj.user.userId);

    // Sadece profil resmi alanlarından ID çıkar (Attachment alanlarına bakma)
    const profileFields = [
        obj.pictureUrl, obj.PictureUrl, obj.profilePictureUrl, obj.avatarUrl, obj.userAvatar
    ];
    for (const field of profileFields) {
        const extracted = extractUserIdFromMediaUrl(field);
        if (extracted) return extracted;
    }
    return null;
}

function findKnownUserByUsername(username) {
    if (!username) return null;
    const clean = String(username).trim().replace(/^@+/, '');
    const stripped = stripEmojis(clean).toLowerCase();
    if (!clean) return null;

    if (knownUsersMap.has(clean)) return knownUsersMap.get(clean);
    const lower = clean.toLowerCase();

    for (const [k, v] of knownUsersMap.entries()) {
        const kLower = k.toLowerCase();
        const kStripped = stripEmojis(k).toLowerCase();
        if (kLower === lower || (stripped && kStripped === stripped)) return v;
        if (v.cleanUsername && v.cleanUsername.toLowerCase() === stripped) return v;
    }
    return null;
}

function extractUserIdFromPictureUrl(picUrl) {
    return extractUserIdFromMediaUrl(picUrl);
}

function extractUserIdFromObject(obj, isPostObject = false) {
    if (!obj) return null;
    const candidates = [
        obj.userId, obj.UserId, obj.authorId, obj.AuthorId,
        obj.createdByUserId, obj.CreatedByUserId, obj.senderId,
        obj.memberId, obj.ownerId, obj.appUserId
    ];
    if (!isPostObject && obj.id) candidates.push(obj.id);

    for (const c of candidates) {
        if (c !== undefined && c !== null && !isNaN(Number(c)) && Number(c) > 0) return Number(c);
    }
    if (obj.user && (obj.user.id || obj.user.userId)) return Number(obj.user.id || obj.user.userId);

    const mediaFields = [
        obj.pictureUrl, obj.profilePictureUrl, obj.avatarUrl, obj.userAvatar,
        obj.attachmentUrl, obj.AttachmentUrl, obj.mediaUrl, obj.fileUrl
    ];
    for (const mediaField of mediaFields) {
        const extracted = extractUserIdFromMediaUrl(mediaField);
        if (extracted) return extracted;
    }
    return null;
}

function parseJwt(token) {
    try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(window.atob(base64).split('').map(c =>
            '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
        ).join(''));
        return JSON.parse(jsonPayload);
    } catch (e) {
        return null;
    }
}

function isMyMessage(msg) {
    if (!msg) return false;
    if (msg.isOptimistic) return true;

    const msgUid = extractUserIdFromObject(msg, true);
    if (msgUid && currentLoggedUserInfo.userId && Number(msgUid) === Number(currentLoggedUserInfo.userId)) {
        return true;
    }

    const author = (msg.userName || msg.username || "").toString().trim().toLowerCase();
    if (!author) return false;

    const candidates = [
        localStorage.getItem('mc_username'),
        currentLoggedUserInfo.username,
        currentLoggedUserInfo.jwtUserName,
        currentLoggedUserInfo.fullName
    ].filter(Boolean).map(s => String(s).trim().toLowerCase());

    return candidates.includes(author);
}

function formatSmartTimestamp(dateInput) {
    const dateObj = new Date(dateInput);
    if (isNaN(dateObj.getTime())) return { display: "", full: "" };

    const now = new Date();
    const isSameDay = dateObj.getFullYear() === now.getFullYear() &&
                      dateObj.getMonth() === now.getMonth() &&
                      dateObj.getDate() === now.getDate();

    const timeStr = dateObj.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    const fullDateStr = dateObj.toLocaleString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

    if (isSameDay) return { display: timeStr, full: fullDateStr };
    const shortDateStr = dateObj.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' });
    return { display: `${shortDateStr} ${timeStr}`, full: fullDateStr };
}

function formatBirthDateForProfile(rawDate, showYear = true) {
    if (!rawDate) return null;
    const d = new Date(rawDate);
    if (isNaN(d.getTime())) {
        const str = String(rawDate).trim();
        if (str.includes('0001') || str === '') return null;
        if (!showYear || str.includes('1900')) {
            return str.replace(/\b(19|20)\d{2}\b[-/.]?/g, '').replace(/[-/.]?\b(19|20)\d{2}\b/g, '').trim();
        }
        return str;
    }
    const year = d.getFullYear();
    if (year <= 1) return null;
    if (!showYear || year === 1900 || year <= 1901) {
        return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });
    }
    return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function getZodiacSignFromDate(rawDate) {
    if (!rawDate) return null;
    const d = new Date(rawDate);
    if (isNaN(d.getTime()) || d.getFullYear() <= 1) return null;
    const day = d.getDate();
    const month = d.getMonth() + 1;
    if ((month === 1 && day <= 20) || (month === 12 && day >= 22)) return "Oğlak";
    if ((month === 1 && day >= 21) || (month === 2 && day <= 19)) return "Kova";
    if ((month === 2 && day >= 20) || (month === 3 && day <= 20)) return "Balık";
    if ((month === 3 && day >= 21) || (month === 4 && day <= 20)) return "Koç";
    if ((month === 4 && day >= 21) || (month === 5 && day <= 21)) return "Boğa";
    if ((month === 5 && day >= 22) || (month === 6 && day <= 21)) return "İkizler";
    if ((month === 6 && day >= 22) || (month === 7 && day <= 22)) return "Yengeç";
    if ((month === 7 && day >= 23) || (month === 8 && day <= 23)) return "Aslan";
    if ((month === 8 && day >= 24) || (month === 9 && day <= 23)) return "Başak";
    if ((month === 9 && day >= 24) || (month === 10 && day <= 23)) return "Terazi";
    if ((month === 10 && day >= 24) || (month === 11 && day <= 22)) return "Akrep";
    if ((month === 11 && day >= 23) || (month === 12 && day <= 21)) return "Yay";
    return null;
}

function findKnownUserByUsername(username) {
    if (!username) return null;
    const clean = String(username).trim().replace(/^@+/, '');
    if (!clean) return null;
    if (knownUsersMap.has(clean)) return knownUsersMap.get(clean);
    const lower = clean.toLowerCase();
    for (const [k, v] of knownUsersMap.entries()) {
        if (k.toLowerCase() === lower) return v;
        if (v.fullName && v.fullName.toLowerCase() === lower) return v;
    }
    return null;
}

function parseMarkdownToHtml(md = "") {
    if (!md) return "";
    const lines = md.replace(/\r\n/g, '\n').split('\n');
    let html = '';
    let inOrderedList = false;
    let inUnorderedList = false;

    const closeLists = () => {
        if (inOrderedList) { html += '</ol>'; inOrderedList = false; }
        if (inUnorderedList) { html += '</ul>'; inUnorderedList = false; }
    };

    const formatInline = (str) => {
        return str
            .replace(/\*\*(.*?)\*\*/g, '<strong class="text-white font-semibold">$1</strong>')
            .replace(/\*(.*?)\*/g, '<em class="italic text-gray-200">$1</em>');
    };

    lines.forEach(rawLine => {
        const line = rawLine.trim();
        if (!line) {
            closeLists();
            return;
        }

        if (line.startsWith('### ')) {
            closeLists();
            html += `<h3 class="text-lg font-bold text-mc-primary mt-5 mb-2.5">${formatInline(line.slice(4))}</h3>`;
        } else if (line.startsWith('## ')) {
            closeLists();
            html += `<h2 class="text-xl font-bold text-white mt-6 mb-3 border-b border-white/10 pb-1.5">${formatInline(line.slice(3))}</h2>`;
        } else if (line.startsWith('# ')) {
            closeLists();
            html += `<h1 class="text-2xl font-extrabold text-white mt-6 mb-3">${formatInline(line.slice(2))}</h1>`;
        } else if (/^\d+\.\s+/.test(line)) {
            if (inUnorderedList) { html += '</ul>'; inUnorderedList = false; }
            if (!inOrderedList) { html += '<ol class="list-decimal pl-5 space-y-2 mb-4 text-gray-300">'; inOrderedList = true; }
            html += `<li>${formatInline(line.replace(/^\d+\.\s+/, ''))}</li>`;
        } else if (/^[-*]\s+/.test(line)) {
            if (inOrderedList) { html += '</ol>'; inOrderedList = false; }
            if (!inUnorderedList) { html += '<ul class="list-disc pl-5 space-y-2 mb-4 text-gray-300">'; inUnorderedList = true; }
            html += `<li>${formatInline(line.replace(/^[-*]\s+/, ''))}</li>`;
        } else {
            closeLists();
            html += `<p class="text-gray-300 leading-relaxed mb-3">${formatInline(line)}</p>`;
        }
    });

    closeLists();
    return html;
}