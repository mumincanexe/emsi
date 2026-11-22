// ==========================================
// 📜 NORMLAR, 🔔 BİLDİRİMLER, 📅 ETKİNLİKLER & 💬 DM MODÜLLERİ
// ==========================================

// ==========================================
// 🛠️ ORTAK YARDIMCILAR: SABİT MODAL BOYUTU, LİNKLEME & BOŞ RESİM YAMASI
// ==========================================

// 1. Modalların boyutunu ilk açıldığı boyutta sabitler (içerik değişse de oynamaz)
function enforceFixedModalDimensions() {
    const modalConfigs = [
        { id: 'normsModal', maxW: 'max-w-2xl' },
        { id: 'notificationsModal', maxW: 'max-w-lg' },
        { id: 'dmsModal', maxW: 'max-w-lg' },
        { id: 'eventsModal', maxW: 'max-w-lg' }
    ];

    modalConfigs.forEach(cfg => {
        const modal = document.getElementById(cfg.id);
        if (!modal) return;
        const card = modal.firstElementChild;
        if (!card) return;

        card.style.height = '560px';
        card.style.minHeight = '560px';
        card.style.maxHeight = '82vh';
        card.style.width = '100%';

        const body = card.querySelector('.overflow-y-auto');
        if (body) {
            body.style.flex = '1 1 0%';
            body.style.minHeight = '0';
        }
    });
}

// 2. Küçültülmüş ve önbellekli Avatar / Medya URL çözücü (Sayfa kasmasını önler)
var _avatarUrlMemo = new Map();
function getFastAvatarUrl(pictureUrl, fallbackName = 'U', size = 96) {
    const cacheKey = `${pictureUrl || ''}_${fallbackName}_${size}`;
    if (_avatarUrlMemo.has(cacheKey)) return _avatarUrlMemo.get(cacheKey);

    const fallback = `https://ui-avatars.com/api/?background=1e1f22&color=fff&name=${encodeURIComponent(fallbackName || 'U')}`;
    if (!pictureUrl) {
        _avatarUrlMemo.set(cacheKey, fallback);
        return fallback;
    }

    let finalUrl = '';
    if (typeof getOptimizedImageUrl === 'function') {
        finalUrl = getOptimizedImageUrl(pictureUrl, size);
    } else {
        const rawUrl = String(pictureUrl).startsWith('http')
            ? String(pictureUrl)
            : `https://api.meetingchallenge.com${String(pictureUrl).startsWith('/') ? '' : '/'}${pictureUrl}`;
        finalUrl = `https://meetingchallenge.com/_next/image?url=${encodeURIComponent(rawUrl)}&w=${size}&q=75`;
    }

    _avatarUrlMemo.set(cacheKey, finalUrl);
    return finalUrl;
}

function getRawMediaUrl(url) {
    if (!url) return '';
    if (typeof getDirectMediaUrl === 'function') return getDirectMediaUrl(url);
    if (String(url).startsWith('http')) return String(url);
    return `https://api.meetingchallenge.com${String(url).startsWith('/') ? '' : '/'}${url}`;
}

function escapeHtmlSafe(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// 3. Metin içindeki URL'leri tıklanabilir linke çevirir
function linkifySafeText(rawText, isOwnBubble = false) {
    const cleaned = String(rawText || '').replace(/\u200B/g, '');
    if (!cleaned.trim()) return '';
    const escaped = escapeHtmlSafe(cleaned);
    const linkColorClass = isOwnBubble
        ? 'underline text-white font-semibold hover:opacity-85 break-all'
        : 'underline text-indigo-400 hover:text-indigo-300 break-all';

    const urlRegex = /((?:https?:\/\/|www\.)[^\s<]+)/gi;
    return escaped.replace(urlRegex, (match) => {
        const href = match.toLowerCase().startsWith('http') ? match : `https://${match}`;
        return `<a href="${href}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" class="${linkColorClass}">${match}</a>`;
    });
}

// 4. Ana kanal sohbetindeki (#chatMessages) linkleri tıklanabilir yapar ve boş metinle resim göndermeyi aktif eder
function initChannelChatEnhancements() {
    // a) Resim seçildiğinde #sendBtn kilidini aç ve boş mesajla gönderime izin ver
    const chatFileInput = document.getElementById('chatFileInput');
    const chatInput = document.getElementById('chatInput');
    const sendBtn = document.getElementById('sendBtn');

    function syncMainChatSendButton() {
        if (!sendBtn) return;
        const hasText = chatInput && chatInput.value.trim().length > 0;
        const hasFile = (chatFileInput && chatFileInput.files && chatFileInput.files.length > 0) ||
                        (typeof selectedFile !== 'undefined' && !!selectedFile);
        sendBtn.disabled = !(hasText || hasFile);
    }

    if (chatFileInput && !chatFileInput._mcPatched) {
        chatFileInput._mcPatched = true;
        chatFileInput.addEventListener('change', () => {
            setTimeout(syncMainChatSendButton, 50);
        });
    }

    if (chatInput && !chatInput._mcPatched) {
        chatInput._mcPatched = true;
        chatInput.addEventListener('input', () => {
            setTimeout(syncMainChatSendButton, 20);
        });
    }

    // clearSelectedFile kancası
    if (typeof window.clearSelectedFile === 'function' && !window.clearSelectedFile._mcPatched) {
        const origClear = window.clearSelectedFile;
        window.clearSelectedFile = function(...args) {
            const res = origClear.apply(this, args);
            setTimeout(syncMainChatSendButton, 30);
            return res;
        };
        window.clearSelectedFile._mcPatched = true;
    }

    // handleSendMessage kancası: Dosya seçiliyse ve metin boşsa \u200B ekleyerek gönderir
    if (typeof window.handleSendMessage === 'function' && !window.handleSendMessage._mcPatched) {
        const origSend = window.handleSendMessage;
        window.handleSendMessage = function(event) {
            const hasFile = (chatFileInput && chatFileInput.files && chatFileInput.files.length > 0) ||
                            (typeof selectedFile !== 'undefined' && !!selectedFile);
            if (hasFile && chatInput && !chatInput.value.trim()) {
                chatInput.value = '\u200B';
            }
            return origSend.apply(this, arguments);
        };
        window.handleSendMessage._mcPatched = true;
    }

    // b) Ana kanal sohbetindeki düz metin linkleri otomatik tıklanabilir yap
    const chatMessagesEl = document.getElementById('chatMessages');
    if (chatMessagesEl && !chatMessagesEl._mcLinkObserver) {
        const linkifyNodeTree = (root) => {
            if (!root) return;
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
            const nodesToReplace = [];
            let node;
            while ((node = walker.nextNode())) {
                const parentTag = node.parentElement && node.parentElement.tagName;
                if (parentTag === 'A' || parentTag === 'SCRIPT' || parentTag === 'STYLE' || parentTag === 'TEXTAREA') continue;
                if (/(?:https?:\/\/|www\.)[^\s<]+/i.test(node.nodeValue)) {
                    nodesToReplace.push(node);
                }
            }
            nodesToReplace.forEach(textNode => {
                const span = document.createElement('span');
                span.innerHTML = linkifySafeText(textNode.nodeValue, false);
                if (textNode.parentNode) {
                    textNode.parentNode.replaceChild(span, textNode);
                }
            });
        };

        chatMessagesEl._mcLinkObserver = new MutationObserver(() => {
            linkifyNodeTree(chatMessagesEl);
        });
        chatMessagesEl._mcLinkObserver.observe(chatMessagesEl, { childList: true, subtree: true });
        linkifyNodeTree(chatMessagesEl);
    }
}

// ==========================================
// 📜 NORMLAR (KURALLAR) MODÜLÜ
// ==========================================
async function openNormsModal() {
    enforceFixedModalDimensions();
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

// ==========================================
// 🔔 BİLDİRİMLER (NOTIFICATIONS) MODÜLÜ
// Eklenen API'ler:
// - GET /User/get-notifications-pagination?lastNotificationId=X&limit=13
// - GET /User/read-notification?notificationId=X
// - GET /User/read-all-notification
// ==========================================
var notificationsListState = [];
var notificationsHasMore = true;
var notificationsLoadingMore = false;

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

async function fetchAndRenderNotifications(loadMore = false) {
    const token = localStorage.getItem('mc_token') || localStorage.getItem('Authorization');
    const container = document.querySelector('#notificationsModal .overflow-y-auto');
    if (!token || !container) return;

    if (!loadMore) {
        notificationsListState = [];
        notificationsHasMore = true;
        if (container.children.length <= 1) {
            container.innerHTML = '<div class="text-center text-gray-500 py-10 animate-pulse">Bildirimler yükleniyor...</div>';
        }
    } else {
        if (notificationsLoadingMore || !notificationsHasMore) return;
        notificationsLoadingMore = true;
        const btn = document.getElementById('btnLoadMoreNotifications');
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Yükleniyor...';
        }
    }

    const lastId = loadMore && notificationsListState.length > 0
        ? Number(notificationsListState[notificationsListState.length - 1].id || 0)
        : 0;

    try {
        const res = await fetch(`https://api.meetingchallenge.com/User/get-notifications-pagination?lastNotificationId=${lastId}&limit=13`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const result = await res.json();
        const items = (result && Array.isArray(result.data)) ? result.data : (Array.isArray(result) ? result : []);

        if (items.length < 13) notificationsHasMore = false;

        if (loadMore) {
            const existingIds = new Set(notificationsListState.map(n => n.id));
            items.forEach(it => {
                if (!existingIds.has(it.id)) notificationsListState.push(it);
            });
        } else {
            notificationsListState = items;
        }

        renderNotificationsModalContent();
    } catch (err) {
        if (!loadMore) {
            container.innerHTML = '<div class="text-center text-mc-red py-10">Bildirimler yüklenemedi.</div>';
        }
    } finally {
        notificationsLoadingMore = false;
    }
}

function renderNotificationsModalContent() {
    const container = document.querySelector('#notificationsModal .overflow-y-auto');
    if (!container) return;

    if (notificationsListState.length === 0) {
        container.innerHTML = '<div class="text-center text-gray-500 py-16">Henüz yeni bildiriminiz yok.</div>';
        setNotificationStatus(false);
        return;
    }

    const unreadCount = notificationsListState.filter(n => n.isRead === false).length;
    setNotificationStatus(unreadCount > 0);

    let html = `
        <div class="flex items-center justify-between mb-3 pb-2 border-b border-white/10">
            <span class="text-xs font-bold text-gray-400">
                ${unreadCount > 0 ? `<span class="text-mc-primary">${unreadCount} okunmamış</span> bildirim` : 'Tüm bildirimler okundu'}
            </span>
            ${unreadCount > 0 ? `
                <button type="button" onclick="markAllNotificationsRead()" class="text-xs font-semibold text-mc-primary hover:text-indigo-400 bg-mc-primary/10 hover:bg-mc-primary/20 px-2.5 py-1 rounded-lg transition-colors cursor-pointer">
                    ✓ Tümünü Okundu İşaretle
                </button>
            ` : ''}
        </div>
        <div class="flex flex-col gap-2">
    `;

    notificationsListState.forEach(item => {
        const isUnread = item.isRead === false;
        const readClass = isUnread
            ? 'bg-[#35373c] border-l-4 border-mc-primary shadow-md'
            : 'bg-[#2b2d31] opacity-80';

        html += `
            <div onclick="markSingleNotificationRead(${Number(item.id)})"
                 class="p-3 rounded-lg flex flex-col gap-1 transition-colors cursor-pointer hover:bg-[#3a3c42] ${readClass}">
                <div class="font-bold text-white text-sm flex items-center justify-between gap-2">
                    <span class="flex items-center gap-1.5 truncate">
                        <span class="text-mc-primary shrink-0">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"></path></svg>
                        </span>
                        <span class="truncate">${escapeHtmlSafe(item.title || 'Meeting Challenge')}</span>
                    </span>
                    ${isUnread ? `<span class="w-2 h-2 rounded-full bg-mc-primary shrink-0" title="Okunmadı"></span>` : ''}
                </div>
                <div class="text-gray-300 text-xs leading-relaxed">
                    ${linkifySafeText(item.body || '')}
                </div>
                <div class="text-[10px] text-gray-500 font-medium text-right mt-1">
                    ${typeof formatApiDate === 'function' ? formatApiDate(item.createDate) : (item.createDate || '')}
                </div>
            </div>
        `;
    });

    html += `</div>`;

    if (notificationsHasMore) {
        html += `
            <div class="pt-3 text-center">
                <button type="button" id="btnLoadMoreNotifications" onclick="fetchAndRenderNotifications(true)"
                    class="w-full py-2 bg-[#2b2d31] hover:bg-[#35373c] text-gray-300 hover:text-white text-xs font-semibold rounded-xl border border-white/5 transition-colors cursor-pointer">
                    Daha Fazla Yükle
                </button>
            </div>
        `;
    }

    container.innerHTML = html;
}

async function markSingleNotificationRead(notificationId) {
    if (!notificationId) return;
    const target = notificationsListState.find(n => Number(n.id) === Number(notificationId));
    if (target && target.isRead) return;

    if (target) target.isRead = true;
    renderNotificationsModalContent();

    const token = localStorage.getItem('mc_token') || localStorage.getItem('Authorization');
    if (!token) return;
    try {
        await fetch(`https://api.meetingchallenge.com/User/read-notification?notificationId=${encodeURIComponent(notificationId)}`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });
    } catch (_) {}
}

async function markAllNotificationsRead() {
    notificationsListState.forEach(n => { n.isRead = true; });
    renderNotificationsModalContent();

    const token = localStorage.getItem('mc_token') || localStorage.getItem('Authorization');
    if (!token) return;
    try {
        await fetch('https://api.meetingchallenge.com/User/read-all-notification', {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });
    } catch (_) {}
}

function openNotificationsModal() {
    enforceFixedModalDimensions();
    document.getElementById('notificationsModal').classList.remove('hidden');
    fetchAndRenderNotifications(false);
}

function closeNotificationsModal() { 
    document.getElementById('notificationsModal').classList.add('hidden'); 
}

// ==========================================
// 📅 GELİŞMİŞ ETKİNLİKLER (EVENTS) MODÜLÜ
// Eklenen API'ler:
// - POST /Event/get-events-by-date
// - POST /Event/get-event-by-id?eventId=X
// - POST /Event/join-event?eventId=X & leave-event?eventId=X
// - POST /Event/search-event ({ keyword })
// - GET  /Event/get-user-events
// - GET  /Setting/get-todays-birthday-users
// ==========================================

var EVENT_CITIES = [
    { id: "34", name: "İstanbul", aliases: ["istanbul", "i̇stanbul"] },
    { id: "35", name: "İzmir", aliases: ["izmir", "i̇zmir"] },
    { id: "6",  name: "Ankara", aliases: ["ankara"] },
    { id: "41", name: "Kocaeli", aliases: ["kocaeli", "izmit"] }
];

var activeEventsModalTab = 'upcoming'; // 'upcoming' | 'my_events' | 'birthdays'
var eventSearchQuery = '';
var eventSearchTimer = null;
var birthdayUsersCache = null;

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
    if (typeof selectedEventCityId !== 'undefined' && selectedEventCityId) return selectedEventCityId;

    const token = localStorage.getItem('mc_token') || localStorage.getItem('Authorization');
    if (!token) {
        window.selectedEventCityId = "34";
        return window.selectedEventCityId;
    }

    let uid = (typeof currentLoggedUserInfo !== 'undefined' && currentLoggedUserInfo.userId)
        ? currentLoggedUserInfo.userId
        : Number(localStorage.getItem('userid') || 0) || null;

    if (!uid && typeof parseJwt === 'function') {
        const jwtPayload = parseJwt(token);
        if (jwtPayload) {
            uid = Number(jwtPayload.Id || jwtPayload.id || jwtPayload.sub) || null;
        }
    }

    if (uid && (typeof userCityFetched === 'undefined' || !userCityFetched)) {
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
                    window.selectedEventCityId = mappedId;
                }
                if (typeof currentLoggedUserInfo !== 'undefined') {
                    currentLoggedUserInfo.city = userData.city;
                }
            }
        } catch (err) {
            console.warn("Kullanıcı şehir bilgisi alınamadı, varsayılan İstanbul seçiliyor:", err);
        } finally {
            window.userCityFetched = true;
        }
    }

    if (typeof selectedEventCityId === 'undefined' || !selectedEventCityId) {
        window.selectedEventCityId = "34";
    }
    return window.selectedEventCityId;
}

function switchEventsModalTab(tabName) {
    activeEventsModalTab = tabName;
    window.currentOpenEventId = null;
    if (tabName === 'upcoming') {
        fetchAndRenderEvents();
    } else if (tabName === 'my_events') {
        fetchAndRenderMyEvents();
    } else if (tabName === 'birthdays') {
        fetchAndRenderBirthdayUsers();
    }
}

function selectEventCity(cityId) {
    window.selectedEventCityId = String(cityId);
    window.currentOpenEventId = null;
    eventSearchQuery = '';
    activeEventsModalTab = 'upcoming';
    fetchAndRenderEvents();
}

function renderEventsModalTopNavigation() {
    const tabs = [
        { id: 'upcoming', label: '📅 Etkinlikler' },
        { id: 'my_events', label: '🎫 Katıldıklarım' },
        { id: 'birthdays', label: '🎂 Doğum Günleri' }
    ];

    return `
        <div class="flex flex-col gap-2.5 mb-3 pb-2.5 border-b border-white/10 shrink-0">
            <!-- Sekmeler -->
            <div class="flex items-center gap-1.5 bg-[#1e1f22] p-1 rounded-xl">
                ${tabs.map(t => `
                    <button type="button" onclick="switchEventsModalTab('${t.id}')"
                        class="flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${activeEventsModalTab === t.id ? 'bg-mc-primary text-white shadow' : 'text-gray-400 hover:text-white'}">
                        ${t.label}
                    </button>
                `).join('')}
            </div>

            ${activeEventsModalTab === 'upcoming' ? `
                <!-- Şehir Seçimi ve Arama -->
                <div class="flex items-center justify-between gap-2 flex-wrap">
                    <div class="flex items-center gap-1 flex-wrap">
                        ${EVENT_CITIES.map(c => {
                            const isActive = String(window.selectedEventCityId) === String(c.id) && !eventSearchQuery;
                            return `
                                <button type="button" onclick="selectEventCity('${c.id}')" 
                                    class="px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${isActive ? 'bg-mc-primary text-white shadow-sm' : 'bg-[#1e1f22] text-gray-400 hover:bg-[#35373c] hover:text-gray-200'}">
                                    ${c.name}
                                </button>
                            `;
                        }).join('')}
                    </div>
                    <div class="relative flex-1 min-w-[140px]">
                        <input type="text" id="eventSearchInputBox" value="${escapeHtmlSafe(eventSearchQuery)}"
                            oninput="handleEventSearchInput(this.value)"
                            placeholder="Etkinlik ara..."
                            class="w-full bg-[#1e1f22] border border-white/10 rounded-lg pl-7 pr-6 py-1 text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-mc-primary">
                        <svg class="w-3.5 h-3.5 text-gray-500 absolute left-2 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z"></path></svg>
                    </div>
                </div>
            ` : ''}
        </div>
    `;
}

function handleEventSearchInput(val) {
    eventSearchQuery = String(val || '');
    if (eventSearchTimer) clearTimeout(eventSearchTimer);

    const trimmed = eventSearchQuery.trim();
    if (trimmed.length === 0) {
        fetchAndRenderEvents();
        return;
    }
    if (trimmed.length < 2) return;

    eventSearchTimer = setTimeout(async () => {
        const token = localStorage.getItem('mc_token') || localStorage.getItem('Authorization');
        const listBox = document.getElementById('eventsModalListBody');
        if (!token || !listBox) return;

        listBox.innerHTML = `<div class="text-center text-gray-400 py-10 animate-pulse text-xs">"${escapeHtmlSafe(trimmed)}" için etkinlikler aranıyor...</div>`;
        try {
            const res = await fetch('https://api.meetingchallenge.com/Event/search-event', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ keyword: trimmed })
            });
            const json = await res.json();
            const items = Array.isArray(json) ? json : (Array.isArray(json.data) ? json.data : []);
            renderEventCardsIntoBox(listBox, items, `"${escapeHtmlSafe(trimmed)}" araması için etkinlik bulunamadı.`);
        } catch (err) {
            listBox.innerHTML = `<div class="text-center text-mc-red py-10 text-xs">Arama sırasında hata oluştu.</div>`;
        }
    }, 350);
}

function isUserJoinedEvent(eventObj) {
    if (!eventObj) return false;
    if (eventObj.isJoined === true) return true;
    if (Number(eventObj.eventJoinStatus) === 2) return true;
    const statusText = String(eventObj.eventJoinStatusName || '').toLocaleLowerCase('tr-TR');
    if (statusText.includes('katıldın') || statusText.includes('katildin')) return true;

    const myId = typeof currentLoggedUserInfo !== 'undefined' ? Number(currentLoggedUserInfo.userId) : Number(localStorage.getItem('userid') || 0);
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
    const token = localStorage.getItem('mc_token') || localStorage.getItem('Authorization');
    if (!token || !eventId) return null;

    const url = `https://api.meetingchallenge.com/Event/get-event-by-id?eventId=${encodeURIComponent(eventId)}`;
    const headers = {
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`,
        'lang': 'tr'
    };

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
    } catch (_) {}

    try {
        const resGet = await fetch(url, { method: 'GET', headers });
        if (resGet.ok) {
            const json = await resGet.json();
            if (json && (json.data || json.id || json.name)) {
                return json.data || json;
            }
        }
    } catch (_) {}

    if (typeof eventsListCache !== 'undefined' && eventsListCache.has(Number(eventId))) {
        return eventsListCache.get(Number(eventId));
    }

    return null;
}

function renderEventCardsIntoBox(targetBox, items, emptyMessage) {
    if (!targetBox) return;
    if (!Array.isArray(items) || items.length === 0) {
        targetBox.innerHTML = `
            <div class="text-center text-gray-400 py-12 flex flex-col items-center gap-2">
                <svg class="w-10 h-10 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                <span>${emptyMessage}</span>
            </div>
        `;
        return;
    }

    let html = '<div class="flex flex-col gap-3">';
    items.forEach(item => {
        if (typeof eventsListCache !== 'undefined') {
            eventsListCache.set(Number(item.id), item);
        }

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
                        ${escapeHtmlSafe(item.name || item.title || 'Etkinlik')}
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
                            ${typeof formatApiDate === 'function' ? formatApiDate(item.eventDate) : (item.eventDate || '')}
                        </span>
                        <span class="flex items-center gap-1">
                            <svg class="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                            ${escapeHtmlSafe(item.locationName || item.cityName || 'Konum Belirtilmemiş')}
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
    targetBox.innerHTML = html;
}

async function fetchAndRenderEvents() {
    const token = localStorage.getItem('mc_token') || localStorage.getItem('Authorization');
    const container = document.querySelector('#eventsModal .overflow-y-auto');
    if (!token || !container) return;

    window.currentOpenEventId = null;
    await resolveUserDefaultEventCity();

    container.innerHTML = `
        ${renderEventsModalTopNavigation()}
        <div id="eventsModalListBody" class="flex-1">
            <div class="text-center text-gray-500 py-10 animate-pulse">Etkinlikler yükleniyor...</div>
        </div>
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
                cityId: String(window.selectedEventCityId)
            })
        });
        const result = await res.json();
        const items = (result && Array.isArray(result.data)) ? result.data : (Array.isArray(result) ? result : []);

        const selectedCityObj = EVENT_CITIES.find(c => c.id === String(window.selectedEventCityId));
        const cityNameLabel = selectedCityObj ? selectedCityObj.name : 'Bu şehir';
        const listBox = document.getElementById('eventsModalListBody');
        renderEventCardsIntoBox(listBox, items, `${cityNameLabel} için yaklaşan etkinlik bulunmuyor.`);
    } catch (err) {
        const listBox = document.getElementById('eventsModalListBody');
        if (listBox) listBox.innerHTML = `<div class="text-center text-mc-red py-10">Etkinlikler yüklenemedi.</div>`;
    }
}

// Katıldığım Etkinlikler (/Event/get-user-events)
async function fetchAndRenderMyEvents() {
    const token = localStorage.getItem('mc_token') || localStorage.getItem('Authorization');
    const container = document.querySelector('#eventsModal .overflow-y-auto');
    if (!token || !container) return;

    container.innerHTML = `
        ${renderEventsModalTopNavigation()}
        <div id="eventsModalListBody" class="flex-1">
            <div class="text-center text-gray-500 py-10 animate-pulse">Katıldığınız etkinlikler yükleniyor...</div>
        </div>
    `;

    try {
        const res = await fetch('https://api.meetingchallenge.com/Event/get-user-events', {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const json = await res.json();
        const items = Array.isArray(json) ? json : (Array.isArray(json.data) ? json.data : []);
        const listBox = document.getElementById('eventsModalListBody');
        renderEventCardsIntoBox(listBox, items, 'Henüz katıldığınız bir etkinlik bulunmuyor.');
    } catch (err) {
        const listBox = document.getElementById('eventsModalListBody');
        if (listBox) listBox.innerHTML = `<div class="text-center text-mc-red py-10">Etkinlikleriniz alınamadı.</div>`;
    }
}

// Bugün Doğum Günü Olanlar (/Setting/get-todays-birthday-users)
async function fetchAndRenderBirthdayUsers() {
    const token = localStorage.getItem('mc_token') || localStorage.getItem('Authorization');
    const container = document.querySelector('#eventsModal .overflow-y-auto');
    if (!token || !container) return;

    container.innerHTML = `
        ${renderEventsModalTopNavigation()}
        <div id="eventsModalListBody" class="flex-1">
            <div class="text-center text-gray-500 py-10 animate-pulse">Doğum günü listesi yükleniyor...</div>
        </div>
    `;

    try {
        if (!birthdayUsersCache) {
            const res = await fetch('https://api.meetingchallenge.com/Setting/get-todays-birthday-users', {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const json = await res.json();
            birthdayUsersCache = Array.isArray(json) ? json : (Array.isArray(json.data) ? json.data : []);
        }

        const listBox = document.getElementById('eventsModalListBody');
        if (!listBox) return;

        if (!birthdayUsersCache || birthdayUsersCache.length === 0) {
            listBox.innerHTML = `
                <div class="text-center text-gray-400 py-14 flex flex-col items-center gap-2">
                    <span class="text-3xl">🎂</span>
                    <span>Bugün doğum günü olan üyemiz bulunmuyor.</span>
                </div>
            `;
            return;
        }

        listBox.innerHTML = `
            <div class="flex flex-col gap-2">
                ${birthdayUsersCache.map(u => {
                    const avatar = getFastAvatarUrl(u.pictureUrl, u.username || u.name, 64);
                    const safeUname = String(u.username || '').replace(/'/g, "\\'");
                    const safePic = String(u.pictureUrl || '').replace(/'/g, "\\'");
                    const fullName = (u.name && u.surname) ? `${u.name} ${u.surname}` : (u.name || u.username || 'Üye');
                    const safeFull = String(fullName).replace(/'/g, "\\'");
                    return `
                        <div class="flex items-center justify-between gap-3 p-3 rounded-xl bg-[#2b2d31] border border-white/5 hover:bg-[#35373c] transition-colors">
                            <div onclick="closeEventsModal(); openUserProfileModal(${Number(u.id) || 'null'}, '${safeUname}', '${safePic}')"
                                 class="flex items-center gap-3 cursor-pointer min-w-0 flex-1">
                                <img src="${avatar}" loading="lazy" decoding="async" class="w-10 h-10 rounded-full object-cover bg-[#1e1f22] shrink-0">
                                <div class="min-w-0">
                                    <div class="text-sm font-bold text-white truncate">🎂 ${escapeHtmlSafe(fullName)}</div>
                                    <div class="text-xs text-gray-400 truncate">@${escapeHtmlSafe(u.username || '')}</div>
                                </div>
                            </div>
                            <button type="button" onclick="closeEventsModal(); startDMFromUserProfile(${Number(u.id) || 'null'}, '${safeUname}', '${safePic}', '${safeFull}')"
                                class="px-3 py-1.5 rounded-lg bg-mc-primary hover:bg-[#4752C4] text-white text-xs font-semibold shrink-0 cursor-pointer">
                                💬 Kutla
                            </button>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    } catch (err) {
        const listBox = document.getElementById('eventsModalListBody');
        if (listBox) listBox.innerHTML = `<div class="text-center text-mc-red py-10">Doğum günü listesi yüklenemedi.</div>`;
    }
}

async function openEventDetails(eventId) {
    const token = localStorage.getItem('mc_token') || localStorage.getItem('Authorization');
    const container = document.querySelector('#eventsModal .overflow-y-auto');
    if (!token || !container || !eventId) return;

    window.currentOpenEventId = Number(eventId);
    container.innerHTML = `
        <div class="flex items-center gap-2 mb-3 pb-2 border-b border-white/10">
            <button type="button" onclick="switchEventsModalTab('${activeEventsModalTab}')" class="text-xs font-semibold text-gray-300 hover:text-white bg-[#1e1f22] hover:bg-[#35373c] px-2.5 py-1.5 rounded-lg flex items-center gap-1 transition-colors cursor-pointer">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path></svg>
                Listeye Dön
            </button>
        </div>
        <div class="text-center text-gray-400 py-12 animate-pulse">Etkinlik detayları yükleniyor...</div>
    `;

    try {
        const ev = await fetchEventDetailFromApi(eventId);
        if (!ev) throw new Error("Etkinlik detayı alınamadı.");

        const users = Array.isArray(ev.eventUsers) ? ev.eventUsers : [];
        const pCount = ev.participants ?? users.length;
        const capacity = ev.capacity || 'Sınırsız';
        const joined = isUserJoinedEvent(ev);
        const isFull = typeof ev.capacity === 'number' && pCount >= ev.capacity && !joined;

        const joinBtnClass = joined
            ? 'bg-mc-green/20 hover:bg-mc-red text-mc-green hover:text-white border border-mc-green/40 hover:border-mc-red'
            : (isFull ? 'bg-gray-700 text-gray-400 cursor-not-allowed' : 'bg-mc-primary hover:bg-indigo-500 text-white');

        const joinBtnContent = joined
            ? `<span class="group-hover/detailjoin:hidden">✓ ${escapeHtmlSafe(ev.eventJoinStatusName || 'Katıldın')}</span><span class="hidden group-hover/detailjoin:inline">✕ Katılımdan Vazgeç</span>`
            : (isFull ? 'Kontenjan Dolu' : 'Etkinliğe Katıl');

        const statusBadge = ev.eventJoinStatusName || joined
            ? `<span class="text-[11px] font-bold px-2.5 py-1 rounded-full ${joined ? 'bg-mc-green/20 text-mc-green border border-mc-green/30' : 'bg-white/10 text-gray-300'}">${escapeHtmlSafe(ev.eventJoinStatusName || (joined ? 'Katıldın' : ''))}</span>`
            : '';

        const channelBtnHtml = ev.channelId
            ? `<button type="button" onclick="openEventChannelFromModal(${ev.channelId})" class="px-3.5 py-2 rounded-lg text-xs font-semibold bg-[#1e1f22] hover:bg-[#35373c] text-gray-200 border border-white/10 flex items-center gap-1.5 transition-colors cursor-pointer">
                    <svg class="w-4 h-4 text-mc-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"></path></svg>
                    Etkinlik Kanalına Git
               </button>`
            : '';

        const participantsHtml = users.length > 0
            ? users.map(u => {
                const avatar = getFastAvatarUrl(u.pictureUrl, u.username || 'U', 64);
                const safeUname = String(u.username || 'Kullanıcı').replace(/'/g, "\\'");
                const safePic = u.pictureUrl ? String(u.pictureUrl).replace(/'/g, "\\'") : '';

                return `
                    <div onclick="closeEventsModal(); openUserProfileModal(${Number(u.id) || 'null'}, '${safeUname}', '${safePic}')" 
                         class="flex items-center gap-2 bg-[#1e1f22] hover:bg-[#35373c] p-2 rounded-lg border border-white/5 cursor-pointer transition-colors group/p">
                        <img src="${avatar}" loading="lazy" decoding="async" alt="${escapeHtmlSafe(u.username)}" class="w-7 h-7 rounded-full object-cover bg-[#111214] shrink-0">
                        <div class="min-w-0 flex-1">
                            <div class="text-xs font-semibold text-gray-200 group-hover/p:text-white truncate">@${escapeHtmlSafe(u.username)}</div>
                        </div>
                    </div>
                `;
            }).join('')
            : '<div class="text-xs text-gray-500 italic col-span-full py-3 text-center">Henüz katılımcı bulunmuyor. İlk katılan sen ol!</div>';

        container.innerHTML = `
            <div class="flex flex-col gap-3.5">
                <div class="flex items-center justify-between gap-2 pb-2 border-b border-white/10">
                    <button type="button" onclick="switchEventsModalTab('${activeEventsModalTab}')" class="text-xs font-semibold text-gray-300 hover:text-white bg-[#1e1f22] hover:bg-[#35373c] px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path></svg>
                        Listeye Dön
                    </button>
                    ${statusBadge}
                </div>

                <div class="bg-[#2b2d31] p-4 rounded-xl border border-white/5 flex flex-col gap-3">
                    <div class="flex items-start justify-between gap-3">
                        <div>
                            <h3 class="text-lg font-bold text-white leading-snug">${escapeHtmlSafe(ev.name || 'Etkinlik')}</h3>
                            ${ev.createdBy ? `<div class="text-xs text-gray-400 mt-0.5">Organizatör: <span class="text-gray-200 font-semibold">${escapeHtmlSafe(ev.createdBy)}</span></div>` : ''}
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
                                <div class="text-gray-100 font-semibold">${typeof formatApiDate === 'function' ? formatApiDate(ev.eventDate) : (ev.eventDate || '')}</div>
                            </div>
                        </div>
                        <div class="bg-[#1e1f22] p-2.5 rounded-lg border border-white/5 flex items-center gap-2.5">
                            <svg class="w-4 h-4 text-mc-green shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                            <div class="min-w-0">
                                <div class="text-[10px] text-gray-400 uppercase font-bold">Mekan / Şehir</div>
                                <div class="text-gray-100 font-semibold truncate">
                                    ${escapeHtmlSafe(ev.locationName ? `${ev.locationName}${ev.cityName ? ' • ' + ev.cityName : ''}` : (ev.cityName || 'Belirtilmemiş'))}
                                </div>
                            </div>
                        </div>
                    </div>

                    ${ev.description ? `
                        <div class="bg-[#1e1f22] p-3 rounded-lg border border-white/5">
                            <div class="text-[10px] font-bold text-gray-400 uppercase mb-1">Etkinlik Açıklaması</div>
                            <div class="text-xs text-gray-200 whitespace-pre-line leading-relaxed">${linkifySafeText(ev.description)}</div>
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
        container.innerHTML = `
            <div class="flex items-center gap-2 mb-3 pb-2 border-b border-white/10">
                <button type="button" onclick="switchEventsModalTab('${activeEventsModalTab}')" class="text-xs font-semibold text-gray-300 hover:text-white bg-[#1e1f22] px-2.5 py-1.5 rounded-lg flex items-center gap-1 cursor-pointer">
                    ← Listeye Dön
                </button>
            </div>
            <div class="text-center text-mc-red py-10">Etkinlik detayları yüklenemedi.</div>
        `;
    }
}

async function toggleEventJoin(eventId, isCurrentlyJoined, domEvent, isFromDetailView = false) {
    if (domEvent) domEvent.stopPropagation();
    const token = localStorage.getItem('mc_token') || localStorage.getItem('Authorization');
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
            if (isFromDetailView || window.currentOpenEventId === Number(eventId)) {
                await openEventDetails(eventId);
            } else {
                await switchEventsModalTab(activeEventsModalTab);
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
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    }
}

function openEventChannelFromModal(channelId) {
    if (!channelId) return;
    closeEventsModal();
    const targetCh = (typeof globalChannels !== 'undefined' && Array.isArray(globalChannels))
        ? globalChannels.find(c => Number(c.id) === Number(channelId))
        : null;
    if (targetCh && typeof handleChannelClick === 'function') {
        handleChannelClick(targetCh);
    } else {
        window.activeViewingChannelId = Number(channelId);
        if (typeof startChatPolling === 'function') startChatPolling(Number(channelId));
        if (typeof syncMainLayout === 'function') syncMainLayout();
        if (typeof renderSidebar === 'function') renderSidebar(true);
    }
}

function openEventsModal() {
    enforceFixedModalDimensions();
    document.getElementById('eventsModal').classList.remove('hidden');
    switchEventsModalTab(activeEventsModalTab || 'upcoming');
}

function closeEventsModal() { 
    document.getElementById('eventsModal').classList.add('hidden'); 
    window.currentOpenEventId = null;
}

// ==========================================
// 👤 KULLANICI PROFİLİ MODALI EK API'LERİ
// - Direkt Mesaj Başlatma Butonu
// - Engelle / Engeli Kaldır (/User/change-block-status)
// ==========================================
function enhanceUserProfileModalActions() {
    if (typeof window.openUserProfileModal !== 'function' || window.openUserProfileModal._mcEnhanced) return;
    const origOpenProfile = window.openUserProfileModal;

    window.openUserProfileModal = async function(userId, username, pictureUrl) {
        const res = await origOpenProfile.apply(this, arguments);
        injectProfileModalActionButtons(userId, username, pictureUrl);
        return res;
    };
    window.openUserProfileModal._mcEnhanced = true;
}

function injectProfileModalActionButtons(userId, username, pictureUrl) {
    const detailsSection = document.getElementById('profileModalDetailsSection');
    if (!detailsSection) return;

    let actionsBar = document.getElementById('profileModalCustomActions');
    if (actionsBar) actionsBar.remove();

    const myId = getMyUserIdForDM();
    const cleanUname = String(username || '').replace(/^@/, '').trim();
    if (!userId && !cleanUname) return;
    if (myId && Number(userId) === Number(myId)) return; // Kendi profilimizse gösterme

    const safeUname = cleanUname.replace(/'/g, "\\'");
    const safePic = String(pictureUrl || '').replace(/'/g, "\\'");

    actionsBar = document.createElement('div');
    actionsBar.id = 'profileModalCustomActions';
    actionsBar.className = 'flex items-center gap-2 pt-3 border-t border-white/10';
    actionsBar.innerHTML = `
        <button type="button" onclick="startDMFromUserProfile(${Number(userId) || 'null'}, '${safeUname}', '${safePic}')"
            class="flex-1 bg-mc-primary hover:bg-[#4752C4] text-white py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow">
            <span>💬</span> Mesaj Gönder
        </button>
        ${userId ? `
            <button type="button" onclick="toggleBlockUserFromProfile(${Number(userId)}, '${safeUname}')"
                class="bg-[#1e1f22] hover:bg-mc-red/20 text-gray-300 hover:text-mc-red border border-white/10 py-2 px-3 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
                title="Kullanıcıyı Engelle / Engeli Kaldır">
                🚫 Engelle
            </button>
        ` : ''}
    `;
    detailsSection.appendChild(actionsBar);
}

async function toggleBlockUserFromProfile(targetUserId, username) {
    if (!targetUserId) return;
    if (!confirm(`@${username} kullanıcısının engel durumunu değiştirmek istediğinize emin misiniz?`)) return;

    const token = localStorage.getItem('mc_token') || localStorage.getItem('Authorization');
    if (!token) return;

    try {
        const res = await fetch('https://api.meetingchallenge.com/User/change-block-status', {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ blockedUserId: Number(targetUserId), userId: Number(targetUserId) })
        });
        const json = await res.json().catch(() => ({}));
        alert(json.message || 'Kullanıcı engel durumu güncellendi.');
    } catch (err) {
        alert('İşlem sırasında hata oluştu.');
    }
}

// ==========================================
// 💬 DM (DİREKT MESAJLAR) MODÜLÜ (SignalR chairohub)
// ==========================================

var DM_CACHE_STORAGE_KEY = 'mc_dm_conversations_cache_v1';

var dmStore = {
    conversations: [],
    activeConversationId: null,
    activePartner: null,
    messagesByConversation: {},
    typingUsers: {},
    searchQuery: '',
    searchedUsers: [],
    isSearchingUsers: false,
    editingMessageId: null,
    selectedFile: null,
    selectedFilePreviewUrl: ''
};

// Önbellekteki konuşma listesini yükle (Anında açılış için)
try {
    const cached = sessionStorage.getItem(DM_CACHE_STORAGE_KEY) || localStorage.getItem(DM_CACHE_STORAGE_KEY);
    if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) dmStore.conversations = parsed;
    }
} catch (_) {}

function saveDMConversationsCache() {
    try {
        const data = JSON.stringify(dmStore.conversations.slice(0, 60));
        sessionStorage.setItem(DM_CACHE_STORAGE_KEY, data);
        localStorage.setItem(DM_CACHE_STORAGE_KEY, data);
    } catch (_) {}
}

var dmSearchDebounceTimer = null;
var dmTypingEmitTimer = null;

// SignalR HubConnection.prototype Kancası:
// js/signalr.js içindeki mevcut bağlantıyı otomatik yakalar, ikinci bağlantı açıp çakışma yaratmaz!
(function installSignalRPrototypeHook() {
    if (typeof signalR === 'undefined' || !signalR.HubConnection) return;
    const proto = signalR.HubConnection.prototype;
    if (proto._mcDMHookInstalled) return;
    proto._mcDMHookInstalled = true;

    function captureInstance(instance) {
        if (!instance || typeof instance.on !== 'function') return;
        if (window.__mcCapturedHubConnection !== instance) {
            window.__mcCapturedHubConnection = instance;
            bindDMSignalREvents(instance);
        }
    }

    const origStart = proto.start;
    proto.start = function(...args) {
        captureInstance(this);
        const p = origStart.apply(this, args);
        this._mcStartPromise = p;
        p.then(() => {
            setTimeout(() => dmInvokeGetConversationList(), 300);
        }).catch(() => {});
        return p;
    };

    const origInvoke = proto.invoke;
    proto.invoke = function(...args) {
        captureInstance(this);
        return origInvoke.apply(this, args);
    };

    const origOn = proto.on;
    proto.on = function(...args) {
        captureInstance(this);
        return origOn.apply(this, args);
    };

    if (typeof proto._processIncomingData === 'function') {
        const origProcess = proto._processIncomingData;
        proto._processIncomingData = function(...args) {
            captureInstance(this);
            return origProcess.apply(this, args);
        };
    }
})();

function findExistingSignalRConnection() {
    if (window.__mcCapturedHubConnection) return window.__mcCapturedHubConnection;

    const candidates = [
        typeof hubConnection !== 'undefined' ? hubConnection : null,
        typeof signalRConnection !== 'undefined' ? signalRConnection : null,
        typeof chatConnection !== 'undefined' ? chatConnection : null,
        typeof connection !== 'undefined' ? connection : null,
        window.hubConnection,
        window.signalRConnection,
        window.connection
    ];

    for (const c of candidates) {
        if (c && typeof c.invoke === 'function' && typeof c.on === 'function') {
            window.__mcCapturedHubConnection = c;
            return c;
        }
    }
    return null;
}

async function ensureDMSignalRConnected() {
    let conn = findExistingSignalRConnection();

    // Eğer uygulamada henüz hiç bağlantı oluşturulmamışsa yedek bağlantı oluştur
    if (!conn && typeof signalR !== 'undefined' && signalR.HubConnectionBuilder) {
        const token = localStorage.getItem('mc_token') || localStorage.getItem('Authorization') || '';
        if (!token) return null;

        conn = new signalR.HubConnectionBuilder()
            .withUrl('https://api.meetingchallenge.com/chairohub', {
                accessTokenFactory: () => localStorage.getItem('mc_token') || localStorage.getItem('Authorization') || ''
            })
            .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
            .build();
        window.__mcCapturedHubConnection = conn;
    }

    if (!conn) return null;
    bindDMSignalREvents(conn);

    if (conn.state === 'Connected') return conn;

    if (conn.state === 'Connecting' || conn.state === 'Reconnecting') {
        if (conn._mcStartPromise) {
            try { await conn._mcStartPromise; } catch (_) {}
        }
        // Bağlantı kurulana kadar en fazla 4 saniye bekle
        for (let i = 0; i < 40; i++) {
            if (conn.state === 'Connected') return conn;
            await new Promise(r => setTimeout(r, 100));
        }
        return conn.state === 'Connected' ? conn : null;
    }

    if (conn.state === 'Disconnected' && typeof conn.start === 'function') {
        try {
            conn._mcStartPromise = conn.start();
            await conn._mcStartPromise;
            return conn;
        } catch (err) {
            console.warn('[DM SignalR] Bağlantı başlatılamadı:', err);
            return null;
        }
    }

    return conn;
}

function bindDMSignalREvents(conn) {
    if (!conn || conn._dmEventsBound) return;
    conn._dmEventsBound = true;

    // 1. Konuşma Listesi Geldiğinde
    conn.on('DMConversationListReceived', (list) => {
        const arr = Array.isArray(list) ? list : (list && Array.isArray(list.conversations) ? list.conversations : []);
        dmStore.conversations = arr.map(normalizeDMConversation).filter(Boolean);
        saveDMConversationsCache();
        updateSidebarDMBadge();

        // Eğer yeni mesaj gönderilmiş ve conversationId henüz belli değilse eşleştir
        if (dmStore.activePartner && !dmStore.activePartner.conversationId && dmStore.activePartner.userId) {
            const matched = dmStore.conversations.find(c => Number(c.userId) === Number(dmStore.activePartner.userId));
            if (matched && matched.conversationId) {
                dmStore.activePartner.conversationId = matched.conversationId;
                dmStore.activeConversationId = matched.conversationId;
                dmInvokeGetMessages(matched.conversationId, 0);
            }
        }

        if (isDMsModalOpen() && !dmStore.activePartner) {
            updateDMInboxListDOMOnly();
        }
    });

    // 2. Mesajlar Geldiğinde
    conn.on('DMMessagesReceived', (payload) => {
        if (!payload) return;
        const convId = Number(payload.conversationId || (dmStore.activePartner && dmStore.activePartner.conversationId));
        const incoming = Array.isArray(payload.messages) ? payload.messages : (Array.isArray(payload) ? payload : []);
        if (!convId) return;

        const normalizedIncoming = incoming.map(normalizeDMMessage).filter(Boolean);
        const existing = (dmStore.messagesByConversation[convId] || []).filter(m => !String(m.id).startsWith('temp_'));

        let wasPrepend = false;
        if (existing.length > 0 && normalizedIncoming.length > 0) {
            const existingIds = new Set(existing.map(m => Number(m.id)));
            const olderUnique = normalizedIncoming.filter(m => !existingIds.has(Number(m.id)));
            if (olderUnique.length > 0 && Number(normalizedIncoming[0].id) < Number(existing[0].id)) {
                dmStore.messagesByConversation[convId] = [...olderUnique, ...existing];
                wasPrepend = true;
            } else {
                dmStore.messagesByConversation[convId] = normalizedIncoming;
            }
        } else {
            dmStore.messagesByConversation[convId] = normalizedIncoming;
        }

        if (isDMsModalOpen() && dmStore.activePartner && Number(dmStore.activePartner.conversationId) === convId) {
            renderActiveDMMessagesList(!wasPrepend);
        }
    });

    // 3. Yeni Mesaj Geldiğinde
    conn.on('ReceiveDMMessage', (rawMsg) => {
        const msg = normalizeDMMessage(rawMsg);
        if (!msg) return;

        let convId = Number(msg.conversationId);
        if (dmStore.activePartner && !dmStore.activePartner.conversationId) {
            if (Number(msg.senderId) === Number(dmStore.activePartner.userId) || msg.isMine) {
                dmStore.activePartner.conversationId = convId;
                dmStore.activeConversationId = convId;
            }
        }

        if (convId) {
            // Geçici (optimistik) mesajı temizle ve gerçek mesajı ekle
            const list = (dmStore.messagesByConversation[convId] || []).filter(m => {
                if (!String(m.id).startsWith('temp_')) return true;
                return m.content.trim() !== msg.content.trim();
            });
            if (!list.some(m => Number(m.id) === Number(msg.id))) {
                dmStore.messagesByConversation[convId] = [...list, msg];
            } else {
                dmStore.messagesByConversation[convId] = list;
            }
        }

        const isCurrentOpenChat = isDMsModalOpen() && dmStore.activePartner && Number(dmStore.activePartner.conversationId) === convId;
        const convIndex = dmStore.conversations.findIndex(c => Number(c.conversationId) === convId);

        if (convIndex > -1) {
            const conv = dmStore.conversations[convIndex];
            conv.lastMessage = msg.content.replace(/\u200B/g, '').trim() || (msg.attachmentUrl ? '📷 Fotoğraf' : '');
            conv.lastMessageDate = msg.createDate;
            if (!msg.isMine && !isCurrentOpenChat) {
                conv.unreadCount = (Number(conv.unreadCount) || 0) + 1;
            }
            dmStore.conversations.splice(convIndex, 1);
            dmStore.conversations.unshift(conv);
            saveDMConversationsCache();
        } else {
            dmInvokeGetConversationList();
        }

        updateSidebarDMBadge();

        if (isCurrentOpenChat) {
            renderActiveDMMessagesList(true);
            dmInvokeMarkAsRead(convId);
        } else if (isDMsModalOpen() && !dmStore.activePartner) {
            updateDMInboxListDOMOnly();
        }
    });

    // 4. Mesaj Düzenlendiğinde
    conn.on('DMMessageUpdated', (rawMsg) => {
        const msg = normalizeDMMessage(rawMsg);
        if (!msg || !msg.conversationId) return;
        const convId = Number(msg.conversationId);
        const list = dmStore.messagesByConversation[convId] || [];
        dmStore.messagesByConversation[convId] = list.map(m => Number(m.id) === Number(msg.id) ? msg : m);

        if (isDMsModalOpen() && dmStore.activePartner && Number(dmStore.activePartner.conversationId) === convId) {
            renderActiveDMMessagesList(false);
        }
    });

    // 5. Mesaj Silindiğinde
    conn.on('DMMessageDeleted', (payload) => {
        if (!payload) return;
        const convId = Number(payload.conversationId);
        const messageId = Number(payload.messageId || payload.id);
        if (!convId || !messageId) return;

        const list = dmStore.messagesByConversation[convId] || [];
        dmStore.messagesByConversation[convId] = list.filter(m => Number(m.id) !== messageId);

        if (isDMsModalOpen() && dmStore.activePartner && Number(dmStore.activePartner.conversationId) === convId) {
            renderActiveDMMessagesList(false);
        }
    });

    // 6. Okundu Bilgisi
    conn.on('DMConversationMarkedAsRead', (payload) => {
        const convId = Number(payload?.conversationId || payload);
        if (!convId) return;
        dmStore.conversations = dmStore.conversations.map(c =>
            Number(c.conversationId) === convId ? { ...c, unreadCount: 0 } : c
        );
        saveDMConversationsCache();
        updateSidebarDMBadge();
    });

    // 7. Yazıyor... Bilgisi
    conn.on('DMTypingStatusReceived', (payload) => {
        if (!payload || !payload.conversationId) return;
        const convId = Number(payload.conversationId);
        const current = (dmStore.typingUsers[convId] || []).filter(u => Number(u.userId) !== Number(payload.userId));
        dmStore.typingUsers[convId] = payload.isTyping
            ? [...current, { userId: payload.userId, username: payload.username }]
            : current;

        if (isDMsModalOpen() && dmStore.activePartner && Number(dmStore.activePartner.conversationId) === convId) {
            updateDMTypingIndicatorUI(convId);
        }
    });

    // 8. Çevrimiçi Durumu
    conn.on('UserOnlineStatusChanged', (payload) => {
        if (!payload) return;
        const targetUid = Number(payload.userId);
        dmStore.conversations = dmStore.conversations.map(c =>
            Number(c.userId) === targetUid ? { ...c, isOnline: !!payload.isOnline } : c
        );
        if (dmStore.activePartner && Number(dmStore.activePartner.userId) === targetUid) {
            dmStore.activePartner.isOnline = !!payload.isOnline;
        }
        if (isDMsModalOpen() && !dmStore.activePartner) {
            updateDMInboxListDOMOnly();
        }
    });
}

// ==========================================
// 📡 SIGNALR INVOKE METOTLARI
// ==========================================

async function dmInvokeGetConversationList() {
    const conn = await ensureDMSignalRConnected();
    if (!conn) return;
    try {
        const res = await conn.invoke('GetDMConversationList');
        if (Array.isArray(res)) {
            dmStore.conversations = res.map(normalizeDMConversation).filter(Boolean);
            saveDMConversationsCache();
            updateSidebarDMBadge();
            if (isDMsModalOpen() && !dmStore.activePartner) updateDMInboxListDOMOnly();
        }
    } catch (err) {
        console.warn('[DM] GetDMConversationList:', err);
    }
}

async function dmInvokeGetMessages(conversationId, lastMessageId = 0) {
    if (!conversationId) return;
    const conn = await ensureDMSignalRConnected();
    if (!conn) return;
    try {
        const res = await conn.invoke('GetDMMessages', Number(conversationId), Number(lastMessageId || 0));
        if (res && (Array.isArray(res) || Array.isArray(res.messages))) {
            const msgs = Array.isArray(res) ? res : res.messages;
            dmStore.messagesByConversation[Number(conversationId)] = msgs.map(normalizeDMMessage).filter(Boolean);
            renderActiveDMMessagesList(lastMessageId === 0);
        }
    } catch (err) {
        console.warn('[DM] GetDMMessages:', err);
    }
}

async function dmInvokeSendMessage(convId, targetUserId, content, attachmentUrl = '') {
    const conn = await ensureDMSignalRConnected();
    if (!conn) throw new Error('SignalR bağlantısı hazır değil.');

    // System.Text.Json uyumlu temiz payload (null olan int alanlar gönderilmez)
    const payload = {
        content: content,
        attachmentUrl: attachmentUrl || ''
    };

    if (convId && Number(convId) > 0) {
        payload.conversationId = Number(convId);
    }
    if (targetUserId && Number(targetUserId) > 0) {
        payload.receiverId = Number(targetUserId);
        payload.targetUserId = Number(targetUserId);
        payload.recipientId = Number(targetUserId);
        payload.userId = Number(targetUserId);
    }

    return await conn.invoke('SendDMMessage', payload);
}

async function dmInvokeUpdateMessage(conversationId, messageId, content) {
    const conn = await ensureDMSignalRConnected();
    if (!conn) return;
    const payload = {
        messageId: Number(messageId),
        id: Number(messageId),
        content: content
    };
    if (conversationId) payload.conversationId = Number(conversationId);
    return await conn.invoke('UpdateDMMessage', payload);
}

async function dmInvokeDeleteMessage(conversationId, messageId) {
    const conn = await ensureDMSignalRConnected();
    if (!conn) return;
    try {
        await conn.invoke('DeleteDMMessage', {
            conversationId: Number(conversationId),
            messageId: Number(messageId),
            id: Number(messageId)
        });
    } catch (_) {
        try {
            await conn.invoke('DeleteDMMessage', Number(messageId));
        } catch (err) {}
    }
}

async function dmInvokeMarkAsRead(conversationId) {
    if (!conversationId) return;
    const conn = await ensureDMSignalRConnected();
    if (!conn) return;

    dmStore.conversations = dmStore.conversations.map(c =>
        Number(c.conversationId) === Number(conversationId) ? { ...c, unreadCount: 0 } : c
    );
    saveDMConversationsCache();
    updateSidebarDMBadge();

    try {
        await conn.invoke('MarkDMConversationAsRead', Number(conversationId));
    } catch (_) {
        try {
            await conn.invoke('MarkDMConversationAsRead', { conversationId: Number(conversationId) });
        } catch (e) {}
    }
}

async function dmInvokeSendTypingStatus(conversationId, isTyping) {
    if (!conversationId) return;
    const conn = await ensureDMSignalRConnected();
    if (!conn) return;
    try {
        await conn.invoke('SendDMTypingStatus', {
            conversationId: Number(conversationId),
            isTyping: !!isTyping
        });
    } catch (_) {}
}

// ==========================================
// 🧩 DM VERİ NORMALİZASYONU & MEDYA YÜKLEME
// ==========================================

function getMyUserIdForDM() {
    if (typeof currentLoggedUserInfo !== 'undefined' && currentLoggedUserInfo?.userId) {
        return Number(currentLoggedUserInfo.userId);
    }
    const storedId = localStorage.getItem('userid') || localStorage.getItem('mc_user_id');
    if (storedId) return Number(storedId);

    const token = localStorage.getItem('mc_token') || localStorage.getItem('Authorization');
    if (token && typeof parseJwt === 'function') {
        const p = parseJwt(token);
        if (p) return Number(p.Id || p.id || p.sub || p.nameid) || null;
    }
    return null;
}

function normalizeDMConversation(raw) {
    if (!raw) return null;
    const other = raw.otherUser || raw.user || raw.participant || raw.targetUser || raw.receiver || {};
    const conversationId = Number(raw.conversationId ?? raw.id) || null;
    const userId = Number(raw.userId ?? raw.otherUserId ?? raw.targetUserId ?? raw.recipientId ?? raw.participantId ?? other.id ?? other.userId) || null;
    const username = String(raw.username || raw.userName || other.username || other.userName || 'kullanici').replace(/^@/, '');
    const name = raw.name || other.name || '';
    const surname = raw.surname || other.surname || '';
    const fullName = raw.fullName || (name && surname ? `${name} ${surname}` : (name || username));
    const pictureUrl = raw.pictureUrl || raw.profilePicture || other.pictureUrl || '';

    let lastMsgText = '';
    if (typeof raw.lastMessage === 'string') {
        lastMsgText = raw.lastMessage;
    } else if (raw.lastMessage && typeof raw.lastMessage === 'object') {
        lastMsgText = raw.lastMessage.content || raw.lastMessage.message || '';
    } else {
        lastMsgText = raw.lastMessageContent || raw.content || '';
    }
    lastMsgText = String(lastMsgText || '').replace(/\u200B/g, '').trim();

    const lastMessageDate = raw.lastMessageDate || raw.lastMessage?.createDate || raw.updateDate || raw.createDate || null;

    return {
        conversationId,
        userId,
        username,
        fullName,
        pictureUrl,
        lastMessage: lastMsgText,
        lastMessageDate,
        unreadCount: Number(raw.unreadCount ?? 0) || 0,
        isOnline: !!raw.isOnline
    };
}

function normalizeDMMessage(raw) {
    if (!raw) return null;
    const myId = getMyUserIdForDM();
    const myUname = String((typeof currentLoggedUserInfo !== 'undefined' && currentLoggedUserInfo?.username) || localStorage.getItem('mc_username') || localStorage.getItem('username') || '').trim().toLowerCase();

    const senderId = Number(raw.senderId ?? raw.userId ?? raw.fromUserId ?? raw.user?.id) || null;
    const senderUsername = String(raw.senderUsername || raw.username || raw.user?.username || '').trim();

    let isMine = false;
    if (raw.isMine === true || raw.isOwn === true) {
        isMine = true;
    } else if (myId && senderId && myId === senderId) {
        isMine = true;
    } else if (myUname && senderUsername && senderUsername.toLowerCase() === myUname) {
        isMine = true;
    }

    return {
        id: raw.id ?? raw.messageId,
        conversationId: Number(raw.conversationId) || null,
        senderId,
        senderUsername,
        content: raw.content ?? raw.message ?? raw.text ?? '',
        attachmentUrl: raw.attachmentUrl || raw.mediaUrl || raw.fileUrl || '',
        createDate: raw.createDate || raw.createdAt || new Date().toISOString(),
        isEdited: !!raw.isEdited || !!raw.updateDate,
        isRead: raw.isRead !== false,
        isMine
    };
}

// DM İçin Resim/Dosya Yükleme Yardımcısı
async function uploadDMAttachmentFile(file) {
    if (!file) return '';

    // Globalde mevcut bir yükleme fonksiyonu varsa önce onu dene
    const globalUploaders = [window.uploadChatFile, window.uploadFileToServer, window.uploadAttachment, window.uploadMedia];
    for (const fn of globalUploaders) {
        if (typeof fn === 'function') {
            try {
                const resUrl = await fn(file);
                if (resUrl && typeof resUrl === 'string') return resUrl;
            } catch (_) {}
        }
    }

    const token = localStorage.getItem('mc_token') || localStorage.getItem('Authorization');
    if (!token) throw new Error('Oturum bulunamadı.');

    const uploadEndpoints = [
        'https://api.meetingchallenge.com/Post/upload-file',
        'https://api.meetingchallenge.com/Message/upload-file',
        'https://api.meetingchallenge.com/File/upload',
        'https://api.meetingchallenge.com/Channel/upload-file',
        'https://api.meetingchallenge.com/User/upload-file'
    ];

    for (const endpoint of uploadEndpoints) {
        try {
            const formData = new FormData();
            formData.append('file', file);
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            });
            if (!res.ok) continue;
            const json = await res.json();
            const uploadedUrl = json?.data?.url || json?.data?.fileUrl || json?.data?.attachmentUrl || json?.data || json?.url || json?.fileUrl;
            if (uploadedUrl && typeof uploadedUrl === 'string') {
                return uploadedUrl;
            }
        } catch (_) {}
    }

    throw new Error('Dosya yüklenemedi.');
}

function isDMsModalOpen() {
    const modal = document.getElementById('dmsModal');
    return !!(modal && !modal.classList.contains('hidden'));
}

function updateSidebarDMBadge() {
    const totalUnread = dmStore.conversations.reduce((acc, c) => acc + (Number(c.unreadCount) || 0), 0);
    const dmBtn = document.querySelector('button[onclick="openDMsModal()"]');
    if (!dmBtn) return;

    dmBtn.classList.add('relative');
    let badge = document.getElementById('dmUnreadBadge');
    if (!badge) {
        badge = document.createElement('span');
        badge.id = 'dmUnreadBadge';
        badge.className = 'hidden absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 bg-mc-red text-white text-[10px] font-bold rounded-full flex items-center justify-center border border-[#2b2d31]';
        dmBtn.appendChild(badge);
    }

    if (totalUnread > 0) {
        badge.textContent = totalUnread > 99 ? '99+' : String(totalUnread);
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

// ==========================================
// 🖥️ DM ARAYÜZ (UI) FONKSİYONLARI
// ==========================================

function renderDMModalView() {
    const container = document.querySelector('#dmsModal .overflow-y-auto');
    if (!container) return;

    if (dmStore.activePartner) {
        renderDMChatConversationView(container);
    } else {
        renderDMInboxShell(container);
    }
}

// Arama kutusunu sabit tutar, sadece alt sonuç listesini günceller (Kasmayı sıfırlar)
function renderDMInboxShell(container) {
    container.innerHTML = `
        <div class="flex flex-col gap-3 h-full">
            <!-- Sabit Arama Çubuğu -->
            <div class="relative shrink-0">
                <input type="text" id="dmSearchInput"
                    value="${escapeHtmlSafe(dmStore.searchQuery)}"
                    oninput="handleDMSearchInput(this.value)"
                    placeholder="Sohbetlerde ara veya yeni kullanıcı adı yaz..."
                    class="w-full bg-[#1e1f22] border border-white/10 rounded-xl pl-9 pr-8 py-2.5 text-xs text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-mc-primary">
                <svg class="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z"></path>
                </svg>
                <button type="button" id="dmSearchClearBtn" onclick="handleDMSearchInput('')"
                    class="${dmStore.searchQuery ? '' : 'hidden'} absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white text-xs cursor-pointer">✕</button>
            </div>

            <!-- Yeni Kullanıcı Arama Sonuçları -->
            <div id="dmSearchUsersBox" class="hidden shrink-0"></div>

            <!-- Konuşma Listesi Kapsayıcısı -->
            <div id="dmConversationsListBox" class="flex-1 overflow-y-auto space-y-1.5 pr-0.5 custom-scrollbar"></div>
        </div>
    `;

    updateDMInboxListDOMOnly();
}

function updateDMInboxListDOMOnly() {
    const clearBtn = document.getElementById('dmSearchClearBtn');
    const searchUsersBox = document.getElementById('dmSearchUsersBox');
    const listBox = document.getElementById('dmConversationsListBox');
    if (!listBox) return;

    if (clearBtn) {
        clearBtn.classList.toggle('hidden', !dmStore.searchQuery);
    }

    const q = dmStore.searchQuery.trim().toLocaleLowerCase('tr-TR');

    // 1. Kullanıcı arama sonuçları
    if (searchUsersBox) {
        if (q.length >= 2 && (dmStore.isSearchingUsers || dmStore.searchedUsers.length > 0)) {
            searchUsersBox.classList.remove('hidden');
            searchUsersBox.innerHTML = `
                <div class="bg-[#232428] border border-white/10 rounded-xl p-2.5 space-y-1.5">
                    <div class="text-[10px] font-bold text-gray-400 uppercase tracking-wider px-1">Kişiler</div>
                    ${dmStore.isSearchingUsers ? `<div class="text-xs text-gray-400 py-1.5 px-1 animate-pulse">Kullanıcılar aranıyor...</div>` : ''}
                    ${dmStore.searchedUsers.map(u => {
                        const uAvatar = getFastAvatarUrl(u.pictureUrl, u.username || u.name, 64);
                        const safeUname = String(u.username || '').replace(/'/g, "\\'");
                        const safeFull = String(u.name && u.surname ? `${u.name} ${u.surname}` : (u.name || u.username || '')).replace(/'/g, "\\'");
                        const safePic = String(u.pictureUrl || '').replace(/'/g, "\\'");
                        return `
                            <div onclick="openDMChatWithUser(${Number(u.id)}, '${safeUname}', '${safePic}', '${safeFull}')"
                                 class="flex items-center justify-between gap-2.5 p-2 rounded-lg hover:bg-[#35373c] cursor-pointer transition-colors">
                                <div class="flex items-center gap-2.5 min-w-0">
                                    <img src="${uAvatar}" loading="lazy" decoding="async" class="w-8 h-8 rounded-full object-cover bg-[#1e1f22] shrink-0">
                                    <div class="min-w-0">
                                        <div class="text-xs font-bold text-white truncate">${escapeHtmlSafe(safeFull)}</div>
                                        <div class="text-[11px] text-gray-400 truncate">@${escapeHtmlSafe(u.username)}</div>
                                    </div>
                                </div>
                                <span class="text-[11px] font-semibold text-mc-primary bg-mc-primary/15 px-2.5 py-1 rounded-md shrink-0">Mesaj</span>
                            </div>
                        `;
                    }).join('')}
                </div>
            `;
        } else {
            searchUsersBox.classList.add('hidden');
            searchUsersBox.innerHTML = '';
        }
    }

    // 2. Mevcut konuşmalar listesi
    const filteredConvs = q
        ? dmStore.conversations.filter(c =>
            c.username.toLocaleLowerCase('tr-TR').includes(q) ||
            c.fullName.toLocaleLowerCase('tr-TR').includes(q) ||
            (c.lastMessage && c.lastMessage.toLocaleLowerCase('tr-TR').includes(q))
          )
        : dmStore.conversations;

    if (filteredConvs.length === 0) {
        listBox.innerHTML = `
            <div class="text-center text-gray-400 py-14 flex flex-col items-center gap-2">
                <svg class="w-10 h-10 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"></path>
                </svg>
                <span>${q ? 'Eşleşen sohbet bulunamadı.' : 'Özel mesaj kutunuz boş.'}</span>
                <span class="text-[11px] text-gray-500">Arama kutusuna kullanıcı adı yazarak yeni sohbet başlatabilirsiniz.</span>
            </div>
        `;
        return;
    }

    listBox.innerHTML = filteredConvs.map(conv => {
        const avatar = getFastAvatarUrl(conv.pictureUrl, conv.username, 64);
        const safeUname = String(conv.username || '').replace(/'/g, "\\'");
        const safeFull = String(conv.fullName || conv.username || '').replace(/'/g, "\\'");
        const safePic = String(conv.pictureUrl || '').replace(/'/g, "\\'");
        const timeLabel = conv.lastMessageDate && typeof formatApiDate === 'function' ? formatApiDate(conv.lastMessageDate) : '';
        const fallbackAvatar = `https://ui-avatars.com/api/?background=1e1f22&color=fff&name=${encodeURIComponent(conv.username || 'U')}`;

        return `
            <div onclick="openDMConversation(${conv.conversationId || 'null'}, ${conv.userId || 'null'}, '${safeUname}', '${safePic}', '${safeFull}', ${conv.isOnline})"
                 class="flex items-center gap-3 p-2.5 rounded-xl bg-[#2b2d31] hover:bg-[#35373c] border border-white/5 hover:border-white/10 transition-colors cursor-pointer group">
                <div class="relative shrink-0" onclick="event.stopPropagation(); closeDMsModal(); openUserProfileModal(${conv.userId || 'null'}, '${safeUname}', '${safePic}')">
                    <img src="${avatar}" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='${fallbackAvatar}'"
                         alt="${escapeHtmlSafe(conv.username)}" class="w-11 h-11 rounded-full object-cover bg-[#1e1f22] border border-white/10">
                    <span class="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-[#2b2d31] ${conv.isOnline ? 'bg-mc-green' : 'bg-gray-500'}"></span>
                </div>

                <div class="min-w-0 flex-1">
                    <div class="flex items-center justify-between gap-2">
                        <div class="flex items-center gap-1.5 min-w-0">
                            <span class="font-bold text-white text-sm truncate group-hover:text-mc-primary transition-colors">${escapeHtmlSafe(conv.fullName)}</span>
                            <span class="text-[11px] text-gray-400 truncate">@${escapeHtmlSafe(conv.username)}</span>
                        </div>
                        ${timeLabel ? `<span class="text-[10px] text-gray-400 shrink-0">${timeLabel}</span>` : ''}
                    </div>
                    <div class="flex items-center justify-between gap-2 mt-0.5">
                        <p class="text-xs ${conv.unreadCount > 0 ? 'text-white font-semibold' : 'text-gray-400'} truncate">
                            ${escapeHtmlSafe(conv.lastMessage || 'Sohbeti görüntülemek için tıklayın')}
                        </p>
                        ${conv.unreadCount > 0 ? `
                            <span class="bg-mc-red text-white text-[10px] font-bold min-w-[18px] h-[18px] px-1.5 rounded-full flex items-center justify-center shrink-0">
                                ${conv.unreadCount > 99 ? '99+' : conv.unreadCount}
                            </span>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function handleDMSearchInput(val) {
    dmStore.searchQuery = String(val || '');
    const input = document.getElementById('dmSearchInput');
    if (input && input.value !== dmStore.searchQuery) {
        input.value = dmStore.searchQuery;
    }

    if (dmSearchDebounceTimer) clearTimeout(dmSearchDebounceTimer);

    const trimmed = dmStore.searchQuery.trim();
    if (trimmed.length < 2) {
        dmStore.searchedUsers = [];
        dmStore.isSearchingUsers = false;
        updateDMInboxListDOMOnly();
        return;
    }

    dmStore.isSearchingUsers = true;
    updateDMInboxListDOMOnly();

    dmSearchDebounceTimer = setTimeout(async () => {
        const token = localStorage.getItem('mc_token') || localStorage.getItem('Authorization');
        if (!token) return;

        try {
            const res = await fetch(`https://api.meetingchallenge.com/User/search-user?userName=${encodeURIComponent(trimmed)}`, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Authorization': `Bearer ${token}`
                }
            });
            const json = await res.json();
            const users = Array.isArray(json) ? json : (Array.isArray(json.data) ? json.data : []);
            dmStore.searchedUsers = users.slice(0, 5);
        } catch (_) {
            dmStore.searchedUsers = [];
        } finally {
            dmStore.isSearchingUsers = false;
            if (isDMsModalOpen() && !dmStore.activePartner) {
                updateDMInboxListDOMOnly();
            }
        }
    }, 280);
}

function openDMChatWithUser(userId, username, pictureUrl = '', fullName = '') {
    const existingConv = dmStore.conversations.find(c =>
        (userId && Number(c.userId) === Number(userId)) ||
        (username && c.username.toLowerCase() === String(username).replace(/^@/, '').toLowerCase())
    );

    if (existingConv) {
        openDMConversation(existingConv.conversationId, existingConv.userId, existingConv.username, existingConv.pictureUrl, existingConv.fullName, existingConv.isOnline);
    } else {
        openDMConversation(null, userId, username, pictureUrl, fullName, false);
    }
}

async function openDMConversation(conversationId, userId, username, pictureUrl = '', fullName = '', isOnline = false) {
    dmStore.editingMessageId = null;
    dmStore.selectedFile = null;
    dmStore.selectedFilePreviewUrl = '';
    dmStore.activeConversationId = conversationId ? Number(conversationId) : null;
    dmStore.activePartner = {
        conversationId: conversationId ? Number(conversationId) : null,
        userId: userId ? Number(userId) : null,
        username: String(username || 'kullanici').replace(/^@/, ''),
        fullName: fullName || username || 'Kullanıcı',
        pictureUrl: pictureUrl || '',
        isOnline: !!isOnline
    };

    renderDMModalView();

    if (dmStore.activePartner.conversationId) {
        await dmInvokeGetMessages(dmStore.activePartner.conversationId, 0);
        await dmInvokeMarkAsRead(dmStore.activePartner.conversationId);
    } else {
        renderActiveDMMessagesList(true);
    }
}

function backToDMConversationList() {
    dmStore.activePartner = null;
    dmStore.activeConversationId = null;
    dmStore.editingMessageId = null;
    dmStore.selectedFile = null;
    dmStore.selectedFilePreviewUrl = '';
    renderDMModalView();
    dmInvokeGetConversationList();
}

function renderDMChatConversationView(container) {
    const p = dmStore.activePartner;
    if (!p) return;

    const avatar = getFastAvatarUrl(p.pictureUrl, p.username, 64);
    const safeUname = String(p.username).replace(/'/g, "\\'");
    const safePic = String(p.pictureUrl || '').replace(/'/g, "\\'");

    container.innerHTML = `
        <div class="flex flex-col h-full">
            <!-- Üst Bar -->
            <div class="flex items-center justify-between gap-2 pb-2.5 mb-2 border-b border-white/10 shrink-0">
                <div class="flex items-center gap-2.5 min-w-0">
                    <button type="button" onclick="backToDMConversationList()"
                        class="text-xs font-semibold text-gray-300 hover:text-white bg-[#1e1f22] hover:bg-[#35373c] px-2.5 py-1.5 rounded-lg flex items-center gap-1 transition-colors cursor-pointer shrink-0">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path></svg>
                        Geri
                    </button>
                    <div onclick="closeDMsModal(); openUserProfileModal(${p.userId || 'null'}, '${safeUname}', '${safePic}')"
                         class="flex items-center gap-2.5 cursor-pointer group min-w-0">
                        <div class="relative shrink-0">
                            <img src="${avatar}" class="w-8 h-8 rounded-full object-cover bg-[#1e1f22] border border-white/10">
                            <span class="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#313338] ${p.isOnline ? 'bg-mc-green' : 'bg-gray-500'}"></span>
                        </div>
                        <div class="min-w-0">
                            <div class="text-sm font-bold text-white group-hover:underline truncate leading-tight">${escapeHtmlSafe(p.fullName)}</div>
                            <div class="text-[11px] text-gray-400 truncate">@${escapeHtmlSafe(p.username)}</div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Mesajlar Listesi -->
            <div id="dmMessagesScrollBox" onscroll="handleDMScrollOlder(this)" class="flex-1 overflow-y-auto space-y-2.5 pr-1 py-2 custom-scrollbar min-h-0">
                <div class="text-center text-gray-500 py-10 text-xs animate-pulse">Mesajlar yükleniyor...</div>
            </div>

            <!-- Yazıyor Göstergesi -->
            <div id="dmTypingIndicator" class="hidden text-[11px] text-indigo-400 italic px-1 py-0.5 shrink-0"></div>

            <!-- Resim/Dosya Önizleme Çubuğu -->
            <div id="dmFilePreviewBar" class="hidden pt-1.5 shrink-0">
                <div class="bg-[#232428] border border-white/10 p-2 rounded-xl flex items-center justify-between gap-2.5">
                    <div class="flex items-center gap-2.5 min-w-0">
                        <img id="dmFilePreviewImg" src="" class="hidden w-10 h-10 rounded-lg object-cover border border-white/10 shrink-0">
                        <span id="dmFilePreviewIcon" class="text-xl hidden">📄</span>
                        <span id="dmFilePreviewName" class="text-xs text-gray-200 truncate"></span>
                    </div>
                    <button type="button" onclick="clearDMSelectedFile()" class="text-gray-400 hover:text-mc-red px-1.5 text-xs font-bold cursor-pointer">✕</button>
                </div>
            </div>

            <!-- Mesaj Düzenleme Bilgi Çubuğu -->
            <div id="dmEditBanner" class="hidden flex items-center justify-between bg-[#232428] border-l-4 border-mc-primary px-3 py-1.5 rounded-r-lg text-xs mt-1 shrink-0">
                <span class="text-gray-300">Mesaj düzenleniyor...</span>
                <button type="button" onclick="cancelDMEditMessage()" class="text-gray-400 hover:text-white font-bold cursor-pointer">✕</button>
            </div>

            <!-- Mesaj Gönderme Formu (Boş mesajla resim göndermeyi destekler) -->
            <form onsubmit="handleSendDMFormSubmit(event)" class="pt-2 mt-1.5 border-t border-white/10 flex items-center gap-2 shrink-0">
                <button type="button" onclick="document.getElementById('dmFileInput').click()"
                    class="p-2 rounded-xl bg-[#1e1f22] hover:bg-[#35373c] text-gray-400 hover:text-white border border-white/10 transition-colors shrink-0 cursor-pointer" title="Resim / Dosya Ekle">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551"></path></svg>
                </button>
                <input type="file" id="dmFileInput" onchange="handleDMFileSelect(event)" class="hidden" accept="image/*,video/*,.pdf,.doc,.docx">
                <input type="text" id="dmChatInput" autocomplete="off"
                    oninput="handleDMInputTyping()"
                    placeholder="@${escapeHtmlSafe(p.username)} kullanıcısına mesaj yaz..."
                    class="flex-1 bg-[#1e1f22] border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-mc-primary">
                <button type="submit" id="dmChatSendBtn"
                    class="bg-mc-primary hover:bg-[#4752C4] text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-colors cursor-pointer shrink-0 flex items-center gap-1.5 shadow-md">
                    <span id="dmChatSendBtnLabel">Gönder</span>
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"></path></svg>
                </button>
            </form>
        </div>
    `;

    const inputEl = document.getElementById('dmChatInput');
    if (inputEl) inputEl.focus();

    if (p.conversationId && dmStore.messagesByConversation[p.conversationId]) {
        renderActiveDMMessagesList(true);
    }
}

function handleDMFileSelect(event) {
    const file = event?.target?.files?.[0];
    if (!file) return;

    dmStore.selectedFile = file;
    const bar = document.getElementById('dmFilePreviewBar');
    const img = document.getElementById('dmFilePreviewImg');
    const icon = document.getElementById('dmFilePreviewIcon');
    const nameEl = document.getElementById('dmFilePreviewName');

    if (bar) bar.classList.remove('hidden');
    if (nameEl) nameEl.textContent = file.name;

    if (file.type.startsWith('image/')) {
        dmStore.selectedFilePreviewUrl = URL.createObjectURL(file);
        if (img) {
            img.src = dmStore.selectedFilePreviewUrl;
            img.classList.remove('hidden');
        }
        if (icon) icon.classList.add('hidden');
    } else {
        dmStore.selectedFilePreviewUrl = '';
        if (img) img.classList.add('hidden');
        if (icon) icon.classList.remove('hidden');
    }
}

function clearDMSelectedFile() {
    dmStore.selectedFile = null;
    dmStore.selectedFilePreviewUrl = '';
    const fileInput = document.getElementById('dmFileInput');
    const bar = document.getElementById('dmFilePreviewBar');
    if (fileInput) fileInput.value = '';
    if (bar) bar.classList.add('hidden');
}

function renderActiveDMMessagesList(scrollToBottom = false) {
    const box = document.getElementById('dmMessagesScrollBox');
    if (!box || !dmStore.activePartner) return;

    const convId = dmStore.activePartner.conversationId || 'temp_conv';
    const msgs = dmStore.messagesByConversation[convId] || [];

    if (msgs.length === 0) {
        box.innerHTML = `
            <div class="text-center text-gray-500 py-14 text-xs">
                Henüz mesaj bulunmuyor. İlk mesajı göndererek sohbeti başlatın!
            </div>
        `;
        return;
    }

    box.innerHTML = msgs.map(m => {
        const alignClass = m.isMine ? 'items-end' : 'items-start';
        const bubbleClass = m.isMine
            ? 'bg-mc-primary text-white rounded-2xl rounded-br-sm'
            : 'bg-[#2b2d31] text-gray-100 border border-white/5 rounded-2xl rounded-bl-sm';
        const timeText = m.createDate && typeof formatApiDate === 'function' ? formatApiDate(m.createDate) : '';
        const cleanContent = String(m.content || '').replace(/\u200B/g, '');
        const safeContentForEdit = cleanContent.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
        const linkedHtml = linkifySafeText(cleanContent, m.isMine);
        const mediaSrc = m.attachmentUrl ? (String(m.attachmentUrl).startsWith('blob:') ? m.attachmentUrl : getRawMediaUrl(m.attachmentUrl)) : '';

        return `
            <div class="flex flex-col ${alignClass} group/dmmsg">
                <div class="flex items-center gap-1.5 max-w-[85%] ${m.isMine ? 'flex-row-reverse' : 'flex-row'}">
                    <div class="px-3.5 py-2 text-xs leading-relaxed break-words shadow-sm ${bubbleClass}">
                        ${linkedHtml ? `<div class="whitespace-pre-wrap">${linkedHtml}</div>` : ''}
                        ${mediaSrc ? `<img src="${mediaSrc}" loading="lazy" class="${linkedHtml ? 'mt-1.5' : ''} rounded-lg max-h-52 object-cover cursor-pointer" onclick="window.open(this.src, '_blank')">` : ''}
                    </div>
                    ${m.isMine && m.id && !String(m.id).startsWith('temp_') ? `
                        <div class="hidden group-hover/dmmsg:flex items-center gap-1 text-gray-400 shrink-0">
                            <button type="button" onclick="startDMEditMessage(${Number(m.id)}, '${safeContentForEdit}')" class="p-1 hover:text-white rounded hover:bg-white/5 cursor-pointer" title="Düzenle">✎</button>
                            <button type="button" onclick="confirmDMDeleteMessage(${Number(m.id)})" class="p-1 hover:text-mc-red rounded hover:bg-white/5 cursor-pointer" title="Sil">🗑️</button>
                        </div>
                    ` : ''}
                </div>
                <div class="flex items-center gap-1 text-[10px] text-gray-500 mt-0.5 px-1">
                    ${String(m.id).startsWith('temp_') ? `<span>Gönderiliyor...</span>` : (timeText ? `<span>${timeText}</span>` : '')}
                    ${m.isEdited ? `<span>(düzenlendi)</span>` : ''}
                </div>
            </div>
        `;
    }).join('');

    if (scrollToBottom) {
        box.scrollTop = box.scrollHeight;
    }
}

var dmLoadingOlder = false;
async function handleDMScrollOlder(scrollEl) {
    if (!scrollEl || scrollEl.scrollTop > 10 || dmLoadingOlder || !dmStore.activePartner?.conversationId) return;
    const convId = dmStore.activePartner.conversationId;
    const msgs = (dmStore.messagesByConversation[convId] || []).filter(m => !String(m.id).startsWith('temp_'));
    if (msgs.length < 15) return;

    const oldestMsg = msgs[0];
    if (!oldestMsg || !oldestMsg.id) return;

    dmLoadingOlder = true;
    await dmInvokeGetMessages(convId, Number(oldestMsg.id));
    setTimeout(() => { dmLoadingOlder = false; }, 600);
}

function updateDMTypingIndicatorUI(convId) {
    const el = document.getElementById('dmTypingIndicator');
    if (!el) return;
    const myId = getMyUserIdForDM();
    const typingList = (dmStore.typingUsers[convId] || []).filter(u => Number(u.userId) !== Number(myId));

    if (typingList.length > 0) {
        const names = typingList.map(u => `@${u.username}`).join(', ');
        el.textContent = `${names} yazıyor...`;
        el.classList.remove('hidden');
    } else {
        el.classList.add('hidden');
    }
}

function handleDMInputTyping() {
    const convId = dmStore.activePartner?.conversationId;
    if (!convId) return;

    dmInvokeSendTypingStatus(convId, true);
    if (dmTypingEmitTimer) clearTimeout(dmTypingEmitTimer);
    dmTypingEmitTimer = setTimeout(() => {
        dmInvokeSendTypingStatus(convId, false);
    }, 2000);
}

function startDMEditMessage(messageId, currentContent) {
    dmStore.editingMessageId = Number(messageId);
    const banner = document.getElementById('dmEditBanner');
    const input = document.getElementById('dmChatInput');
    const btnLabel = document.getElementById('dmChatSendBtnLabel');
    if (banner) banner.classList.remove('hidden');
    if (btnLabel) btnLabel.textContent = 'Kaydet';
    if (input) {
        input.value = currentContent;
        input.focus();
    }
}

function cancelDMEditMessage() {
    dmStore.editingMessageId = null;
    const banner = document.getElementById('dmEditBanner');
    const input = document.getElementById('dmChatInput');
    const btnLabel = document.getElementById('dmChatSendBtnLabel');
    if (banner) banner.classList.add('hidden');
    if (btnLabel) btnLabel.textContent = 'Gönder';
    if (input) input.value = '';
}

async function confirmDMDeleteMessage(messageId) {
    if (!dmStore.activePartner?.conversationId || !messageId) return;
    await dmInvokeDeleteMessage(dmStore.activePartner.conversationId, messageId);
}

// Mesaj veya Resim Gönderme (Metin boş olsa bile resim gönderilebilir)
async function handleSendDMFormSubmit(event) {
    if (event) event.preventDefault();
    if (!dmStore.activePartner) return;

    const inputEl = document.getElementById('dmChatInput');
    const sendBtn = document.getElementById('dmChatSendBtn');
    const rawText = inputEl ? inputEl.value.trim() : '';
    const attachedFile = dmStore.selectedFile;

    // Hem metin hem dosya boşsa gönderme
    if (!rawText && !attachedFile) return;

    if (sendBtn) sendBtn.disabled = true;

    try {
        if (dmStore.editingMessageId) {
            const editId = dmStore.editingMessageId;
            cancelDMEditMessage();
            await dmInvokeUpdateMessage(dmStore.activePartner.conversationId, editId, rawText);
        } else {
            // 1. Önce optimistik olarak ekrana ekle (Anında tepki)
            const convKey = dmStore.activePartner.conversationId || 'temp_conv';
            const tempId = 'temp_' + Date.now();
            const tempMsg = {
                id: tempId,
                conversationId: dmStore.activePartner.conversationId,
                senderId: getMyUserIdForDM(),
                content: rawText,
                attachmentUrl: dmStore.selectedFilePreviewUrl || '',
                createDate: new Date().toISOString(),
                isMine: true
            };

            if (!dmStore.messagesByConversation[convKey]) {
                dmStore.messagesByConversation[convKey] = [];
            }
            dmStore.messagesByConversation[convKey].push(tempMsg);
            if (inputEl) inputEl.value = '';
            clearDMSelectedFile();
            renderActiveDMMessagesList(true);

            // 2. Dosya seçiliyse önce sunucuya yükle
            let uploadedAttachmentUrl = '';
            if (attachedFile) {
                uploadedAttachmentUrl = await uploadDMAttachmentFile(attachedFile);
            }

            // Resim gönderirken metin boşsa sıfır genişlikli boşluk (\u200B) göndererek backend doğrulamasını geç
            const finalContent = rawText || (uploadedAttachmentUrl ? '\u200B' : '');

            const invokeRes = await dmInvokeSendMessage(
                dmStore.activePartner.conversationId,
                dmStore.activePartner.userId,
                finalContent,
                uploadedAttachmentUrl
            );

            // Sunucu doğrudan mesaj nesnesi döndürdüyse veya ReceiveDMMessage bekleniyorsa senkronize et
            if (invokeRes && (invokeRes.id || invokeRes.messageId)) {
                const realMsg = normalizeDMMessage(invokeRes);
                if (realMsg.conversationId && !dmStore.activePartner.conversationId) {
                    dmStore.activePartner.conversationId = realMsg.conversationId;
                    dmStore.activeConversationId = realMsg.conversationId;
                }
                const targetConv = dmStore.activePartner.conversationId || convKey;
                const list = (dmStore.messagesByConversation[targetConv] || []).filter(m => m.id !== tempId);
                if (!list.some(m => Number(m.id) === Number(realMsg.id))) {
                    list.push(realMsg);
                }
                dmStore.messagesByConversation[targetConv] = list;
                renderActiveDMMessagesList(true);
            } else {
                // 500ms sonra sunucu geçmişini senkronize et
                setTimeout(() => {
                    if (dmStore.activePartner?.conversationId) {
                        dmInvokeGetMessages(dmStore.activePartner.conversationId, 0);
                    } else {
                        dmInvokeGetConversationList();
                    }
                }, 500);
            }
        }
    } catch (err) {
        console.error('[DM] Mesaj gönderim hatası:', err);
        alert('Mesaj gönderilemedi: ' + (err?.message || 'Bağlantı hatası'));
    } finally {
        if (sendBtn) sendBtn.disabled = false;
        if (inputEl) inputEl.focus();
    }
}

function startDMFromUserProfile(userId, username, pictureUrl = '', fullName = '') {
    if (typeof closeUserProfileModal === 'function') closeUserProfileModal();
    openDMsModal(false);
    openDMChatWithUser(userId, username, pictureUrl, fullName);
}

function openDMsModal(loadList = true) {
    enforceFixedModalDimensions();
    const modal = document.getElementById('dmsModal');
    if (!modal) return;
    modal.classList.remove('hidden');

    if (loadList) {
        dmStore.activePartner = null;
        dmStore.activeConversationId = null;
        // Önbellekteki listeyi 0ms'de anında ekrana bas
        renderDMModalView();
        // Arka planda sessizce güncel listeyi çek
        dmInvokeGetConversationList();
    }
}

function closeDMsModal() {
    const modal = document.getElementById('dmsModal');
    if (modal) modal.classList.add('hidden');
    dmStore.activePartner = null;
    dmStore.activeConversationId = null;
    dmStore.editingMessageId = null;
}

// ==========================================
// 🚀 BAŞLANGIÇ KURULUMU (SAYFA YÜKLENDİĞİNDE)
// ==========================================
function initAllModalsAndEnhancements() {
    enforceFixedModalDimensions();
    initChannelChatEnhancements();
    enhanceUserProfileModalActions();
    updateSidebarDMBadge();

    // Mevcut SignalR bağlantısını yakalayıp arka planda DM listesini hazırla
    setTimeout(() => {
        ensureDMSignalRConnected().then(conn => {
            if (conn) dmInvokeGetConversationList();
        });
    }, 1200);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAllModalsAndEnhancements);
} else {
    initAllModalsAndEnhancements();
}