import TradingViewWidget from "@/components/TradingViewWidget";
import WatchlistButton from "@/components/WatchlistButton";
import {
    SYMBOL_INFO_WIDGET_CONFIG,
    CANDLE_CHART_WIDGET_CONFIG,
    BASELINE_WIDGET_CONFIG,
    TECHNICAL_ANALYSIS_WIDGET_CONFIG,
    COMPANY_PROFILE_WIDGET_CONFIG,
    COMPANY_FINANCIALS_WIDGET_CONFIG,
} from "@/lib/constants";
import { auth } from "@/lib/better-auth/auth";
import { headers } from "next/headers";
import { getWatchlistSymbolsByEmail } from "@/lib/actions/watchlist.actions";

// small helper (you can also put this in finnhub.actions.ts)
async function getCompanyName(symbol: string): Promise<string> {
    const token =
        process.env.FINNHUB_API_KEY ?? process.env.NEXT_PUBLIC_FINNHUB_API_KEY ?? "";
    if (!token) return symbol.toUpperCase();

    try {
        const res = await fetch(
            `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(
                symbol
            )}&token=${token}`,
            { next: { revalidate: 3600 } }
        );
        if (!res.ok) return symbol.toUpperCase();
        const data = await res.json();
        return data?.name || symbol.toUpperCase();
    } catch {
        return symbol.toUpperCase();
    }
}

export default async function StockDetails({ params }: StockDetailsPageProps) {
    const { symbol } = await params;
    const scriptUrl = `https://s3.tradingview.com/external-embedding/embed-widget-`;

    const session = await auth.api.getSession({ headers: await headers() });
    const email = session?.user?.email ?? "";

    const watchlistSymbols = email
        ? await getWatchlistSymbolsByEmail(email)
        : [];

    const isInWatchlist = watchlistSymbols.includes(symbol.toUpperCase());

    // Get the real company name
    const companyName = await getCompanyName(symbol);

    return (
        <div className="flex min-h-screen p-4 md:p-6 lg:p-8">
            <section className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full">
                {/* Left column */}
                <div className="flex flex-col gap-6">
                    <TradingViewWidget
                        scriptUrl={`${scriptUrl}symbol-info.js`}
                        config={SYMBOL_INFO_WIDGET_CONFIG(symbol)}
                        height={170}
                    />

                    <TradingViewWidget
                        scriptUrl={`${scriptUrl}advanced-chart.js`}
                        config={BASELINE_WIDGET_CONFIG(symbol)}
                        className="custom-chart"
                        height={600}
                    />

                    <TradingViewWidget
                        scriptUrl={`${scriptUrl}advanced-chart.js`}
                        config={CANDLE_CHART_WIDGET_CONFIG(symbol)}
                        className="custom-chart"
                        height={600}
                    />
                </div>

                {/* Right column */}
                <div className="flex flex-col gap-6">
                    <div className="flex items-center justify-between">
                        <WatchlistButton
                            symbol={symbol.toUpperCase()}
                            company={companyName}          // ← real name now
                            isInWatchlist={isInWatchlist}
                            showTrashIcon
                        />
                    </div>

                    <TradingViewWidget
                        scriptUrl={`${scriptUrl}technical-analysis.js`}
                        config={TECHNICAL_ANALYSIS_WIDGET_CONFIG(symbol)}
                        height={400}
                    />

                    <TradingViewWidget
                        scriptUrl={`${scriptUrl}company-profile.js`}
                        config={COMPANY_PROFILE_WIDGET_CONFIG(symbol)}
                        height={440}
                    />

                    <TradingViewWidget
                        scriptUrl={`${scriptUrl}financials.js`}
                        config={COMPANY_FINANCIALS_WIDGET_CONFIG(symbol)}
                        height={464}
                    />
                </div>
            </section>
        </div>
    );
}