"use server";

import {
    addSubtaskImpl,
    breakdownTodoImpl,
    bulkDeleteImpl,
    bulkSetStatusImpl,
    createTodoImpl,
    deleteRoutineImpl,
    deleteSubtaskImpl,
    deleteTodoImpl,
    duplicateTodoImpl,
    reorderTodosImpl,
    rescheduleTodoImpl,
    setBlockedByImpl,
    setTodoStatusImpl,
    toggleRoutineActiveImpl,
    toggleSubtaskImpl,
    updateRoutineImpl,
    updateTodoImpl,
} from "@/lib/todos";

// Thin "use server" wrappers over the implementations in @/lib/todos so the
// per-day + routine logic can be shared without re-exporting across modules.

export async function createTodo(fd: FormData) {
    return createTodoImpl(fd);
}

export async function updateTodo(fd: FormData) {
    return updateTodoImpl(fd);
}

export async function setTodoStatus(fd: FormData) {
    return setTodoStatusImpl(fd);
}

export async function deleteTodo(fd: FormData) {
    return deleteTodoImpl(fd);
}

export async function updateRoutine(fd: FormData) {
    return updateRoutineImpl(fd);
}

export async function toggleRoutineActive(fd: FormData) {
    return toggleRoutineActiveImpl(fd);
}

export async function deleteRoutine(fd: FormData) {
    return deleteRoutineImpl(fd);
}

export async function duplicateTodo(fd: FormData) {
    return duplicateTodoImpl(fd);
}

export async function rescheduleTodo(fd: FormData) {
    return rescheduleTodoImpl(fd);
}

export async function bulkSetStatus(fd: FormData) {
    return bulkSetStatusImpl(fd);
}

export async function bulkDeleteTodos(fd: FormData) {
    return bulkDeleteImpl(fd);
}

export async function reorderTodos(fd: FormData) {
    return reorderTodosImpl(fd);
}

export async function addSubtask(fd: FormData) {
    return addSubtaskImpl(fd);
}

export async function toggleSubtask(fd: FormData) {
    return toggleSubtaskImpl(fd);
}

export async function deleteSubtask(fd: FormData) {
    return deleteSubtaskImpl(fd);
}

export async function setBlockedBy(fd: FormData) {
    return setBlockedByImpl(fd);
}

export async function breakdownTodo(fd: FormData) {
    return breakdownTodoImpl(fd);
}
