import { phoneNumberClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/** Browser auth client. Same-origin, so no base URL is needed. */
export const authClient = createAuthClient({
  plugins: [phoneNumberClient()],
});
