/** Auth.js's endpoints (sign-in, callbacks, sign-out, session, CSRF) under /api/auth. */
import { handlers } from "@/auth";

export const { GET, POST } = handlers;
