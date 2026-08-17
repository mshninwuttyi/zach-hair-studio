/**
 * Minimal Streamable-HTTP MCP client for the Zach Hair Studio API `/mcp`
 * surface. Read-only tools only — booking stays on the /book page.
 */

const API_BASE_URL = (
  process.env.MCP_SERVER_URL?.replace(/\/mcp\/?$/, "") ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:5236"
).replace(/\/$/, "");

const MCP_URL = `${API_BASE_URL}/mcp`;

type JsonRpcSuccess = {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

function parseSseOrJson(body: string): JsonRpcSuccess {
  const trimmed = body.trim();
  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed) as JsonRpcSuccess;
  }

  const dataLine = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("data:"));

  if (!dataLine) {
    throw new Error(`MCP response had no JSON payload: ${trimmed.slice(0, 200)}`);
  }

  return JSON.parse(dataLine.replace(/^data:\s*/, "")) as JsonRpcSuccess;
}

async function mcpRpc(
  method: string,
  params?: Record<string, unknown>,
  id = 1
): Promise<unknown> {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      ...(params !== undefined ? { params } : {}),
    }),
    cache: "no-store",
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`MCP HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  // notifications often return empty 202 bodies
  if (!text.trim()) {
    return null;
  }

  const payload = parseSseOrJson(text);
  if (payload.error) {
    throw new Error(`MCP error ${payload.error.code}: ${payload.error.message}`);
  }
  return payload.result;
}

/** Extract the text payload MCP tools return inside result.content[]. */
function toolTextResult(result: unknown): string {
  const content = (result as { content?: Array<{ type?: string; text?: string }> })
    ?.content;
  const text = content?.find((part) => part.type === "text" && part.text)?.text;
  if (typeof text === "string") return text;
  return JSON.stringify(result ?? {});
}

export const CHAT_MCP_TOOLS = [
  "get_services",
  "get_stylists",
  "get_available_slots",
] as const;

export type ChatMcpToolName = (typeof CHAT_MCP_TOOLS)[number];

/**
 * Calls one of the read-only salon MCP tools. `create_appointment` is
 * intentionally omitted — the Booking Assistant must only link to /book.
 */
export async function callMcpTool(
  name: ChatMcpToolName,
  args: Record<string, unknown> = {}
): Promise<string> {
  const result = await mcpRpc("tools/call", { name, arguments: args });
  return toolTextResult(result);
}
