// Simplified movie-agent for Cloudflare Pages Functions
import { v4 as uuidv4 } from 'uuid';
import OpenAI from "openai";

// Simple store for contexts (in production, use Cloudflare KV or Durable Objects)
const contexts = new Map();

// TMDB API integration
async function callTmdbApi(endpoint, query, env) {
  const apiKey = env.TMDB_API_KEY;
  const apiToken = env.TMDB_API_TOKEN;
  if (!apiKey && !apiToken) {
    throw new Error("TMDB_API_KEY or TMDB_API_TOKEN environment variable must be set");
  }

  try {
    const url = new URL(`https://api.themoviedb.org/3/search/${endpoint}`);
    if (apiKey) {
      url.searchParams.append("api_key", apiKey);
    }
    url.searchParams.append("query", query);
    url.searchParams.append("include_adult", "false");
    url.searchParams.append("language", "en-US");
    url.searchParams.append("page", "1");

    const response = await fetch(url.toString(), {
      headers: apiToken ? { Authorization: `Bearer ${apiToken}` } : undefined,
    });

    if (!response.ok) {
      throw new Error(
        `TMDB API error: ${response.status} ${response.statusText}`
      );
    }

    return await response.json();
  } catch (error) {
    console.error(`Error calling TMDB API (${endpoint}):`, error);
    throw error;
  }
}

// OpenAI tool definitions
const openAiToolDefinitions = [
  {
    type: "function",
    function: {
      name: "searchMovies",
      description: "Search TMDB for movies by title",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Movie title to search for" },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "searchPeople",
      description: "Search TMDB for people by name",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Person name to search for" },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
];

// Tool handlers
async function searchMoviesTool({ query }, env) {
  console.log("[tmdb:searchMovies]", JSON.stringify(query));
  try {
    const data = await callTmdbApi("movie", query, env);

    const results = data.results.map((movie) => {
      if (movie.poster_path) {
        movie.poster_path = `https://image.tmdb.org/t/p/w500${movie.poster_path}`;
      }
      if (movie.backdrop_path) {
        movie.backdrop_path = `https://image.tmdb.org/t/p/w500${movie.backdrop_path}`;
      }
      return movie;
    });

    return { ...data, results };
  } catch (error) {
    console.error("Error searching movies:", error);
    throw error;
  }
}

async function searchPeopleTool({ query }, env) {
  console.log("[tmdb:searchPeople]", JSON.stringify(query));
  try {
    const data = await callTmdbApi("person", query, env);

    const results = data.results.map((person) => {
      if (person.profile_path) {
        person.profile_path = `https://image.tmdb.org/t/p/w500${person.profile_path}`;
      }
      if (person.known_for && Array.isArray(person.known_for)) {
        person.known_for = person.known_for.map((work) => {
          if (work.poster_path) {
            work.poster_path = `https://image.tmdb.org/t/p/w500${work.poster_path}`;
          }
          if (work.backdrop_path) {
            work.backdrop_path = `https://image.tmdb.org/t/p/w500${work.backdrop_path}`;
          }
          return work;
        });
      }
      return person;
    });

    return { ...data, results };
  } catch (error) {
    console.error("Error searching people:", error);
    throw error;
  }
}

const openAiToolHandlers = {
  searchMovies: (args, env) => searchMoviesTool(args, env),
  searchPeople: (args, env) => searchPeopleTool(args, env),
};

// System prompt
function renderSystemPrompt(goal) {
  const raw = `You are a helpful movie agent that can answer questions about movies, actors, directors, and other film-related topics using The Movie Database (TMDB) API.

You have access to the following tools:
- searchMovies: Search for movies by title
- searchPeople: Search for people (actors, directors, etc.) by name

When answering questions:
1. Use the appropriate tools to gather information
2. Provide comprehensive and accurate responses
3. Include relevant details like release dates, ratings, cast, etc.
4. Be conversational and helpful

Current time: {{now}}

{{#if goal}}
User's goal: {{goal}}
{{/if}}

Always end your response with one of these states on a new line:
- COMPLETED (if you've fully answered the question)
- AWAITING_USER_INPUT (if you need more information from the user)`;

  const nowStr = new Date().toISOString();
  let content = raw.replaceAll("{{now}}", nowStr);

  if (goal && goal.length > 0) {
    content = content
      .replaceAll("{{#if goal}}", "")
      .replaceAll("{{/if}}", "")
      .replaceAll("{{goal}}", goal);
  } else {
    content = content.replace(/{{#if goal}}[\s\S]*?{{\/if}}/g, "");
  }
  return content;
}

// Main handler
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      });
    }

    // Handle agent card endpoint
    if (url.pathname === '/.well-known/agent-card.json') {
      try {
        const baseUrl = `${url.protocol}//${url.host}`;
        const agentCard = {
          name: "movieagent.orgtrust.eth",
          description: "movie agent description ....",
          url: baseUrl,
          version: "0.0.2",
          skills: [
            {
              id: "general_movie_chat",
              name: "General Movie Chat",
              tags: [],
              examples: [],
              inputModes: [],
              outputModes: [],
              description: ""
            },
            {
              id: "agent.feedback.requestAuth",
              name: "agent.feedback.requestAuth",
              tags: ["erc8004","feedback","auth","a2a"],
              examples: ["Client requests feedbackAuth after receiving results"],
              inputModes: ["text"],
              outputModes: ["text"],
              description: "Issue a signed ERC-8004 feedbackAuth for a client to submit feedback"
            }
          ],
          registrations: [
            {
              agentId: 11,
              agentAddress: "eip155:11155111:0x80fAA3740fDb03D7536C7fEef94f6F34Ea932bd3",
              signature: "0x4d6ff18c69d1306363b4728dfecbf6f71c552936c8cb3c5b47d255f0f20719f042e25d6b70258856a91c1c9c07ab7cb5ee5402fe0c6ff39109f2b63329993afe1b"
            }
          ],
          trustModels: ["feedback"],
          capabilities: {
            streaming: false,
            pushNotifications: false,
            stateTransitionHistory: false
          },
          defaultInputModes: [],
          defaultOutputModes: [],
          supportsAuthenticatedExtendedCard: false,
          feedbackDataURI: ""
        };
        return new Response(JSON.stringify(agentCard), {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });
      } catch (error) {
        console.error('Error serving agent card:', error);
        return new Response(JSON.stringify({ error: 'Failed to load agent card' }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }
    }

    // Handle chat endpoint
    if (url.pathname === '/chat' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { message, contextId } = body;
        
        if (!message) {
          return new Response(JSON.stringify({ error: 'Message is required' }), {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
          });
        }

        // Get or create context
        const currentContextId = contextId || uuidv4();
        const history = contexts.get(currentContextId) || [];
        
        // Add user message to history
        history.push({
          role: 'user',
          content: message,
          timestamp: new Date().toISOString()
        });

        // Call OpenAI
        const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
        const model = env.OPENAI_MODEL || 'gpt-4o-mini';

        const systemPrompt = renderSystemPrompt();
        const oaiMessages = [
          { role: 'system', content: systemPrompt },
          ...history.map(msg => ({
            role: msg.role === 'user' ? 'user' : 'assistant',
            content: msg.content
          }))
        ];

        let assistantText = null;
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const completion = await client.chat.completions.create({
            model,
            messages: oaiMessages,
            tools: openAiToolDefinitions,
          });

          const msg = completion.choices?.[0]?.message;
          if (!msg) {
            throw new Error('OpenAI returned no message');
          }

          const toolCalls = msg.tool_calls || [];
          if (toolCalls.length > 0) {
            // Add the assistant message that requested tool calls
            oaiMessages.push({
              role: 'assistant',
              content: msg.content ?? null,
              tool_calls: toolCalls,
            });

            for (const call of toolCalls) {
              const name = call.function?.name;
              const id = call.id;
              const argsJson = call.function?.arguments || '{}';
              let args = {};
              try { args = JSON.parse(argsJson); } catch {}
              const handler = openAiToolHandlers[name];
              if (!handler) {
                oaiMessages.push({ role: 'tool', tool_call_id: id, content: `Unknown tool: ${name}` });
                continue;
              }
              const result = await handler(args, env);
              oaiMessages.push({ role: 'tool', tool_call_id: id, content: JSON.stringify(result) });
            }
            // Continue loop for another model turn
            continue;
          }

          assistantText = msg.content ?? '';
          break;
        }

        // Add assistant response to history
        history.push({
          role: 'assistant',
          content: assistantText,
          timestamp: new Date().toISOString()
        });
        
        contexts.set(currentContextId, history);

        return new Response(JSON.stringify({
          response: assistantText,
          contextId: currentContextId
        }), {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });

      } catch (error) {
        console.error('Error processing chat:', error);
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }
    }

    // Default response
    return new Response(JSON.stringify({ 
      message: 'Movie Agent API',
      endpoints: [
        '/.well-known/agent-card.json',
        '/chat (POST)'
      ]
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  },
};