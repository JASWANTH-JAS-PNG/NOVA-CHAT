require("dotenv").config();
const express = require("express");
const cors = require("cors");

const app = express();
const PORT = 5000;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

// App-only token for catalog search (client credentials flow) — cached until near expiry.
let spotifyToken = { value: null, expiresAt: 0 };
async function getSpotifyToken() {
  if (spotifyToken.value && Date.now() < spotifyToken.expiresAt) {
    return spotifyToken.value;
  }
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString("base64")}`,
    },
    body: "grant_type=client_credentials",
  });
  if (!response.ok) throw new Error("Failed to get Spotify token");
  const data = await response.json();
  spotifyToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return spotifyToken.value;
}

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
      description: "Find a song or artist and immediately start playing it on Spotify on the user's phone.",
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
      name: "control_playback",
      description: "Pause, resume, or skip the currently playing Spotify track on the user's phone.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["pause", "resume", "next", "previous"] },
        },
        required: ["action"],
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
      ? " You are running inside the user's phone app and can open installed apps, play a song directly on Spotify, pause/resume/skip playback, open the Add Contact screen, or send a WhatsApp message directly, using the tools provided. Use a tool whenever the user's request calls for one of these actions, then reply naturally about what you did."
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

app.get("/api/spotify-search", async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: "q query param is required" });
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
    return res.status(500).json({ error: "Spotify credentials are not configured on the server." });
  }

  try {
    const token = await getSpotifyToken();
    const searchResponse = await fetch(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=1`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!searchResponse.ok) throw new Error(`Spotify search returned ${searchResponse.status}`);

    const data = await searchResponse.json();
    const track = data.tracks?.items?.[0];
    if (!track) return res.status(404).json({ error: "No matching track found." });

    res.json({ uri: track.uri, name: track.name, artist: track.artists?.[0]?.name ?? "" });
  } catch (err) {
    console.error("Spotify search error:", err.message);
    res.status(500).json({ error: "Spotify search failed." });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Using OpenRouter model: ${OPENROUTER_MODEL}`);
});
