'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { connectToDatabase } from '@/database/mongoose';
import { Watchlist } from '@/database/models/watchlist.model';
import { auth } from '@/lib/better-auth/auth';

export async function getWatchlistSymbolsByEmail(email: string): Promise<string[]> {
    if (!email) return [];

    try {
        const mongoose = await connectToDatabase();
        const db = mongoose.connection.db;
        if (!db) throw new Error('MongoDB connection not found');

        // Better Auth stores users in the "user" collection
        const user = await db.collection('user').findOne<{ _id?: unknown; id?: string; email?: string }>({ email });

        if (!user) return [];

        const userId = (user.id as string) || String(user._id || '');
        if (!userId) return [];

        const items = await Watchlist.find({ userId }, { symbol: 1 }).lean();
        return items.map((i) => String(i.symbol));
    } catch (err) {
        console.error('getWatchlistSymbolsByEmail error:', err);
        return [];
    }
}

export async function addToWatchlist(symbol: string, company: string) {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) throw new Error('Unauthorized');

    await connectToDatabase();

    await Watchlist.findOneAndUpdate(
        { userId: session.user.id, symbol: symbol.toUpperCase() },
        {
            userId: session.user.id,
            symbol: symbol.toUpperCase(),
            company: company.trim(),
            addedAt: new Date(),
        },
        { upsert: true, new: true }
    );

    //revalidatePath('/watchlist');
    //revalidatePath(`/stocks/${symbol}`);
}

export async function removeFromWatchlist(symbol: string) {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) throw new Error('Unauthorized');

    await connectToDatabase();

    await Watchlist.deleteOne({
        userId: session.user.id,
        symbol: symbol.toUpperCase(),
    });

    //revalidatePath('/watchlist');
    //revalidatePath(`/stocks/${symbol}`);
}

export async function getUserWatchlist() {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) return [];

    await connectToDatabase();

    const items = await Watchlist.find({ userId: session.user.id })
        .sort({ addedAt: -1 })
        .lean();

    return items.map((item) => ({
        userId: item.userId,
        symbol: item.symbol,
        company: item.company,
        addedAt: item.addedAt,
    }));
}