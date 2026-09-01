import { redirect } from "next/navigation";

/** Tags moved onto the contacts page ("Manage tags"). Redirect any old links. */
export default function TagsPage() {
    redirect("/social/contacts");
}
