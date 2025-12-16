import type { WahaSendRequest } from "@/types/waha";

const WAHA_API_URL = process.env.WAHA_API_URL ?? "http://localhost:3000";
const WAHA_API_KEY = process.env.WAHA_API_KEY ?? "";

export function toChatId(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  if (trimmed.includes("@")) return trimmed;
  return `${trimmed}@c.us`;
}

function headers() {
  return {
    "content-type": "application/json",
    ...(WAHA_API_KEY ? { "X-Api-Key": WAHA_API_KEY } : {}),
  };
}

async function postJson(path: string, body: unknown) {
  const res = await fetch(`${WAHA_API_URL}${path}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
    // WAHA can be slow on media sends
    cache: "no-store",
  });

  const text = await res.text();
  let data: unknown = text;
  try {
    data = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    // keep raw
  }

  if (!res.ok) {
    const msg =
      typeof data === "object" && data && "message" in data
        ? String((data as { message?: unknown }).message ?? "WAHA error")
        : `WAHA error (${res.status})`;
    throw new Error(msg);
  }

  return data;
}

export async function sendViaWaha(req: WahaSendRequest) {
  const chatId = toChatId(req.chatId);

  switch (req.type) {
    case "text":
      return postJson("/api/sendText", {
        chatId,
        text: req.text,
        session: req.session,
      });

    case "image":
      return postJson("/api/sendImage", {
        chatId,
        file: {
          url: req.fileUrl,
          mimetype: req.mimetype ?? "image/jpeg",
          filename: req.filename ?? "image.jpg",
        },
        caption: req.caption ?? null,
        session: req.session,
      });

    case "file":
      return postJson("/api/sendFile", {
        chatId,
        file: {
          url: req.fileUrl,
          mimetype: req.mimetype ?? "application/octet-stream",
          filename: req.filename ?? "file",
        },
        caption: req.caption ?? null,
        session: req.session,
      });

    case "voice":
      return postJson("/api/sendVoice", {
        chatId,
        file: {
          url: req.fileUrl,
          mimetype: req.mimetype ?? "audio/ogg; codecs=opus",
        },
        convert: req.convert ?? true,
        session: req.session,
      });

    case "video":
      return postJson("/api/sendVideo", {
        chatId,
        file: {
          url: req.fileUrl,
          mimetype: req.mimetype ?? "video/mp4",
          filename: req.filename ?? "video.mp4",
        },
        caption: req.caption ?? null,
        convert: req.convert ?? true,
        asNote: req.asNote ?? false,
        session: req.session,
      });

    case "link-custom-preview":
      return postJson("/api/send/link-custom-preview", {
        chatId,
        text: req.text,
        linkPreviewHighQuality: req.linkPreviewHighQuality ?? true,
        preview: {
          url: req.preview.url,
          title: req.preview.title ?? "Preview",
          description: req.preview.description ?? "",
          ...(req.preview.imageUrl ? { image: { url: req.preview.imageUrl } } : {}),
        },
        session: req.session,
      });
  }
}
