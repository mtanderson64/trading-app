"use client";

import React, { useMemo, useState, useTransition, useEffect } from "react";
import { addToWatchlist, removeFromWatchlist } from "@/lib/actions/watchlist.actions";

type WatchlistButtonProps = {
    symbol: string;
    company: string;
    isInWatchlist: boolean;
    showTrashIcon?: boolean;
    type?: "button" | "icon";
    compact?: boolean;                 // ← new
    onWatchlistChange?: (symbol: string, isAdded: boolean) => void;
};

const WatchlistButton = ({
                             symbol,
                             company,
                             isInWatchlist,
                             showTrashIcon = false,
                             type = "button",
                             compact = false,
                             onWatchlistChange,
                         }: WatchlistButtonProps) => {
    const [added, setAdded] = useState<boolean>(!!isInWatchlist);
    const [isPending, startTransition] = useTransition();

    useEffect(() => {
        setAdded(!!isInWatchlist);
    }, [isInWatchlist, symbol]);

    const label = useMemo(() => {
        if (type === "icon") return "";
        if (compact) {
            return added ? "Remove" : "Add";
        }
        return added ? "Remove from Watchlist" : "Add to Watchlist";
    }, [added, type, compact]);

    const handleClick = () => {
        if (isPending) return;

        const next = !added;
        setAdded(next);
        onWatchlistChange?.(symbol, next);

        startTransition(async () => {
            try {
                if (next) {
                    await addToWatchlist(symbol, company);
                } else {
                    await removeFromWatchlist(symbol);
                }
            } catch (error) {
                console.error("Watchlist update failed:", error);
                setAdded(!next);
                onWatchlistChange?.(symbol, !next);
            }
        });
    };

    if (type === "icon") {
        // ... keep your existing icon version unchanged
    }

    return (
        <button
            className={`
              watchlist-btn 
              ${added ? "watchlist-remove" : ""} 
              ${compact ? "watchlist-btn-compact" : ""}
              inline-flex items-center justify-center gap-1.5 px-2
            `}
            onClick={handleClick}
            disabled={isPending}
        >
            {showTrashIcon && added ? (
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.75}
                    stroke="currentColor"
                    className="w-5 h-5 mt-0.5"
                >
                    <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-7 4v6m4-6v6m4-6v6"
                    />
                </svg>
            ) : null}
            <span>{isPending ? "..." : label}</span>
        </button>
    );
};

export default WatchlistButton;