"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Mic } from "lucide-react";

import { ModeToggle } from "./mode-toggle";

export default function Header() {
  const pathname = usePathname();

  const links = [
    { to: "/", label: "Home" },
    { to: "/recorder", label: "Recorder" },
  ] as const;

  return (
    <header className="border-b border-border/50 bg-card/80 backdrop-blur-sm">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-2.5">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2 transition-opacity hover:opacity-80">
            <div className="flex size-7 items-center justify-center rounded-lg bg-primary">
              <Mic className="size-3.5 text-primary-foreground" />
            </div>
            <span className="text-sm font-semibold tracking-tight">VoxScribe</span>
          </Link>
          <nav className="flex items-center gap-1">
            {links.map(({ to, label }) => {
              const isActive = pathname === to;
              return (
                <Link
                  key={to}
                  href={to}
                  className={`rounded-md px-3 py-1.5 text-sm transition-colors ${isActive
                      ? "bg-accent font-medium text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                    }`}
                >
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>
        <ModeToggle />
      </div>
    </header>
  );
}
