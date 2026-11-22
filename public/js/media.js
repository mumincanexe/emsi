function getParticipantSid(participant) {
    if (!participant) return 'local';
    if (participant.isLocal) return 'local';
    return participant.sid || participant.identity || 'local';
}

function hasVideo(p) {
    if (!p) return false;
    if (p.isLocal) return isCamEnabled;
    let hasV = false;
    if (p.videoTracks) {
        p.videoTracks.forEach((pub) => {
            if (pub.track && !pub.isMuted) hasV = true;
        });
    }
    return hasV || p.isCameraEnabled;
}

function isParticipantMicMuted(p) {
    if (!p) return true;
    if (p.isLocal) return !isMicEnabled;
    return !p.isMicrophoneEnabled;
}

// Web Audio API ile %200'e kadar gerçek ses yükseltme (Audio Boost) yöneticisi
let sharedAudioContext = null;
const participantGainNodesMap = new Map(); // normalizedUsername -> { gainNode, audioEl }

function normalizeUsernameKey(username) {
    return stripEmojis(String(username || '').trim().replace(/^@+/, '')).toLowerCase();
}

// Varsayılan her zaman 1.0 (%100), üst sınır 2.0 (%200), alt sınır 0.05 (%5)
function getParticipantVolume(username) {
    const key = normalizeUsernameKey(username);
    if (!key) return 1.0;
    const saved = participantVolumesMap[key];
    if (saved === undefined || isNaN(Number(saved))) return 1.0;
    return Math.max(MIN_PARTICIPANT_VOLUME, Math.min(MAX_PARTICIPANT_VOLUME, Number(saved)));
}

function ensureParticipantGainNode(audioEl, key) {
    if (!audioEl || !key) return null;
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return null;
        if (!sharedAudioContext) sharedAudioContext = new AudioCtx();
        if (sharedAudioContext.state === 'suspended') {
            sharedAudioContext.resume().catch(() => {});
        }

        if (!audioEl._gainNode && audioEl.srcObject) {
            const source = sharedAudioContext.createMediaStreamSource(audioEl.srcObject);
            const gainNode = sharedAudioContext.createGain();
            source.connect(gainNode);
            gainNode.connect(sharedAudioContext.destination);
            audioEl._gainNode = gainNode;
            // Çift ses çıkmaması için ham audio elementini sessize alıp sesi GainNode üzerinden veriyoruz
            audioEl.muted = true;
            participantGainNodesMap.set(key, gainNode);
        }
        return audioEl._gainNode || null;
    } catch (e) {
        return null;
    }
}

function applyParticipantAudioVolume(username) {
    const key = normalizeUsernameKey(username);
    if (!key) return;
    const effectiveVol = getParticipantVolume(username); // 0.05 ile 2.0 arası

    const container = document.getElementById('audioContainer');
    if (container) {
        container.querySelectorAll('audio').forEach(audioEl => {
            if (normalizeUsernameKey(audioEl.dataset.participantIdentity) === key) {
                if (effectiveVol > 1.0 || audioEl._gainNode) {
                    const gainNode = ensureParticipantGainNode(audioEl, key);
                    if (gainNode) {
                        gainNode.gain.value = effectiveVol;
                        return;
                    }
                }
                audioEl.muted = false;
                audioEl.volume = Math.max(0.05, Math.min(1.0, effectiveVol));
            }
        });
    }

    if (room && room.participants) {
        room.participants.forEach(p => {
            if (normalizeUsernameKey(p.identity) === key && p.audioTracks) {
                p.audioTracks.forEach(pub => {
                    if (pub.track && typeof pub.track.setVolume === 'function') {
                        try { pub.track.setVolume(effectiveVol); } catch (e) {}
                    }
                });
            }
        });
    }
}

async function attachRemoteAudioTrack(participant, track) {
    if (!track) return;
    const identity = participant?.identity || '';
    const key = normalizeUsernameKey(identity);
    const effectiveVol = getParticipantVolume(identity);

    const audioEl = track.attach();
    audioEl.dataset.participantIdentity = identity;
    audioEl.dataset.participantSid = participant?.sid || '';
    audioEl.muted = false;
    audioEl.volume = Math.max(0.05, Math.min(1.0, effectiveVol));

    if (typeof track.setVolume === 'function') {
        try { track.setVolume(effectiveVol); } catch (e) {}
    }

    if (selectedSpeakerDeviceId && typeof audioEl.setSinkId === 'function') {
        try { await audioEl.setSinkId(selectedSpeakerDeviceId); } catch (e) {}
    }

    document.getElementById('audioContainer').appendChild(audioEl);

    if (effectiveVol > 1.0) {
        applyParticipantAudioVolume(identity);
    }
}

function clearVolumeMenuCloseTimer() {
    if (volumeMenuCloseTimer) {
        clearTimeout(volumeMenuCloseTimer);
        volumeMenuCloseTimer = null;
    }
}

function scheduleVolumeMenuClose(delay = 250) {
    clearVolumeMenuCloseTimer();
    volumeMenuCloseTimer = setTimeout(() => {
        closeUserVolumeContextMenu();
    }, delay);
}

function openUserVolumeContextMenu(username, e) {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
    if (!username) return;

    const localUsername = currentLoggedUserInfo.username || localStorage.getItem('mc_username') || '';
    if (normalizeUsernameKey(username) === normalizeUsernameKey(localUsername)) return;

    clearVolumeMenuCloseTimer();
    activeVolumeContextUsername = username;

    const menu = document.getElementById('userVolumeContextMenu');
    const userLabel = document.getElementById('volContextMenuUser');
    const valLabel = document.getElementById('volContextMenuValue');
    const slider = document.getElementById('volContextMenuSlider');
    if (!menu || !userLabel || !valLabel || !slider) return;

    const currentPercent = Math.round(getParticipantVolume(username) * 100);
    userLabel.innerText = `@${username}`;
    valLabel.innerText = `${currentPercent}%`;
    slider.value = currentPercent;

    menu.classList.remove('hidden');

    const clientX = e ? (e.clientX || 120) : 120;
    const clientY = e ? (e.clientY || 120) : 120;
    const menuWidth = 240;
    const menuHeight = 86;

    const left = Math.max(8, Math.min(window.innerWidth - menuWidth - 8, clientX - 20));
    const top = Math.max(8, Math.min(window.innerHeight - menuHeight - 8, clientY - 20));

    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
}

function closeUserVolumeContextMenu() {
    clearVolumeMenuCloseTimer();
    activeVolumeContextUsername = null;
    const menu = document.getElementById('userVolumeContextMenu');
    if (menu) menu.classList.add('hidden');
}

function handleContextMenuVolumeInput(volumePercent, e) {
    if (e) e.stopPropagation();
    if (!activeVolumeContextUsername) return;

    const clampedPercent = Math.max(5, Math.min(100, Number(volumePercent) || 100));
    const valLabel = document.getElementById('volContextMenuValue');
    if (valLabel) valLabel.innerText = `${Math.round(clampedPercent)}%`;

    setParticipantLocalVolume(activeVolumeContextUsername, clampedPercent, e);
}

function setParticipantLocalVolume(username, volumePercent, e) {
    if (e) e.stopPropagation();
    const key = normalizeUsernameKey(username);
    if (!key) return;

    const vol = Math.max(MIN_PARTICIPANT_VOLUME, Math.min(1, Number(volumePercent) / 100));
    participantVolumesMap[key] = vol;

    saveParticipantAudioPrefs();
    applyParticipantAudioVolume(username);
    updateVideoUI();
    renderSidebar(true);
}

function applyParticipantAudioVolume(username) {
    const key = normalizeUsernameKey(username);
    if (!key) return;
    const effectiveVol = getParticipantVolume(username);

    const container = document.getElementById('audioContainer');
    if (container) {
        container.querySelectorAll('audio').forEach(audioEl => {
            if (normalizeUsernameKey(audioEl.dataset.participantIdentity) === key) {
                audioEl.muted = false;
                audioEl.volume = effectiveVol;
            }
        });
    }

    if (room && room.participants) {
        room.participants.forEach(p => {
            if (normalizeUsernameKey(p.identity) === key && p.audioTracks) {
                p.audioTracks.forEach(pub => {
                    if (pub.track && typeof pub.track.setVolume === 'function') {
                        try { pub.track.setVolume(effectiveVol); } catch (e) {}
                    }
                });
            }
        });
    }
}

async function attachRemoteAudioTrack(participant, track) {
    if (!track) return;
    const identity = participant?.identity || '';
    const effectiveVol = getParticipantVolume(identity);

    const audioEl = track.attach();
    audioEl.dataset.participantIdentity = identity;
    audioEl.dataset.participantSid = participant?.sid || '';
    audioEl.muted = false;
    audioEl.volume = effectiveVol;

    if (typeof track.setVolume === 'function') {
        try { track.setVolume(effectiveVol); } catch (e) {}
    }

    if (selectedSpeakerDeviceId && typeof audioEl.setSinkId === 'function') {
        try { await audioEl.setSinkId(selectedSpeakerDeviceId); } catch (e) {}
    }

    document.getElementById('audioContainer').appendChild(audioEl);
}

function toggleHideAllCameras(checked) {
    hideAllCameraStreams = Boolean(checked);
    localStorage.setItem('mc_hide_all_cameras', hideAllCameraStreams ? 'true' : 'false');
    updateVideoUI();
}

function attachLocalVideoIfAvailable() {
    if (!room || !room.localParticipant) return;
    const localP = room.localParticipant;
    createParticipantBoxIfNeeded(localP);

    let localVideoTrack = null;
    if (localP.videoTracks) {
        localP.videoTracks.forEach((pub) => {
            if (pub.track && pub.source !== 'screen_share') {
                localVideoTrack = pub.track;
            } else if (pub.videoTrack) {
                localVideoTrack = pub.videoTrack;
            }
        });
    }

    if (localVideoTrack && isCamEnabled) {
        attachVideoTrackToBox(localP, localVideoTrack);
    }
}

function attachVideoTrackToBox(participant, track) {
    const sid = getParticipantSid(participant);
    createParticipantBoxIfNeeded(participant);
    const box = document.getElementById(`box-${sid}`);
    if (!box || !track) return;
    const vidContainer = box.querySelector('.vid-container');
    if (!vidContainer) return;

    vidContainer.innerHTML = '';
    const el = track.attach();
    el.setAttribute('playsinline', 'true');
    el.autoplay = true;
    if (participant.isLocal) el.muted = true;
    el.className = `absolute inset-0 w-full h-full object-contain bg-[#2b2d31] ${participant.isLocal ? 'transform scale-x-[-1]' : ''}`;
    vidContainer.appendChild(el);
}

async function applyAudioOutputDeviceToElements() {
    const container = document.getElementById('audioContainer');
    if (container && selectedSpeakerDeviceId) {
        const audioEls = container.querySelectorAll('audio');
        for (const audioEl of audioEls) {
            if (typeof audioEl.setSinkId === 'function') {
                try { await audioEl.setSinkId(selectedSpeakerDeviceId); } catch (e) {}
            }
        }
    }

    if (room && typeof room.switchActiveDevice === 'function' && selectedSpeakerDeviceId) {
        try { await room.switchActiveDevice('audiooutput', selectedSpeakerDeviceId); } catch (e) {}
    }
}

async function joinVoiceChannel(channelId, channelName) {
    const myJoinId = ++currentJoinTokenId;

    if (room) {
        room.removeAllListeners();
        try { await room.disconnect(); } catch (e) {}
        room = null;
    }
    if (uiSyncInterval) clearInterval(uiSyncInterval);

    document.getElementById('audioContainer').innerHTML = '';
    document.getElementById('videoGrid').innerHTML = '';
    document.getElementById('spotlightMain').innerHTML = '';
    document.getElementById('spotlightMain').classList.add('hidden');

    activeVoiceChannelId = channelId;
    activeVoiceChannelName = channelName;
    focusedParticipantSid = null;
    recentSpeakerSids = [];
    isMicEnabled = false;
    isCamEnabled = false;
    resetMediaButtonsUI();

    const statusEl = document.getElementById('localStatusText');
    statusEl.innerText = `Bağlanıyor: ${channelName}...`;
    statusEl.className = "text-[11px] text-yellow-500 truncate transition-colors";
    document.getElementById('connectionDot').className = "absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-yellow-500 border-[2px] border-[#232428] animate-pulse";

    syncMainLayout();
    startChatPolling(channelId);

    try {
        const token = localStorage.getItem('mc_token');
        const res = await fetch(`${apiBaseUrl}/get-voice-channel-token?channelId=${channelId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const result = await res.json();

        if (myJoinId !== currentJoinTokenId) return;

        if (result.httpStatusCode === 200 && result.data && result.data.token) {
            await startLiveKitMeeting(result.data.token, channelName, myJoinId);
        } else {
            throw new Error("Token alınamadı.");
        }
    } catch (err) {
        if (myJoinId === currentJoinTokenId) {
            alert("Ses kanalına bağlanılamadı.");
            leaveRoom();
        }
    }
}

async function startLiveKitMeeting(liveKitToken, channelName, joinId) {
    const roomOptions = {
        adaptiveStream: true,
        dynacast: true,
        audioCaptureDefaults: selectedMicDeviceId ? { deviceId: selectedMicDeviceId } : undefined,
        videoCaptureDefaults: selectedCamDeviceId ? { deviceId: selectedCamDeviceId } : undefined,
        audioOutput: selectedSpeakerDeviceId ? { deviceId: selectedSpeakerDeviceId } : undefined
    };

    const newRoom = new LivekitClient.Room(roomOptions);
    room = newRoom;

    newRoom.on(LivekitClient.RoomEvent.Disconnected, () => {
        if (room === newRoom) leaveRoom();
    });

    newRoom.on(LivekitClient.RoomEvent.ParticipantConnected, (p) => {
        if (p && p.identity && !knownUsersMap.has(p.identity)) {
            knownUsersMap.set(p.identity, { username: p.identity, pictureUrl: null, color: '#fff' });
        }
        updateVideoUI();
        renderSidebar();
    });

    newRoom.on(LivekitClient.RoomEvent.ParticipantDisconnected, () => {
        updateVideoUI();
        renderSidebar();
    });

    newRoom.on(LivekitClient.RoomEvent.ActiveSpeakersChanged, (speakers) => {
        if (speakers && speakers.forEach) {
            speakers.forEach(sp => {
                const sid = getParticipantSid(sp);
                recentSpeakerSids = recentSpeakerSids.filter(s => s !== sid);
                recentSpeakerSids.unshift(sid);
            });
            recentSpeakerSids = recentSpeakerSids.slice(0, 5);
        }
        updateTopActiveSpeakersUI();
        updateVideoUI();
        renderSidebar();
    });

    newRoom.on(LivekitClient.RoomEvent.TrackSubscribed, async (track, publication, participant) => {
        if (track.kind === 'video') {
            createParticipantBoxIfNeeded(participant);
            attachVideoTrackToBox(participant, track);
        } else if (track.kind === 'audio') {
            await attachRemoteAudioTrack(participant, track);
        }
        updateVideoUI();
        renderSidebar();
    });

    newRoom.on(LivekitClient.RoomEvent.TrackUnsubscribed, (track) => {
        const elements = track.detach();
        if (elements) {
            if (Array.isArray(elements) || elements.forEach) elements.forEach(el => el.remove());
            else if (elements.remove) elements.remove();
        }
        updateVideoUI();
        renderSidebar();
    });

    newRoom.on(LivekitClient.RoomEvent.LocalTrackPublished, (publication, participant) => {
        if (publication && publication.track && publication.track.kind === 'video') {
            createParticipantBoxIfNeeded(participant || newRoom.localParticipant);
            attachVideoTrackToBox(participant || newRoom.localParticipant, publication.track);
        }
        updateVideoUI();
        renderSidebar();
    });

    newRoom.on(LivekitClient.RoomEvent.LocalTrackUnpublished, (publication, participant) => {
        if (publication && publication.track) {
            const elements = publication.track.detach();
            if (elements && elements.forEach) elements.forEach(el => el.remove());
        }
        const sid = getParticipantSid(participant || newRoom.localParticipant);
        const box = document.getElementById(`box-${sid}`);
        if (box) {
            const vidContainer = box.querySelector('.vid-container');
            if (vidContainer) vidContainer.innerHTML = '';
        }
        updateVideoUI();
        renderSidebar();
    });

    newRoom.on(LivekitClient.RoomEvent.TrackMuted, () => { updateVideoUI(); renderSidebar(); });
    newRoom.on(LivekitClient.RoomEvent.TrackUnmuted, () => { updateVideoUI(); renderSidebar(); });

    await newRoom.connect(livekitServerUrl, liveKitToken);
    if (joinId !== currentJoinTokenId) {
        newRoom.removeAllListeners();
        await newRoom.disconnect();
        return;
    }

    const statusEl = document.getElementById('localStatusText');
    statusEl.innerText = `Sesli: ${channelName}`;
    statusEl.className = "text-[11px] text-mc-green font-medium truncate transition-colors";
    document.getElementById('connectionDot').className = "absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-mc-green border-[2px] border-[#232428]";

    newRoom.participants.forEach(participant => {
        if (participant.identity && !knownUsersMap.has(participant.identity)) {
            knownUsersMap.set(participant.identity, { username: participant.identity, pictureUrl: null, color: '#fff' });
        }
        if (participant.audioTracks) {
            participant.audioTracks.forEach(async pub => {
                if (pub.track) {
                    await attachRemoteAudioTrack(participant, pub.track);
                }
            });
        }
        if (participant.videoTracks) {
            participant.videoTracks.forEach(pub => {
                if (pub.track && !pub.isMuted) {
                    createParticipantBoxIfNeeded(participant);
                    attachVideoTrackToBox(participant, pub.track);
                }
            });
        }
    });

    if (uiSyncInterval) clearInterval(uiSyncInterval);
    uiSyncInterval = setInterval(() => { if (room) updateVideoUI(); }, 1000);
    syncMainLayout();
    updateVideoUI();
    renderSidebar();
}

function createParticipantBoxIfNeeded(participant) {
    const sid = getParticipantSid(participant);
    if (document.getElementById(`box-${sid}`)) return;

    const localName = currentLoggedUserInfo.username || localStorage.getItem('mc_username') || "Sen";
    const identityName = participant.isLocal ? localName : (participant.identity || "Kullanıcı");

    const box = document.createElement('div');
    box.id = `box-${sid}`;
    box.className = "video-wrapper group";
    box.onclick = () => focusParticipant(sid);

    if (!participant.isLocal) {
        box.oncontextmenu = (ev) => {
            openUserVolumeContextMenu(identityName, ev);
            return false;
        };
    }

    const vidContainer = document.createElement('div');
    vidContainer.className = "vid-container w-full h-full absolute inset-0";
    box.appendChild(vidContainer);

    const infoBar = document.createElement('div');
    infoBar.className = "absolute bottom-2 left-2 right-2 flex items-center justify-between z-10 pointer-events-none";

    const nameTag = document.createElement('div');
    nameTag.className = "bg-black/60 backdrop-blur-sm text-white text-xs px-2 py-1 rounded-md font-medium truncate max-w-[70%]";
    nameTag.innerText = participant.isLocal ? `${localName} (Sen)` : identityName;
    infoBar.appendChild(nameTag);

    const statusIcons = document.createElement('div');
    statusIcons.className = "flex gap-1 items-center";
    statusIcons.innerHTML = `
        <div class="vol-level-badge bg-black/60 text-indigo-300 text-[10px] font-bold px-1.5 py-0.5 rounded-md hidden"></div>
        <div class="mic-status-icon bg-black/60 p-1 rounded-md text-mc-red hidden">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="22"/></svg>
        </div>
    `;
    infoBar.appendChild(statusIcons);
    box.appendChild(infoBar);

    const avatarFallback = document.createElement('div');
    avatarFallback.className = "avatar-container absolute inset-0 flex items-center justify-center bg-[#2b2d31] z-0";
    const activeCh = globalChannels.find(c => c.id === activeVoiceChannelId);
    let pUrl = null;

    if (activeCh && activeCh.voiceParticipants) {
        const vp = activeCh.voiceParticipants.find(v => v.username === identityName);
        if (vp) pUrl = vp.pictureUrl;
    }
    if (!pUrl) {
        const known = findKnownUserByUsername(identityName);
        if (known && known.pictureUrl) pUrl = known.pictureUrl;
    }

    const avatarUrl = pUrl ? getOptimizedImageUrl(pUrl, 128) : 'https://ui-avatars.com/api/?background=1e1f22&color=fff&name=' + encodeURIComponent(identityName || "User");
    avatarFallback.innerHTML = `<div class="w-20 h-20 rounded-full bg-[#1e1f22] border-4 border-transparent overflow-hidden shadow-lg transition-colors duration-200" id="avatar-border-${sid}"><img src="${avatarUrl}" class="w-full h-full object-cover"></div>`;
    box.appendChild(avatarFallback);

    document.getElementById('videoGrid').appendChild(box);
}

function updateVideoUI() {
    if (!room) return;

    const grid = document.getElementById('videoGrid');
    const spotlight = document.getElementById('spotlightMain');
    let participants = [room.localParticipant, ...Array.from(room.participants.values())].filter(Boolean);

    const validSids = new Set(participants.map(p => getParticipantSid(p)));
    Array.from(grid.children).forEach(child => {
        const sid = child.id.replace('box-', '');
        if (!validSids.has(sid)) child.remove();
    });
    if (spotlight.children.length > 0) {
        const spotSid = spotlight.children[0].id.replace('box-', '');
        if (!validSids.has(spotSid)) {
            spotlight.innerHTML = '';
            spotlight.classList.add('hidden');
            focusedParticipantSid = null;
        }
    }

    participants.forEach(p => {
        createParticipantBoxIfNeeded(p);
        const sid = getParticipantSid(p);
        const box = document.getElementById(`box-${sid}`);
        if (!box) return;

        const isCam = hasVideo(p);
        const isMuted = isParticipantMicMuted(p);
        const isSpeaking = p.isSpeaking;

        const vidContainer = box.querySelector('.vid-container');
        const avatarFallback = box.querySelector('.avatar-container');
        const micIcon = box.querySelector('.mic-status-icon');
        const volBadge = box.querySelector('.vol-level-badge');
        const avatarBorder = box.querySelector(`#avatar-border-${sid}`);

        if (p.isLocal && isCam && vidContainer.children.length === 0) {
            attachLocalVideoIfAvailable();
        }

        if (!hideAllCameraStreams && isCam && vidContainer.children.length > 0) {
            vidContainer.style.opacity = '1';
            avatarFallback.style.opacity = '0';
        } else {
            vidContainer.style.opacity = '0';
            avatarFallback.style.opacity = '1';
        }

        if (isMuted) micIcon.classList.remove('hidden');
        else micIcon.classList.add('hidden');

        if (volBadge && !p.isLocal) {
            const pct = Math.round(getParticipantVolume(p.identity) * 100);
            if (pct < 100) {
                volBadge.innerText = `🔊 ${pct}%`;
                volBadge.classList.remove('hidden');
            } else {
                volBadge.classList.add('hidden');
            }
        }

        if (isSpeaking) {
            box.style.boxShadow = 'inset 0 0 0 3px #23a559';
            if (avatarBorder) avatarBorder.className = "w-20 h-20 rounded-full bg-[#1e1f22] border-4 border-mc-green overflow-hidden shadow-lg transition-colors duration-200";
        } else {
            box.style.boxShadow = 'none';
            if (avatarBorder) avatarBorder.className = "w-20 h-20 rounded-full bg-[#1e1f22] border-4 border-transparent overflow-hidden shadow-lg transition-colors duration-200";
        }

        if (focusedParticipantSid === sid && spotlight.children.length === 0) {
            spotlight.appendChild(box);
        } else if (focusedParticipantSid !== sid && box.parentElement === spotlight) {
            grid.appendChild(box);
        }
    });

    const totalBoxes = grid.children.length;
    grid.className = "video-grid flex-1";
    if (focusedParticipantSid) {
        spotlight.classList.remove('hidden');
        spotlight.classList.add('flex');
        grid.classList.add('spotlight-active');
    } else {
        spotlight.classList.add('hidden');
        spotlight.classList.remove('flex');
        if (totalBoxes === 1) grid.classList.add('grid-1');
        else if (totalBoxes === 2) grid.classList.add('grid-2');
        else if (totalBoxes <= 4) grid.classList.add('grid-4');
        else if (totalBoxes <= 6) grid.classList.add('grid-6');
        else if (totalBoxes <= 9) grid.classList.add('grid-9');
        else if (totalBoxes <= 12) grid.classList.add('grid-12');
        else grid.classList.add('grid-16');
    }
}

function focusParticipant(sid) {
    focusedParticipantSid = (focusedParticipantSid === sid) ? null : sid;
    updateVideoUI();
}

async function toggleMic() {
    if (!room || !room.localParticipant) return;
    const targetState = !isMicEnabled;

    try {
        const captureOpts = selectedMicDeviceId ? { deviceId: selectedMicDeviceId } : undefined;
        await room.localParticipant.setMicrophoneEnabled(targetState, captureOpts);
        isMicEnabled = targetState;
        updateVideoUI();
        resetMediaButtonsUI();
        renderSidebar();
    } catch (e) {
        alert("Mikrofon erişimi reddedildi veya hata oluştu.");
    }
}

async function toggleCam() {
    if (!room || !room.localParticipant) return;
    const targetState = !isCamEnabled;

    try {
        const captureOpts = selectedCamDeviceId ? { deviceId: selectedCamDeviceId } : undefined;
        await room.localParticipant.setCameraEnabled(targetState, captureOpts);
        isCamEnabled = targetState;

        if (isCamEnabled) {
            attachLocalVideoIfAvailable();
        } else {
            const box = document.getElementById('box-local');
            if (box) {
                const vidContainer = box.querySelector('.vid-container');
                if (vidContainer) vidContainer.innerHTML = '';
            }
        }

        updateVideoUI();
        resetMediaButtonsUI();
        renderSidebar();
    } catch (e) {
        alert("Kamera erişimi reddedildi veya hata oluştu.");
    }
}

function resetMediaButtonsUI() {
    const micBtn = document.getElementById('btnMic');
    const camBtn = document.getElementById('btnCam');

    if (micBtn) {
        if (isMicEnabled) {
            document.getElementById('iconMicOn').classList.remove('hidden');
            document.getElementById('iconMicOff').classList.add('hidden');
            micBtn.classList.remove('bg-mc-sidebar');
            micBtn.classList.add('bg-white', 'text-black', 'hover:bg-gray-200');
        } else {
            document.getElementById('iconMicOn').classList.add('hidden');
            document.getElementById('iconMicOff').classList.remove('hidden');
            micBtn.classList.add('bg-mc-sidebar');
            micBtn.classList.remove('bg-white', 'text-black', 'hover:bg-gray-200');
        }
    }

    if (camBtn) {
        if (isCamEnabled) {
            document.getElementById('iconCamOn').classList.remove('hidden');
            document.getElementById('iconCamOff').classList.add('hidden');
            camBtn.classList.remove('bg-mc-sidebar');
            camBtn.classList.add('bg-white', 'text-black', 'hover:bg-gray-200');
        } else {
            document.getElementById('iconCamOn').classList.add('hidden');
            document.getElementById('iconCamOff').classList.remove('hidden');
            camBtn.classList.add('bg-mc-sidebar');
            camBtn.classList.remove('bg-white', 'text-black', 'hover:bg-gray-200');
        }
    }
}

async function toggleDeviceModal(e) {
    if (e) e.stopPropagation();
    const modal = document.getElementById('deviceSettingsModal');
    if (!modal) return;
    const isHidden = modal.classList.contains('hidden');
    if (isHidden) {
        await refreshMediaDeviceLists();
        const hideCamCheckbox = document.getElementById('toggleHideCamerasCheckbox');
        if (hideCamCheckbox) hideCamCheckbox.checked = hideAllCameraStreams;
        modal.classList.remove('hidden');
    } else {
        modal.classList.add('hidden');
    }
}

function closeDeviceModal() {
    const modal = document.getElementById('deviceSettingsModal');
    if (modal) modal.classList.add('hidden');
}

async function refreshMediaDeviceLists() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;

    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const mics = devices.filter(d => d.kind === 'audioinput');
        const cams = devices.filter(d => d.kind === 'videoinput');
        const speakers = devices.filter(d => d.kind === 'audiooutput');

        const micSelect = document.getElementById('selectMicDevice');
        const camSelect = document.getElementById('selectCamDevice');
        const speakerSelect = document.getElementById('selectSpeakerDevice');

        if (micSelect) {
            micSelect.innerHTML = mics.length
                ? mics.map((d, i) => `<option value="${d.deviceId}" ${d.deviceId === selectedMicDeviceId ? 'selected' : ''}>${d.label || `Mikrofon ${i + 1}`}</option>`).join('')
                : `<option value="">Varsayılan Mikrofon</option>`;
        }

        if (camSelect) {
            camSelect.innerHTML = cams.length
                ? cams.map((d, i) => `<option value="${d.deviceId}" ${d.deviceId === selectedCamDeviceId ? 'selected' : ''}>${d.label || `Kamera ${i + 1}`}</option>`).join('')
                : `<option value="">Varsayılan Kamera</option>`;
        }

        if (speakerSelect) {
            speakerSelect.innerHTML = speakers.length
                ? speakers.map((d, i) => `<option value="${d.deviceId}" ${(d.deviceId === selectedSpeakerDeviceId || (!selectedSpeakerDeviceId && i === 0)) ? 'selected' : ''}>${d.label || `Hoparlör / Kulaklık ${i + 1}`}</option>`).join('')
                : `<option value="">Varsayılan Ses Çıkışı</option>`;
        }
    } catch (e) {}
}

async function handleMicDeviceChange(deviceId) {
    selectedMicDeviceId = deviceId || '';
    localStorage.setItem('mc_mic_device_id', selectedMicDeviceId);

    if (!room) return;
    try {
        if (typeof room.switchActiveDevice === 'function' && selectedMicDeviceId) {
            await room.switchActiveDevice('audioinput', selectedMicDeviceId);
        } else if (isMicEnabled && room.localParticipant) {
            await room.localParticipant.setMicrophoneEnabled(false);
            await room.localParticipant.setMicrophoneEnabled(true, { deviceId: selectedMicDeviceId });
        }
    } catch (e) {}
}

async function handleCamDeviceChange(deviceId) {
    selectedCamDeviceId = deviceId || '';
    localStorage.setItem('mc_cam_device_id', selectedCamDeviceId);

    if (!room) return;
    try {
        if (typeof room.switchActiveDevice === 'function' && selectedCamDeviceId) {
            await room.switchActiveDevice('videoinput', selectedCamDeviceId);
        } else if (isCamEnabled && room.localParticipant) {
            await room.localParticipant.setCameraEnabled(false);
            await room.localParticipant.setCameraEnabled(true, { deviceId: selectedCamDeviceId });
        }
        if (isCamEnabled) {
            setTimeout(() => {
                attachLocalVideoIfAvailable();
                updateVideoUI();
            }, 150);
        }
    } catch (e) {}
}

async function handleSpeakerDeviceChange(deviceId) {
    selectedSpeakerDeviceId = deviceId || '';
    localStorage.setItem('mc_speaker_device_id', selectedSpeakerDeviceId);
    await applyAudioOutputDeviceToElements();
}

async function leaveRoom() {
    if (room) {
        room.removeAllListeners();
        try { await room.disconnect(); } catch (e) {}
        room = null;
    }
    if (uiSyncInterval) clearInterval(uiSyncInterval);

    isMicEnabled = false;
    isCamEnabled = false;
    activeVoiceChannelId = null;
    activeVoiceChannelName = "";
    focusedParticipantSid = null;

    document.getElementById('videoGrid').innerHTML = '';
    document.getElementById('spotlightMain').innerHTML = '';
    document.getElementById('audioContainer').innerHTML = '';

    const statusEl = document.getElementById('localStatusText');
    statusEl.innerText = "Bağlı değil";
    statusEl.className = "text-[11px] text-gray-400 truncate transition-colors";
    document.getElementById('connectionDot').className = "absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-gray-500 border-[2px] border-[#232428]";

    isPopupForced = false;
    closeDeviceModal();
    closeUserVolumeContextMenu();
    syncMainLayout();
    fetchActiveChannels();
}