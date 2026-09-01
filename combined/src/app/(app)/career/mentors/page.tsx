import { redirect } from "next/navigation";

// The Mentors section was removed from the career module. Server actions + data are
// retained; this route now redirects back to the career overview.
export default function CareerMentorsPage() {
    redirect("/career");
}
