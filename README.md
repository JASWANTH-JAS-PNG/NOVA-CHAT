# NovaChat — AI Chatbot

A full-stack AI chatbot with a modern dark UI, powered by [OpenRouter](https://openrouter.ai/).

## 🚀 Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/) v18+
- An [OpenRouter](https://openrouter.ai/keys) API key

### 1. Clone the repo
```bash
git clone https://github.com/JASWANTH-JAS-PNG/Ai-Chatbot.git
cd Ai-Chatbot
```

### 2. Install dependencies
```bash
# Root (backend)
npm install

# Frontend
cd frontend
npm install
cd ..
```

### 3. Configure your API key
Create a `.env` file in the project root:
```
OPENROUTER_API_KEY=your-key-here
OPENROUTER_MODEL=openai/gpt-4o-mini
```

### 4. Run the app
```bash
npm run dev
```

This starts:
- 🤖 **NovaChat Frontend**: http://localhost:4173
- 🔧 **Node.js API**: http://localhost:5000

---

## 📁 Project Structure

```
Ai-Chatbot/
├── server.js          # Express backend (OpenRouter API wrapper)
├── package.json       # Root scripts
├── frontend/          # React + Vite + TypeScript frontend
│   ├── src/
│   │   ├── components/   # Sidebar, Header, ChatArea, Message...
│   │   ├── store/        # Zustand state management
│   │   ├── types/        # TypeScript types
│   │   └── utils/        # API helpers
│   └── vite.config.ts
└── backend/           # C# .NET API (optional)
```

## 🔧 Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | React 19 + Vite + TypeScript |
| Styling | Tailwind CSS v4 + CSS variables |
| State | Zustand + localStorage |
| Markdown | react-markdown + rehype-highlight |
| Backend | Express.js (Node.js) |
| AI | OpenRouter (openai/gpt-4o-mini default) |

## ⚙️ Configuration

To use a different model, add to `.env`:
```
OPENROUTER_API_KEY=your-key-here
OPENROUTER_MODEL=anthropic/claude-3.5-haiku
```

Browse available models at [openrouter.ai/models](https://openrouter.ai/models).

## 🐛 Troubleshooting

**"Unknown error" in chat** → Check that `OPENROUTER_API_KEY` is set correctly in `.env`.

**Port 4173 in use** → Another app is using that port. Kill it or change port in `frontend/vite.config.ts`.

**Port 5000 in use** → Kill the old backend: `npx kill-port 5000`
