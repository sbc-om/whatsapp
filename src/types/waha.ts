export type WahaSendType =
  | "text"
  | "image"
  | "file"
  | "voice"
  | "video"
  | "link-custom-preview";

export type WahaSendRequest =
  | {
      type: "text";
      chatId: string;
      text: string;
      session: string;
    }
  | {
      type: "image" | "file" | "video";
      chatId: string;
      session: string;
      fileUrl: string;
      mimetype?: string;
      filename?: string;
      caption?: string | null;
      convert?: boolean;
      asNote?: boolean;
    }
  | {
      type: "voice";
      chatId: string;
      session: string;
      fileUrl: string;
      mimetype?: string;
      convert?: boolean;
    }
  | {
      type: "link-custom-preview";
      chatId: string;
      session: string;
      text: string;
      preview: {
        url: string;
        title?: string;
        description?: string;
        imageUrl?: string;
      };
      linkPreviewHighQuality?: boolean;
    };

export interface WahaEventEnvelope {
  id: string;
  timestamp: number;
  event?: string;
  session?: string;
  payload: unknown;
  metadata?: Record<string, unknown>;
}

export interface ApiOk<T> {
  ok: true;
  data: T;
}

export interface ApiErr {
  ok: false;
  error: string;
}
