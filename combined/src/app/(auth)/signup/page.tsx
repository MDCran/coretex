import { redirect } from "next/navigation";
import { SignupForm } from "@/components/auth/signup-form";
import { getCurrentUser } from "@/lib/auth";

export const metadata = { title: "Sign up — LifeOS" };

export default async function SignupPage() {
    const user = await getCurrentUser();
    if (user) redirect("/dashboard");
    return <SignupForm />;
}
