import { prisma } from "../db/prisma.js";

export async function handleWorkoutsCommand(cmd: any): Promise<unknown> {
    if (cmd.type === "workouts:callDb") {
        const { model, operation, args } = cmd;
        return await (prisma as any)[model][operation](args);
    }
    throw new Error(`Unhandled Workouts command: ${cmd.type}`);
}
