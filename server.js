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
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

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
      name: "set_auto_reply_mode",
      description: "Turn always-on auto-reply on or off. When on, every new incoming message from any messaging app is answered automatically the instant it arrives, with no user action needed.",
      parameters: {
        type: "object",
        properties: {
          enabled: { type: "boolean" },
        },
        required: ["enabled"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_catch_up_digest",
      description: "Summarize all recently captured notifications (texts, emails, etc.) into one digest instead of reading each one.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_app_usage",
      description: "Get how much time the user has spent today on a specific app, or a top-apps breakdown if no app is named.",
      parameters: {
        type: "object",
        properties: {
          app_name: { type: "string", description: "App to check, e.g. Instagram. Omit for a top-apps summary." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reply_all_unread_whatsapp",
      description: "Draft and send an AI reply to every unread WhatsApp message currently captured on the phone, with no per-message confirmation.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_reminder",
      description: "Create a calendar reminder/event on the user's phone. The user still has to tap Save to confirm.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "What to be reminded about" },
          datetime: { type: "string", description: "ISO-8601 local datetime for the reminder, e.g. 2026-07-15T17:00:00" },
        },
        required: ["title", "datetime"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "schedule_daily_briefing",
      description: "Schedule (or cancel) a recurring daily briefing that proactively notifies the user each day with the weather and today's calendar, with no need to ask.",
      parameters: {
        type: "object",
        properties: {
          enabled: { type: "boolean" },
          time: { type: "string", description: "24h HH:mm, e.g. 08:00" },
          location: { type: "string", description: "City for the weather lookup" },
        },
        required: ["enabled"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_web",
      description: "Search the live web for current information (news, prices, scores, anything the model might not already know).",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reply_all_unread_emails",
      description: "Draft and send an AI reply to every unread Gmail message currently captured on the phone, with no per-message confirmation.",
      parameters: {
        type: "object",
        properties: {},
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
  {
    type: "function",
    function: {
      name: "send_email",
      description: "Send an email directly from the user's Gmail account, with no manual confirmation from the user.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient email address" },
          subject: { type: "string", description: "Email subject line" },
          body: { type: "string", description: "Email body text" },
        },
        required: ["to", "subject", "body"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_sms",
      description: "Send a native SMS/text message directly to a phone number or a saved contact's name, with no manual confirmation from the user.",
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
  {
    type: "function",
    function: {
      name: "find_nearby_places",
      description: "Find places near the user's current location using their phone's GPS, e.g. coffee shops, gas stations, pharmacies.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "What kind of place to look for, e.g. 'coffee shop', 'gas station'" },
          radius_km: { type: "number", description: "Search radius in kilometers. Omit for a sensible default." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "share_location",
      description: "Share the user's current live location with a contact via message.",
      parameters: {
        type: "object",
        properties: {
          recipient: { type: "string", description: "Phone number (with country code) or a contact's name" },
        },
        required: ["recipient"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "navigate_to",
      description: "Open turn-by-turn navigation to a destination in the phone's native Maps app.",
      parameters: {
        type: "object",
        properties: {
          destination: { type: "string", description: "Address, place name, or landmark to navigate to" },
          mode: { type: "string", enum: ["driving", "walking", "transit", "bicycling"], description: "Mode of transport. Omit for driving." },
        },
        required: ["destination"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "configure_proactive_nudges",
      description: "Turn Nova's autonomous proactive nudges on or off. When on, Nova may reach out on her own — unprompted — if she notices something in the user's app usage or notifications worth flagging.",
      parameters: {
        type: "object",
        properties: {
          enabled: { type: "boolean" },
        },
        required: ["enabled"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reply_all_unread_instagram",
      description: "Draft and send an AI reply to every unread Instagram DM currently captured on the phone, with no per-message confirmation.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_expense_summary",
      description: "Get how much the user spent (and received) on a given day, tracked automatically from bank/UPI SMS alerts.",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "'today', 'yesterday', or an ISO date like 2026-07-14. Omit for today." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_package_status",
      description: "Get the latest tracked status (shipped, out for delivery, delivered) of recent Amazon/Flipkart orders, parsed automatically from their notifications.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
];

// Forced tool_choice for /api/proactive-check — the model either calls this with a message, or doesn't call it at all.
const NUDGE_TOOL = {
  type: "function",
  function: {
    name: "send_nudge",
    description: "Proactively surface a message to the user right now, unprompted.",
    parameters: {
      type: "object",
      properties: {
        message: { type: "string", description: "The nudge message to show the user, in Nova's voice." },
      },
      required: ["message"],
    },
  },
};

// Forced tool_choice for /api/detect-meeting — the model either proposes a meeting, or doesn't call it at all.
const MEETING_TOOL = {
  type: "function",
  function: {
    name: "propose_meeting",
    description: "Propose adding a specific meeting/plan mentioned in the message to the user's calendar.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short calendar event title, e.g. 'Coffee with Priya'." },
        isoDateTime: { type: "string", description: "ISO-8601 local datetime, e.g. 2026-07-16T17:00:00. Resolve relative terms like 'tomorrow' using the current date given." },
      },
      required: ["title", "isoDateTime"],
    },
  },
};

// Always offered, regardless of client (web or phone) — lets Nova persist facts across conversations.
const MEMORY_TOOLS = [
  {
    type: "function",
    function: {
      name: "remember",
      description: "Save a durable fact or preference about the user so it's available in future conversations, not just this one. Use for things worth recalling later (stated preferences, ongoing projects, names, constraints) — not one-off conversational details or anything already in the remembered-facts list.",
      parameters: {
        type: "object",
        properties: {
          fact: { type: "string", description: "The fact to remember, as a short standalone statement, e.g. 'Prefers Python over JavaScript' or 'Has a dog named Max'." },
        },
        required: ["fact"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "forget",
      description: "Remove a previously remembered fact about the user, e.g. because it's outdated, wrong, or the user asked to forget it.",
      parameters: {
        type: "object",
        properties: {
          fact: { type: "string", description: "The remembered fact to remove — match it as closely as possible to how it's listed." },
        },
        required: ["fact"],
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
  const { messages, enablePhoneTools, memories } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "messages array is required" });
  }

  if (!OPENROUTER_API_KEY) {
    return res.status(500).json({ error: "OPENROUTER_API_KEY is not configured on the server." });
  }

  const controller = new AbortController();
  res.on("close", () => controller.abort());

  const memoryList = Array.isArray(memories) ? memories.filter((m) => typeof m === "string" && m.trim()) : [];
  const memoryBlock = memoryList.length
    ? `\n\nThings you remember about this user from past conversations:\n${memoryList.map((m) => `- ${m}`).join("\n")}\nWeave these in naturally when relevant — don't just recite the list.`
    : "";

  const systemPrompt = "You are a helpful, friendly, and knowledgeable AI assistant. Provide clear, concise, and accurate responses."
    + " Talk like a Gen Z close friend texting, not like an assistant. Lean into it: fr, ngl, bet, no cap, lowkey/highkey, deadass, ts (this), fym, ong, ate, bro/bruh, ✨💀🔥 emoji when it fits, lowercase energy, short punchy sentences over formal ones. Still be genuinely helpful and accurate — the vibe is casual, the substance isn't."
    + memoryBlock
    + " You have a remember tool and a forget tool for persisting facts about the user across conversations, not just this one. Call remember, before writing your reply, any time the user asks you to remember/note/save something, or shares a durable preference, fact, or detail about themselves worth recalling later (their name, likes/dislikes, ongoing projects, constraints) — this includes simple requests like 'remember that X.' Call forget the same way when a fact becomes outdated or the user asks you to forget it. These calls are low-ceremony — don't make a big deal about it in your reply, just confirm briefly and naturally."
    + (enablePhoneTools
      ? ` You are running inside the user's phone app. The current date and time is ${new Date().toString()}, use it to resolve relative times like "tomorrow" or "5pm" when creating reminders. `
        + "You can open installed apps, search Spotify for a song, pause/resume/skip playback, open the Add Contact screen, create a calendar reminder, search the live web, send a WhatsApp message directly, send an email or SMS directly, reply to all unread WhatsApp, Gmail, or Instagram messages at once, turn always-on auto-reply mode on/off, schedule or cancel a recurring daily briefing, summarize recent notifications into a catch-up digest, check app usage time, find nearby places, share your location, navigate to a destination, turn your own proactive nudges on/off, check today's (or a past day's) spending tracked from bank SMS, or check the delivery status of recent Amazon/Flipkart orders, using the tools provided. Use a tool whenever the user's request calls for one of these actions, then reply naturally about what you did."
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
        tools: [...MEMORY_TOOLS, ...(enablePhoneTools ? PHONE_TOOLS : [])],
        tool_choice: "auto",
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

// Called periodically by the phone client (its own cadence) so Nova can decide, on her own judgment,
// whether anything in recent telemetry is worth proactively surfacing — not a rule-based threshold.
app.post("/api/proactive-check", async (req, res) => {
  const { app_usage, recent_notifications, minutes_since_last_nudge, is_late_night } = req.body;

  if (!OPENROUTER_API_KEY) {
    return res.status(500).json({ error: "OPENROUTER_API_KEY is not configured on the server." });
  }

  const systemPrompt = "You are Nova, checking in on the user's phone activity in the background — they have proactive nudges turned on."
    + " Talk like a Gen Z close friend texting, not like an assistant: fr, ngl, bet, no cap, lowkey/highkey, deadass, emoji when it fits."
    + " Use your own judgment about whether ANY of the telemetry below is worth flagging right now — but lean toward speaking up rather than staying quiet when something reasonably stands out. You don't need certainty, just a plausible reason a friend would mention it."
    + " Clear nudge-worthy signals: 60+ minutes on one app in a single stretch, several unread messages piling up, or a notification that sounds time-sensitive, urgent, or from someone close to the user (family, a boss, anything mentioning \"call me\", \"urgent\", \"asap\", an emergency, etc.)."
    + " Only skip nudging if the telemetry is genuinely mundane (routine app use, spam/promo notifications, nothing time-sensitive)."
    + (is_late_night
      ? " It's currently late night (11pm-5am) for the user — this adds a bedtime/wellness angle: if there's meaningful screen time on a distracting app (social media, games, doomscrolling-style apps) at this hour, that alone is worth a gentle nudge to wrap up and get some sleep, even if it wouldn't be nudge-worthy during the day."
      : "")
    + ` It has been ${minutes_since_last_nudge ?? "an unknown number of"} minutes since Nova last nudged the user — avoid nudging again within the last 20 minutes unless it's clearly urgent, but don't use that as a reason to stay silent otherwise.\n\n`
    + `App usage: ${JSON.stringify(app_usage ?? [])}\nRecent notifications: ${JSON.stringify(recent_notifications ?? [])}`;

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
        messages: [{ role: "system", content: systemPrompt }],
        tools: [NUDGE_TOOL],
        tool_choice: "auto",
        stream: false,
      }),
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

  const data = await openRouterResponse.json();
  const toolCall = data.choices?.[0]?.message?.tool_calls?.find((tc) => tc.function?.name === "send_nudge");

  if (!toolCall) {
    return res.json({ nudge: null });
  }

  try {
    const args = JSON.parse(toolCall.function.arguments);
    return res.json({ nudge: args.message ?? null });
  } catch {
    return res.json({ nudge: null });
  }
});

// Called by the phone client when a captured message notification plausibly mentions a plan —
// asks the model whether there's a specific meeting worth offering to add to the calendar.
app.post("/api/detect-meeting", async (req, res) => {
  const { message, sender } = req.body;

  if (!message) {
    return res.status(400).json({ error: "message is required" });
  }
  if (!OPENROUTER_API_KEY) {
    return res.status(500).json({ error: "OPENROUTER_API_KEY is not configured on the server." });
  }

  const systemPrompt = `The current date and time is ${new Date().toString()}.`
    + ` ${sender ? `A message from ${sender}` : "A message"} was just received: "${message}".`
    + " If it clearly mentions a specific meeting, call, or plan with a discernible date/time (even relative, like 'tomorrow at 5' or 'Friday morning'), call propose_meeting with a short title and the resolved ISO datetime."
    + " If it's vague, has no discernible time, or isn't actually about scheduling something, don't call the tool at all.";

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
        messages: [{ role: "system", content: systemPrompt }],
        tools: [MEETING_TOOL],
        tool_choice: "auto",
        stream: false,
      }),
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

  const data = await openRouterResponse.json();
  const toolCall = data.choices?.[0]?.message?.tool_calls?.find((tc) => tc.function?.name === "propose_meeting");

  if (!toolCall) {
    return res.json({ title: null, isoDateTime: null });
  }

  try {
    const args = JSON.parse(toolCall.function.arguments);
    return res.json({ title: args.title ?? null, isoDateTime: args.isoDateTime ?? null });
  } catch {
    return res.json({ title: null, isoDateTime: null });
  }
});

app.get("/api/web-search", async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: "q query param is required" });
  if (!TAVILY_API_KEY) {
    return res.status(500).json({ error: "Web search is not configured on the server." });
  }

  try {
    const searchResponse = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: TAVILY_API_KEY,
        query,
        max_results: 5,
        include_answer: true,
      }),
    });
    if (!searchResponse.ok) throw new Error(`Tavily returned ${searchResponse.status}`);

    const data = await searchResponse.json();
    res.json({
      answer: data.answer ?? "",
      results: (data.results ?? []).map((r) => ({ title: r.title, url: r.url, content: r.content })),
    });
  } catch (err) {
    console.error("Web search error:", err.message);
    res.status(500).json({ error: "Web search failed." });
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
