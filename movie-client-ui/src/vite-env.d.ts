/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MOVIE_AGENT_URL?: string;
  readonly VITE_AGENT_NAME?: string;
  readonly VITE_BACKEND_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}