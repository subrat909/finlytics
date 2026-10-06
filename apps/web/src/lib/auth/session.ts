import { cache } from "react";

import { auth } from "@/auth";

import { parseAppSession } from "./session-payload";
import type { AppSession } from "./session-payload";

export type { AppSession } from "./session-payload";

/** The signed-in session for this request (one database lookup per request, however many components ask). */
export const getSession = cache(async (): Promise<AppSession | null> => parseAppSession(await auth()));
