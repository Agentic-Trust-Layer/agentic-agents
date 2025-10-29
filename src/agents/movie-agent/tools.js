// Simplified tools for Cloudflare Pages
export const openAiToolDefinitions = [
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

// TMDB API integration
async function callTmdbApi(endpoint, query) {
  const apiKey = process.env.TMDB_API_KEY;
  const apiToken = process.env.TMDB_API_TOKEN;
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

export async function searchMoviesTool({ query }) {
  console.log("[tmdb:searchMovies]", JSON.stringify(query));
  try {
    const data = await callTmdbApi("movie", query);

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

export async function searchPeopleTool({ query }) {
  console.log("[tmdb:searchPeople]", JSON.stringify(query));
  try {
    const data = await callTmdbApi("person", query);

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

export const openAiToolHandlers = {
  searchMovies: (args) => searchMoviesTool(args),
  searchPeople: (args) => searchPeopleTool(args),
};
