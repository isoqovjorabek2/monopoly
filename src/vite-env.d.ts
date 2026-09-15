/// <reference types="vite/client" />

/**
 * Build-time configuration. Everything here is baked into the bundle and is
 * therefore public; nothing secret can live in it. See docs/turn.md.
 */
interface ImportMetaEnv {
  /** Comma-separated TURN URLs, e.g. `turn:1.2.3.4:3478,turn:1.2.3.4:3478?transport=tcp`. */
  readonly VITE_TURN_URLS?: string;
  readonly VITE_TURN_USERNAME?: string;
  readonly VITE_TURN_CREDENTIAL?: string;
  /** Where player sign-in lives. Defaults to https://aytingchi.uz/auth. */
  readonly VITE_AUTH_URL?: string;
  /** The public lobby directory. Defaults to https://aytingchi.uz/lobbies. */
  readonly VITE_LOBBY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
