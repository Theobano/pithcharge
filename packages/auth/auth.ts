import { betterAuth } from "better-auth";
import { authConfig } from "./auth.config.js";

const isProduction = process.env.NODE_ENV === "production"

export const auth = betterAuth({
    advanced: {
        database: {
            generateId: 'uuid'
        },
        disableCSRFCheck: !isProduction,
        disableOriginCheck: !isProduction,
        defaultCookieAttributes: {
            sameSite: isProduction ? "None" : "Lax",
            secure: isProduction,
            httpOnly: true
        }
        
    },
    ...authConfig
});