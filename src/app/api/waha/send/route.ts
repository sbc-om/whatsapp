import { NextRequest, NextResponse } from "next/server";

import { sendViaWaha } from "@/lib/waha";
import type { ApiErr, ApiOk, WahaSendRequest } from "@/types/waha";

export const runtime = "nodejs";

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

function validateWahaSendRequest(x: unknown): WahaSendRequest {
  if (!isObject(x)) throw new Error("Invalid body");

  const type = x.type;
  const chatId = x.chatId;
  const session = x.session;

  if (type !== "text" && type !== "image" && type !== "file" && type !== "voice" && type !== "video" && type !== "link-custom-preview") {
    throw new Error("Invalid type");
  }
  if (typeof chatId !== "string" || !chatId.trim()) throw new Error("Invalid chatId");
  if (typeof session !== "string" || !session.trim()) throw new Error("Invalid session");

  if (type === "text") {
    if (typeof x.text !== "string" || !x.text.trim()) throw new Error("Invalid text");
    return { type, chatId, session, text: x.text };
  }

  if (type === "link-custom-preview") {
    if (typeof x.text !== "string" || !x.text.trim()) throw new Error("Invalid text");
    const preview = x.preview;
    if (!isObject(preview) || typeof preview.url !== "string" || !preview.url.trim()) {
      throw new Error("Invalid preview");
    }
    return {
      type,
      chatId,
      session,
      text: x.text,
      preview: {
        url: preview.url,
        title: typeof preview.title === "string" ? preview.title : undefined,
        description: typeof preview.description === "string" ? preview.description : undefined,
        imageUrl: typeof preview.imageUrl === "string" ? preview.imageUrl : undefined,
      },
      linkPreviewHighQuality: typeof x.linkPreviewHighQuality === "boolean" ? x.linkPreviewHighQuality : undefined,
    };
  }

  // Media
  if (typeof x.fileUrl !== "string" || !x.fileUrl.trim()) throw new Error("Invalid fileUrl");

  if (type === "voice") {
    return {
      type,
      chatId,
      session,
      fileUrl: x.fileUrl,
      mimetype: typeof x.mimetype === "string" ? x.mimetype : undefined,
      convert: typeof x.convert === "boolean" ? x.convert : undefined,
    };
  }

  return {
    type,
    chatId,
    session,
    fileUrl: x.fileUrl,
    mimetype: typeof x.mimetype === "string" ? x.mimetype : undefined,
    filename: typeof x.filename === "string" ? x.filename : undefined,
    caption: typeof x.caption === "string" ? x.caption : null,
    convert: typeof x.convert === "boolean" ? x.convert : undefined,
    asNote: typeof x.asNote === "boolean" ? x.asNote : undefined,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as unknown;
    const payload = validateWahaSendRequest(body);
    const data = await sendViaWaha(payload);
    const out: ApiOk<unknown> = { ok: true, data };
    return NextResponse.json(out, { status: 200 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Send failed";
    const out: ApiErr = { ok: false, error: msg };
    return NextResponse.json(out, { status: 500 });
  }
}
