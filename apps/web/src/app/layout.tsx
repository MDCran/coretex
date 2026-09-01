import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { RouteProvider } from "@/providers/router-provider";
import "@/styles/globals.css";
import { cx } from "@/utils/cx";

const inter = Inter({
    subsets: ["latin"],
    display: "swap",
    variable: "--font-inter",
});

export const metadata: Metadata = {
    title: "Coretex",
    description: "Coretex — local multi-agent AI orchestration",
    icons: { icon: "/coretex-icon.svg" },
};

export const viewport: Viewport = {
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
                <script
                    dangerouslySetInnerHTML={{
                        __html: `(function(){try{var r=document.documentElement;var m=localStorage.getItem('coretex-theme')||'dark';var d=m==='system'?window.matchMedia('(prefers-color-scheme: dark)').matches:m==='dark';r.setAttribute('data-theme',d?'dark':'light');r.classList.toggle('dark-mode',d);r.style.colorScheme=d?'dark':'light';var a=localStorage.getItem('coretex-accent');if(a&&/^#?[0-9a-f]{6}$/i.test(a)){var hex=a[0]==='#'?a:'#'+a;r.style.setProperty('--brand',hex);}var s=localStorage.getItem('coretex-scheme');if(s){var p=JSON.parse(s);if(p&&p.background&&p.foreground){r.style.setProperty('--app-bg',p.background);r.style.setProperty('--c-text-primary',p.foreground);}}}catch(e){var r2=document.documentElement;r2.setAttribute('data-theme','dark');r2.classList.add('dark-mode');r2.style.colorScheme='dark';}})();`,
                    }}
                />
            </head>
            <body className={cx(inter.variable, "bg-primary antialiased")}>
                <RouteProvider>{children}</RouteProvider>
            </body>
        </html>
    );
}
