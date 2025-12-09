# Movie Info Agent

This agent uses the TMDB API to answer questions about movies.

## Required Environment Variables

Create a `.env` file in the project root with the following **required** variables:

- **`OPENAI_API_KEY`** (required): Your OpenAI API key for GPT model access
- **`TMDB_API_KEY`** (required): The Movie Database (TMDB) API key (v3) - OR use `TMDB_API_TOKEN` for v4 token instead

### Example `.env` setup:

```bash
cp ../../.env.example ../../.env # or create your own .env
echo "OPENAI_API_KEY=sk-..." >> ../../.env
echo "TMDB_API_KEY=..." >> ../../.env # v3 key
# or use a v4 token instead of TMDB_API_KEY
# echo "TMDB_API_TOKEN=ey..." >> ../../.env
```

## Optional Environment Variables

### Agent Configuration
- **`OPENAI_MODEL`**: OpenAI model to use (default: `gpt-4o-mini`)
- **`AGENT_NAME`** or **`MOVIE_AGENT_NAME`**: Display name for the agent (default: `Movie Agent`)
- **`AGENT_URL`**: Full URL where the agent is accessible (auto-generated from HOST and PORT if not set)
- **`HOST`**: Host to bind the server to (default: `0.0.0.0` - binds to all interfaces)
- **`PORT`**: Port to run the agent on (default: `41241`)
- **`CORS_ORIGINS`**: Comma-separated list of allowed CORS origins (default: `http://localhost:3000,http://localhost:4002,http://movieclient.localhost:3000`)

### ERC-8004 / Blockchain Configuration
- **`RPC_URL`** or **`JSON_RPC_URL`**: Ethereum RPC endpoint (default: `https://rpc.sepolia.org`)
- **`ERC8004_CHAIN_ID`**: Chain ID for ERC-8004 operations (default: `11155111` for Sepolia)
- **`ERC8004_CHAIN_HEX`**: Chain ID in hex format (default: `0xaa36a7` for Sepolia)
- **`REPUTATION_REGISTRY`** or **`ERC8004_REPUTATION_REGISTRY`**: Address of the ERC-8004 Reputation Registry contract
- **`ENS_REGISTRY`** or **`NEXT_PUBLIC_ENS_REGISTRY`**: ENS Registry contract address (default: `0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e`)
- **`BUNDLER_URL`**: Account Abstraction bundler URL (e.g., Pimlico)
- **`AGENT_EOA_PRIVATE_KEY`**: Private key for agent operations (hex format with `0x` prefix)
- **`MOVIE_AGENT_OPERATOR_KEY`** or **`SERVER_PRIVATE_KEY`**: Private key for agent operator/server operations
- **`MOVIE_AGENT_ADDRESS`**: Ethereum address of the movie agent (default: `0x0000000000000000000000000000000000000000`)
- **`ERC8004_FEEDBACKAUTH_TTL_SEC`**: Feedback authorization expiration time in seconds (default: `3600`)

### Payment (AP2) Configuration
- **`AP2_RATE`**: Payment rate (default: `0.001`)
- **`AP2_TOKEN`**: Payment token symbol (default: `ETH`)
- **`AP2_TERMS_CID`**: IPFS CID for payment terms (optional)

### Example Complete `.env` File

```bash
# Required
OPENAI_API_KEY=sk-...
TMDB_API_KEY=your_tmdb_api_key_here
# OR use v4 token instead:
# TMDB_API_TOKEN=ey...

# Agent Configuration
AGENT_NAME=Movie Agent
PORT=5002
HOST=0.0.0.0

# Blockchain / ERC-8004 Configuration
RPC_URL=https://rpc.sepolia.org
ERC8004_CHAIN_ID=11155111
ERC8004_CHAIN_HEX=0xaa36a7
REPUTATION_REGISTRY=0x...
ENS_REGISTRY=0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e
BUNDLER_URL=https://api.pimlico.io/v2/11155111/rpc?apikey=your_key
AGENT_EOA_PRIVATE_KEY=0x...
ERC8004_FEEDBACKAUTH_TTL_SEC=3600
```

## Running the Agent

```bash
echo "127.0.0.1 movieagent.localhost" | sudo tee -a /etc/hosts
npm run agents:movie-agent
```

The agent will start on `http://localhost:41241` (or the port specified in the `PORT` environment variable).
