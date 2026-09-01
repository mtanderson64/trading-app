'use server';

import { connectToDatabase } from '@/database/mongoose';
import { Watchlist } from '@/database/models/watchlist.model';
import { auth } from '@/lib/better-auth/auth';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { formatMarketCapValue } from '@/lib/utils';

const FINNHUB_BASE_URL = 'https://finnhub.io/api/v1';
const FINNHUB_TOKEN =
    process.env.FINNHUB_API_KEY ?? process.env.NEXT_PUBLIC_FINNHUB_API_KEY ?? '';

async function fetchJSON<T>(url: string): Promise<T | null> {
    try {
        const res = await fetch(url, {
            next: { revalidate: 300 },
        });
        if (!res.ok) return null;
        return (await res.json()) as T;
    } catch {
        return null;
    }
}

async function getQuote(symbol: string) {
    if (!FINNHUB_TOKEN) return null;
    const url = `${FINNHUB_BASE_URL}/quote?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_TOKEN}`;
    return fetchJSON<{ c: number; dp: number }>(url);
}

async function getProfile(symbol: string) {
    if (!FINNHUB_TOKEN) return null;
    const url = `${FINNHUB_BASE_URL}/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_TOKEN}`;
    return fetchJSON<{ marketCapitalization?: number; name?: string }>(url);
}

async function getBasicFinancials(symbol: string) {
    if (!FINNHUB_TOKEN) return null;
    const url = `${FINNHUB_BASE_URL}/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all&token=${FINNHUB_TOKEN}`;
    return fetchJSON<{
        metric?: {
            peBasicExclExtraTTM?: number;
            peNormalizedAnnual?: number;
        };
    }>(url);
}

export type EnrichedWatchlistItem = {
    userId: string;
    symbol: string;
    company: string;
    addedAt: Date;
    price?: number;
    change?: number;
    marketCap?: string;
    peRatio?: number;
};

/**
 * Returns the current user's watchlist enriched with live price data.
 */
export async function getUserWatchlist(): Promise<EnrichedWatchlistItem[]> {
    try {
        const session = await auth.api.getSession({ headers: await headers() });
        if (!session?.user?.id) return [];

        const userId = session.user.id;

        await connectToDatabase();

        const items = await Watchlist.find({ userId })
            .sort({ addedAt: -1 })
            .lean();

        if (!items.length) return [];

        const enriched = await Promise.all(
            items.map(async (item) => {
                const symbol = String(item.symbol).toUpperCase();

                const [quote, profile, financials] = await Promise.all([
                    getQuote(symbol),
                    getProfile(symbol),
                    getBasicFinancials(symbol),
                ]);

                const price = quote?.c ?? undefined;
                const change = quote?.dp ?? undefined;

                const marketCap =
                    profile?.marketCapitalization != null
                        ? formatMarketCapValue(profile.marketCapitalization * 1_000_000)
                        : undefined;

                const peRatio =
                    financials?.metric?.peBasicExclExtraTTM ??
                    financials?.metric?.peNormalizedAnnual ??
                    undefined;

                return {
                    userId: String(item.userId),
                    symbol,
                    company: item.company,
                    addedAt: item.addedAt,
                    price,
                    change,
                    marketCap,
                    peRatio,
                };
            })
        );

        return enriched;
    } catch (error) {
        console.error('getUserWatchlist error:', error);
        return [];
    }
}

/**
 * Used by the stock details page
 */
export async function getWatchlistSymbolsByEmail(email: string): Promise<string[]> {
    if (!email) return [];

    try {
        const mongoose = await connectToDatabase();
        const db = mongoose.connection.db;
        if (!db) throw new Error('MongoDB connection not found');

        const user = await db.collection('user').findOne<{ _id?: unknown; id?: string; email?: string }>({ email });
        if (!user) return [];

        const userId = (user.id as string) || String(user._id || '');
        if (!userId) return [];

        const items = await Watchlist.find({ userId }, { symbol: 1 }).lean();
        return items.map((i) => String(i.symbol).toUpperCase());
    } catch (err) {
        console.error('getWatchlistSymbolsByEmail error:', err);
        return [];
    }
}

/**
 * Add a stock to the current user's watchlist
 */
export async function addToWatchlist(symbol: string, company: string) {
    try {
        const session = await auth.api.getSession({ headers: await headers() });
        if (!session?.user?.id) {
            throw new Error('Unauthorized');
        }

        const userId = session.user.id;
        const cleanSymbol = symbol.toUpperCase().trim();
        const cleanCompany = company.trim() || cleanSymbol;

        if (!cleanSymbol) {
            throw new Error('Symbol is required');
        }

        await connectToDatabase();

        await Watchlist.findOneAndUpdate(
            { userId, symbol: cleanSymbol },
            {
                userId,
                symbol: cleanSymbol,
                company: cleanCompany,
                addedAt: new Date(),
            },
            { upsert: true, new: true }
        );

        //revalidatePath('/watchlist');
        return { success: true };
    } catch (error) {
        console.error('addToWatchlist error:', error);
        throw error;
    }
}

/**
 * Remove a stock from the current user's watchlist
 */
export async function removeFromWatchlist(symbol: string) {
    try {
        const session = await auth.api.getSession({ headers: await headers() });
        if (!session?.user?.id) {
            throw new Error('Unauthorized');
        }

        const userId = session.user.id;
        const cleanSymbol = symbol.toUpperCase().trim();

        await connectToDatabase();

        await Watchlist.deleteOne({ userId, symbol: cleanSymbol });

        //revalidatePath('/watchlist');
        return { success: true };
    } catch (error) {
        console.error('removeFromWatchlist error:', error);
        throw error;
    }
}