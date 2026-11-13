/**
 * The two calls GitHub's web sign-in needs after the browser comes back with a code: trade the
 * code for a token, and ask who the token is. The token is used once, for that question, and
 * dropped: this service does nothing in the owner's name on GitHub (ADR 0043).
 */
export interface GitHub {
  authorizeUrl(state: string, redirectUri: string): string;
  /** The login the code belongs to, or null when GitHub would not say. */
  loginFor(code: string, redirectUri: string): Promise<string | null>;
}

export function createGitHub(clientId: string, clientSecret: string, fetcher: typeof fetch = fetch): GitHub {
  return {
    authorizeUrl(state, redirectUri) {
      // No scope: reading the public profile is all that is asked.
      const q = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, state, allow_signup: "false" });
      return `https://github.com/login/oauth/authorize?${q.toString()}`;
    },
    async loginFor(code, redirectUri) {
      const token = await fetcher("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
      });
      if (!token.ok) return null;
      const { access_token: accessToken } = (await token.json()) as { access_token?: unknown };
      if (typeof accessToken !== "string") return null;
      const user = await fetcher("https://api.github.com/user", {
        headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${accessToken}`, "User-Agent": "openseas-studio" },
      });
      if (!user.ok) return null;
      const { login } = (await user.json()) as { login?: unknown };
      return typeof login === "string" ? login : null;
    },
  };
}
