import { inngest } from "@/lib/inngest/client";
import { NEWS_SUMMARY_EMAIL_PROMPT, PERSONALIZED_WELCOME_EMAIL_PROMPT } from "@/lib/inngest/prompts";
import { sendNewsSummaryEmail, sendWelcomeEmail } from "@/lib/nodemailer";
import { getAllUsersForNewsEmail } from "@/lib/actions/user.actions";
import { getWatchlistSymbolsByEmail } from "@/lib/actions/watchlist.actions";
import { getNews } from "@/lib/actions/finnhub.actions";
import { getFormattedTodayDate } from "@/lib/utils";

// Direct Gemini API call helper
async function callGemini(prompt: string) {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        throw new Error("GEMINI_API_KEY not set in environment variables");
    }

    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${apiKey}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [
                    {
                        role: "user",
                        parts: [{ text: prompt }],
                    },
                ],
            }),
        }
    );

    if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`Gemini API error ${response.status}: ${errorData}`);
    }

    return await response.json();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const sendSignUpEmail = inngest.createFunction(
    {
        id: "sign-up-email",
        triggers: { event: "app/user.created" },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async ({ event, step }: { event: any; step: any }) => {
        const userProfile = `
            - Country: ${event.data.country}
            - Investment goals: ${event.data.investmentGoals}
            - Risk tolerance: ${event.data.riskTolerance}
            - Preferred industry: ${event.data.preferredIndustry}
        `;

        const prompt = PERSONALIZED_WELCOME_EMAIL_PROMPT.replace("{{userProfile}}", userProfile);

        const response = await step.run("generate-welcome-intro", async () => {
            return await callGemini(prompt);
        });

        await step.run("send-welcome-email", async () => {
            const part = response.candidates?.[0]?.content?.parts?.[0];
            const introText =
                (part && "text" in part ? part.text : null) ||
                "Thanks for joining Signalist. You now have the tools to track markets and make smarter moves.";

            const {
                data: { email, name },
            } = event;

            return await sendWelcomeEmail({ email, name, intro: introText });
        });

        return {
            success: true,
            message: "Welcome email sent successfully",
        };
    }
) as any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const sendDailyNewsSummary = inngest.createFunction(
    {
        id: "daily-news-summary",
        triggers: [
            { event: "app/send.daily.news" },
            { cron: "35 19 * * *" },
        ],
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async ({ step }: { step: any }) => {
        // Step #1: Get all users for news delivery
        const users = await step.run("get-all-users", getAllUsersForNewsEmail);

        if (!users || users.length === 0)
            return { success: false, message: "No users found for news email" };

        // Step #2: For each user, get watchlist symbols -> fetch news (fallback to general)
        const results = await step.run("fetch-user-news", async () => {
            const perUser: Array<{ user: UserForNewsEmail; articles: MarketNewsArticle[] }> = [];
            for (const user of users as UserForNewsEmail[]) {
                try {
                    const symbols = await getWatchlistSymbolsByEmail(user.email);
                    let articles = await getNews(symbols);
                    // Enforce max 6 articles per user
                    articles = (articles || []).slice(0, 6);
                    // If still empty, fallback to general
                    if (!articles || articles.length === 0) {
                        articles = await getNews();
                        articles = (articles || []).slice(0, 6);
                    }
                    perUser.push({ user, articles });
                } catch (e) {
                    console.error("daily-news: error preparing user news", user.email, e);
                    perUser.push({ user, articles: [] });
                }
            }
            return perUser;
        });

        // Step #3: Summarize news via Gemini API
        const userNewsSummaries: { user: UserForNewsEmail; newsContent: string | null }[] = [];

        for (const { user, articles } of results) {
            try {
                const prompt = NEWS_SUMMARY_EMAIL_PROMPT.replace(
                    "{{newsData}}",
                    JSON.stringify(articles, null, 2)
                );

                const response = await step.run(`summarize-news-${user.email}`, async () => {
                    return await callGemini(prompt);
                });

                const part = response.candidates?.[0]?.content?.parts?.[0];
                const newsContent =
                    (part && "text" in part ? part.text : null) || "No market news.";

                userNewsSummaries.push({ user, newsContent });
            } catch (e) {
                console.error("Failed to summarize news for:", user.email, e);
                userNewsSummaries.push({ user, newsContent: null });
            }
        }

        // Step #4: Send the emails
        await step.run("send-news-emails", async () => {
            await Promise.all(
                userNewsSummaries.map(async ({ user, newsContent }) => {
                    if (!newsContent) return false;

                    return await sendNewsSummaryEmail({
                        email: user.email,
                        date: getFormattedTodayDate(),
                        newsContent,
                    });
                })
            );
        });

        return {
            success: true,
            message: "Daily news summary emails sent successfully",
        };
    }
) as any;

export const sendCustomUpdateSummary = inngest.createFunction(
    {
        id: "daily-news-summary", // or rename to "portfolio-projections"
        triggers: [
            { event: "app/send.daily.news" },
            { cron: "55 19 * * *" },
        ],
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async ({ step }: { step: any }) => {
        // Step #1: Get all users for delivery
        const users = await step.run("get-all-users", getAllUsersForNewsEmail);

        if (!users || users.length === 0)
            return { success: false, message: "No users found" };

        // Step #2: Ask Gemini for the two required tables
        const newsContent = await step.run("generate-projections", async () => {
            const prompt = `
You are a financial analyst. Answer ONLY with two concise Markdown tables. No other text, disclaimers, or commentary.

1. Portfolio base-case value (0.4 BTC + 172 SOL + 12 MSTR + 20 TSLA + 120 STRK) for 2030, 2035, 2040, 2045.
   - Account for ~2.5% annual inflation.
   - Assume reasonable ongoing DCA / corporate accumulation where relevant (especially for MSTR/STRK).
   - Use a single base-case point estimate per year.
   - Format exactly:

### Portfolio Base-Case Value
| Year | Nominal Value |
|------|---------------|
| 2030 | ...           |
| 2035 | ...           |
| 2040 | ...           |
| 2045 | ...           |

2. Base-case price projections for one share/unit of each asset in 2045 only:
   - BTC
   - SOL
   - MSTR (assume at least 1× mNAV, max 2× mNAV)
   - TSLA
   - STRK (MicroStrategy preferred stock)
   - Format exactly:

### 2045 Individual Price Targets (Base Case)
| Asset | 2045 Price |
|-------|------------|
| BTC   | ...        |
| SOL   | ...        |
| MSTR  | ...        |
| TSLA  | ...        |
| STRK  | ...        |
`.trim();

            const response = await callGemini(prompt);
            const part = response.candidates?.[0]?.content?.parts?.[0];
            return (part && "text" in part ? part.text : null) || "Unable to generate projections.";
        });

        // Step #3: Send the emails
        await step.run("send-projection-emails", async () => {
            await Promise.all(
                (users as UserForNewsEmail[]).map(async (user) => {
                    if (!newsContent) return false;
                    return await sendNewsSummaryEmail({
                        email: user.email,
                        date: getFormattedTodayDate(),
                        newsContent,
                    });
                })
            );
        });

        return {
            success: true,
            message: "Portfolio projection emails sent successfully",
        };
    }
) as any;