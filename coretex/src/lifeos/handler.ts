import type { WebCommand } from "../types.js";
import { prisma } from "../db/prisma.js";
import * as financial from "./financial.js";
import * as social from "./social.js";
import * as socialCanvas from "./social-canvas.js";
import * as workouts from "./workouts.js";
import * as health from "./health.js";
import * as healthOperations from "./health-operations.js";
import * as nutrition from "./nutrition.js";
import * as nutritionLibrary from "./nutrition-library.js";
import * as tasks from "./tasks.js";
import { getPersonalCalendar } from "./personal-calendar.js";
import { getUnifiedCalendarContext } from "./calendar.js";

type LifeOSCommand = {
    type: string;
    userId?: string;
    payload?: Record<string, unknown>;
    data?: Record<string, unknown>;
};

/**
 * Coretex is a single-user desktop app. Prefer an explicitly selected user,
 * otherwise use the oldest LifeOS account in the local database. A fresh
 * install gets a local account on first use so every personal module has a
 * valid foreign-key owner.
 */
async function resolveLocalUserId(requested?: string): Promise<string> {
    if (requested) {
        const match = await prisma.user.findUnique({ where: { id: requested }, select: { id: true } });
        if (match) return match.id;
    }

    const existing = await prisma.user.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
    if (existing) return existing.id;

    try {
        const created = await prisma.user.create({
            data: {
                id: "user_core",
                email: "local@coretex.app",
                name: "Local workspace",
                // Desktop-local accounts never authenticate over HTTP, but the
                // shared schema keeps this field required for the former web app.
                passwordHash: "desktop-local-account",
            },
            select: { id: true },
        });
        return created.id;
    } catch {
        // Another request may have created the first-run account concurrently.
        const createdByPeer = await prisma.user.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
        if (createdByPeer) return createdByPeer.id;
        throw new Error("Unable to initialize the local LifeOS account.");
    }
}

/** Route Electron/Vite requests to the correct namespaced LifeOS service. */
export async function handleLifeOSCommand(command: WebCommand): Promise<unknown> {
    const cmd = command as unknown as LifeOSCommand;
    const userId = await resolveLocalUserId(cmd.userId);

    switch (cmd.type) {
        case "financial:getAccounts": return financial.getAccounts(userId);
        case "financial:getAlerts": return financial.getAlerts(userId);
        case "financial:getBudget": return financial.getBudget(userId);
        case "financial:getCalendar": return financial.getCalendar(userId);
        case "financial:getCards": return financial.getCards(userId);
        case "financial:getCredit": return financial.getCredit(userId);
        case "financial:getCurrencies": return financial.getCurrencies(userId);
        case "financial:getDebt": return financial.getDebt(userId);
        case "financial:getDeductions": return financial.getDeductions(userId, cmd.payload);
        case "financial:getForecast": return financial.getForecast(userId);
        case "financial:getGoals": return financial.getGoals(userId);
        case "financial:getHealth": return financial.getHealth(userId);
        case "financial:getImportStatus": return financial.getImportStatus(userId);
        case "financial:getIncome": return financial.getIncome(userId);
        case "financial:getInstitutions": return financial.getInstitutions(userId);
        case "financial:getNetWorth": return financial.getNetWorth(userId);
        case "financial:getOverview": return financial.getOverview(userId);
        case "financial:getPaycheck": return financial.getPaycheck(userId);
        case "financial:getReports": return financial.getReports(userId);
        case "financial:getStatements": return financial.getStatements(userId);
        case "financial:getSubscriptions": return financial.getSubscriptions(userId);
        case "financial:getTax": return financial.getTax(userId);
        case "financial:getTransactions": return financial.getTransactions(userId, cmd.payload);
        case "calendar:getPersonalContext": return getPersonalCalendar(userId, cmd.payload);
        case "calendar:getUnifiedContext": return getUnifiedCalendarContext(userId, cmd.payload);
        case "financial:createAccount": return financial.createAccount(userId, cmd.payload);
        case "financial:updateAccount": return financial.updateAccount(userId, cmd.payload);
        case "financial:deleteAccount": return financial.deleteAccount(userId, cmd.payload);
        case "financial:createTransaction": return financial.createTransaction(userId, cmd.payload);
        case "financial:updateTransaction": return financial.updateTransaction(userId, cmd.payload);
        case "financial:deleteTransaction": return financial.deleteTransaction(userId, cmd.payload);
        case "financial:importTransactions": return financial.importTransactions(userId, cmd.payload);
        case "financial:createBudgetCategory": return financial.createBudgetCategory(userId, cmd.payload);
        case "financial:updateBudgetCategory": return financial.updateBudgetCategory(userId, cmd.payload);
        case "financial:deleteBudgetCategory": return financial.deleteBudgetCategory(userId, cmd.payload);
        case "financial:setGenericBudgetTotal": return financial.setGenericBudgetTotal(userId, cmd.payload);
        case "financial:createSubscription": return financial.createSubscription(userId, cmd.payload);
        case "financial:updateSubscription": return financial.updateSubscription(userId, cmd.payload);
        case "financial:deleteSubscription": return financial.deleteSubscription(userId, cmd.payload);
        case "financial:createIncomeStream": return financial.createIncomeStream(userId, cmd.payload);
        case "financial:updateIncomeStream": return financial.updateIncomeStream(userId, cmd.payload);
        case "financial:deleteIncomeStream": return financial.deleteIncomeStream(userId, cmd.payload);
        case "financial:createIncomeEntry": return financial.createIncomeEntry(userId, cmd.payload);
        case "financial:updateIncomeEntry": return financial.updateIncomeEntry(userId, cmd.payload);
        case "financial:deleteIncomeEntry": return financial.deleteIncomeEntry(userId, cmd.payload);
        case "financial:createDebt": return financial.createDebt(userId, cmd.payload);
        case "financial:updateDebt": return financial.updateDebt(userId, cmd.payload);
        case "financial:deleteDebt": return financial.deleteDebt(userId, cmd.payload);
        case "financial:createGoal": return financial.createGoal(userId, cmd.payload);
        case "financial:updateGoal": return financial.updateGoal(userId, cmd.payload);
        case "financial:deleteGoal": return financial.deleteGoal(userId, cmd.payload);
        case "financial:createCard": return financial.createCard(userId, cmd.payload);
        case "financial:updateCard": return financial.updateCard(userId, cmd.payload);
        case "financial:deleteCard": return financial.deleteCard(userId, cmd.payload);
        case "financial:createInstitution": return financial.createInstitution(userId, cmd.payload);
        case "financial:updateInstitution": return financial.updateInstitution(userId, cmd.payload);
        case "financial:deleteInstitution": return financial.deleteInstitution(userId, cmd.payload);
        case "financial:createCreditScore": return financial.createCreditScore(userId, cmd.payload);
        case "financial:updateCreditScore": return financial.updateCreditScore(userId, cmd.payload);
        case "financial:deleteCreditScore": return financial.deleteCreditScore(userId, cmd.payload);
        case "financial:updateStatement": return financial.updateStatement(userId, cmd.payload);
        case "financial:deleteStatement": return financial.deleteStatement(userId, cmd.payload);
        case "financial:createTaxDocument": return financial.createTaxDocument(userId, cmd.payload);
        case "financial:updateTaxDocument": return financial.updateTaxDocument(userId, cmd.payload);
        case "financial:deleteTaxDocument": return financial.deleteTaxDocument(userId, cmd.payload);
        case "financial:setDeductible": return financial.setDeductible(userId, cmd.payload);
        case "financial:importFile": return financial.importFile(userId, cmd.payload);
        case "financial:getFinancialFile": return financial.getFinancialFile(userId, cmd.payload);
        case "financial:attachReceipt": return financial.attachReceipt(userId, cmd.payload);
        case "financial:deleteReceipt": return financial.deleteReceipt(userId, cmd.payload);
        case "financial:reanalyzeStatement": return financial.reanalyzeStatement(userId, cmd.payload);
        case "financial:reanalyzeTaxDocument": return financial.reanalyzeTaxDocument(userId, cmd.payload);
        case "financial:aiCategorizeTransaction": return financial.aiCategorizeTransaction(userId, cmd.payload);
        case "financial:setTransactionCategory": return financial.setTransactionCategory(userId, cmd.payload);
        case "financial:setTransactionSplits": return financial.setTransactionSplits(userId, cmd.payload);
        case "financial:detectSubscriptions": return financial.detectSubscriptions(userId);

        case "social:getCalendar": return social.getCalendar(userId);
        case "social:getCanvas": return socialCanvas.getCanvas(userId);
        case "social:getContactsNew": return social.getContactsNew(userId);
        case "social:getContacts": return social.getContacts(userId);
        case "social:getDrafts": return social.getDrafts(userId);
        case "social:getEvents": return social.getEvents(userId);
        case "social:getOverview": return social.getOverview(userId);
        case "social:getTags": return social.getTags(userId);
        case "social:createContact": return social.createContact(userId, cmd.payload);
        case "social:deleteContact": return social.deleteContact(userId, cmd.payload);
        case "social:createEvent": return social.createEvent(userId, cmd.payload);
        case "social:deleteEvent": return social.deleteEvent(userId, cmd.payload);
        case "social:createDraft": return social.createDraft(userId, cmd.payload);
        case "social:assistDraft": return social.assistDraft(userId, cmd.payload);
        case "social:updateDraft": return social.updateDraft(userId, cmd.payload);
        case "social:deleteDraft": return social.deleteDraft(userId, cmd.payload);
        case "social:logBattery": return social.logBattery(userId, cmd.payload);
        case "social:createTag": return social.createTag(userId, cmd.payload);
        case "social:deleteTag": return social.deleteTag(userId, cmd.payload);
        case "social:logInteraction": return socialCanvas.logInteraction(userId, cmd.payload);
        case "social:ingestCommunication": return socialCanvas.ingestCommunication(userId, cmd.payload);
        case "social:createReminder": return socialCanvas.createReminder(userId, cmd.payload);
        case "social:completeReminder": return socialCanvas.completeReminder(userId, cmd.payload);
        case "social:createGift": return socialCanvas.createGift(userId, cmd.payload);
        case "social:updateGiftStage": return socialCanvas.updateGiftStage(userId, cmd.payload);
        case "social:createMemory": return socialCanvas.createMemory(userId, cmd.payload);
        case "social:draftEventInvites": return socialCanvas.draftEventInvites(userId, cmd.payload);
        case "social:createConnection": return socialCanvas.createConnection(userId, cmd.payload);
        case "social:deleteConnection": return socialCanvas.deleteConnection(userId, cmd.payload);
        case "social:createHandle": return socialCanvas.createHandle(userId, cmd.payload);
        case "social:updateHandle": return socialCanvas.updateHandle(userId, cmd.payload);
        case "social:deleteHandle": return socialCanvas.deleteHandle(userId, cmd.payload);
        case "social:updateContactMeta": return socialCanvas.updateContactMeta(userId, cmd.payload);

        case "workouts:getBody": return workouts.getBody(userId);
        case "workouts:getExercisesNew": return workouts.getExercisesNew(userId);
        case "workouts:getExercises": return workouts.getExercises(userId);
        case "workouts:getLog": return workouts.getLog(userId);
        case "workouts:getOverview": return workouts.getOverview(userId);
        case "workouts:getProgress": return workouts.getProgress(userId);
        case "workouts:getSchedule": return workouts.getSchedule(userId);
        case "workouts:getTemplatesNew": return workouts.getTemplatesNew(userId);
        case "workouts:getTemplates": return workouts.getTemplates(userId);
        case "workouts:createExercise": return workouts.createExercise(userId, cmd.payload as unknown as workouts.CreateExerciseInput);
        case "workouts:updateExercise": return workouts.updateExercise(userId, cmd.payload as unknown as workouts.UpdateExerciseInput);
        case "workouts:deleteExercise": return workouts.deleteExercise(userId, cmd.payload as unknown as workouts.DeleteExerciseInput);
        case "workouts:createTemplate": return workouts.createTemplate(userId, cmd.payload as unknown as workouts.CreateTemplateInput);
        case "workouts:updateTemplate": return workouts.updateTemplate(userId, cmd.payload as unknown as workouts.UpdateTemplateInput);
        case "workouts:deleteTemplate": return workouts.deleteTemplate(userId, cmd.payload as unknown as workouts.DeleteTemplateInput);
        case "workouts:createSchedule": return workouts.createSchedule(userId, cmd.payload as unknown as workouts.CreateScheduleInput);
        case "workouts:updateSchedule": return workouts.updateSchedule(userId, cmd.payload as unknown as workouts.UpdateScheduleInput);
        case "workouts:setScheduleSkipped": return workouts.setScheduleSkipped(userId, cmd.payload as unknown as workouts.SetScheduleSkippedInput);
        case "workouts:startScheduledWorkout": return workouts.startScheduledWorkout(userId, cmd.payload as unknown as workouts.StartScheduledWorkoutInput);
        case "workouts:deleteSchedule": return workouts.deleteSchedule(userId, cmd.payload as unknown as workouts.DeleteScheduleInput);
        case "workouts:logWorkout": return workouts.logWorkout(userId, cmd.payload as unknown as workouts.LogWorkoutInput);
        case "workouts:updateWorkout": return workouts.updateWorkout(userId, cmd.payload as unknown as workouts.UpdateWorkoutInput);
        case "workouts:pauseWorkout": return workouts.pauseWorkout(userId, cmd.payload as unknown as workouts.WorkoutLifecycleInput);
        case "workouts:resumeWorkout": return workouts.resumeWorkout(userId, cmd.payload as unknown as workouts.WorkoutLifecycleInput);
        case "workouts:setWorkoutPaused": return workouts.setWorkoutPaused(userId, cmd.payload as unknown as workouts.SetWorkoutPausedInput);
        case "workouts:finishWorkout": return workouts.finishWorkout(userId, cmd.payload as unknown as workouts.WorkoutLifecycleInput);
        case "workouts:restartWorkout": return workouts.restartWorkout(userId, cmd.payload as unknown as workouts.WorkoutLifecycleInput);
        case "workouts:recomputeRecords": return workouts.recomputePersonalRecords(userId);
        case "workouts:deleteWorkout": return workouts.deleteWorkout(userId, cmd.payload as unknown as workouts.DeleteWorkoutInput);
        case "workouts:addBodyMeasurement": return workouts.addBodyMeasurement(userId, cmd.payload as unknown as workouts.AddBodyMeasurementInput);
        case "workouts:updateBodyMeasurement": return workouts.updateBodyMeasurement(userId, cmd.payload as unknown as workouts.UpdateBodyMeasurementInput);
        case "workouts:deleteBodyMeasurement": return workouts.deleteBodyMeasurement(userId, cmd.payload as unknown as workouts.DeleteBodyMeasurementInput);
        case "workouts:createTrainingCycle": return workouts.createTrainingCycle(userId, cmd.payload as unknown as workouts.CreateTrainingCycleInput);
        case "workouts:updateTrainingCycle": return workouts.updateTrainingCycle(userId, cmd.payload as unknown as workouts.UpdateTrainingCycleInput);
        case "workouts:deleteTrainingCycle": return workouts.deleteTrainingCycle(userId, cmd.payload as unknown as workouts.DeleteTrainingCycleInput);
        case "workouts:uploadProgressPhoto": return workouts.uploadProgressPhoto(userId, cmd.payload as unknown as workouts.UploadProgressPhotoInput);
        case "workouts:updateProgressPhoto": return workouts.updateProgressPhoto(userId, cmd.payload as unknown as workouts.UpdateProgressPhotoInput);
        case "workouts:deleteProgressPhoto": return workouts.deleteProgressPhoto(userId, cmd.payload as unknown as workouts.DeleteProgressPhotoInput);

        case "health:getGoals": return healthOperations.getGoals(userId);
        case "health:getHabits": return healthOperations.getHabits(userId);
        case "health:getJournal": return healthOperations.getJournal(userId);
        case "health:getMedical": return healthOperations.getMedical(userId);
        case "health:getMedications": return healthOperations.getMedications(userId);
        case "health:getMetrics": return healthOperations.getMetrics(userId);
        case "health:getOverview": return healthOperations.getOverview(userId);
        case "health:getPeptides": return healthOperations.getPeptides(userId);
        case "health:getPhotos": return healthOperations.getPhotos(userId);
        case "health:getSleep": return healthOperations.getSleep(userId);
        case "health:getSobriety": return healthOperations.getSobriety(userId);
        case "health:getVitals": return healthOperations.getVitals(userId);
        case "health:saveProvider": return health.saveProvider(userId, cmd.payload);
        case "health:deleteProvider": return health.deleteProvider(userId, cmd.payload);
        case "health:saveDoctor": return health.saveDoctor(userId, cmd.payload);
        case "health:deleteDoctor": return health.deleteDoctor(userId, cmd.payload);
        case "health:saveMedicalRecord": return health.saveMedicalRecord(userId, cmd.payload);
        case "health:deleteMedicalRecord": return health.deleteMedicalRecord(userId, cmd.payload);
        case "health:saveAppointment": return health.saveAppointment(userId, cmd.payload);
        case "health:deleteAppointment": return health.deleteAppointment(userId, cmd.payload);
        case "health:updateGoals": return healthOperations.updateGoals(userId, cmd.payload);
        case "health:createMetric": return healthOperations.createMetric(userId, cmd.payload);
        case "health:updateMetric": return healthOperations.updateMetric(userId, cmd.payload);
        case "health:deleteMetric": return healthOperations.deleteMetric(userId, cmd.payload);
        case "health:setUnitSystem": return health.setUnitSystem(userId, cmd.payload);
        case "health:createVital": return healthOperations.createVital(userId, cmd.payload);
        case "health:updateVital": return healthOperations.updateVital(userId, cmd.payload);
        case "health:deleteVital": return healthOperations.deleteVital(userId, cmd.payload);
        case "health:upsertSleep": return healthOperations.upsertSleep(userId, cmd.payload);
        case "health:deleteSleep": return healthOperations.deleteSleep(userId, cmd.payload);
        case "health:createHabit": return healthOperations.createHabit(userId, cmd.payload);
        case "health:updateHabit": return healthOperations.updateHabit(userId, cmd.payload);
        case "health:deleteHabit": return healthOperations.deleteHabit(userId, cmd.payload);
        case "health:toggleHabit": return healthOperations.toggleHabit(userId, cmd.payload);
        case "health:addHabitMilestone": return healthOperations.addHabitMilestone(userId, cmd.payload);
        case "health:deleteHabitMilestone": return healthOperations.deleteHabitMilestone(userId, cmd.payload);
        case "health:upsertJournal": return healthOperations.upsertJournal(userId, cmd.payload);
        case "health:deleteJournal": return healthOperations.deleteJournal(userId, cmd.payload);
        case "health:createProgressPhoto": return healthOperations.createProgressPhoto(userId, cmd.payload);
        case "health:updateProgressPhoto": return healthOperations.updateProgressPhoto(userId, cmd.payload);
        case "health:deleteProgressPhoto": return healthOperations.deleteProgressPhoto(userId, cmd.payload);
        case "health:saveMedication": return healthOperations.saveMedication(userId, cmd.payload);
        case "health:deleteMedication": return healthOperations.deleteMedication(userId, cmd.payload);
        case "health:saveSupplement": return healthOperations.saveSupplement(userId, cmd.payload);
        case "health:deleteSupplement": return healthOperations.deleteSupplement(userId, cmd.payload);
        case "health:saveTherapeuticSchedule": return healthOperations.saveTherapeuticSchedule(userId, cmd.payload);
        case "health:deleteTherapeuticSchedule": return healthOperations.deleteTherapeuticSchedule(userId, cmd.payload);
        case "health:setTherapeuticDoseStatus": return healthOperations.setTherapeuticDoseStatus(userId, cmd.payload);
        case "health:logTherapeutic": return healthOperations.logTherapeutic(userId, cmd.payload);
        case "health:deleteTherapeutic": return healthOperations.deleteTherapeutic(userId, cmd.payload);
        case "health:createSobrietyCounter": return healthOperations.createSobrietyCounter(userId, cmd.payload);
        case "health:updateSobrietyCounter": return healthOperations.updateSobrietyCounter(userId, cmd.payload);
        case "health:deleteSobrietyCounter": return healthOperations.deleteSobrietyCounter(userId, cmd.payload);
        case "health:logRelapse": return healthOperations.logRelapse(userId, cmd.payload);
        case "health:deleteRelapse": return healthOperations.deleteRelapse(userId, cmd.payload);
        case "health:logSubstance": return healthOperations.logSubstance(userId, cmd.payload);
        case "health:deleteSubstance": return healthOperations.deleteSubstance(userId, cmd.payload);
        case "health:createCustomSubstance": return healthOperations.createCustomSubstance(userId, cmd.payload);
        case "health:deleteCustomSubstance": return healthOperations.deleteCustomSubstance(userId, cmd.payload);
        case "health:createPeptide": return healthOperations.createPeptide(userId, cmd.payload);
        case "health:savePeptide": return healthOperations.savePeptide(userId, cmd.payload);
        case "health:deletePeptide": return healthOperations.deletePeptide(userId, cmd.payload);
        case "health:savePeptideBlock": return healthOperations.savePeptideBlock(userId, cmd.payload);
        case "health:deletePeptideBlock": return healthOperations.deletePeptideBlock(userId, cmd.payload);
        case "health:logPeptideDose": return healthOperations.logPeptideDose(userId, cmd.payload);
        case "health:updatePeptideDose": return healthOperations.updatePeptideDose(userId, cmd.payload);
        case "health:deletePeptideDose": return healthOperations.deletePeptideDose(userId, cmd.payload);

        case "nutrition:getOverview": return nutritionLibrary.getOverview(userId, cmd.payload);
        case "nutrition:addWater": return nutrition.addWater(userId, cmd.payload);
        case "nutrition:setWater": return nutrition.setWater(userId, cmd.payload);
        case "nutrition:logFood": return nutrition.logFood(userId, cmd.payload);
        case "nutrition:analyzeFood": return nutrition.analyzeFood(userId, cmd.payload);
        case "nutrition:analyzeFoodPhoto": return nutrition.analyzeFoodPhoto(userId, cmd.payload);
        case "nutrition:lookupBarcode": return nutrition.lookupBarcode(userId, cmd.payload);
        case "nutrition:updateGoals": return nutritionLibrary.updateGoals(userId, cmd.payload);
        case "nutrition:updateProfileAndCalculate": return nutrition.updateProfileAndCalculate(userId, cmd.payload);
        case "nutrition:setFoodFavorite": return nutritionLibrary.setFoodFavorite(userId, cmd.payload);
        case "nutrition:logFavorite": return nutritionLibrary.logFavorite(userId, cmd.payload);
        case "nutrition:createSavedMeal": return nutritionLibrary.createSavedMeal(userId, cmd.payload);
        case "nutrition:updateSavedMeal": return nutritionLibrary.updateSavedMeal(userId, cmd.payload);
        case "nutrition:deleteSavedMeal": return nutritionLibrary.deleteSavedMeal(userId, cmd.payload);
        case "nutrition:logSavedMeal": return nutritionLibrary.logSavedMeal(userId, cmd.payload);
        case "nutrition:updateFoodEntry": return nutritionLibrary.updateFoodEntry(userId, cmd.payload);
        case "nutrition:deleteFoodEntry": return nutritionLibrary.deleteFoodEntry(userId, cmd.payload);
        case "tasks:getDashboard": return tasks.getDashboard(userId, cmd.payload);
        case "tasks:getAnalytics": return tasks.getAnalytics(userId);
        case "tasks:createTodo": return tasks.createTodo(userId, cmd.payload);
        case "tasks:updateTodo": return tasks.updateTodo(userId, cmd.payload);
        case "tasks:deleteTodo": return tasks.deleteTodo(userId, cmd.payload);
        case "tasks:createSubtask": return tasks.createSubtask(userId, cmd.payload);
        case "tasks:toggleSubtask": return tasks.toggleSubtask(userId, cmd.payload);
        case "tasks:createRoutine": return tasks.createRoutine(userId, cmd.payload);
        case "tasks:toggleRoutine": return tasks.toggleRoutine(userId, cmd.payload);
        case "tasks:deleteRoutine": return tasks.deleteRoutine(userId, cmd.payload);
        default:
            throw new Error(`Unhandled LifeOS command: ${cmd.type}`);
    }
}
