require("dotenv").config();
const express = require("express");
const cors = require("cors");

const app = express();
const PORT = 5000;
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.2";

app.use(cors({ origin: ["http://localhost:3000", "http://localhost:3001", "http://localhost:5173", "http://localhost:5174", "https://ai-chatbot-web.onrender.com"] }));
app.use(express.json());

app.post("/api/chat", async (req, res) => {
  const { messages } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "messages array is required" });
  }

  try {
    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [
          {
            role: "system",
            content: "You are a helpful, friendly, and knowledgeable AI assistant. Provide clear, concise, and accurate responses.",
          },
          ...messages.map((m) => ({ role: m.role, content: m.content })),
        ],
        stream: false,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("Ollama error:", err);
      return res.status(500).json({ error: "Ollama request failed. Is Ollama running?" });
    }

    const data = await response.json();
    res.json({ reply: data.message.content });
  } catch (err) {
    console.error("Error calling Ollama:", err.message);
    res.status(500).json({ error: "Cannot connect to Ollama. Make sure it is running (ollama serve)." });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Using Ollama at ${OLLAMA_URL} with model: ${OLLAMA_MODEL}`);
});
