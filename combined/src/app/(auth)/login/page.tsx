import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { getCurrentUser } from "@/lib/auth";
import { safeNextPath } from "@/lib/safe-next-path";

export const metadata = { title: "Sign in — LifeOS" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
    const { next } = await searchParams;
    const destination = safeNextPath(next);
    const user = await getCurrentUser();
    if (user) redirect(destination);
    return <LoginForm next={destination} />;
}
