import { NextResponse } from "next/server";
import {
  getHuggingFaceToken,
  runBookingAssistantAi,
  type ChatHistoryItem,
} from "@/lib/chat-ai";

export const runtime = "nodejs";

type ChatRequestBody = {
  message?: unknown;
  history?: unknown;
};

function parseHistory(raw: unknown): ChatHistoryItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (item): item is { role: string; text: string } =>
        !!item &&
        typeof item === "object" &&
        (item as { role?: unknown }).role !== undefined &&
        (item as { text?: unknown }).text !== undefined
    )
    .filter(
      (item) =>
        (item.role === "user" || item.role === "assistant") &&
        typeof item.text === "string"
    )
    .map((item) => ({
      role: item.role as "user" | "assistant",
      text: item.text.slice(0, 4000),
    }))
    .slice(-20);
}

export async function POST(request: Request) {
  if (!getHuggingFaceToken()) {
    return NextResponse.json(
      {
        error: "not_configured",
        message:
          "Set HF_TOKEN or HUGGINGFACE_API_KEY in landing-page/.env.local to enable AI chat.",
      },
      { status: 503 }
    );
  }

  let body: ChatRequestBody;
  try {
    body = (await request.json()) as ChatRequestBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const message =
    typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    return NextResponse.json({ error: "message_required" }, { status: 400 });
  }
  if (message.length > 2000) {
    return NextResponse.json({ error: "message_too_long" }, { status: 400 });
  }

  const history = parseHistory(body.history);

  try {
    const reply = await runBookingAssistantAi(message, history);
    return NextResponse.json({ reply, mode: "ai" });
  } catch (err) {
    console.error("[api/chat]", err);
    return NextResponse.json(
      {
        error: "ai_failed",
        message: err instanceof Error ? err.message : "AI request failed",
      },
      { status: 502 }
    );
  }
}
