// @ts-nocheck
import React from "react";

export function Link({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) {
    // In Coretex, we rely on the parent or window location, but here we just render a simple anchor.
    return (
        <a href="#" className={className} onClick={(e) => {
            e.preventDefault();
            // Just dispatch a custom event for the parent view to catch if needed
            window.dispatchEvent(new CustomEvent("socialNavigate", { detail: href }));
        }}>
            {children}
        </a>
    );
}
