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

```bash
npm run dev
```

The app will open at `http://localhost:3002`

### Build for Production

```bash
npm run build
```

### Preview Production Build

```bash
npm run preview
```

## Deployment to Cloudflare Pages

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
