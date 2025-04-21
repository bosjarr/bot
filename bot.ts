import makeWASocket, {
    DisconnectReason,
    useMultiFileAuthState,
    jidNormalizedUser
} from "@whiskeysockets/baileys";
import * as fs from "fs";

const badWords = ["anjing", "goblok", "kontol", "bangsat"];
const spamTracker: Record < string, { lastMessage: string;lastTime: number } > = {};
const violationScores: Record < string, number > = {};

const isLink = (text: string) => /https?:\/\/[^\s]+/gi.test(text);

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState("auth");
    const sock = makeWASocket({ auth: state, printQRInTerminal: true });
    
    sock.ev.on("messages.upsert", async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || !msg.key.remoteJid?.endsWith("@g.us")) return;
        
        const groupId = msg.key.remoteJid;
        const sender = msg.key.participant || msg.key.remoteJid;
        const senderID = jidNormalizedUser(sender);
        const textMsg = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        
        const now = Date.now();
        const spamData = spamTracker[senderID] || { lastMessage: "", lastTime: 0 };
        
        // Anti spam
        if (spamData.lastMessage === textMsg) {
            const hoursPassed = (now - spamData.lastTime) / (1000 * 60 * 60);
            if (hoursPassed < 5) {
                await sock.sendMessage(groupId, {
                    text: `Pesan @${senderID.split("@")[0]} sama persis dengan sebelumnya, dihapus karena terdeteksi spam.`,
                    mentions: [senderID]
                });
                await sock.sendMessage(groupId, {
                    delete: {
                        remoteJid: groupId,
                        fromMe: false,
                        id: msg.key.id,
                        participant: senderID
                    }
                });
                trackViolation(senderID, groupId, sock, msg.key.id, senderID);
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
                        id: msg.key.id,
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
                text: `Pesan @${senderID.split("@")[0]} mengandung link dan telah dihapus.`,
                mentions: [senderID]
            });
            await sock.sendMessage(groupId, {
                delete: {
                    remoteJid: groupId,
                    fromMe: false,
                    id: msg.key.id,
                    participant: senderID
                }
            });
            violated = true;
        }
        
        if (violated) {
            trackViolation(senderID, groupId, sock, msg.key.id, senderID);
        }
    });
    
    sock.ev.on("creds.update", saveCreds);
    
    sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === "close") {
            const shouldReconnect = (lastDisconnect?.error as any)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                startBot();
            }
        }
    });
}

// Fungsi untuk kelola skor dan kick
async function trackViolation(user: string, groupId: string, sock: any, messageId: string, participant: string) {
    violationScores[user] = (violationScores[user] || 0) + 1;
    if (violationScores[user] >= 3) {
        await sock.sendMessage(groupId, {
            text: `@${user.split("@")[0]} telah melanggar aturan 3x dan akan dikick.`,
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