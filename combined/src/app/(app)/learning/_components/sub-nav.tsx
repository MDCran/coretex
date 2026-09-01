"use client";

import { ModuleSubNav } from "@/components/app-shell/module-sub-nav";

const TABS = [
    { label: "Dashboard", href: "/learning" },
    { label: "Academic", href: "/learning/academic" },
    { label: "Courses", href: "/learning/courses" },
    { label: "Goals", href: "/learning/goals" },
    { label: "Archive", href: "/learning/archive" },
    { label: "Flashcards", href: "/learning/flashcards" },
    { label: "Quizzes", href: "/learning/quizzes" },
    { label: "Notes", href: "/learning/notes" },
    { label: "Sessions", href: "/learning/sessions" },
];

export const LearningSubNav = () => <ModuleSubNav tabs={TABS} rootHref="/learning" />;
