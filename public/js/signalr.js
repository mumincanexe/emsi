let chairoHubConnection = null;
let chairoHubConnectingPromise = null;

async function ensureChairoHubConnected() {
    const token = localStorage.getItem('mc_token');
    if (!token || typeof signalR === 'undefined') return null;

    if (chairoHubConnection && chairoHubConnection.state === signalR.HubConnectionState.Connected) {
        return chairoHubConnection;
    }

    if (chairoHubConnectingPromise) {
        return await chairoHubConnectingPromise;
    }

    chairoHubConnectingPromise = (async () => {
        try {
            if (chairoHubConnection) {
                try { await chairoHubConnection.stop(); } catch (e) {}
            }

            chairoHubConnection = new signalR.HubConnectionBuilder()
                .withUrl("https://api.meetingchallenge.com/chairohub", {
                    accessTokenFactory: () => localStorage.getItem('mc_token'),
                    transport: signalR.HttpTransportType.LongPolling
                })
                .withAutomaticReconnect()
                .configureLogging(signalR.LogLevel.Warning)
                .build();

            chairoHubConnection.on("channelunreadupdated", () => { fetchActiveChannels(); });
            chairoHubConnection.on("voiceparticipantleft", () => { fetchActiveChannels(); });
            chairoHubConnection.on("voiceparticipantjoined", () => { fetchActiveChannels(); });

            const onIncomingPostEvent = () => {
                if (currentChatChannelId) pollNewMessages();
                fetchActiveChannels();
            };

            [
                "ReceivePost", "receivepost", "NewPost", "newpost",
                "PostCreated", "PostUpdated", "postupdated", "UpdatePost",
                "PostDeleted", "postdeleted", "DeletePost",
                "AddEmojiPost", "addemojipost", "RemoveEmojiPost", "removeemojipost"
            ].forEach(evt => chairoHubConnection.on(evt, onIncomingPostEvent));

            await chairoHubConnection.start();
            return chairoHubConnection;
        } catch (err) {
            return null;
        } finally {
            chairoHubConnectingPromise = null;
        }
    })();

    return await chairoHubConnectingPromise;
}

async function joinSignalRChannel(channelId) {
    if (!channelId) return;
    const hub = await ensureChairoHubConnected();
    if (hub && hub.state === signalR.HubConnectionState.Connected) {
        try { await hub.invoke("JoinChannel", Number(channelId)); } catch (err) {}
    }
}

async function leaveSignalRChannel(channelId) {
    if (!channelId) return;
    const hub = await ensureChairoHubConnected();
    if (hub && hub.state === signalR.HubConnectionState.Connected) {
        try { await hub.invoke("LeaveChannel", Number(channelId)); } catch (err) {}
    }
}

// Yanıtlama varsa tam olarak {"Content":"...", "ChannelId":1110, "AttachmentUrl":"", "ReplyTo":791793} gönderir
async function sendPostViaSignalR(channelId, content, attachmentUrl = "", replyToPostId = null) {
    const hub = await ensureChairoHubConnected();
    if (!hub || hub.state !== signalR.HubConnectionState.Connected) {
        throw new Error("SignalR hub bağlantısı aktif değil.");
    }

    const payload = {
        Content: content || "",
        ChannelId: Number(channelId),
        AttachmentUrl: attachmentUrl || ""
    };

    if (replyToPostId !== null && replyToPostId !== undefined && Number(replyToPostId) > 0) {
        payload.ReplyTo = Number(replyToPostId);
    }

    return await hub.invoke("SendPost", payload);
}

async function updatePostViaSignalR(postId, content, attachmentUrl = "") {
    const hub = await ensureChairoHubConnected();
    if (!hub || hub.state !== signalR.HubConnectionState.Connected) {
        throw new Error("SignalR hub bağlantısı aktif değil.");
    }
    return await hub.invoke("UpdatePost", {
        PostId: Number(postId),
        Content: content,
        AttachmentUrl: attachmentUrl || ""
    });
}

async function deletePostViaSignalR(postId) {
    const hub = await ensureChairoHubConnected();
    if (!hub || hub.state !== signalR.HubConnectionState.Connected) {
        throw new Error("SignalR hub bağlantısı aktif değil.");
    }
    return await hub.invoke("DeletePost", Number(postId));
}

async function addEmojiPostViaSignalR(postId, emojiId) {
    const hub = await ensureChairoHubConnected();
    if (!hub || hub.state !== signalR.HubConnectionState.Connected) {
        throw new Error("SignalR hub bağlantısı aktif değil.");
    }
    return await hub.invoke("AddEmojiPost", {
        PostId: Number(postId),
        EmojiId: Number(emojiId)
    });
}

async function removeEmojiPostViaSignalR(postId, emojiId) {
    const hub = await ensureChairoHubConnected();
    if (!hub || hub.state !== signalR.HubConnectionState.Connected) {
        throw new Error("SignalR hub bağlantısı aktif değil.");
    }
    return await hub.invoke("RemoveEmojiPost", {
        PostId: Number(postId),
        EmojiId: Number(emojiId)
    });
}