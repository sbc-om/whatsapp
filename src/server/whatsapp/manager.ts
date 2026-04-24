import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

import { Location, MessageMedia, Poll } from "whatsapp-web.js";

import { statusStore } from "@/server/store/statusStore";
import { createWwebjsClient, resolveDataPath } from "@/server/whatsapp/client";
import { toWhatsAppChatId } from "@/server/whatsapp/phone";

const MAX_RECONNECT_DELAY_MS = 30_000;

interface SessionContext {
  reconnectAttempts: number;
  isInitialized: boolean;
  initializePromise?: Promise<void>;
  reconnectTimer?: NodeJS.Timeout;
  client: ReturnType<typeof createWwebjsClient>;
}

class SessionManager {
  private readonly sessions = new Map<string, SessionContext>();

  private isBrowserLockError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes("The browser is already running for");
  }

  private normalizeInitError(error: unknown) {
    const raw = error instanceof Error ? error.message : String(error);
    if (this.isBrowserLockError(error)) {
      return `${raw} Stop other Next/worker processes using this session, then retry.`;
    }
    return raw;
  }

  private tryReleaseSessionBrowserLock(sessionId: string) {
    try {
      spawnSync("pkill", ["-f", `session-${sessionId}`], {
        stdio: "ignore",
      });
    } catch {
      // ignore recovery errors; caller will still receive the original init error
    }

    try {
      const sessionDir = path.join(resolveDataPath(), `session-${sessionId}`);
      const lockCandidates = [
        path.join(sessionDir, "SingletonLock"),
        path.join(sessionDir, "SingletonCookie"),
        path.join(sessionDir, "SingletonSocket"),
      ];

      for (const filePath of lockCandidates) {
        if (fs.existsSync(filePath)) {
          fs.rmSync(filePath, { force: true });
        }
      }
    } catch {
      // ignore stale lock cleanup errors
    }
  }

  private async initializeWithRecovery(sessionId: string, context: SessionContext) {
    try {
      await context.client.initialize();
      return;
    } catch (error) {
      if (!this.isBrowserLockError(error)) {
        throw error;
      }

      this.tryReleaseSessionBrowserLock(sessionId);

      try {
        await context.client.destroy();
      } catch {
        // ignore
      }

      const replacementClient = createWwebjsClient(sessionId);
      const replacementContext: SessionContext = {
        reconnectAttempts: context.reconnectAttempts,
        isInitialized: false,
        client: replacementClient,
      };
      this.attachEvents(sessionId, replacementContext);
      this.sessions.set(sessionId, replacementContext);

      await replacementClient.initialize();
      replacementContext.isInitialized = true;
      return;
    }
  }

  private getDefaultSessionId() {
    return process.env.DEFAULT_SESSION_ID || "main";
  }

  private getOrCreateContext(sessionId: string) {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      return existing;
    }

    const client = createWwebjsClient(sessionId);
    const context: SessionContext = {
      reconnectAttempts: 0,
      isInitialized: false,
      client,
    };

    this.attachEvents(sessionId, context);
    this.sessions.set(sessionId, context);
    statusStore.upsertSession(sessionId, {
      status: "connecting",
      reconnectAttempts: 0,
    });

    return context;
  }

  private attachEvents(sessionId: string, context: SessionContext) {
    const { client } = context;

    client.on("qr", (qr: string) => {
      statusStore.upsertSession(sessionId, {
        status: "qr",
        qr,
      });
    });

    client.on("authenticated", () => {
      context.isInitialized = true;
      context.reconnectAttempts = 0;
      statusStore.upsertSession(sessionId, {
        status: "authenticated",
        reconnectAttempts: 0,
      });
    });

    client.on("ready", () => {
      context.isInitialized = true;
      context.reconnectAttempts = 0;
      statusStore.upsertSession(sessionId, {
        status: "ready",
        reconnectAttempts: 0,
      });
    });

    client.on("auth_failure", (message: string) => {
      context.isInitialized = false;
      statusStore.upsertSession(sessionId, {
        status: "auth_failure",
        lastError: message,
      });
      this.scheduleReconnect(sessionId, context);
    });

    client.on("disconnected", (reason: string) => {
      context.isInitialized = false;
      statusStore.upsertSession(sessionId, {
        status: "disconnected",
        lastError: reason,
      });
      this.scheduleReconnect(sessionId, context);
    });
  }

  private scheduleReconnect(sessionId: string, context: SessionContext) {
    if (context.reconnectTimer) {
      return;
    }

    context.reconnectAttempts += 1;
    const delayMs = Math.min(
      MAX_RECONNECT_DELAY_MS,
      2 ** context.reconnectAttempts * 1000,
    );

    statusStore.upsertSession(sessionId, {
      status: "connecting",
      reconnectAttempts: context.reconnectAttempts,
    });

    context.reconnectTimer = setTimeout(async () => {
      context.reconnectTimer = undefined;
      try {
        await this.reconnect(sessionId);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown reconnect error";
        statusStore.upsertSession(sessionId, {
          status: "disconnected",
          lastError: message,
          reconnectAttempts: context.reconnectAttempts,
        });
        this.scheduleReconnect(sessionId, context);
      }
    }, delayMs);
  }

  async ensureSession(sessionId = this.getDefaultSessionId()) {
    const context = this.getOrCreateContext(sessionId);

    if (context.isInitialized) {
      return context.client;
    }

    if (!context.initializePromise) {
      context.initializePromise = this.initializeWithRecovery(sessionId, context)
        .then(() => {
          context.isInitialized = true;
        })
        .catch((error) => {
          context.isInitialized = false;
          const message = this.normalizeInitError(error);
          throw new Error(message);
        })
        .finally(() => {
        context.initializePromise = undefined;
      });
    }

    await context.initializePromise;
    return context.client;
  }

  startSession(sessionId = this.getDefaultSessionId()) {
    const context = this.getOrCreateContext(sessionId);

    if (context.isInitialized || context.initializePromise) {
      return;
    }

    context.initializePromise = this.initializeWithRecovery(sessionId, context)
      .then(() => {
        context.isInitialized = true;
      })
      .catch((error) => {
        context.isInitialized = false;
        const message = this.normalizeInitError(error);
        statusStore.upsertSession(sessionId, {
          status: "disconnected",
          lastError: message,
        });
      })
      .finally(() => {
        context.initializePromise = undefined;
      });
  }

  discoverSessions() {
    const dataPath = resolveDataPath();

    let entries: string[] = [];
    try {
      entries = fs.readdirSync(dataPath, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name.startsWith("session-"))
        .map((entry) => entry.name.replace(/^session-/, ""));
    } catch {
      return [] as string[];
    }

    const discovered = Array.from(new Set(entries));
    for (const sessionId of discovered) {
      this.getOrCreateContext(sessionId);
      statusStore.upsertSession(sessionId, {
        status: statusStore.getSession(sessionId)?.status ?? "unknown",
      });
    }

    return discovered;
  }

  getSessionState(sessionId: string) {
    return (
      statusStore.getSession(sessionId) ??
      statusStore.upsertSession(sessionId, {
        status: "unknown",
        reconnectAttempts: 0,
      })
    );
  }

  getAllSessionStates() {
    return statusStore.getSessions();
  }

  getQrString(sessionId: string) {
    return statusStore.getSession(sessionId)?.qr || null;
  }

  async reconnect(sessionId: string) {
    const context = this.getOrCreateContext(sessionId);
    statusStore.upsertSession(sessionId, {
      status: "connecting",
      lastError: undefined,
    });

    try {
      await context.client.destroy();
    } catch {
      // ignore destroy errors on reconnect
    }

    const replacementClient = createWwebjsClient(sessionId);
    const replacementContext: SessionContext = {
      reconnectAttempts: context.reconnectAttempts,
      isInitialized: false,
      client: replacementClient,
    };

    this.attachEvents(sessionId, replacementContext);
    this.sessions.set(sessionId, replacementContext);
    replacementContext.initializePromise = this.initializeWithRecovery(
      sessionId,
      replacementContext,
    )
      .then(() => {
        replacementContext.isInitialized = true;
      })
      .catch((error) => {
        replacementContext.isInitialized = false;
        const message = this.normalizeInitError(error);
        throw new Error(message);
      })
      .finally(() => {
        replacementContext.initializePromise = undefined;
      });

    await replacementContext.initializePromise;
  }

  async logout(sessionId: string) {
    const context = this.sessions.get(sessionId);
    if (!context) {
      return;
    }

    if (context.reconnectTimer) {
      clearTimeout(context.reconnectTimer);
    }

    await context.client.logout();
    await context.client.destroy();
    this.sessions.delete(sessionId);

    statusStore.upsertSession(sessionId, {
      status: "disconnected",
      qr: undefined,
      reconnectAttempts: 0,
      lastError: undefined,
    });
  }

  async sendText(sessionId: string, to: string, text: string) {
    const client = await this.ensureSession(sessionId);
    const chatId = toWhatsAppChatId(to);
    return client.sendMessage(chatId, text);
  }

  async sendLocation(
    sessionId: string,
    to: string,
    latitude: number,
    longitude: number,
    description?: string,
  ) {
    const client = await this.ensureSession(sessionId);
    const chatId = toWhatsAppChatId(to);
    const location = new Location(
      latitude,
      longitude,
      description ? { name: description } : undefined,
    );
    return client.sendMessage(chatId, location);
  }

  async sendPoll(
    sessionId: string,
    to: string,
    pollName: string,
    options: string[],
    allowMultiple = false,
  ) {
    const client = await this.ensureSession(sessionId);
    const chatId = toWhatsAppChatId(to);
    const poll = new Poll(pollName, options, {
      allowMultipleAnswers: allowMultiple,
      messageSecret: undefined,
    });
    return client.sendMessage(chatId, poll);
  }

  async sendContactCard(sessionId: string, to: string, contactId: string) {
    const client = await this.ensureSession(sessionId);
    const toChatId = toWhatsAppChatId(to);
    const normalizedContactId = this.normalizeContactId(contactId);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const targetClient = client as any;
    if (typeof targetClient.getContactById !== "function") {
      throw new Error("Contact APIs are not supported by this client version");
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contact = await targetClient.getContactById(normalizedContactId) as any;
    return client.sendMessage(toChatId, contact);
  }

  async rejectCall(sessionId: string, callId: string) {
    const client = await this.ensureSession(sessionId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const targetClient = client as any;

    if (typeof targetClient.rejectCall === "function") {
      return targetClient.rejectCall(callId);
    }

    throw new Error("Reject call is not supported by this client version");
  }

  async sendMedia(params: {
    sessionId: string;
    to: string;
    mediaUrl: string;
    caption?: string;
    filename?: string;
  }) {
    const client = await this.ensureSession(params.sessionId);
    const chatId = toWhatsAppChatId(params.to);

    const media = await MessageMedia.fromUrl(params.mediaUrl, {
      unsafeMime: true,
      filename: params.filename,
    });

    return client.sendMessage(chatId, media, {
      caption: params.caption,
    });
  }

  async getChats(sessionId: string) {
    const client = await this.ensureSession(sessionId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chats = await (client as any).getChats();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return chats.map((chat: any) => ({
      id: chat.id?._serialized ?? String(chat.id),
      name: chat.name || chat.formattedTitle || chat.id?.user || "Unknown",
      isGroup: !!chat.isGroup,
      unreadCount: chat.unreadCount ?? 0,
      timestamp: (chat.timestamp ?? 0) * 1000,
      lastMessage: chat.lastMessage
        ? {
            body: chat.lastMessage.body ?? "",
            type: chat.lastMessage.type ?? "chat",
            timestamp: (chat.lastMessage.timestamp ?? chat.timestamp ?? 0) * 1000,
            fromMe: !!chat.lastMessage.fromMe,
          }
        : null,
      archived: !!chat.archived,
      pinned: !!chat.pinned,
      muteExpiration: chat.muteExpiration,
    }));
  }

  async getContacts(sessionId: string) {
    const client = await this.ensureSession(sessionId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contacts = await (client as any).getContacts();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return contacts.map((contact: any) => {
      const serializedId = contact.id?._serialized ?? String(contact.id ?? "");
      const number = contact.number || contact.userid || serializedId.split("@")[0] || "";

      return {
        id: serializedId,
        number,
        name: contact.name || contact.pushname || contact.shortName || number || "Unknown",
        pushname: contact.pushname || null,
        shortName: contact.shortName || null,
        isBusiness: !!contact.isBusiness,
        isEnterprise: !!contact.isEnterprise,
        isMyContact: !!contact.isMyContact,
        isBlocked: !!contact.isBlocked,
        isGroup: !!contact.isGroup,
        isWAContact: !!contact.isWAContact,
      };
    });
  }

  async getContactById(sessionId: string, contactId: string) {
    const client = await this.ensureSession(sessionId);
    const normalizedContactId = this.normalizeContactId(contactId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const targetClient = client as any;

    if (typeof targetClient.getContactById !== "function") {
      throw new Error("Contact APIs are not supported by this client version");
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contact = await targetClient.getContactById(normalizedContactId) as any;
    const serializedId = contact.id?._serialized ?? String(contact.id ?? normalizedContactId);
    const number = contact.number || contact.userid || serializedId.split("@")[0] || "";

    return {
      id: serializedId,
      number,
      name: contact.name || contact.pushname || contact.shortName || number || "Unknown",
      pushname: contact.pushname || null,
      shortName: contact.shortName || null,
      isBusiness: !!contact.isBusiness,
      isEnterprise: !!contact.isEnterprise,
      isMyContact: !!contact.isMyContact,
      isBlocked: !!contact.isBlocked,
      isGroup: !!contact.isGroup,
      isWAContact: !!contact.isWAContact,
    };
  }

  async getProfilePicUrl(sessionId: string, contactId: string) {
    const client = await this.ensureSession(sessionId);
    const normalizedContactId = this.normalizeContactId(contactId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const targetClient = client as any;

    if (typeof targetClient.getProfilePicUrl === "function") {
      return targetClient.getProfilePicUrl(normalizedContactId);
    }

    throw new Error("Profile picture API is not supported by this client version");
  }

  async getContactAbout(sessionId: string, contactId: string) {
    const client = await this.ensureSession(sessionId);
    const normalizedContactId = this.normalizeContactId(contactId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const targetClient = client as any;

    if (typeof targetClient.getContactById !== "function") {
      throw new Error("Contact APIs are not supported by this client version");
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contact = await targetClient.getContactById(normalizedContactId) as any;
    if (typeof contact?.getAbout === "function") {
      return contact.getAbout();
    }

    if (typeof targetClient.getStatus === "function") {
      return targetClient.getStatus(normalizedContactId);
    }

    throw new Error("Contact about API is not supported by this client version");
  }

  async createGroup(sessionId: string, title: string, participants: string[]) {
    const client = await this.ensureSession(sessionId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const targetClient = client as any;
    if (typeof targetClient.createGroup !== "function") {
      throw new Error("Create group is not supported by this client version");
    }

    return targetClient.createGroup(
      title,
      participants.map((participant) => this.normalizeContactId(participant)),
    );
  }

  async getGroupChat(sessionId: string, chatId: string) {
    const client = await this.ensureSession(sessionId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chat = await (client as any).getChatById(chatId);

    if (!chat?.isGroup) {
      throw new Error("Chat is not a group");
    }

    return {
      id: chat.id?._serialized ?? String(chat.id),
      name: chat.name || chat.formattedTitle || chat.id?.user || "Unknown",
      description: chat.description ?? null,
      participantsCount: Array.isArray(chat.participants) ? chat.participants.length : 0,
      owner: chat.owner?._serialized ?? chat.owner ?? null,
      createdAt: chat.createdAt ?? null,
      isReadOnly: !!chat.isReadOnly,
      isAnnounce: !!chat.isAnnounce,
    };
  }

  private normalizeContactId(contactId: string) {
    return contactId.includes("@") ? contactId : toWhatsAppChatId(contactId);
  }

  private normalizeChatId(chatId: string) {
    let normalized = String(chatId).trim();

    // Decode a couple of times to tolerate already-encoded ids (e.g. %40lid or %2540lid).
    for (let i = 0; i < 2; i += 1) {
      try {
        const decoded = decodeURIComponent(normalized);
        if (decoded === normalized) {
          break;
        }
        normalized = decoded;
      } catch {
        break;
      }
    }

    return normalized;
  }

  async blockContact(sessionId: string, contactId: string) {
    const client = await this.ensureSession(sessionId);
    const normalizedContactId = this.normalizeContactId(contactId);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const targetClient = client as any;
    if (typeof targetClient.getContactById === "function") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contact = await targetClient.getContactById(normalizedContactId) as any;
      if (typeof contact?.block === "function") {
        return contact.block();
      }
    }

    if (typeof targetClient.blockContact === "function") {
      return targetClient.blockContact(normalizedContactId);
    }

    throw new Error("Block contact is not supported by this client version");
  }

  async unblockContact(sessionId: string, contactId: string) {
    const client = await this.ensureSession(sessionId);
    const normalizedContactId = this.normalizeContactId(contactId);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const targetClient = client as any;
    if (typeof targetClient.getContactById === "function") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contact = await targetClient.getContactById(normalizedContactId) as any;
      if (typeof contact?.unblock === "function") {
        return contact.unblock();
      }
    }

    if (typeof targetClient.unblockContact === "function") {
      return targetClient.unblockContact(normalizedContactId);
    }

    throw new Error("Unblock contact is not supported by this client version");
  }

  async getChatMessages(sessionId: string, chatId: string, limit = 50) {
    const client = await this.ensureSession(sessionId);
    const normalizedChatId = this.normalizeChatId(chatId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const targetClient = client as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let chat: any = null;

    // Resolve @lid → @c.us via the in-page Store when possible.
    // `@lid` chats frequently throw inside WhatsApp Web's own bundle when
    // accessed through fetchMessages, but resolving their phone-number WID
    // first makes them behave like a normal @c.us chat.
    let resolvedChatId = normalizedChatId;
    if (normalizedChatId.endsWith("@lid")) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pupPage = targetClient.pupPage as any;
        if (pupPage && typeof pupPage.evaluate === "function") {
          const mapped: string | null = await pupPage.evaluate(
            (lid: string) => {
              try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const store = (window as any).Store;
                if (!store) return null;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const wid = store.WidFactory?.createWid?.(lid);
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const pn = store.LidUtils?.getPhoneNumber?.(wid)
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  ?? store.LidUtils?.getCurrentLidPn?.(wid);
                if (pn?._serialized) return pn._serialized;
                return null;
              } catch {
                return null;
              }
            },
            normalizedChatId,
          );
          if (mapped && typeof mapped === "string") {
            resolvedChatId = mapped;
          }
        }
      } catch (error) {
        console.warn(
          `[whatsapp/manager] LID→PN resolution failed for ${normalizedChatId}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }

    // Resolve from the cached chat list first. This is the same surface that
    // powers the admin chat list and avoids getChatById(), which can leak WA
    // bundle exceptions to the server console for some chats.
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chats = (await targetClient.getChats()) as any[];
      const [requestedUser, requestedServer = ""] = String(resolvedChatId).split("@");
      chat = chats.find((candidate) => {
        const candidateId = candidate?.id?._serialized ?? String(candidate?.id ?? "");
        const normalizedCandidateId = this.normalizeChatId(candidateId);

        if (
          candidateId === chatId
          || candidateId === normalizedChatId
          || candidateId === resolvedChatId
          || normalizedCandidateId === resolvedChatId
          || normalizedCandidateId === normalizedChatId
        ) {
          return true;
        }

        const [candidateUser, candidateServer = ""] = normalizedCandidateId.split("@");
        if (!candidateUser || candidateUser !== requestedUser) {
          return false;
        }

        const equivalentServers = new Set([requestedServer, "lid", "c.us", "g.us"]);
        return equivalentServers.has(candidateServer);
      });
    } catch (error) {
      console.warn(
        `[whatsapp/manager] getChats lookup failed for ${normalizedChatId}:`,
        error instanceof Error ? error.message : error,
      );
    }

    if (!chat) {
      // No chat found — return empty list rather than throwing.
      // The UI will show "no messages yet" instead of an error toast.
      console.warn(
        `[whatsapp/manager] Chat not found, returning empty messages for ${normalizedChatId}`,
      );
      return [];
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const targetChat = chat as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let messages: any[] = [];

    // Primary path: in-page evaluation that mirrors whatsapp-web.js's
    // Chat.fetchMessages but wraps loadEarlierMsgs in try/catch so transient
    // bundle errors (common for @lid and some @g.us chats) don't fail the
    // whole request. Returns whatever is already cached on failure.
    const pupPage = targetClient.pupPage;
    const chatIdSerialized: string =
      targetChat?.id?._serialized ?? resolvedChatId ?? normalizedChatId;

    const runPageFetch = async () => {
      if (!pupPage || typeof pupPage.evaluate !== "function") {
        return null;
      }
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (await pupPage.evaluate(
          async (chatIdParam: string, max: number) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const WWebJS = (window as any).WWebJS;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const Store = (window as any).Store;
            if (!Store) return [];

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const msgFilter = (m: any) => {
              if (!m) return false;
              if (m.isNotification) return false;
              return true;
            };

            // Resolve the chat model without going through findOrCreateLatestChat
            // (that path can throw for @lid / @g.us chats in the WA Web bundle).
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let chat: any = null;
            try {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const wid = Store.WidFactory?.createWid?.(chatIdParam);
              if (wid && Store.Chat?.get) {
                chat = Store.Chat.get(wid) || Store.Chat.get(chatIdParam) || null;
              }
            } catch {
              chat = null;
            }

            if (!chat) {
              try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const models: any[] = Store.Chat?.getModelsArray?.() ?? [];
                chat = models.find((c) => c?.id?._serialized === chatIdParam) ?? null;
              } catch {
                chat = null;
              }
            }

            if (!chat && WWebJS?.getChat) {
              try {
                chat = await WWebJS.getChat(chatIdParam, { getAsModel: false });
              } catch {
                chat = null;
              }
            }

            if (chat && Store.Cmd?.openChatBottom) {
              try {
                await Store.Cmd.openChatBottom({ chat });
                await new Promise((resolve) => setTimeout(resolve, 80));
              } catch {
                // ignore chat-open failures and continue with whatever is cached
              }
            }

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let msgs: any[] = [];
            try {
              msgs = chat?.msgs?.getModelsArray?.().filter(msgFilter) ?? [];
            } catch {
              msgs = [];
            }

            const mergeUnique = (items: any[]) => {
              const seen = new Set();
              return items.filter((item: any) => {
                const key = item?.id?._serialized ?? String(item?.id ?? "");
                if (!key || seen.has(key)) {
                  return false;
                }
                seen.add(key);
                return true;
              });
            };

            if (chat && max > 0 && Store.ConversationMsgs?.loadEarlierMsgs) {
              let guard = 0;
              while (msgs.length < max && guard < 24) {
                guard += 1;
                let loaded = null;
                try {
                  loaded = await Store.ConversationMsgs.loadEarlierMsgs(chat, chat.msgs);
                } catch {
                  try {
                    loaded = await Store.ConversationMsgs.loadEarlierMsgs(chat);
                  } catch {
                    break;
                  }
                }

                const loadedFiltered = Array.isArray(loaded) ? loaded.filter(msgFilter) : [];
                if (!loadedFiltered.length) {
                  break;
                }

                const current = chat?.msgs?.getModelsArray?.().filter(msgFilter) ?? msgs;
                msgs = mergeUnique([...loadedFiltered, ...current, ...msgs]);
              }
            }

            if ((!msgs || msgs.length === 0) && chat?.lastMessage) {
              msgs = [chat.lastMessage].filter(msgFilter);
            }

            if (msgs.length > max) {
              msgs.sort((a, b) => (a.t > b.t ? 1 : -1));
              msgs = msgs.slice(msgs.length - max);
            } else {
              msgs.sort((a, b) => (a.t > b.t ? 1 : -1));
            }

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return msgs
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              .map((m: any) => {
                try {
                  if (WWebJS.getMessageModel) {
                    return WWebJS.getMessageModel(m);
                  }
                } catch {
                  // fallthrough to manual serialization
                }
                try {
                  return {
                    id: {
                      _serialized: m.id?._serialized ?? String(m.id),
                      fromMe: !!m.id?.fromMe,
                    },
                    from: m.from?._serialized ?? m.from,
                    to: m.to?._serialized ?? m.to,
                    fromMe: !!m.id?.fromMe,
                    body: m.body ?? "",
                    type: m.type ?? "chat",
                    timestamp: m.t ?? 0,
                    hasMedia: !!m.mediaKey || !!m.deprecatedMms3Url,
                    ack: m.ack ?? 0,
                    author: m.author?._serialized ?? m.author,
                  };
                } catch {
                  return null;
                }
              })
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              .filter((m: any) => m !== null);
          },
          chatIdSerialized,
          limit,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        )) as any[];
      } catch (error) {
        console.warn(
          `[whatsapp/manager] in-page fetch failed for ${chatIdSerialized}:`,
          error instanceof Error ? error.message : error,
        );
        return null;
      }
    };

    const pageResult = await runPageFetch();
    if (Array.isArray(pageResult)) {
      messages = pageResult;
    } else {
      messages = [];
    }

    // Also cross-reference Store.Msg cache so we include any messages that
    // exist in-memory but weren't surfaced by the primary path.
    try {
      if (pupPage && typeof pupPage.evaluate === "function") {
        const cacheIds = Array.from(
          new Set(
            [chatIdSerialized, resolvedChatId, normalizedChatId, chatId].filter(
              (value): value is string => typeof value === "string" && value.length > 0,
            ),
          ),
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cached = (await pupPage.evaluate(
          (ids: string[], max: number) => {
            try {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const Store = (window as any).Store;
              if (!Store?.Msg?.getModelsArray) return [];
              const idSet = new Set(ids);
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const all: any[] = Store.Msg.getModelsArray();
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const picked: any[] = [];
              for (const m of all) {
                try {
                  const remote =
                    m?.id?.remote?._serialized
                    ?? (typeof m?.from === "object"
                      ? m.from._serialized
                      : m?.from);
                  if (remote && idSet.has(remote)) {
                    picked.push({
                      id: {
                        _serialized: m.id?._serialized ?? String(m.id),
                        fromMe: !!m.id?.fromMe,
                      },
                      from: m.from?._serialized ?? m.from,
                      to: m.to?._serialized ?? m.to,
                      fromMe: !!m.id?.fromMe,
                      body: m.body ?? "",
                      type: m.type ?? "chat",
                      timestamp: m.t ?? 0,
                      hasMedia: !!m.mediaKey || !!m.deprecatedMms3Url,
                      ack: m.ack ?? 0,
                      author: m.author?._serialized ?? m.author,
                    });
                  }
                } catch {
                  // skip
                }
              }
              picked.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
              return picked.slice(-max);
            } catch {
              return [];
            }
          },
          cacheIds,
          limit,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        )) as any[];

        if (Array.isArray(cached) && cached.length > 0) {
          const seenIds = new Set(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            messages.map((m: any) => m?.id?._serialized).filter(Boolean),
          );
          for (const m of cached) {
            const key = m?.id?._serialized;
            if (key && !seenIds.has(key)) {
              messages.push(m);
              seenIds.add(key);
            }
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          messages.sort((a: any, b: any) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
          if (messages.length > limit) {
            messages = messages.slice(messages.length - limit);
          }
        }
      }
    } catch (error) {
      console.warn(
        `[whatsapp/manager] Store.Msg cross-reference failed for ${chatIdSerialized}:`,
        error instanceof Error ? error.message : error,
      );
    }

    if (messages.length === 0 && targetChat?.lastMessage) {
      messages = [targetChat.lastMessage];
    }

    if (!Array.isArray(messages)) {
      return [];
    }

    // Build reactions from _data (synchronous, reliable for fetched messages)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const extractReactions = (msg: any) => {
      try {
        // _data.reactions is an array of reaction aggregation objects
        const rawReactions = msg._data?.reactions;
        if (!rawReactions || !Array.isArray(rawReactions)) return [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return rawReactions.flatMap((group: any) => {
          // Each group: { aggregateEmoji, senders: [{id, reaction, timestamp, ...}] }
          if (group.senders && Array.isArray(group.senders)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return group.senders.map((s: any) => ({
              emoji: s.reaction || group.aggregateEmoji,
              senderId: s.id || s.senderId || "",
              timestamp: s.timestamp,
            }));
          }
          // Sometimes reactions is a flat array of {id, msgId, reaction, senderTimestampMs, senderId, ...}
          if (group.reaction && group.senderId) {
            return [{ emoji: group.reaction, senderId: group.senderId, timestamp: group.senderTimestampMs }];
          }
          return [];
        });
      } catch {
        return [];
      }
    };

    // Also try getReactions() for messages that explicitly have hasReaction flag
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const asyncReactionsMap = new Map<string, any[]>();
    await Promise.all(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages.map(async (msg: any) => {
        if (msg.hasReaction) {
          try {
            const reactionLists = await msg.getReactions();
            const msgId = msg.id?._serialized ?? String(msg.id);
            const flat = reactionLists.flatMap(
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (rl: any) =>
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (rl.senders || []).map((s: any) => ({
                  emoji: s.reaction,
                  senderId: s.senderId,
                  timestamp: s.timestamp,
                }))
            );
            if (flat.length > 0) asyncReactionsMap.set(msgId, flat);
          } catch {
            /* ignore */
          }
        }
      })
    );

    const normalizeTimestamp = (value: unknown) => {
      if (typeof value !== "number" || Number.isNaN(value) || value <= 0) {
        return Date.now();
      }

      return value > 1_000_000_000_000 ? value : value * 1000;
    };

    const serializeWidLike = (value: unknown) => {
      if (!value) {
        return undefined;
      }

      if (typeof value === "string") {
        return value;
      }

      if (typeof value === "object") {
        const wid = value as { _serialized?: string; user?: string; server?: string };
        if (typeof wid._serialized === "string") {
          return wid._serialized;
        }
        if (typeof wid.user === "string" && typeof wid.server === "string") {
          return `${wid.user}@${wid.server}`;
        }
      }

      return String(value);
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const normalizeMessage = (msg: any) => {
      const timestamp = normalizeTimestamp(msg?.timestamp ?? msg?.t);
      const msgId = msg?.id?._serialized
        ?? (typeof msg?.id === "string" ? msg.id : undefined)
        ?? `${chatIdSerialized}:${timestamp}:${msg?.fromMe ? "me" : "them"}`;

      // Prefer async reactions (getReactions) over _data.reactions, merge both
      const fromData = extractReactions(msg);
      const fromAsync = asyncReactionsMap.get(msgId) || [];
      const seen = new Set<string>();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const allReactions: any[] = [];
      for (const r of [...fromAsync, ...fromData]) {
        const key = `${r.senderId}:${r.emoji}`;
        if (!seen.has(key)) {
          seen.add(key);
          allReactions.push(r);
        }
      }

      return {
        id: msgId,
        sessionId,
        from: serializeWidLike(msg?.from) ?? (msg?.fromMe ? undefined : chatIdSerialized),
        to: serializeWidLike(msg?.to) ?? (msg?.fromMe ? chatIdSerialized : undefined),
        fromMe: !!msg?.fromMe,
        body: msg?.body ?? msg?.caption ?? "",
        type: msg?.type ?? "chat",
        timestamp,
        hasMedia: !!msg?.hasMedia,
        mimetype: msg?._data?.mimetype,
        filename: msg?._data?.filename,
        isForwarded: !!msg?.isForwarded,
        isStarred: !!msg?.isStarred,
        isStatus: !!msg?.isStatus,
        ack: msg?.ack ?? 0,
        author: serializeWidLike(msg?.author),
        mentionedIds: msg?.mentionedIds ?? [],
        hasQuotedMsg: !!msg?.hasQuotedMsg,
        quotedMsgId: msg?.hasQuotedMsg ? msg?._data?.quotedStanzaID : undefined,
        reactions: allReactions,
        location: msg?.location
          ? {
              latitude: msg.location.latitude,
              longitude: msg.location.longitude,
              description: msg.location.description,
            }
          : undefined,
        vCards: msg?.vCards ?? [],
      };
    };

    return messages
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((msg: any) => {
        try {
          return normalizeMessage(msg);
        } catch {
          return null;
        }
      })
      .filter((msg): msg is NonNullable<typeof msg> => msg !== null)
      .sort((left, right) => left.timestamp - right.timestamp)
      .filter((msg, index, items) => index === items.findIndex((candidate) => candidate.id === msg.id));
  }

  async sendSeen(sessionId: string, chatId: string) {
    const client = await this.ensureSession(sessionId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (typeof (client as any).sendSeen === "function") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (client as any).sendSeen(chatId);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chat = await (client as any).getChatById(chatId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (chat as any).sendSeen();
  }

  async archiveChat(sessionId: string, chatId: string) {
    const client = await this.ensureSession(sessionId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chat = await (client as any).getChatById(chatId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (chat as any).archive();
  }

  async unarchiveChat(sessionId: string, chatId: string) {
    const client = await this.ensureSession(sessionId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chat = await (client as any).getChatById(chatId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (chat as any).unarchive();
  }

  async muteChat(sessionId: string, chatId: string, unmuteDate?: Date) {
    const client = await this.ensureSession(sessionId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chat = await (client as any).getChatById(chatId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (chat as any).mute(unmuteDate);
  }

  async unmuteChat(sessionId: string, chatId: string) {
    const client = await this.ensureSession(sessionId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chat = await (client as any).getChatById(chatId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (chat as any).unmute();
  }

  async pinChat(sessionId: string, chatId: string) {
    const client = await this.ensureSession(sessionId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chat = await (client as any).getChatById(chatId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (chat as any).pin();
  }

  async unpinChat(sessionId: string, chatId: string) {
    const client = await this.ensureSession(sessionId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chat = await (client as any).getChatById(chatId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (chat as any).unpin();
  }

  async deleteChat(sessionId: string, chatId: string) {
    const client = await this.ensureSession(sessionId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (typeof (client as any).deleteChat === "function") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (client as any).deleteChat(chatId);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chat = await (client as any).getChatById(chatId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (chat as any).delete?.();
  }

  async clearChatMessages(sessionId: string, chatId: string) {
    const client = await this.ensureSession(sessionId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chat = await (client as any).getChatById(chatId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (chat as any).clearMessages();
  }

  async sendTyping(sessionId: string, chatId: string) {
    const client = await this.ensureSession(sessionId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chat = await (client as any).getChatById(chatId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (chat as any).sendStateTyping();
  }

  async sendRecording(sessionId: string, chatId: string) {
    const client = await this.ensureSession(sessionId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chat = await (client as any).getChatById(chatId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (chat as any).sendStateRecording();
  }

  async clearChatState(sessionId: string, chatId: string) {
    const client = await this.ensureSession(sessionId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chat = await (client as any).getChatById(chatId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (chat as any).clearState();
  }

  async addGroupParticipants(sessionId: string, chatId: string, participants: string[]) {
    const client = await this.ensureSession(sessionId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chat = await (client as any).getChatById(chatId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (chat as any).addParticipants(participants.map((p) => toWhatsAppChatId(p)));
  }

  async removeGroupParticipants(sessionId: string, chatId: string, participants: string[]) {
    const client = await this.ensureSession(sessionId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chat = await (client as any).getChatById(chatId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (chat as any).removeParticipants(participants.map((p) => toWhatsAppChatId(p)));
  }

  async promoteGroupParticipants(sessionId: string, chatId: string, participants: string[]) {
    const client = await this.ensureSession(sessionId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chat = await (client as any).getChatById(chatId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (chat as any).promoteParticipants(participants.map((p) => toWhatsAppChatId(p)));
  }

  async demoteGroupParticipants(sessionId: string, chatId: string, participants: string[]) {
    const client = await this.ensureSession(sessionId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chat = await (client as any).getChatById(chatId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (chat as any).demoteParticipants(participants.map((p) => toWhatsAppChatId(p)));
  }

  async setGroupSubject(sessionId: string, chatId: string, subject: string) {
    const client = await this.ensureSession(sessionId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chat = await (client as any).getChatById(chatId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (chat as any).setSubject(subject);
  }

  async setGroupDescription(sessionId: string, chatId: string, description: string) {
    const client = await this.ensureSession(sessionId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chat = await (client as any).getChatById(chatId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (chat as any).setDescription(description);
  }

  async getGroupInviteCode(sessionId: string, chatId: string) {
    const client = await this.ensureSession(sessionId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chat = await (client as any).getChatById(chatId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (chat as any).getInviteCode();
  }

  async revokeGroupInvite(sessionId: string, chatId: string) {
    const client = await this.ensureSession(sessionId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chat = await (client as any).getChatById(chatId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (chat as any).revokeInvite();
  }

  async leaveGroup(sessionId: string, chatId: string) {
    const client = await this.ensureSession(sessionId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chat = await (client as any).getChatById(chatId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (chat as any).leave();
  }

  async replyToMessage(sessionId: string, messageId: string, content: string) {
    const client = await this.ensureSession(sessionId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const msg = await (client as any).getMessageById(messageId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (msg as any).reply(content);
  }

  async forwardMessage(sessionId: string, messageId: string, chatId: string) {
    const client = await this.ensureSession(sessionId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const msg = await (client as any).getMessageById(messageId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (msg as any).forward(chatId);
  }

  async deleteMessage(sessionId: string, messageId: string, everyone = false) {
    const client = await this.ensureSession(sessionId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const msg = await (client as any).getMessageById(messageId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (msg as any).delete(everyone);
  }

  async starMessage(sessionId: string, messageId: string) {
    const client = await this.ensureSession(sessionId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const msg = await (client as any).getMessageById(messageId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (msg as any).star();
  }

  async unstarMessage(sessionId: string, messageId: string) {
    const client = await this.ensureSession(sessionId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const msg = await (client as any).getMessageById(messageId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (msg as any).unstar();
  }

  async reactToMessage(sessionId: string, messageId: string, reaction: string) {
    const client = await this.ensureSession(sessionId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const msg = await (client as any).getMessageById(messageId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (msg as any).react(reaction);
  }

  async editMessage(sessionId: string, messageId: string, content: string) {
    const client = await this.ensureSession(sessionId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const msg = await (client as any).getMessageById(messageId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (typeof (msg as any).edit === "function") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (msg as any).edit(content);
    }
    throw new Error("Edit is not supported for this message/client version");
  }

  async pinMessage(sessionId: string, messageId: string, duration = 604800) {
    const client = await this.ensureSession(sessionId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const msg = await (client as any).getMessageById(messageId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (typeof (msg as any).pin === "function") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (msg as any).pin(duration);
    }
    return null;
  }

  async unpinMessage(sessionId: string, messageId: string) {
    const client = await this.ensureSession(sessionId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const msg = await (client as any).getMessageById(messageId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (typeof (msg as any).unpin === "function") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (msg as any).unpin();
    }
    return null;
  }

  async downloadMedia(sessionId: string, messageId: string) {
    const client = await this.ensureSession(sessionId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const msg = await (client as any).getMessageById(messageId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const media = await (msg as any).downloadMedia();

    if (!media?.data || !media?.mimetype) {
      throw new Error("Media not available");
    }

    return {
      mimetype: media.mimetype,
      filename: media.filename,
      dataUrl: `data:${media.mimetype};base64,${media.data}`,
    };
  }

  async captureSessionScreenshot(sessionId: string) {
    const client = await this.ensureSession(sessionId);
    const page = (client as unknown as {
      pupPage?: {
        waitForSelector: (selector: string, options?: { timeout?: number }) => Promise<unknown>;
        setViewport: (viewport: { width: number; height: number; deviceScaleFactor?: number }) => Promise<void>;
        evaluate: <T>(fn: () => T | Promise<T>) => Promise<T>;
        screenshot: (opts: {
          type: "png";
          encoding: "base64";
          fullPage?: boolean;
          captureBeyondViewport?: boolean;
          clip?: { x: number; y: number; width: number; height: number };
        }) => Promise<string>;
      };
    }).pupPage;

    if (!page) {
      throw new Error("WhatsApp page is not ready for screenshot");
    }

    await page.setViewport({
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
    });

    await page.waitForSelector("#app", { timeout: 10000 });

    await page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
    });

    const appRect = await page.evaluate(() => {
      const app = document.querySelector("#app") as HTMLElement | null;
      if (!app) {
        return null;
      }

      const rect = app.getBoundingClientRect();
      return {
        x: Math.max(0, rect.left + window.scrollX),
        y: Math.max(0, rect.top + window.scrollY),
        width: Math.max(1, Math.ceil(rect.width)),
        height: Math.max(1, Math.ceil(rect.height)),
      };
    });

    const base64Png = appRect
      ? await page.screenshot({
          type: "png",
          encoding: "base64",
          clip: appRect,
          captureBeyondViewport: true,
        })
      : await page.screenshot({
          type: "png",
          encoding: "base64",
          fullPage: true,
        });

    return `data:image/png;base64,${base64Png}`;
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __sessionManager__: SessionManager | undefined;
}

export const sessionManager = globalThis.__sessionManager__ ?? new SessionManager();

if (!globalThis.__sessionManager__) {
  globalThis.__sessionManager__ = sessionManager;
}
