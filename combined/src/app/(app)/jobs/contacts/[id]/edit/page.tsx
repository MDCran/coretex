import { redirect } from "next/navigation";

export default async function RedirectByIdEdit({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    redirect(`/career/contacts/${id}/edit`);
}
