import { redirect } from "next/navigation";

export default function TherapeuticsRedirect() {
    redirect("/health/medications");
}
