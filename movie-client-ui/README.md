# Movie Agent Chat UI

A beautiful React-based chat interface for the Movie Agent, providing the same functionality as the CLI with a modern web UI.

## Features

- 🎬 **Interactive Chat Interface**: Clean, modern chat UI with real-time responses
- 📱 **Responsive Design**: Works beautifully on desktop and mobile devices
- 🚀 **Streaming Support**: Real-time streaming responses from the movie agent
- 💬 **Message History**: Maintains conversation context across messages
- ✨ **Status Indicators**: Visual feedback for working, completed, and failed states
- 🎨 **Modern UI**: Beautiful gradient design with Tailwind CSS

## Getting Started

### Install Dependencies

```bash
cd movie-client-ui
npm install
```

### Run Development Server

**Option 1: Run both frontend and backend together (Recommended)**
```bash
npm run dev:all
```
This starts both the backend API server (port 3000) and frontend (port 3002) in one terminal.

**Option 2: Run separately**

Terminal 1 - Backend:
```bash
npm run dev:backend
```

Terminal 2 - Frontend:
```bash
npm run dev
```

The frontend will open at `http://localhost:3002` and connect to the backend at `http://localhost:3000`

### Build for Production

```bash
npm run build
```

### Preview Production Build

```bash
npm run preview
```

## Deployment

### Deploying Both Frontend and Backend

See the main [DEPLOYMENT.md](../DEPLOYMENT.md) guide for instructions on deploying both:
- **movie-client-ui** (frontend) → Cloudflare Pages
- **web-client** (backend) → Cloudflare Workers, Railway, or Render

### Frontend Only: Cloudflare Pages

### Prerequisites

1. Install Wrangler CLI (if not already installed):
   ```bash
   npm install -g wrangler
   ```

2. Authenticate with Cloudflare:
   ```bash
   wrangler login
   ```

### Deploy

#### Option 1: Using npm script

```bash
npm run deploy
```

#### Option 2: Using deployment script

```bash
chmod +x deploy.sh
./deploy.sh
```

#### Option 3: Manual deployment

```bash
# Build the project
npm run build

# Deploy to Cloudflare Pages
wrangler pages deploy dist --project-name movie-client-ui
```

### First-Time Setup

If this is your first deployment, create the Pages project:

```bash
wrangler pages project create movie-client-ui
```

Then deploy as shown above.

### Deployment Configuration

- **Build Output Directory**: `dist` (configured in `wrangler.toml`)
- **Project Name**: `movie-client-ui`
- **SPA Routing**: Handled via `public/_redirects` file

The deployed app will be available at a URL like:
`https://[hash].movie-client-ui.pages.dev`

## Configuration

The app is configured to use the deployed movie agent at:
`https://b07629d5.movie-agent.pages.dev`

To change this, edit the `MOVIE_AGENT_URL` constant in `src/App.tsx`.

### Feedback Feature

The feedback feature is **self-contained** within this project. The backend server (`server.ts`) handles:

1. **Security**: Securely handles `CLIENT_WALLET_EOA_PRIVATE_KEY` (never exposed to frontend)
2. **Blockchain Operations**: Submits feedback on-chain (ERC-8004) which requires signing transactions
3. **ENS Resolution**: Resolves agent names to agent IDs via blockchain
4. **A2A Integration**: Works directly with A2A agents (like movie-agent) to get feedbackAuth

**To use feedback:**

1. Ensure the backend is running (it's included when you run `npm run dev:all`)
2. Set environment variables in `.env` file:
   ```bash
   CLIENT_WALLET_EOA_PRIVATE_KEY=0x...
   RPC_URL=https://rpc.sepolia.org
   REPUTATION_REGISTRY=0x...
   ERC8004_CHAIN_ID=11155111
   ENS_REGISTRY=0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e
   ```
3. In the chat, type "give review" or "give feedback" to open the feedback dialog.

**Architecture:**

```
movie-client-ui/
├── server.ts          # Backend API server (port 3000)
├── src/
│   └── App.tsx        # Frontend React app (port 3002)
└── package.json       # All dependencies included
```

The backend integrates directly with A2A agents (like the movie-agent) to:
- Resolve agent URLs via ENS/identity registry
- Request feedbackAuth from agents using their `/a2a/skills/agent.feedback.requestAuth` endpoint
- Submit feedback on-chain using ERC-8004 reputation system

**No external web-client dependency needed!** This project is self-contained and works directly with any A2A-compatible agent.

## Usage

1. The app automatically connects to the movie agent on load
2. Type your movie-related questions in the input field
3. Press Enter or click Send to send your message
4. The agent will respond with movie information, actor details, recommendations, etc.

## Features Comparison with CLI

| Feature | CLI | React UI |
|---------|-----|----------|
| Connect to Agent | ✅ | ✅ |
| Display Agent Card | ✅ | ✅ |
| Send Messages | ✅ | ✅ |
| Stream Responses | ✅ | ✅ |
| Status Updates | ✅ | ✅ |
| Context Management | ✅ | ✅ |
| New Session | ✅ | ✅ |
| Visual Status | ❌ | ✅ |
| Modern UI | ❌ | ✅ |
| Mobile Support | ❌ | ✅ |

## Tech Stack

- **React 18** - UI Framework
- **TypeScript** - Type Safety
- **Vite** - Build Tool
- **Tailwind CSS** - Styling
- **@a2a-js/sdk** - A2A Protocol Client

## License

MIT
