import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "@/components/app-shell/toaster";
import { RouteProvider } from "@/providers/router-provider";
import { Theme } from "@/providers/theme";
import { themeInitScript } from "@/lib/theme-init-script";
import "@/styles/globals.css";
import { cx } from "@/utils/cx";

const inter = Inter({
    subsets: ["latin"],
    display: "swap",
    variable: "--font-inter",
});

export const metadata: Metadata = {
    title: "LifeOS",
    description: "Your whole life, one operating system.",
    icons: {
        icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
        apple: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    },
};

export const viewport: Viewport = {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    themeColor: "#ef4242",
    colorScheme: "light dark",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en" suppressHydrationWarning>
            <head>
                {/*
                 * Pre-hydration theme/accent/density bootstrap — inline in <head> so it runs
                 * before first paint (no flash) and stays put through hydration. Not
                 * next/script `beforeInteractive` (trips React 19's "script tag while
                 * rendering" dev error overlay) and not a body-level <script src> (React 19
                 * hoists it out of <body>, breaking hydration). See lib/theme-init-script.
                 */}
                <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
            </head>
            <body className={cx(inter.variable, "bg-primary antialiased")}>
                <RouteProvider>
                    <Theme>
                        {children}
                        <Toaster />
                    </Theme>
                </RouteProvider>
            </body>
        </html>
    );
}
