import { Inngest } from "inngest";

export const inngest = new Inngest({
    id: 'signalist',
    ai: { gemini: { apiKey: process.env.GEMINION_API_KEY! } }
});