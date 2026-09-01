// @ts-nocheck
import type { WebCommand } from "../types.js";
import * as habits from "./health-actions/health-habits.js";
import * as journal from "./health-actions/health-journal.js";
import * as medical from "./health-actions/health-medical.js";
import * as metrics from "./health-actions/health-metrics.js";
import * as nutrition from "./health-actions/health-nutrition.js";
import * as photos from "./health-actions/health-photos.js";
import * as sleep from "./health-actions/health-sleep.js";
import * as sobriety from "./health-actions/health-sobriety.js";
import * as vitals from "./health-actions/health-vitals.js";
import * as peptides from "./health-actions/peptides.js";
import * as therapeutics from "./health-actions/therapeutics.js";

// @ts-nocheck
export class MockFormData {
    constructor(private obj: any) {
        if (!this.obj) this.obj = {};
    }
    get(key: string) { return this.obj[key]; }
    getAll(key: string) { 
        return Array.isArray(this.obj[key]) ? this.obj[key] : (this.obj[key] != null ? [this.obj[key]] : []);
    }
}

export async function handleHealthCommand(cmd: WebCommand): Promise<unknown> {
    const fd = cmd.data ? new MockFormData(cmd.data) : new MockFormData({});
    const payload = cmd.data || {};
    
    // Server Actions endpoints
    switch (cmd.type) {
        case "health:createHabit": return habits.createHabit(fd as any);
        case "health:updateHabit": return habits.updateHabit(fd as any);
        case "health:deleteHabit": return habits.deleteHabit(fd as any);
        case "health:toggleHabitLog": return habits.toggleHabitLog(fd as any);
        case "health:addHabitMilestone": return habits.addHabitMilestone(fd as any);
        case "health:deleteHabitMilestone": return habits.deleteHabitMilestone(fd as any);

        case "health:upsertJournalEntry": return journal.upsertJournalEntry(fd as any);
        case "health:deleteJournalEntry": return journal.deleteJournalEntry(fd as any);

        case "health:upsertMedicalRecord": return medical.upsertMedicalRecord(fd as any);
        case "health:deleteMedicalRecord": return medical.deleteMedicalRecord(fd as any);
        case "health:upsertProvider": return medical.upsertProvider(fd as any);
        case "health:deleteProvider": return medical.deleteProvider(fd as any);
        case "health:upsertDoctor": return medical.upsertDoctor(fd as any);
        case "health:deleteDoctor": return medical.deleteDoctor(fd as any);

        case "health:createBodyMetric": return metrics.createBodyMetric(fd as any);
        case "health:updateBodyMetric": return metrics.updateBodyMetric(fd as any);
        case "health:deleteBodyMetric": return metrics.deleteBodyMetric(fd as any);
        
        case "health:applyCalculatedGoals": return nutrition.applyCalculatedGoals(fd as any);

        case "health:createProgressPhoto": return photos.createProgressPhoto(fd as any);
        case "health:deleteProgressPhoto": return photos.deleteProgressPhoto(fd as any);

        case "health:upsertSleepEntry": return sleep.upsertSleepEntry(fd as any);
        case "health:deleteSleepEntry": return sleep.deleteSleepEntry(fd as any);

        case "health:createSobrietyCounter": return sobriety.createSobrietyCounter(fd as any);
        case "health:updateSobrietyCounter": return sobriety.updateSobrietyCounter(fd as any);
        case "health:deleteSobrietyCounter": return sobriety.deleteSobrietyCounter(fd as any);
        case "health:logSubstance": return sobriety.logSubstance(fd as any);
        case "health:deleteSubstanceLog": return sobriety.deleteSubstanceLog(fd as any);
        case "health:createCustomSubstance": return sobriety.createCustomSubstance(fd as any);
        
        case "health:createVital": return vitals.createVital(fd as any);
        case "health:updateVital": return vitals.updateVital(fd as any);
        case "health:deleteVital": return vitals.deleteVital(fd as any);

        case "health:listPeptides": return peptides.listPeptides(fd as any);
        case "health:getPeptide": return peptides.getPeptide(payload.id);
        
        case "health:getAdherence": return therapeutics.getAdherence(payload.since, payload.until);
        case "health:materializeUpcomingDoses": return therapeutics.materializeUpcomingDoses(payload.userId);
        
        case "health:getPageData": 
            return getPageData(payload.page, cmd.userId || "user_core");

        default:
            throw new Error(`Unhandled health command: ${(cmd as any).type}`);
    }
}

// @ts-nocheck
import { prisma } from "../db/prisma.js";

async function getPageData(page: string, userId: string) {
    const today = new Date();
    const todayDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    
    switch (page) {
        case "overview": {
            const [latestWeight, weightHistory, lastSleep, sleepHistory, water, profile, goal, todayDay, habitsList, sobrietyCounters, settings] = await Promise.all([
                prisma.bodyMetric.findFirst({ where: { userId, metricType: "weight" }, orderBy: { measuredAt: "desc" } }),
                prisma.bodyMetric.findMany({ where: { userId, metricType: "weight" }, orderBy: { measuredAt: "asc" }, take: 60 }),
                prisma.sleepEntry.findFirst({ where: { userId }, orderBy: { date: "desc" } }),
                prisma.sleepEntry.findMany({ where: { userId }, orderBy: { date: "asc" }, take: 30 }),
                prisma.waterLog.findUnique({ where: { userId_date: { userId, date: todayDate } } }),
                prisma.userProfile.findUnique({ where: { userId } }),
                prisma.nutritionGoal.findUnique({ where: { userId } }),
                prisma.nutritionDay.findUnique({ where: { userId_date: { userId, date: todayDate } }, include: { meals: { include: { entries: true } } } }),
                prisma.habit.findMany({ where: { userId, active: true }, include: { logs: { where: { logDate: todayDate } } } }),
                prisma.sobrietyCounter.findMany({ where: { userId, archived: false }, orderBy: { startedAt: "asc" } }),
                prisma.settings.findUnique({ where: { userId } }),
            ]);
            return { latestWeight, weightHistory, lastSleep, sleepHistory, water, profile, goal, todayDay, habits: habitsList, sobrietyCounters, settings };
        }
        case "metrics": {
            const [metricsList, settings, lastMeasurement] = await Promise.all([
                prisma.bodyMetric.findMany({ where: { userId }, orderBy: { measuredAt: "desc" }, take: 500 }),
                prisma.settings.findUnique({ where: { userId } }),
                prisma.bodyMeasurement.findFirst({ where: { userId }, orderBy: { date: "desc" } }),
            ]);
            return { metrics: metricsList, settings, lastMeasurement };
        }
        case "goals": {
            const [data, settings] = await Promise.all([
                nutrition.getGoalCalcData(),
                prisma.settings.findUnique({ where: { userId } }),
            ]);
            return { data, settings };
        }
        case "vitals": {
            const vitalsList = await prisma.vitalReading.findMany({ where: { userId }, orderBy: { measuredAt: "desc" }, take: 1000 });
            return { vitals: vitalsList };
        }
        case "sleep": {
            const entries = await prisma.sleepEntry.findMany({ where: { userId }, orderBy: { date: "desc" }, take: 365 });
            return { entries };
        }
        case "habits": {
            const habitsList = await prisma.habit.findMany({ where: { userId }, include: { logs: { orderBy: { logDate: "asc" } }, milestones: { orderBy: { milestoneDate: "asc" } } }, orderBy: { createdAt: "asc" } });
            return { habits: habitsList };
        }
        case "journal": {
            const entries = await prisma.journalEntry.findMany({ where: { userId }, orderBy: { date: "desc" }, take: 100 });
            return { entries };
        }
        case "medical": {
            const [records, providers, doctors] = await Promise.all([
                prisma.medicalRecord.findMany({ where: { userId }, orderBy: { date: "desc" } }),
                prisma.provider.findMany({ where: { userId, archived: false }, orderBy: { name: "asc" } }),
                prisma.doctor.findMany({ where: { userId, archived: false }, orderBy: { name: "asc" } }),
            ]);
            return { records, providers, doctors };
        }
        case "photos": {
            const [photosList, settings] = await Promise.all([
                prisma.progressPhoto.findMany({ where: { userId }, orderBy: { date: "desc" }, take: 100 }),
                prisma.settings.findUnique({ where: { userId } }),
            ]);
            return { photos: photosList, settings };
        }
        case "sobriety": {
            const [counters, logs, customTypes] = await Promise.all([
                prisma.sobrietyCounter.findMany({ where: { userId, archived: false }, orderBy: { startedAt: "asc" } }),
                prisma.substanceLog.findMany({ where: { userId }, orderBy: { loggedAt: "desc" }, take: 500 }),
                prisma.customSubstanceType.findMany({ where: { userId }, orderBy: { name: "asc" } }),
            ]);
            return { counters, logs, customTypes };
        }
        case "medications": {
            const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            const [meds, supps, schedules, past, upcoming, logs] = await Promise.all([
                prisma.medication.findMany({ where: { userId }, orderBy: [{ active: "desc" }, { name: "asc" }] }),
                prisma.supplement.findMany({ where: { userId }, orderBy: [{ active: "desc" }, { name: "asc" }] }),
                prisma.therapeuticSchedule.findMany({ where: { userId, archived: false }, orderBy: { createdAt: "desc" } }),
                prisma.therapeuticDose.findMany({ where: { schedule: { userId }, scheduledFor: { lt: new Date() } }, orderBy: { scheduledFor: "desc" }, take: 100, include: { schedule: true } }),
                prisma.therapeuticDose.findMany({ where: { schedule: { userId }, scheduledFor: { gte: new Date() } }, orderBy: { scheduledFor: "asc" }, take: 100, include: { schedule: true } }),
                prisma.therapeuticLog.findMany({ where: { userId, loggedAt: { gte: since30 } }, orderBy: { loggedAt: "desc" } }),
            ]);
            return { meds, supps, schedules, past, upcoming, logs };
        }
        case "peptides": {
            const [settings] = await Promise.all([ prisma.settings.findUnique({ where: { userId }, select: { unitSystem: true } }) ]);
            return { settings };
        }
        default:
            return {};
    }
}

