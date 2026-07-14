require("dotenv").config();
const express = require("express");
const cors = require("cors");

const app = express();
const PORT = 5000;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

app.use(cors({ origin: ["http://localhost:3000", "http://localhost:3001", "http://localhost:5173", "http://localhost:5174", "https://ai-chatbot-web.onrender.com"] }));
app.use(express.json());

// Only offered to clients that opt in (the Android app) — the web chat has no phone to act on.
const PHONE_TOOLS = [
  {
    type: "function",
    function: {
      name: "open_app",
      description: "Open/launch an app already installed on the user's phone.",
      parameters: {
        type: "object",
        properties: {
          app_name: { type: "string", description: "Name of the app to open, e.g. Spotify, WhatsApp, Camera" },
        },
        required: ["app_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "play_music",
      description: "Search for a song or artist in Spotify on the user's phone so they can play it.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Song name and/or artist to search for" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_contact",
      description: "Open the phone's native Add Contact screen pre-filled with a name and optional phone number. The user still has to tap Save themselves.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Contact's name" },
          phone: { type: "string", description: "Contact's phone number, if given" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_whatsapp_message",
      description: "Send a WhatsApp message directly to a phone number or a saved contact's name, with no manual confirmation from the user.",
      parameters: {
        type: "object",
        properties: {
          recipient: { type: "string", description: "Phone number (with country code) or a contact's name" },
          message: { type: "string", description: "The message text to send" },
        },
        required: ["recipient", "message"],
      },
    },
  },
];

function mapMessageForOpenRouter(m) {
  const msg = { role: m.role, content: m.content ?? "" };
  if (Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
    msg.tool_calls = m.tool_calls.map((tc) => ({
      id: tc.id,
      type: "function",
      function: { name: tc.name, arguments: tc.arguments },
    }));
  }
  if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
  if (m.name) msg.name = m.name;
  return msg;
}

app.post("/api/chat", async (req, res) => {
  const { messages, enablePhoneTools } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "messages array is required" });
  }

  if (!OPENROUTER_API_KEY) {
    return res.status(500).json({ error: "OPENROUTER_API_KEY is not configured on the server." });
  }

  const controller = new AbortController();
  res.on("close", () => controller.abort());

  const systemPrompt = "You are a helpful, friendly, and knowledgeable AI assistant. Provide clear, concise, and accurate responses."
    + (enablePhoneTools
      ? " You are running inside the user's phone app and can open installed apps, search Spotify for a song, open the Add Contact screen, or send a WhatsApp message directly, using the tools provided. Use a tool whenever the user's request calls for one of these actions, then reply naturally about what you did."
      : "");

  let openRouterResponse;
  try {
    openRouterResponse = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          ...messages.map(mapMessageForOpenRouter),
        ],
        ...(enablePhoneTools ? { tools: PHONE_TOOLS, tool_choice: "auto" } : {}),
        stream: true,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    console.error("Error calling OpenRouter:", err.message);
    return res.status(500).json({ error: "Cannot connect to OpenRouter." });
  }

  if (!openRouterResponse.ok) {
    const errText = await openRouterResponse.text().catch(() => "");
    console.error("OpenRouter error:", errText);
    return res.status(500).json({ error: "OpenRouter request failed. Check your API key and model." });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  let buffer = "";
  const decoder = new TextDecoder("utf-8");
  const toolCallsAcc = {};
  try {
    for await (const chunk of openRouterResponse.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let lineEnd;
      while ((lineEnd = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, lineEnd).trim();
        buffer = buffer.slice(lineEnd + 1);
        if (!line || line.startsWith(":") || !line.startsWith("data:")) continue;

        const data = line.replace(/^data:\s*/, "");
        if (data === "[DONE]") {
          res.write("data: [DONE]\n\n");
          continue;
        }

        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }

        const delta = parsed.choices?.[0]?.delta;

        const content = delta?.content;
        if (content) {
          res.write(`data: ${JSON.stringify({ content })}\n\n`);
        }

        const deltaToolCalls = delta?.tool_calls;
        if (deltaToolCalls) {
          for (const tc of deltaToolCalls) {
            const idx = tc.index ?? 0;
            if (!toolCallsAcc[idx]) toolCallsAcc[idx] = { id: "", name: "", arguments: "" };
            if (tc.id) toolCallsAcc[idx].id = tc.id;
            if (tc.function?.name) toolCallsAcc[idx].name += tc.function.name;
            if (tc.function?.arguments) toolCallsAcc[idx].arguments += tc.function.arguments;
          }
        }

        const finishReason = parsed.choices?.[0]?.finish_reason;
        if (finishReason === "tool_calls") {
          const calls = Object.values(toolCallsAcc);
          res.write(`data: ${JSON.stringify({ tool_calls: calls })}\n\n`);
        }
      }
    }
  } catch (err) {
    if (!controller.signal.aborted) {
      console.error("Stream error:", err.message);
      res.write(`data: ${JSON.stringify({ error: "The response stream was interrupted." })}\n\n`);
    }
  } finally {
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Using OpenRouter model: ${OPENROUTER_MODEL}`);
});
