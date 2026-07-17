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
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "https://nova-chat-dbth.onrender.com";

// In-memory per-call state (goal, transcript, status) keyed by Twilio CallSid — cleared if the
// server restarts, same tradeoff as the Spotify token cache elsewhere in this file.
const activeCalls = new Map();

// Mode-switching: same brain, different vibe. "genz" is the long-standing default tone.
const PERSONA_PROMPTS = {
  genz: "Talk like a Gen Z close friend texting, not like an assistant. Lean into it: fr, ngl, bet, no cap, lowkey/highkey, deadass, ts (this), fym, ong, ate, bro/bruh, lowercase energy, short punchy sentences over formal ones. Do NOT use emoji by default — treat emoji as off unless the style samples below clearly show this specific user uses them a lot themselves, in which case match their actual rate, never more. When in doubt, zero emoji. Don't perform a generic 'Gen Z' impression — if style samples of how this specific user actually texts are given below, match THEIR real phrasing, slang choices, and rhythm over any generic version of the vibe.",
  hype: "Talk like an over-the-top hype coach — everything the user does is a W, you're their biggest cheerleader, lots of energy and exclamation, genuinely fired up about their day even for small stuff.",
  tough_love: "Talk like a tough-love mentor — blunt, no sugar-coating, calls out excuses, but ultimately wants the user to actually do better, not just feel good. Short, direct sentences.",
  chaotic: "Talk like a chaotic unhinged best friend — unpredictable energy, random tangents, dramatic reactions to mundane stuff, still genuinely helpful underneath the chaos.",
  mentor: "Talk like a calm, wise mentor — measured, thoughtful, asks good questions, speaks in a slightly older/wiser register, but warm not preachy.",
  roast: "Talk like you're roasting your friend, lovingly but mercilessly — clown them for their habits (screen time, one-word replies, procrastination) instead of encouraging them. Still helpful, just delivered as a burn.",
  commentator: "Talk like a hype sports commentator narrating the user's mundane life events as if they were huge plays — over-the-top play-by-play energy for ordinary stuff, pure comedic bit.",
};

function personaTone(persona) {
  return PERSONA_PROMPTS[persona] || PERSONA_PROMPTS.genz;
}

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
app.use(express.urlencoded({ extended: false })); // Twilio webhooks POST form-encoded bodies

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
      name: "configure_scroll_guard",
      description: "Turn on/off a live doom-scroll interrupt: while enabled, Nova checks every ~10 minutes whether Instagram/TikTok/YouTube/Reddit/X/Facebook/Snapchat has been open continuously past a threshold, and speaks up in the moment instead of waiting for the end-of-day digest.",
      parameters: {
        type: "object",
        properties: {
          enabled: { type: "boolean" },
          threshold_minutes: { type: "integer", description: "Minutes of continuous scrolling before Nova interrupts. Defaults to 20." },
        },
        required: ["enabled"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "enable_all_automations",
      description: "Turn on every standing automation at once in one shot: proactive nudges, live doom-scroll guard, always-on auto-reply, and the daily morning briefing. Use this whenever the user asks to turn everything/all features on, instead of calling each toggle tool separately.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_features",
      description: "List everything Nova can do / has been set up to do — every automation, tool, and feature — so the user can see the full picture. Use this whenever the user asks what Nova can do, what's been built, or what features exist.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "place_call",
      description: "Place a real outgoing phone call on the user's behalf to accomplish a stated goal (e.g. book a table, ask about store hours, confirm an order). The call always opens by disclosing it's an AI assistant calling on the user's behalf — it never impersonates the user or hides that it's synthetic. Returns immediately once the call is placed; use check_call_status afterward to see how it went.",
      parameters: {
        type: "object",
        properties: {
          phone_number: { type: "string", description: "Phone number to call, in a dialable format (include country code if known)." },
          goal: { type: "string", description: "What the call should accomplish, e.g. 'book a table for 2 at 7pm tonight'." },
        },
        required: ["phone_number", "goal"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_call_status",
      description: "Check on the most recent phone call Nova placed on the user's behalf — whether it's still in progress, how it ended, and a transcript.",
      parameters: {
        type: "object",
        properties: {},
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
  {
    type: "function",
    function: {
      name: "get_subscriptions",
      description: "List recurring subscriptions (Netflix, Spotify, gym, etc.) detected from bank SMS, with their amount and estimated next renewal date.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "log_expense",
      description: "Manually log an expense or income the user just told you about, or that you identified from a shared receipt/screenshot — adds it to the same tracker used for bank-SMS spending.",
      parameters: {
        type: "object",
        properties: {
          amount: { type: "number", description: "The amount, in rupees." },
          merchant: { type: "string", description: "Who it was paid to/received from, if known." },
          is_debit: { type: "boolean", description: "true if money went out (spending), false if money came in. Defaults to true." },
        },
        required: ["amount"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "configure_bill_payee",
      description: "Save a payee's UPI ID (electricity board, landlord, broadband provider, etc.) so bills can be paid one-tap later. Banks never expose a merchant's UPI ID automatically, so the user has to give it once.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "What to call this payee, e.g. 'electricity board'." },
          upi_vpa: { type: "string", description: "Their UPI ID, e.g. 'name@bank'." },
        },
        required: ["name", "upi_vpa"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_bill_payees",
      description: "List saved UPI bill payees.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "pay_bill",
      description: "Open the UPI payment screen pre-filled for a saved payee. The user still confirms the actual payment themselves in their UPI app — this just gets them there in one tap.",
      parameters: {
        type: "object",
        properties: {
          payee_name: { type: "string", description: "Name of a previously saved bill payee." },
          amount: { type: "number", description: "Amount in rupees, if known." },
          note: { type: "string", description: "Optional payment note/reference." },
        },
        required: ["payee_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_research_topic",
      description: "Give Nova a standing topic to watch and brief the user on weekly (e.g. a market, a hobby, a news beat), delivered as an unprompted notification.",
      parameters: {
        type: "object",
        properties: {
          topic: { type: "string" },
        },
        required: ["topic"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_research_topics",
      description: "List the user's standing weekly research topics.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "remove_research_topic",
      description: "Stop watching a standing research topic matching the given text.",
      parameters: {
        type: "object",
        properties: { topic: { type: "string" } },
        required: ["topic"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_badges",
      description: "List achievement badges the user has unlocked with Nova (streaks, dares, milestones).",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "schedule_time_capsule",
      description: "Hold onto a message and deliver it to the user later, unprompted — e.g. 'send this to future me in 3 months' or 'remind me of this next month'.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "The message to deliver later." },
          deliver_at: { type: "string", description: "ISO-8601 local datetime to deliver it, e.g. 2026-10-15T09:00:00. Resolve relative phrases like 'in 3 months' using the current date given." },
        },
        required: ["text", "deliver_at"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_wrapped",
      description: "Generate a shareable 'Nova Wrapped' style recap — top apps, streaks, dare streak, badges — something the user can screenshot and send to a friend.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_relationships",
      description: "List who the user talks to most, their messaging streaks, and last-contact recency — a lightweight personal CRM derived from captured notifications.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_nova_mode",
      description: "Switch Nova's whole personality/vibe on demand — same brain, different energy. Call this whenever the user asks to change how Nova talks/acts.",
      parameters: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["genz", "hype", "tough_love", "chaotic", "mentor", "roast", "commentator"] },
        },
        required: ["mode"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_low_battery_contact",
      description: "Set (or clear, by omitting contact) a person to auto-text a heads-up when the phone's battery gets low, e.g. 'my mom' or a phone number.",
      parameters: {
        type: "object",
        properties: {
          contact: { type: "string", description: "Phone number or contact name to text when battery is low. Omit to clear/disable." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_my_data",
      description: "Search across everything Nova has already captured on the phone — notifications, expenses, subscriptions, packages, goals, saved places, and (if a contact_name is given) past conversation history with that person. Use this for questions like 'when did I last talk to X about Y' or 'how much have I spent on Netflix' instead of guessing.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "What the user is trying to find out." },
          contact_name: { type: "string", description: "If the question is about a specific person, their name/title as it'd appear in notifications." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_place",
      description: "Save the user's current phone GPS location as a named place (e.g. 'home', 'work') for geofence-style automation.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Name for this place, e.g. 'home' or 'work'." },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "configure_place_alert",
      description: "Set what happens when the user arrives at or leaves a saved place — a local notification, an auto-sent text to someone, and/or a ringer mode change (needs a one-time Do Not Disturb access grant).",
      parameters: {
        type: "object",
        properties: {
          place_name: { type: "string", description: "Name of a previously saved place." },
          event: { type: "string", enum: ["arrive", "leave"] },
          message: { type: "string", description: "Text to send/notify, if not the default." },
          recipient: { type: "string", description: "Phone number or contact name to auto-text on this event. Omit to just get a local notification instead." },
          ringer_mode: { type: "string", enum: ["normal", "vibrate", "silent"], description: "Auto-switch ringer mode on this event, e.g. silent on arriving at work." },
        },
        required: ["place_name", "event"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_places",
      description: "List the user's saved places and their configured arrive/leave alerts.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remove_place",
      description: "Remove a saved place by name.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_goal",
      description: "Give Nova a standing goal to track on her own over time (not just this conversation), e.g. 'keep me under 5000 rupees this month' or 'don't let me miss a subscription renewal'. Nova will factor it into her periodic proactive checks.",
      parameters: {
        type: "object",
        properties: {
          description: { type: "string", description: "The goal, in plain language." },
        },
        required: ["description"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_goals",
      description: "List the user's current standing goals.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "clear_goal",
      description: "Remove a standing goal that matches the given description.",
      parameters: {
        type: "object",
        properties: {
          description: { type: "string", description: "Text to match against existing goals for removal." },
        },
        required: ["description"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "configure_expense_digest",
      description: "Turn the daily spend digest notification on/off, or change its time. It's on by default at 8pm and needs no setup — only call this if the user wants to change or disable it.",
      parameters: {
        type: "object",
        properties: {
          enabled: { type: "boolean" },
          time: { type: "string", description: "24h HH:mm, e.g. 20:00. Omit to keep the current time." },
        },
        required: ["enabled"],
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

// Forced tool_choice for /api/translate — always returns a translation, optionally a heads-up
// note for the user only (never spoken to the other person).
const TRANSLATE_TOOL = {
  type: "function",
  function: {
    name: "translate_turn",
    description: "Translate this conversation turn and optionally flag something worth the user's attention.",
    parameters: {
      type: "object",
      properties: {
        translation: { type: "string", description: "Natural, conversational translation of the text into the target language." },
        note: { type: "string", description: "A short heads-up for the user ONLY if this turn conflicts with or relates to something established earlier in the conversation (e.g. a dietary restriction, a stated preference). Omit entirely if nothing is relevant — don't force one." },
      },
      required: ["translation"],
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
  const { messages, enablePhoneTools, memories, persona, style_samples } = req.body;

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

  const styleSampleList = Array.isArray(style_samples) ? style_samples.filter((s) => typeof s === "string" && s.trim()) : [];
  const styleBlock = styleSampleList.length
    ? `\n\nHere's how this user actually texts, in their own words:\n${styleSampleList.map((s) => `- "${s}"`).join("\n")}\nMatch THIS — their real vocabulary, capitalization habits, punctuation, typical length, and slang choices — instead of a generic impression of the persona. If they never use emoji, don't either.`
    : "";

  const systemPrompt = "You are a helpful, friendly, and knowledgeable AI assistant. Provide clear, concise, and accurate responses."
    + ` ${personaTone(persona)} Still be genuinely helpful and accurate — the vibe is the wrapper, the substance isn't.`
    + styleBlock
    + " You have a set_nova_mode tool (genz, hype, tough_love, chaotic, mentor, roast, commentator) — call it whenever the user asks you to switch vibes/personality/mode."
    + memoryBlock
    + " You have a remember tool and a forget tool for persisting facts about the user across conversations, not just this one. Call remember, before writing your reply, any time the user asks you to remember/note/save something, or shares a durable preference, fact, or detail about themselves worth recalling later (their name, likes/dislikes, ongoing projects, constraints) — this includes simple requests like 'remember that X.' Call forget the same way when a fact becomes outdated or the user asks you to forget it. These calls are low-ceremony — don't make a big deal about it in your reply, just confirm briefly and naturally."
    + (enablePhoneTools
      ? ` You are running inside the user's phone app. The current date and time is ${new Date().toString()}, use it to resolve relative times like "tomorrow" or "5pm" when creating reminders. `
        + "You can open installed apps, search Spotify for a song, pause/resume/skip playback, open the Add Contact screen, create a calendar reminder, search the live web, send a WhatsApp message directly, send an email or SMS directly, reply to all unread WhatsApp, Gmail, or Instagram messages at once, turn always-on auto-reply mode on/off, schedule or cancel a recurring daily briefing, summarize recent notifications into a catch-up digest, check app usage time, find nearby places, share your location, navigate to a destination, turn your own proactive nudges on/off, turn on a live doom-scroll interrupt (scroll guard), turn every standing automation on at once in one shot, list out everything you're able to do so the user can see the full picture, place a real outgoing phone call on the user's behalf to accomplish a stated goal (always disclosing upfront that it's an AI calling on the user's behalf, never impersonating them) and check how a placed call went, check today's (or a past day's) spending tracked from bank SMS (a daily spend digest notification also goes out automatically at 8pm), check the delivery status of recent Amazon/Flipkart orders, list detected recurring subscriptions and when they'll renew, log an expense manually (e.g. from a shared receipt), set/list/clear standing goals for Nova to track on her own over time, save/list/remove places for geofence-style automation (with an arrive/leave alert and a ringer-mode change), set/clear a low-battery emergency contact, search across everything already captured (notifications, expenses, subscriptions, packages, goals, places, past conversations) with search_my_data, save a UPI payee and open a one-tap payment screen for a bill, track a personal CRM of who the user talks to and their streaks, keep a standing weekly watch on research topics, hold a message to deliver later (time capsule), generate a shareable 'Nova Wrapped' recap, list unlocked achievement badges, or switch your own personality/mode (genz, hype, tough_love, chaotic, mentor, roast, commentator) on request, using the tools provided. Use a tool whenever the user's request calls for one of these actions, then reply naturally about what you did."
        + " When the user hands you a multi-step goal in one line (e.g. 'reschedule my dentist appointment to Friday and let them know', 'clear my WhatsApp backlog and tell me what mattered'), complete the whole thing yourself by calling as many tools as it takes, one after another, without pausing to ask permission after each intermediate step — only stop and ask if you hit a real judgment call you can't make on your own (e.g. two contacts with the same name, an ambiguous date). When you're done, reply with a short natural summary of everything you actually did."
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
  const { app_usage, recent_notifications, minutes_since_last_nudge, is_late_night, historical_usage, weather, goals_context, persona, extra_context } = req.body;

  if (!OPENROUTER_API_KEY) {
    return res.status(500).json({ error: "OPENROUTER_API_KEY is not configured on the server." });
  }

  const systemPrompt = "You are Nova, checking in on the user's phone activity in the background — they have proactive nudges turned on, and they specifically want a check-in EVERY time this runs, not just when something stands out."
    + ` ${personaTone(persona)}`
    + " Always call send_nudge with something — if there's a clear signal (heavy usage, piling-up messages, something time-sensitive, weather, a goal, a relationship signal), lead with that. If genuinely nothing stands out, that's fine too — just send a short, casual check-in in your own voice (how's it going, what are you up to, a light observation) instead of staying silent. Never skip calling the tool."
    + " Clear signals worth leading with: 60+ minutes on one app in a single stretch, several unread messages piling up, or a notification that sounds time-sensitive, urgent, or from someone close to the user (family, a boss, anything mentioning \"call me\", \"urgent\", \"asap\", an emergency, etc.)."
    + (is_late_night
      ? " It's currently late night (11pm-5am) for the user — this adds a bedtime/wellness angle: if there's meaningful screen time on a distracting app (social media, games, doomscrolling-style apps) at this hour, that alone is worth a gentle nudge to wrap up and get some sleep, even if it wouldn't be nudge-worthy during the day."
      : "")
    + (Array.isArray(historical_usage) && historical_usage.length > 0
      ? " You also have each app's historical average for this same day of the week — if today's usage is meaningfully above that average (roughly 1.5x or more), treat that as a nudge-worthy pattern-break even if the raw minutes alone wouldn't normally cross the 60-minute bar. Mention the comparison naturally (e.g. \"you're way past your usual Friday Instagram time\") instead of quoting raw numbers robotically."
      : "")
    + (weather
      ? ` You also have the local weather forecast — if rain, storms, extreme heat/cold, or other notable weather is coming up in the next few hours, that alone is worth a heads-up (e.g. "gonna rain around 5, grab an umbrella"), even if nothing else stands out.`
      : "")
    + (goals_context
      ? " The user has given you standing goals to track on your own, provided below with relevant live context (spending, subscriptions). Weigh progress toward these goals as seriously as the other telemetry — e.g. if a goal is about budget and today's spend is unusually high, or a goal is about not missing bills and a subscription renews very soon, that's nudge-worthy on its own."
      : "")
    + (extra_context
      ? " You also have some additional live context below (relationship/streak data, texting-pattern signals, or an old memory worth a callback) — weave it in naturally if it's genuinely relevant, don't force it, and don't feel obligated to nudge just because it's present."
      : "")
    + ` It has been ${minutes_since_last_nudge ?? "an unknown number of"} minutes since Nova last nudged the user — avoid nudging again within the last 20 minutes unless it's clearly urgent, but don't use that as a reason to stay silent otherwise.\n\n`
    + `App usage: ${JSON.stringify(app_usage ?? [])}\nRecent notifications: ${JSON.stringify(recent_notifications ?? [])}`
    + (Array.isArray(historical_usage) && historical_usage.length > 0 ? `\nHistorical same-weekday averages: ${JSON.stringify(historical_usage)}` : "")
    + (weather ? `\nWeather forecast: ${weather}` : "")
    + (goals_context ? `\n${goals_context}` : "")
    + (extra_context ? `\n${extra_context}` : "");

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
        tool_choice: { type: "function", function: { name: "send_nudge" } },
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

// Live translation mode — one conversation turn at a time. session_context carries the recent
// back-and-forth so Nova can flag callbacks (e.g. "they mentioned meat but you said vegetarian
// 3 exchanges ago") instead of translating each line in a vacuum like a plain translator would.
app.post("/api/translate", async (req, res) => {
  const { text, source_lang, target_lang, direction, session_context } = req.body;

  if (!text || !target_lang) {
    return res.status(400).json({ error: "text and target_lang are required" });
  }
  if (!OPENROUTER_API_KEY) {
    return res.status(500).json({ error: "OPENROUTER_API_KEY is not configured on the server." });
  }

  const contextList = Array.isArray(session_context) ? session_context.filter((s) => typeof s === "string" && s.trim()) : [];
  const contextBlock = contextList.length
    ? `\n\nRecent conversation so far (oldest first):\n${contextList.map((s) => `- ${s}`).join("\n")}`
    : "";

  const systemPrompt = `You are interpreting a live spoken conversation${source_lang ? ` from ${source_lang}` : ""} into ${target_lang}.`
    + ` This turn was said by ${direction === "outgoing" ? "the user (to the other person)" : "the other person (to the user)"}: "${text}".`
    + " Translate it naturally, the way a real interpreter would — not overly literal."
    + (direction === "outgoing"
      ? " This is the user's own words, so don't add a note — they already know their own context."
      : " If this turn relates to or conflicts with something in the conversation so far (a dietary restriction, a preference, a prior statement), add a short note flagging it for the user's benefit — but only if it's genuinely relevant, don't force one.")
    + contextBlock;

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
        tools: [TRANSLATE_TOOL],
        tool_choice: { type: "function", function: { name: "translate_turn" } },
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
  const toolCall = data.choices?.[0]?.message?.tool_calls?.find((tc) => tc.function?.name === "translate_turn");

  if (!toolCall) {
    return res.json({ translation: null, note: null });
  }

  try {
    const args = JSON.parse(toolCall.function.arguments);
    return res.json({ translation: args.translation ?? null, note: args.note ?? null });
  } catch {
    return res.json({ translation: null, note: null });
  }
});

// Cloned-voice TTS for nudges/predictions — falls back to the phone's local TTS on the client
// if this isn't configured (503) or the ElevenLabs call fails, so it's always safe to call.
app.post("/api/tts", async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: "text is required" });
  if (!ELEVENLABS_API_KEY || !ELEVENLABS_VOICE_ID) {
    return res.status(503).json({ error: "Cloned-voice TTS is not configured on the server." });
  }

  try {
    const ttsResponse = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": ELEVENLABS_API_KEY,
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });

    if (!ttsResponse.ok) {
      const errText = await ttsResponse.text().catch(() => "");
      console.error("ElevenLabs error:", errText);
      return res.status(502).json({ error: "Voice cloning provider request failed." });
    }

    res.setHeader("Content-Type", "audio/mpeg");
    const buffer = Buffer.from(await ttsResponse.arrayBuffer());
    res.send(buffer);
  } catch (err) {
    console.error("Error calling ElevenLabs:", err.message);
    res.status(500).json({ error: "Cannot connect to the voice cloning provider." });
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

function escapeXml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function twiml(inner) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`;
}

const CALL_END_TOKEN = "[END_CALL]";

// Generates the AI's next spoken line for an in-progress outgoing call. The very first line of
// every call discloses that it's an AI assistant calling on the user's behalf — this is a hard
// instruction, not a suggestion, since the whole point of this feature (vs. voice cloning) is
// that whoever picks up always knows they're talking to a disclosed AI, never being deceived
// into thinking the real person called.
async function generateCallReply(call, isOpening) {
  const systemPrompt = `You are an AI voice assistant placing a real phone call on behalf of ${call.callerName}, to accomplish this goal: "${call.goal}". `
    + `Your very first line of the call MUST clearly and explicitly disclose that you are an AI assistant calling on ${call.callerName}'s behalf — never let the other person believe they're speaking with ${call.callerName} directly, and never imply otherwise later in the call either. `
    + `Speak naturally and briefly, like a real phone call — 1-2 sentences per turn, not like a chatbot. Stay focused on the goal. `
    + `If the goal is accomplished, the other person can't help, or the call should clearly end for any reason, say a brief polite goodbye and put the exact text ${CALL_END_TOKEN} at the very end of your reply (it's a control signal, never spoken aloud). Otherwise don't include it.`;

  const messages = [{ role: "system", content: systemPrompt }, ...call.history];
  if (isOpening) {
    messages.push({ role: "user", content: "The call just connected and the other person picked up. Say your opening line now." });
  }

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENROUTER_API_KEY}` },
      body: JSON.stringify({ model: OPENROUTER_MODEL, messages, stream: false }),
    });
    if (!response.ok) throw new Error(`OpenRouter returned ${response.status}`);
    const data = await response.json();
    let text = data.choices?.[0]?.message?.content?.trim() || `Sorry, I'm having some trouble right now. Goodbye. ${CALL_END_TOKEN}`;
    const shouldEnd = text.includes(CALL_END_TOKEN);
    text = text.replace(CALL_END_TOKEN, "").trim();
    return { text, shouldEnd };
  } catch (err) {
    console.error("Error generating call reply:", err.message);
    return { text: "Sorry, I'm having some technical trouble. I'll try again later. Goodbye.", shouldEnd: true };
  }
}

// Places a real outgoing call via Twilio, disclosing upfront it's an AI assistant — see
// generateCallReply. Deliberately does NOT clone the user's voice or let the call sound like the
// user in person; that was considered and rejected as undisclosed impersonation.
app.post("/api/place-call", async (req, res) => {
  const { to, goal, caller_name } = req.body;
  if (!to || !goal) return res.status(400).json({ error: "to and goal are required" });
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
    return res.status(503).json({ error: "Calling isn't configured on the server yet — a Twilio account, phone number, and API credentials are needed first." });
  }

  try {
    const params = new URLSearchParams({
      To: to,
      From: TWILIO_PHONE_NUMBER,
      Url: `${PUBLIC_BASE_URL}/api/twilio/voice`,
      StatusCallback: `${PUBLIC_BASE_URL}/api/twilio/status`,
      StatusCallbackEvent: "completed",
    });
    const twilioResponse = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Calls.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64")}`,
      },
      body: params.toString(),
    });
    if (!twilioResponse.ok) {
      const errText = await twilioResponse.text().catch(() => "");
      console.error("Twilio call creation error:", errText);
      return res.status(502).json({ error: "Twilio couldn't place the call." });
    }
    const data = await twilioResponse.json();
    activeCalls.set(data.sid, {
      goal,
      callerName: caller_name || "the user",
      history: [],
      status: "in-progress",
      resultSummary: null,
    });
    res.json({ call_sid: data.sid });
  } catch (err) {
    console.error("Error placing call:", err.message);
    res.status(500).json({ error: "Cannot connect to Twilio." });
  }
});

// Twilio webhook: fired when the call is answered.
app.post("/api/twilio/voice", async (req, res) => {
  const call = activeCalls.get(req.body.CallSid);
  res.set("Content-Type", "text/xml");
  if (!call) {
    return res.send(twiml(`<Say>Sorry, something went wrong on our end. Goodbye.</Say><Hangup/>`));
  }

  const opening = await generateCallReply(call, true);
  call.history.push({ role: "assistant", content: opening.text });
  if (opening.shouldEnd) {
    call.status = "completed";
    call.resultSummary = opening.text;
    return res.send(twiml(`<Say>${escapeXml(opening.text)}</Say><Hangup/>`));
  }
  res.send(twiml(
    `<Say>${escapeXml(opening.text)}</Say>`
    + `<Gather input="speech" action="/api/twilio/respond" method="POST" speechTimeout="auto"/>`
    + `<Say>Sorry, I didn't catch that. I'll try again another time. Goodbye.</Say><Hangup/>`,
  ));
});

// Twilio webhook: fired with the transcribed speech after each <Gather>.
app.post("/api/twilio/respond", async (req, res) => {
  const call = activeCalls.get(req.body.CallSid);
  res.set("Content-Type", "text/xml");
  if (!call) {
    return res.send(twiml(`<Say>Sorry, something went wrong. Goodbye.</Say><Hangup/>`));
  }

  call.history.push({ role: "user", content: req.body.SpeechResult || "" });
  const reply = await generateCallReply(call, false);
  call.history.push({ role: "assistant", content: reply.text });

  if (reply.shouldEnd) {
    call.status = "completed";
    call.resultSummary = reply.text;
    return res.send(twiml(`<Say>${escapeXml(reply.text)}</Say><Hangup/>`));
  }
  res.send(twiml(
    `<Say>${escapeXml(reply.text)}</Say>`
    + `<Gather input="speech" action="/api/twilio/respond" method="POST" speechTimeout="auto"/>`
    + `<Say>Sorry, I didn't catch that. Goodbye.</Say><Hangup/>`,
  ));
});

// Twilio webhook: call lifecycle status (covers no-answer/busy/failed cases that never reach /voice).
app.post("/api/twilio/status", (req, res) => {
  const call = activeCalls.get(req.body.CallSid);
  const callStatus = req.body.CallStatus;
  if (call && call.status === "in-progress" && ["completed", "busy", "failed", "no-answer", "canceled"].includes(callStatus)) {
    call.status = callStatus;
    if (!call.resultSummary) call.resultSummary = `Call ended (${callStatus}) before reaching a natural conclusion.`;
  }
  res.sendStatus(200);
});

app.get("/api/call-status/:callSid", (req, res) => {
  const call = activeCalls.get(req.params.callSid);
  if (!call) return res.status(404).json({ error: "Unknown or expired call — the server may have restarted since it was placed." });
  res.json({ status: call.status, transcript: call.history, result_summary: call.resultSummary });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Using OpenRouter model: ${OPENROUTER_MODEL}`);
});
