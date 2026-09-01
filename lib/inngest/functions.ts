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
        id: "daily-portfolio-projections",
        triggers: [
            // 7:58 PM Central Time every day.
            // Automatically follows CST/CDT.
            { cron: "TZ=America/Chicago 26 15 * * *" },
        ],
    },

    async ({ step }) => {
        // ============================================================
        // STEP 1 — GET USERS
        // ============================================================

        const users = await step.run(
            "get-all-users",
            getAllUsersForNewsEmail
        );

        if (!users || users.length === 0) {
            return {
                success: false,
                message: "No users found",
            };
        }

        // ============================================================
        // STEP 2 — GENERATE PROJECTIONS
        // ============================================================

        const projections = await step.run(
            "generate-projections",
            async () => {
                const prompt = `
You are a financial analyst producing a long-term portfolio projection.

Return ONLY valid JSON.
Do NOT use Markdown.
Do NOT use code fences.
Do NOT include commentary or explanations outside the JSON.

IMPORTANT DOLLAR CONVENTION:

All dollar values MUST be expressed in CONSTANT 2026 U.S. DOLLARS.

Assume approximately 2.5% annual inflation and convert all future
nominal values into equivalent 2026 purchasing-power dollars.

The displayed values must therefore represent 2026 dollars,
NOT nominal future dollars.

PORTFOLIO:

- 0.4 BTC
- 172 SOL
- 12 MSTR
- 20 TSLA
- 120 STRK (MicroStrategy preferred stock)

Calculate the BASE-CASE estimated total portfolio value in
constant 2026 dollars for:

2030
2035
2040
2045

Also provide the BASE-CASE estimated 2045 price of one unit/share
of each asset in constant 2026 dollars.

For MSTR:
- Assume approximately 1× to 2× mNAV in the base case.
- Use a reasonable base-case assumption within that range.

For STRK:
- Treat STRK as MicroStrategy's preferred stock.
- Account for its preferred-stock characteristics.
- Do not treat STRK as common MSTR equity.

Use reasonable long-term accumulation/DCA assumptions where relevant,
particularly for MSTR and STRK.

The portfolio values should be internally consistent with the
individual asset assumptions. The total portfolio value in 2045 should neither exceed several millions of dollars nor be below several hundreds of thousdands of dollars.

Return exactly this JSON structure:

{
  "portfolio": [
    {
      "year": 2030,
      "value2026": 0
    },
    {
      "year": 2035,
      "value2026": 0
    },
    {
      "year": 2040,
      "value2026": 0
    },
    {
      "year": 2045,
      "value2026": 0
    }
  ],
  "assets2045": [
    {
      "asset": "BTC",
      "price2026": 0
    },
    {
      "asset": "SOL",
      "price2026": 0
    },
    {
      "asset": "MSTR",
      "price2026": 0
    },
    {
      "asset": "TSLA",
      "price2026": 0
    },
    {
      "asset": "STRK",
      "price2026": 0
    }
  ]
}
`.trim();

                const response = await callGemini(prompt);

                const part =
                    response.candidates?.[0]?.content?.parts?.[0];

                if (
                    !part ||
                    !("text" in part) ||
                    !part.text
                ) {
                    throw new Error(
                        "Gemini returned no projection data."
                    );
                }

                const rawText = part.text
                    .trim()
                    .replace(/^```json\s*/i, "")
                    .replace(/^```\s*/i, "")
                    .replace(/\s*```$/i, "")
                    .trim();

                let parsed;

                try {
                    parsed = JSON.parse(rawText);
                } catch {
                    throw new Error(
                        "Gemini returned invalid JSON."
                    );
                }

                if (
                    !parsed?.portfolio ||
                    !Array.isArray(parsed.portfolio) ||
                    parsed.portfolio.length !== 4 ||
                    !parsed?.assets2045 ||
                    !Array.isArray(parsed.assets2045) ||
                    parsed.assets2045.length !== 5
                ) {
                    throw new Error(
                        "Gemini returned an invalid projection structure."
                    );
                }

                return parsed;
            }
        );

        // ============================================================
        // STEP 3 — BUILD DARK-MODE HTML EMAIL
        // ============================================================

        const formatCurrency = (value: number) => {
            return new Intl.NumberFormat("en-US", {
                style: "currency",
                currency: "USD",
                maximumFractionDigits: 0,
            }).format(value);
        };

        const portfolioRows = projections.portfolio
            .map(
                (row: {
                    year: number;
                    value2026: number;
                }) => `
                    <tr>
                        <td style="
                            padding:14px 16px;
                            color:#ffffff;
                            background-color:#151b23;
                            border-bottom:1px solid #29313d;
                            font-size:14px;
                            font-weight:600;
                        ">
                            ${row.year}
                        </td>

                        <td style="
                            padding:14px 16px;
                            color:#ffffff;
                            background-color:#151b23;
                            border-bottom:1px solid #29313d;
                            font-size:14px;
                            text-align:right;
                            font-weight:600;
                        ">
                            ${formatCurrency(row.value2026)}
                        </td>
                    </tr>
                `
            )
            .join("");

        const assetRows = projections.assets2045
            .map(
                (row: {
                    asset: string;
                    price2026: number;
                }) => `
                    <tr>
                        <td style="
                            padding:14px 16px;
                            color:#ffffff;
                            background-color:#151b23;
                            border-bottom:1px solid #29313d;
                            font-size:14px;
                            font-weight:600;
                        ">
                            ${row.asset}
                        </td>

                        <td style="
                            padding:14px 16px;
                            color:#ffffff;
                            background-color:#151b23;
                            border-bottom:1px solid #29313d;
                            font-size:14px;
                            text-align:right;
                            font-weight:600;
                        ">
                            ${formatCurrency(row.price2026)}
                        </td>
                    </tr>
                `
            )
            .join("");

        const emailHtml = `
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">

    <meta
        name="color-scheme"
        content="dark"
    >

    <meta
        name="supported-color-schemes"
        content="dark"
    >

    <meta
        name="viewport"
        content="width=device-width, initial-scale=1.0"
    >

    <style>
        html,
        body {
            margin: 0 !important;
            padding: 0 !important;
            width: 100% !important;
            background-color: #090d12 !important;
            color: #ffffff !important;
        }

        body {
            background-color: #090d12 !important;
            color: #ffffff !important;
            font-family:
                -apple-system,
                BlinkMacSystemFont,
                "Segoe UI",
                Roboto,
                Helvetica,
                Arial,
                sans-serif;
        }

        table {
            border-collapse: collapse !important;
            border-spacing: 0 !important;
        }

        .email-background {
            background-color: #090d12 !important;
        }

        .email-card {
            background-color: #10161e !important;
        }

        .table-background {
            background-color: #151b23 !important;
        }

        .table-header {
            background-color: #202934 !important;
        }

        .white-text {
            color: #ffffff !important;
        }

        .muted-text {
            color: #9aa6b2 !important;
        }

        @media (prefers-color-scheme: dark) {
            html,
            body {
                background-color: #090d12 !important;
                color: #ffffff !important;
            }

            .email-background {
                background-color: #090d12 !important;
            }

            .email-card {
                background-color: #10161e !important;
            }

            .table-background {
                background-color: #151b23 !important;
            }

            .table-header {
                background-color: #202934 !important;
            }

            .white-text {
                color: #ffffff !important;
            }

            .muted-text {
                color: #9aa6b2 !important;
            }
        }
    </style>
</head>

<body
    style="
        margin:0;
        padding:0;
        background-color:#090d12 !important;
        color:#ffffff !important;
    "
>

    <!-- Outer background -->
    <table
        width="100%"
        cellpadding="0"
        cellspacing="0"
        border="0"
        class="email-background"
        style="
            width:100%;
            background-color:#090d12 !important;
        "
    >
        <tr>
            <td
                align="center"
                style="
                    padding:32px 16px;
                    background-color:#090d12 !important;
                "
            >

                <!-- Main card -->
                <table
                    width="680"
                    cellpadding="0"
                    cellspacing="0"
                    border="0"
                    class="email-card"
                    style="
                        width:100%;
                        max-width:680px;
                        background-color:#10161e !important;
                        border:1px solid #29313d;
                        border-radius:12px;
                        overflow:hidden;
                    "
                >

                    <!-- HEADER -->
                    <tr>
                        <td
                            style="
                                padding:30px 32px 24px;
                                background-color:#10161e !important;
                                border-bottom:1px solid #29313d;
                            "
                        >

                            <div
                                style="
                                    color:#ffffff !important;
                                    font-size:25px;
                                    line-height:32px;
                                    font-weight:700;
                                "
                            >
                                Portfolio Projections
                            </div>

                            <div
                                style="
                                    margin-top:7px;
                                    color:#9aa6b2 !important;
                                    font-size:14px;
                                    line-height:20px;
                                "
                            >
                                ${getFormattedTodayDate()}
                            </div>

                            <div
                                style="
                                    margin-top:14px;
                                    color:#9aa6b2 !important;
                                    font-size:12px;
                                    line-height:18px;
                                "
                            >
                                All values shown in constant 2026 U.S. dollars.
                            </div>

                        </td>
                    </tr>

                    <!-- CONTENT -->
                    <tr>
                        <td
                            style="
                                padding:30px 32px 36px;
                                background-color:#10161e !important;
                            "
                        >

                            <!-- PORTFOLIO TABLE TITLE -->
                            <div
                                style="
                                    margin-bottom:14px;
                                    color:#ffffff !important;
                                    font-size:18px;
                                    line-height:24px;
                                    font-weight:700;
                                "
                            >
                                Portfolio Base-Case Value
                            </div>

                            <!-- PORTFOLIO TABLE -->
                            <table
                                width="100%"
                                cellpadding="0"
                                cellspacing="0"
                                border="0"
                                style="
                                    width:100%;
                                    border:1px solid #29313d;
                                    background-color:#151b23 !important;
                                "
                            >

                                <tr>
                                    <th
                                        style="
                                            padding:14px 16px;
                                            color:#ffffff !important;
                                            background-color:#202934 !important;
                                            border-bottom:1px solid #29313d;
                                            font-size:13px;
                                            font-weight:700;
                                            text-align:left;
                                        "
                                    >
                                        Year
                                    </th>

                                    <th
                                        style="
                                            padding:14px 16px;
                                            color:#ffffff !important;
                                            background-color:#202934 !important;
                                            border-bottom:1px solid #29313d;
                                            font-size:13px;
                                            font-weight:700;
                                            text-align:right;
                                        "
                                    >
                                        Portfolio Value (2026 $)
                                    </th>
                                </tr>

                                ${portfolioRows}

                            </table>


                            <!-- SPACER -->
                            <div style="height:34px;line-height:34px;">
                                &nbsp;
                            </div>


                            <!-- ASSET TABLE TITLE -->
                            <div
                                style="
                                    margin-bottom:14px;
                                    color:#ffffff !important;
                                    font-size:18px;
                                    line-height:24px;
                                    font-weight:700;
                                "
                            >
                                2045 Individual Price Targets
                            </div>

                            <!-- ASSET TABLE -->
                            <table
                                width="100%"
                                cellpadding="0"
                                cellspacing="0"
                                border="0"
                                style="
                                    width:100%;
                                    border:1px solid #29313d;
                                    background-color:#151b23 !important;
                                "
                            >

                                <tr>
                                    <th
                                        style="
                                            padding:14px 16px;
                                            color:#ffffff !important;
                                            background-color:#202934 !important;
                                            border-bottom:1px solid #29313d;
                                            font-size:13px;
                                            font-weight:700;
                                            text-align:left;
                                        "
                                    >
                                        Asset
                                    </th>

                                    <th
                                        style="
                                            padding:14px 16px;
                                            color:#ffffff !important;
                                            background-color:#202934 !important;
                                            border-bottom:1px solid #29313d;
                                            font-size:13px;
                                            font-weight:700;
                                            text-align:right;
                                        "
                                    >
                                        2045 Price (2026 $)
                                    </th>
                                </tr>

                                ${assetRows}

                            </table>

                        </td>
                    </tr>


                    <!-- FOOTER -->
                    <tr>
                        <td
                            style="
                                padding:20px 32px 26px;
                                background-color:#0d1218 !important;
                                border-top:1px solid #29313d;
                            "
                        >

                            <div
                                style="
                                    color:#7f8b98 !important;
                                    font-size:11px;
                                    line-height:17px;
                                "
                            >
                                These are base-case estimates, not guarantees
                                of future performance. Values are presented
                                in constant 2026 dollars.
                            </div>

                        </td>
                    </tr>

                </table>

            </td>
        </tr>
    </table>

</body>
</html>
`;

        // ============================================================
        // STEP 4 — SEND EMAILS
        // ============================================================

        for (const user of users as UserForNewsEmail[]) {
            await step.run(
                `send-projection-email-${user.email}`,
                async () => {
                    return await sendNewsSummaryEmail({
                        email: user.email,
                        date: getFormattedTodayDate(),
                        newsContent: emailHtml,
                    });
                }
            );
        }

        return {
            success: true,
            message: `Portfolio projection emails sent successfully to ${users.length} users`,
        };
    }
);