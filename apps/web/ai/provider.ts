async function sendRequest(url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (String(url) !== "https://api.openai.com/v1/responses" || init?.method !== "POST" || typeof init.body !== "string")
    throw new Error("Unsupported Ask request.");

  const bytes = Buffer.byteLength(init.body);
  const body = JSON.parse(init.body);
  if (bytes > 24_576 || body.model !== "gpt-6.2-sol" || body.service_tier !== "default" ||
      body.store !== false || body.previous_response_id || body.conversation ||
      !Array.isArray(body.input) || body.input.some((item: { type?: string }) => item.type === "item_reference") ||
      body.tools?.some((tool: { type: string }) => tool.type !== "function") ||
      !Number.isInteger(body.max_output_tokens) || body.max_output_tokens < 1 || body.max_output_tokens > 600)
    throw new Error("Ask request exceeded its model bounds.");

  return fetch(url, { ...init, redirect: "error" });
}

export const boundedFetch = Object.assign(sendRequest, { preconnect: fetch.preconnect });
