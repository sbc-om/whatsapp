import { NextRequest } from "next/server";

import { fail, ok } from "@/server/http/api";
import { sessionManager } from "@/server/whatsapp/manager";

export const runtime = "nodejs";

/**
 * GET /api/admin/chats/messages?sessionId=main&chatId=xxx&limit=50
 * Returns messages from a specific chat via the WhatsApp client.
 */
export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("sessionId") || "main";
  const rawChatId = request.nextUrl.searchParams.get("chatId");
  const limit = Math.min(parseInt(request.nextUrl.searchParams.get("limit") || "50", 10), 500);

  if (!rawChatId) {
    return fail("BAD_REQUEST", "chatId query param is required", 400);
  }

  let chatId = rawChatId.trim();
  for (let i = 0; i < 2; i += 1) {
    try {
      const decoded = decodeURIComponent(chatId);
      if (decoded === chatId) {
        break;
      }
      chatId = decoded;
    } catch {
      break;
    }
  }

  try {
    const messages = await sessionManager.getChatMessages(sessionId, chatId, limit);
    return ok({ messages });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to get messages";
    const stack = error instanceof Error ? error.stack : undefined;
    console.error(
      `[api/admin/chats/messages] sessionId=${sessionId} chatId=${chatId} error=${message}`,
      stack,
    );

    // Never block the UI — always return an empty list with a warning instead of 400.
    return ok({ messages: [], warning: message });
  }
}
