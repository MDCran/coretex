// @ts-nocheck
import { useCallback, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import type { Block, LogEntry, Peptide } from "@/lib/peptides/types";
const actions = { updatePeptide: async () => {}, addPeptideLog: async () => {}, createPeptide: async () => {} };

export interface PeptidesController {
    peptides: Peptide[];
    isPending: boolean;
    addPeptide: (input?: actions.NewPeptideInput) => Promise<string | undefined>;
    removePeptide: (id: string) => void;
    updatePeptide: (id: string, patch: Partial<Peptide>) => void;
    addBlock: (peptideId: string) => void;
    updateBlock: (peptideId: string, blockId: string, patch: Partial<Block>) => void;
    removeBlock: (peptideId: string, blockId: string) => void;
    duplicateBlock: (peptideId: string, blockId: string) => void;
    resizeBlock: (peptideId: string, blockId: string, delta: number) => void;
    splitBlock: (peptideId: string, blockId: string, week: number) => void;
    addLog: (peptideId: string, entry: Omit<LogEntry, "id">, supply: { activeVialRemainingMl: number; vialsOpened?: number }) => void;
    removeLog: (peptideId: string, logId: string, restoredRemainingMl: number) => void;
    openNewVial: (peptideId: string, vialsOpened: number, activeVialRemainingMl: number) => void;
}

/**
 * Client controller over normalized peptide data. Keeps an optimistic local
 * copy and writes through to the server actions; scalar field edits are debounced.
 */
export function usePeptides(initial: Peptide[]): PeptidesController {
    const [peptides, setPeptides] = useState<Peptide[]>(initial);
    const [isPending, startTransition] = useTransition();

    // Debounced scalar write-through, keyed by peptide id.
    const pending = useRef<Map<string, Partial<Peptide>>>(new Map());
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const flush = useCallback(() => {
        const batch = Array.from(pending.current.entries());
        pending.current.clear();
        startTransition(async () => {
            for (const [id, patch] of batch) {
                await actions.updatePeptide(id, patch);
            }
        });
    }, []);

    const queueSave = useCallback(
        (id: string, patch: Partial<Peptide>) => {
            const merged = { ...(pending.current.get(id) ?? {}), ...patch };
            pending.current.set(id, merged);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(flush, 400);
        },
        [flush],
    );

    const updatePeptide = useCallback(
        (id: string, patch: Partial<Peptide>) => {
            setPeptides((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
            // Only scalar fields go through the debounced saver. Logs are mutated
            // via dedicated actions (addLog/removeLog).
            const { logs, blocks, ...scalars } = patch;
            void logs;
            void blocks;
            if (Object.keys(scalars).length > 0) queueSave(id, scalars);
        },
        [queueSave],
    );

    const addPeptide = useCallback(async (input?: actions.NewPeptideInput) => {
        try {
            const created = await actions.createPeptide(input ?? "New peptide");
            setPeptides((prev) => [...prev, created]);
            return created.id;
        } catch {
            toast.error("Could not create peptide.");
            return undefined;
        }
    }, []);

    const removePeptide = useCallback((id: string) => {
        setPeptides((prev) => prev.filter((p) => p.id !== id));
        startTransition(async () => {
            await actions.deletePeptide(id);
        });
    }, []);

    const mutateLocal = useCallback((id: string, fn: (p: Peptide) => Peptide) => {
        setPeptides((prev) => prev.map((p) => (p.id === id ? fn(p) : p)));
    }, []);

    const addBlock = useCallback(
        (peptideId: string) => {
            const tempId = crypto.randomUUID();
            mutateLocal(peptideId, (p) => ({
                ...p,
                blocks: [...p.blocks, { id: tempId, startWeek: 1, endWeek: 4, dosePerAdmin: 1, dosesPerWeek: 7 }],
            }));
            startTransition(async () => {
                await actions.addBlock(peptideId);
                const fresh = await actions.getPeptide(peptideId);
                if (fresh) mutateLocal(peptideId, () => fresh);
            });
        },
        [mutateLocal],
    );

    const updateBlock = useCallback(
        (peptideId: string, blockId: string, patch: Partial<Block>) => {
            mutateLocal(peptideId, (p) => ({
                ...p,
                blocks: p.blocks.map((b) => (b.id === blockId ? { ...b, ...patch } : b)),
            }));
            queueSaveBlock(peptideId, blockId, patch);
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [mutateLocal],
    );

    // Debounced per-block write-through.
    const blockPending = useRef<Map<string, { peptideId: string; patch: Partial<Block> }>>(new Map());
    const blockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const flushBlocks = useCallback(() => {
        const batch = Array.from(blockPending.current.entries());
        blockPending.current.clear();
        startTransition(async () => {
            for (const [blockId, { peptideId, patch }] of batch) {
                await actions.updateBlock(peptideId, blockId, patch);
            }
        });
    }, []);
    function queueSaveBlock(peptideId: string, blockId: string, patch: Partial<Block>) {
        const existing = blockPending.current.get(blockId);
        blockPending.current.set(blockId, { peptideId, patch: { ...(existing?.patch ?? {}), ...patch } });
        if (blockTimer.current) clearTimeout(blockTimer.current);
        blockTimer.current = setTimeout(flushBlocks, 400);
    }

    const removeBlock = useCallback(
        (peptideId: string, blockId: string) => {
            mutateLocal(peptideId, (p) => ({ ...p, blocks: p.blocks.filter((b) => b.id !== blockId) }));
            startTransition(async () => {
                await actions.removeBlock(peptideId, blockId);
            });
        },
        [mutateLocal],
    );

    const duplicateBlock = useCallback(
        (peptideId: string, blockId: string) => {
            startTransition(async () => {
                await actions.duplicateBlock(peptideId, blockId);
                const fresh = await actions.getPeptide(peptideId);
                if (fresh) mutateLocal(peptideId, () => fresh);
            });
        },
        [mutateLocal],
    );

    const resizeBlock = useCallback(
        (peptideId: string, blockId: string, delta: number) => {
            mutateLocal(peptideId, (p) => ({
                ...p,
                blocks: p.blocks.map((b) => (b.id === blockId ? { ...b, endWeek: Math.max(b.startWeek, b.endWeek + delta) } : b)),
            }));
            startTransition(async () => {
                await actions.resizeBlock(peptideId, blockId, delta);
                const fresh = await actions.getPeptide(peptideId);
                if (fresh) mutateLocal(peptideId, () => fresh);
            });
        },
        [mutateLocal],
    );

    const splitBlock = useCallback(
        (peptideId: string, blockId: string, week: number) => {
            startTransition(async () => {
                await actions.splitBlock(peptideId, blockId, week);
                const fresh = await actions.getPeptide(peptideId);
                if (fresh) mutateLocal(peptideId, () => fresh);
            });
        },
        [mutateLocal],
    );

    const addLog = useCallback(
        (peptideId: string, entry: Omit<LogEntry, "id">, supply: { activeVialRemainingMl: number; vialsOpened?: number }) => {
            const tempId = crypto.randomUUID();
            mutateLocal(peptideId, (p) => ({
                ...p,
                logs: [...p.logs, { ...entry, id: tempId }],
                activeVialRemainingMl: supply.activeVialRemainingMl,
                ...(supply.vialsOpened !== undefined && { vialsOpened: supply.vialsOpened }),
            }));
            startTransition(async () => {
                await actions.addLog(peptideId, entry, supply);
                const fresh = await actions.getPeptide(peptideId);
                if (fresh) mutateLocal(peptideId, () => fresh);
            });
        },
        [mutateLocal],
    );

    const removeLog = useCallback(
        (peptideId: string, logId: string, restoredRemainingMl: number) => {
            mutateLocal(peptideId, (p) => ({
                ...p,
                logs: p.logs.filter((l) => l.id !== logId),
                activeVialRemainingMl: restoredRemainingMl,
            }));
            startTransition(async () => {
                await actions.removeLog(peptideId, logId, restoredRemainingMl);
            });
        },
        [mutateLocal],
    );

    const openNewVial = useCallback(
        (peptideId: string, vialsOpened: number, activeVialRemainingMl: number) => {
            mutateLocal(peptideId, (p) => ({ ...p, vialsOpened, activeVialRemainingMl }));
            startTransition(async () => {
                await actions.openNewVial(peptideId, vialsOpened, activeVialRemainingMl);
            });
        },
        [mutateLocal],
    );

    return {
        peptides,
        isPending,
        addPeptide,
        removePeptide,
        updatePeptide,
        addBlock,
        updateBlock,
        removeBlock,
        duplicateBlock,
        resizeBlock,
        splitBlock,
        addLog,
        removeLog,
        openNewVial,
    };
}
