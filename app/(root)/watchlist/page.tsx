import { getUserWatchlist } from "@/lib/actions/watchlist.actions";
import { columns } from "@/components/watchlist/columns";
import { DataTable } from "@/components/watchlist/data-table";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default async function WatchlistPage() {
    const watchlist = await getUserWatchlist(); // already enriched

    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-semibold text-gray-100">Watchlist</h1>

                <Button
                    asChild
                    className="bg-yellow-500 hover:bg-yellow-400 text-black font-medium"
                >
                    <Link href="/search">Add Stock</Link>
                </Button>
            </div>

            {watchlist.length === 0 ? (
                <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-10 text-center">
                    <p className="text-gray-300 mb-2">Your watchlist is empty</p>
                    <p className="text-sm text-gray-500 mb-4">
                        Search for stocks and add them from a stock’s page.
                    </p>
                    <Link
                        href="/"
                        className="text-yellow-500 hover:text-yellow-400 text-sm font-medium"
                    >
                        Go to Dashboard →
                    </Link>
                </div>
            ) : (
                <DataTable columns={columns} data={watchlist} />
            )}
        </div>
    );
}