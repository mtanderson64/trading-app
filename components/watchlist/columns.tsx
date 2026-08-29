"use client";

import { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import WatchlistButton from "@/components/WatchlistButton";

export type WatchlistRow = {
    userId: string;
    symbol: string;
    company: string;
    addedAt: Date;
};

export const columns: ColumnDef<WatchlistRow>[] = [
    {
        accessorKey: "company",
        header: "Company",
        cell: ({ row }) => {
            const symbol = row.original.symbol;
            const company = row.original.company;
            return (
                <Link
                    href={`/stocks/${symbol}`}
                    className="text-gray-200 hover:text-yellow-500 transition-colors font-medium"
                >
                    {company}
                </Link>
            );
        },
    },
    {
        accessorKey: "symbol",
        header: "Symbol",
        cell: ({ row }) => (
            <span className="text-gray-400">{row.original.symbol}</span>
        ),
    },
    {
        id: "actions",
        header: () => <div className="text-right">Action</div>,
        cell: ({ row }) => {
            const { symbol, company } = row.original;
            return (
                <div className="flex justify-end">
                    <WatchlistButton
                        symbol={symbol}
                        company={company}
                        isInWatchlist={true}
                        showTrashIcon
                    />
                </div>
            );
        },
    },
];