import { createAuthClient } from "better-auth/react";
import { anonymousClient } from "better-auth/client/plugins";
import { SERVER_URL } from "./base.js";

export const authClient = createAuthClient({
  baseURL: `${SERVER_URL || window.location.origin}/api/auth`,
  plugins: [anonymousClient()],
  fetchOptions: { credentials: "include" },
});
