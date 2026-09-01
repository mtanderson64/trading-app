"use client";

import { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import WatchlistButton from "@/components/WatchlistButton";

export type WatchlistRow = {
    userId: string;
    symbol: string;
    company: string;
    addedAt: Date;
    price?: number;
    change?: number;
    marketCap?: string;
    peRatio?: number;
};

export const columns: ColumnDef<WatchlistRow>[] = [
    {
        id: "star",
        header: "",
        cell: () => (
            <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
        ),
        size: 40,
    },
    {
        accessorKey: "company",
        header: "Company",
        cell: ({ row }) => {
            const { symbol, company } = row.original;
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
            <span className="text-gray-400 font-medium">{row.original.symbol}</span>
        ),
    },
    {
        accessorKey: "price",
        header: "Price",
        cell: ({ row }) => {
            const price = row.original.price;
            return (
                <span className="text-gray-200">
          {price != null ? `$${price.toFixed(2)}` : "—"}
        </span>
            );
        },
    },
    {
        accessorKey: "change",
        header: "Change",
        cell: ({ row }) => {
            const change = row.original.change;
            if (change == null) return <span className="text-gray-500">—</span>;

            const isPositive = change >= 0;
            return (
                <span className={isPositive ? "text-emerald-400" : "text-red-400"}>
          {isPositive ? "+" : ""}
                    {change.toFixed(2)}%
        </span>
            );
        },
    },
    {
        accessorKey: "marketCap",
        header: "Market Cap",
        cell: ({ row }) => (
            <span className="text-gray-300">{row.original.marketCap ?? "—"}</span>
        ),
    },
    {
        accessorKey: "peRatio",
        header: "P/E Ratio",
        cell: ({ row }) => (
            <span className="text-gray-300">
        {row.original.peRatio != null ? row.original.peRatio.toFixed(1) : "—"}
      </span>
        ),
    },
    {
        id: "alert",
        header: "Alert",
        cell: () => (
            <Button
                variant="outline"
                size="sm"
                className="border-amber-700/60 text-amber-500 hover:bg-amber-950/40 hover:text-amber-400"
            >
                Add Alert
            </Button>
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
                        key={symbol}                 // ← important
                        symbol={symbol}
                        company={company}
                        isInWatchlist={true}
                        showTrashIcon
                        compact
                    />
                </div>
            );
        },
    },
];