import makeWASocket, {
    DisconnectReason,
    useMultiFileAuthState,
    jidNormalizedUser
} from "@whiskeysockets/baileys";
import * as fs from "fs";

const badWords = ["anjing", "goblok", "kontol", "bangsat"];
const spamTracker: Record<string, { lastMessage: string; lastTime: number }> = {};
const violationScores: Record<string, number> = {};

const isLink = (text: string) => /https?:\/\/[^\s]+/gi.test(text);

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState("auth");
    const sock = makeWASocket({ auth: state, printQRInTerminal: true });

    sock.ev.on("messages.upsert", async ({ messages }) => {
        const msg = messages[0];
        const groupId = msg.key.remoteJid;
        const senderRaw = msg.key.participant || msg.key.remoteJid;
        if (!senderRaw || !groupId?.endsWith("@g.us") || !msg.message || !msg.key.id) return;

        const senderID = jidNormalizedUser(senderRaw);
        const messageId = msg.key.id;
        const textMsg = msg.message.conversation || msg.message.extendedTextMessage?.text || "";

        const now = Date.now();
        const spamData = spamTracker[senderID] || { lastMessage: "", lastTime: 0 };

        // Anti spam
        if (spamData.lastMessage === textMsg) {
            const hoursPassed = (now - spamData.lastTime) / (1000 * 60 * 60);
            if (hoursPassed < 5) {
                await sock.sendMessage(groupId, {
                    text: `Pesan @${senderID.split("@")[0]} terdeteksi spam dan telah dihapus.`,
                    mentions: [senderID]
                });
                await sock.sendMessage(groupId, {
                    delete: {
                        remoteJid: groupId,
                        fromMe: false,
                        id: messageId,
                        participant: senderID
                    }
                });
                await trackViolation(senderID, groupId, sock);
                return;
            }
        }
        spamTracker[senderID] = { lastMessage: textMsg, lastTime: now };

        let violated = false;

        // Filter kata kasar
        for (const word of badWords) {
            if (textMsg.toLowerCase().includes(word.toLowerCase())) {
                await sock.sendMessage(groupId, {
                    text: `Pesan @${senderID.split("@")[0]} mengandung kata terlarang dan telah dihapus.`,
                    mentions: [senderID]
                });
                await sock.sendMessage(groupId, {
                    delete: {
                        remoteJid: groupId,
                        fromMe: false,
                        id: messageId,
                        participant: senderID
                    }
                });
                violated = true;
                break;
            }
        }

        // Anti link
        if (isLink(textMsg)) {
            await sock.sendMessage(groupId, {
                text: `Pesan @${senderID.split("@")[0]} berisi link dan telah dihapus.`,
                mentions: [senderID]
            });
            await sock.sendMessage(groupId, {
                delete: {
                    remoteJid: groupId,
                    fromMe: false,
                    id: messageId,
                    participant: senderID
                }
            });
            violated = true;
        }

        if (violated) {
            await trackViolation(senderID, groupId, sock);
        }
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === "close") {
            const shouldReconnect = (lastDisconnect?.error as any)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        }
    });
}

async function trackViolation(user: string, groupId: string, sock: any) {
    violationScores[user] = (violationScores[user] || 0) + 1;
    if (violationScores[user] >= 3) {
        await sock.sendMessage(groupId, {
            text: `@${user.split("@")[0]} telah melanggar aturan 3x dan akan dikeluarkan.`,
            mentions: [user]
        });
        try {
            await sock.groupParticipantsUpdate(groupId, [user], "remove");
        } catch (err) {
            await sock.sendMessage(groupId, {
                text: `Gagal mengeluarkan @${user.split("@")[0]}. Pastikan bot adalah admin.`,
                mentions: [user]
            });
        }
        violationScores[user] = 0;
    }
}

startBot();