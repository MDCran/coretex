import { redirect } from "next/navigation";

export default async function PeptideDetailRedirect({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    redirect(`/health/peptides/${id}`);
}
