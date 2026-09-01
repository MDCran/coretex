// Stable, high-contrast colors for distinguishing peptides across the calendar,
// charts and legends. Applied via inline styles (Tailwind can't see dynamic values).
export const PEPTIDE_COLORS = [
    "#2dd4bf", // teal
    "#a78bfa", // violet
    "#fbbf24", // amber
    "#fb7185", // rose
    "#38bdf8", // sky
    "#a3e635", // lime
    "#f472b6", // pink
    "#34d399", // emerald
];

export function peptideColor(index: number): string {
    return PEPTIDE_COLORS[index % PEPTIDE_COLORS.length];
}
