// ==========================================
// 📡 BAĞLANTI DURUMU, PAKET KAYBI VE SUNUCU TANILAMA MODÜLÜ
// ==========================================

var rtcStatsInterval = null;
var prevRtcStatsSnapshot = { bytesSent: 0, bytesReceived: 0, timestamp: 0 };
var isDiagnosticsPanelOpen = false;

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
            ? `${apiBaseUrl}/get-active-channel` : 'https://api.meetingchallenge.com/Channel/get-active-channel'; await fetch(target, { method: 'HEAD', headers: token ? { 'Authorization': `Bearer ${token}` } : {},
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
        ? `<span class="${Number(lossPercent) < 1 ? 'text-mc-green' : (Number(lossPercent) < 4 ? 'text-yellow-400' : 'text-mc-red')}">\%${lossPercent}</span> <span class="text-[10px] text-gray-400 font-normal">(${packetsLost} pk)</span>` : '<span class="text-gray-400">\%0.0 (0 pk)</span>';  jitterEl.innerText = isVoiceActive ? `${jitterMs} ms` : '0 ms';
    bitrateEl.innerText = isVoiceActive ? `↑ ${upKbps} kbps / ↓${downKbps} kbps` : '↑ 0 kbps / ↓ 0 kbps';

    let roomServerText = 'API: api.meetingchallenge.com';
    if (isVoiceActive) {
        const chName = (typeof activeVoiceChannelName !== 'undefined' && activeVoiceChannelName) ? activeVoiceChannelName : 'Ses Odası';
        const sfuHost = (room?.engine?.url || remoteIpAddress || 'LiveKit SFU').replace(/^wss?:\/\//i, '').split('/')[0];
        roomServerText = `${chName} •${sfuHost}`;
    }
    serverEl.innerText = roomServerText;

    const codecList = codecsSet.size > 0 ? Array.from(codecsSet).slice(0, 3).join(', ') : 'OPUS / VP8';
    codecEl.innerText = isVoiceActive ? `${transportProtocol} (${candidateType}) • ${codecList}` : 'HTTPS / WSS • Hazır';  let hubStateText = 'Aktif (Senkronize)'; if (typeof chairoHubConnection !== 'undefined' && chairoHubConnection && chairoHubConnection.state) { hubStateText = `SignalR: ${chairoHubConnection.state}`;
    }
    hubEl.innerText = hubStateText;
}