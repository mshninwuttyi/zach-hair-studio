import {
  callMcpTool,
  type ChatMcpToolName,
  CHAT_MCP_TOOLS,
} from "@/lib/mcp-client";

export type ChatHistoryItem = {
  role: "user" | "assistant";
  text: string;
};

type OpenAiMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
};

type OpenAiToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type OpenAiToolDef = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

const HF_BASE_URL = (
  process.env.HUGGINGFACE_BASE_URL ?? "https://router.huggingface.co/v1"
).replace(/\/$/, "");

const HF_MODEL =
  process.env.HUGGINGFACE_CHAT_MODEL ?? "Qwen/Qwen2.5-7B-Instruct:fastest";

const MAX_TOOL_ROUNDS = 4;

// Mirrors the same-named const in lib/chat.ts (module-private there; chat.ts is the
// client-side fallback and pulls a large fetch surface, so it is not imported here).
const SALON_TIME_ZONE = "Asia/Yangon";

// "en-CA" is load-bearing: it yields "Weekday, yyyy-MM-dd", the format
// get_available_slots' date argument expects. Formatter is built once; only
// .format(now) is per-request.
const SALON_DATE_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: SALON_TIME_ZONE,
  weekday: "long",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function buildSystemPrompt(now: Date): string {
  return `You are the Zach Hair Studio booking assistant on the salon website.

Rules:
- Today is ${SALON_DATE_FORMAT.format(now)} in ${SALON_TIME_ZONE}. Resolve today, tomorrow, this weekend, next Friday and every other relative date from that date, and treat no other date as the current date.
  Compute the date argument for get_available_slots from it.
- Use tools for factual catalog and availability. Never invent services, prices, stylists, or open slots.
- You can answer about services, pricing, stylists, hours, and open appointment times.
- You MUST NOT book or collect booking contact details. When the visitor wants to book, tell them to use the booking page and include a markdown link like [Book an appointment](/book) or [Book Precision Cut](/book?service=precision-cut) using a real service slug from get_services.
- Salon hours: Open Daily: 9:00 AM – 7:30 PM (Asia/Yangon).
- Keep replies short and friendly. Prefer a few concrete times over dumping every slot.
- Dates for get_available_slots must be yyyy-MM-dd.`;
}

const TOOLS: OpenAiToolDef[] = [
  {
    type: "function",
    function: {
      name: "get_services",
      description:
        "Lists active salon services (id, name, slug, category, duration, price). Call before answering about the catalog or building book links.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "get_stylists",
      description: "Lists active stylists (id, name, slug).",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "get_available_slots",
      description:
        "Lists open appointment start times for a service on a date (yyyy-MM-dd). Service may be name, slug, or id.",
      parameters: {
        type: "object",
        properties: {
          service: {
            type: "string",
            description: "Service name, slug, or numeric id",
          },
          date: {
            type: "string",
            description: "Date as yyyy-MM-dd in salon local time",
          },
          stylistId: {
            type: ["integer", "null"],
            description: "Optional stylist id; omit for any stylist",
          },
        },
        required: ["service", "date"],
        additionalProperties: false,
      },
    },
  },
];

export function getHuggingFaceToken(): string | undefined {
  const token =
    process.env.HF_TOKEN?.trim() ||
    process.env.HUGGINGFACE_API_KEY?.trim() ||
    undefined;
  return token || undefined;
}

function isAllowedTool(name: string): name is ChatMcpToolName {
  return (CHAT_MCP_TOOLS as readonly string[]).includes(name);
}

async function chatCompletion(
  token: string,
  messages: OpenAiMessage[]
): Promise<OpenAiMessage> {
  const res = await fetch(`${HF_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: HF_MODEL,
      messages,
      tools: TOOLS,
      tool_choice: "auto",
      temperature: 0.3,
    }),
    cache: "no-store",
  });

  const bodyText = await res.text();
  if (!res.ok) {
    throw new Error(`Hugging Face HTTP ${res.status}: ${bodyText.slice(0, 400)}`);
  }

  const data = JSON.parse(bodyText) as {
    choices?: Array<{ message?: OpenAiMessage }>;
  };
  const message = data.choices?.[0]?.message;
  if (!message) {
    throw new Error("Hugging Face response missing choices[0].message");
  }
  return message;
}

/**
 * Runs the HF chat + MCP tool loop. Caller must ensure a token is configured.
 */
export async function runBookingAssistantAi(
  userText: string,
  history: ChatHistoryItem[]
): Promise<string> {
  const token = getHuggingFaceToken();
  if (!token) {
    throw new Error("Hugging Face token not configured");
  }

  const messages: OpenAiMessage[] = [
    { role: "system", content: buildSystemPrompt(new Date()) },
    ...history.map((item) => ({
      role: item.role as "user" | "assistant",
      content: item.text,
    })),
    { role: "user", content: userText },
  ];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const assistant = await chatCompletion(token, messages);
    messages.push(assistant);

    const toolCalls = assistant.tool_calls ?? [];
    if (toolCalls.length === 0) {
      const text = assistant.content?.trim();
      if (text) return text;
      return (
        "I'm not sure how to help with that — try asking about services, " +
        "hours, or availability. [Book an appointment](/book)"
      );
    }

    for (const call of toolCalls) {
      const name = call.function.name;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}") as Record<
          string,
          unknown
        >;
      } catch {
        args = {};
      }

      let toolResult: string;
      if (!isAllowedTool(name)) {
        toolResult = JSON.stringify({
          error: `Tool '${name}' is not available. Booking is only via the /book page.`,
        });
      } else {
        try {
          toolResult = await callMcpTool(name, args);
        } catch (err) {
          toolResult = JSON.stringify({
            error: err instanceof Error ? err.message : "Tool call failed",
          });
        }
      }

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: toolResult,
      });
    }
  }

  return (
    "I checked a few things but ran out of steps — please try again, " +
    "or book directly: [Book an appointment](/book)"
  );
}
