import makeWASocket, {
    DisconnectReason,
    useMultiFileAuthState,
    GroupMetadata,
    jidNormalizedUser
} from "@whiskeysockets/baileys";
import * as fs from "fs";

const badWords = ["asu", "ngentot", "anjing", "goblok", 'memek', 'tempek', 'jancok', 'kontol', 'kintil', 'babi', 'peli', 'pentel'];
const spamTracker: Record<string, { lastMessage: string; lastTime: number }> = {};
const violationScores: Record<string, number> = {};

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

        // --- Anti Spam ---
        const now = Date.now();
        const spamData = spamTracker[senderID] || { lastMessage: "", lastTime: 0 };

        if (spamData.lastMessage === textMsg) {
            const hoursPassed = (now - spamData.lastTime) / (1000 * 60 * 60);
            if (hoursPassed < 6) {
                await sock.sendMessage(groupId, {
                    text: `@${senderID.split("@")[0]}, kamu mengirim pesan yang sama. Tunggu 5 jam sebelum kirim ulang.`,
                    mentions: [senderID]
                });
                return;
            }
        }

        // Update spam tracker
        spamTracker[senderID] = { lastMessage: textMsg, lastTime: now };

        let violated = false;

        // --- Filter kata kasar ---
        for (const word of badWords) {
            if (textMsg.toLowerCase().includes(word.toLowerCase())) {
                await sock.sendMessage(groupId, {
                    text: `@${senderID.split("@")[0]} kata tidak sopan terdeteksi.`,
                    mentions: [senderID]
                });
                violated = true;
                break;
            }
        }

        // --- Anti Link ---
        if (isLink(textMsg)) {
            await sock.sendMessage(groupId, {
                text: `@${senderID.split("@")[0]} tidak boleh mengirim link di grup ini.`,
                mentions: [senderID]
            });
            violated = true;
        }

        // --- Skor pelanggaran dan auto-kick jika 3x ---
        if (violated) {
            violationScores[senderID] = (violationScores[senderID] || 0) + 1;

            if (violationScores[senderID] >= 3) {
                await sock.sendMessage(groupId, {
                    text: `@${senderID.split("@")[0]} telah melanggar 3x dan akan dikick.`,
                    mentions: [senderID]
                });

                try {
                    await sock.groupParticipantsUpdate(groupId, [senderID], "remove");
                } catch (err) {
                    console.error("Gagal kick:", err);
                    await sock.sendMessage(groupId, { text: `Gagal kick, mungkin bot bukan admin.` });
                }

                violationScores[senderID] = 0; // Reset skor setelah dikick
            }
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

startBot();