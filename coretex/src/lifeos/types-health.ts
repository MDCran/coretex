// Health command compatibility surface.
export type HealthCommand =
    | { type: `health:get${string}`; payload?: Record<string, unknown> }
    | { type: "health:updateGoals"; payload?: Record<string, unknown> }
    | { type: "health:createMetric" | "health:updateMetric" | "health:deleteMetric"; payload?: Record<string, unknown> }
    | { type: "health:createVital" | "health:updateVital" | "health:deleteVital"; payload?: Record<string, unknown> }
    | { type: "health:upsertSleep" | "health:deleteSleep"; payload?: Record<string, unknown> }
    | { type: "health:createHabit" | "health:updateHabit" | "health:deleteHabit" | "health:toggleHabit" | "health:addHabitMilestone" | "health:deleteHabitMilestone"; payload?: Record<string, unknown> }
    | { type: "health:upsertJournal" | "health:deleteJournal"; payload?: Record<string, unknown> }
    | { type: "health:createProgressPhoto" | "health:updateProgressPhoto" | "health:deleteProgressPhoto"; payload?: Record<string, unknown> }
    | { type: "health:createSobrietyCounter" | "health:updateSobrietyCounter" | "health:deleteSobrietyCounter" | "health:logRelapse" | "health:deleteRelapse" | "health:logSubstance" | "health:deleteSubstance" | "health:createCustomSubstance" | "health:deleteCustomSubstance"; payload?: Record<string, unknown> }
    | { type: "health:createPeptide" | "health:savePeptide" | "health:deletePeptide" | "health:savePeptideBlock" | "health:deletePeptideBlock" | "health:logPeptideDose" | "health:updatePeptideDose" | "health:deletePeptideDose"; payload?: Record<string, unknown> }
    | { type: "health:saveMedication" | "health:deleteMedication" | "health:saveSupplement" | "health:deleteSupplement" | "health:saveTherapeuticSchedule" | "health:deleteTherapeuticSchedule" | "health:setTherapeuticDoseStatus" | "health:logTherapeutic" | "health:deleteTherapeutic"; payload?: Record<string, unknown> }
    | { type: "health:createHabit"; data?: any }
    | { type: "health:updateHabit"; data?: any }
    | { type: "health:deleteHabit"; data?: any }
    | { type: "health:toggleHabitLog"; data?: any }
    | { type: "health:addHabitMilestone"; data?: any }
    | { type: "health:deleteHabitMilestone"; data?: any }
    | { type: "health:upsertJournalEntry"; data?: any }
    | { type: "health:deleteJournalEntry"; data?: any }
    | { type: "health:upsertMedicalRecord"; data?: any }
    | { type: "health:deleteMedicalRecord"; data?: any }
    | { type: "health:upsertProvider"; data?: any }
    | { type: "health:deleteProvider"; data?: any }
    | { type: "health:upsertDoctor"; data?: any }
    | { type: "health:deleteDoctor"; data?: any }
    | { type: "health:createBodyMetric"; data?: any }
    | { type: "health:updateBodyMetric"; data?: any }
    | { type: "health:deleteBodyMetric"; data?: any }
    | { type: "health:applyCalculatedGoals"; data?: any }
    | { type: "health:createProgressPhoto"; data?: any }
    | { type: "health:deleteProgressPhoto"; data?: any }
    | { type: "health:upsertSleepEntry"; data?: any }
    | { type: "health:deleteSleepEntry"; data?: any }
    | { type: "health:createSobrietyCounter"; data?: any }
    | { type: "health:updateSobrietyCounter"; data?: any }
    | { type: "health:deleteSobrietyCounter"; data?: any }
    | { type: "health:logSubstance"; data?: any }
    | { type: "health:deleteSubstanceLog"; data?: any }
    | { type: "health:createCustomSubstance"; data?: any }
    | { type: "health:createVital"; data?: any }
    | { type: "health:updateVital"; data?: any }
    | { type: "health:deleteVital"; data?: any }
    | { type: "health:listPeptides"; data?: any }
    | { type: "health:getPeptide"; data?: any }
    | { type: "health:getAdherence"; data?: any }
    | { type: "health:materializeUpcomingDoses"; data?: any }
    | { type: "health:getPageData"; data?: any };
