/** Display labels and option vocabularies for the Social module. */

export const RELATIONSHIP_LABELS: Record<string, string> = {
    FRIEND: "Friend",
    CLOSE_FRIEND: "Close friend",
    FAMILY: "Family",
    PARTNER: "Partner",
    COLLEAGUE: "Colleague",
    MENTOR: "Mentor",
    MENTEE: "Mentee",
    ACQUAINTANCE: "Acquaintance",
    NEIGHBOR: "Neighbor",
    CLASSMATE: "Classmate",
    PROFESSIONAL: "Professional",
    OTHER: "Other",
};

export const RELATIONSHIP_COLORS: Record<string, string> = {
    FRIEND: "blue",
    CLOSE_FRIEND: "indigo",
    FAMILY: "pink",
    PARTNER: "pink",
    COLLEAGUE: "sky",
    MENTOR: "purple",
    MENTEE: "purple",
    ACQUAINTANCE: "gray",
    NEIGHBOR: "orange",
    CLASSMATE: "sky",
    PROFESSIONAL: "slate",
    OTHER: "gray",
};

export const COMMUNICATION_FREQUENCY_LABELS: Record<string, string> = {
    DAILY: "Daily",
    WEEKLY: "Weekly",
    BIWEEKLY: "Every 2 weeks",
    MONTHLY: "Monthly",
    QUARTERLY: "Quarterly",
    YEARLY: "Yearly",
    RARELY: "Rarely",
};

export const CONTACT_METHOD_LABELS: Record<string, string> = {
    TEXT: "Text",
    CALL: "Phone call",
    EMAIL: "Email",
    DM: "Direct message",
    IN_PERSON: "In person",
    VIDEO: "Video call",
};

export const INTERACTION_TYPE_LABELS: Record<string, string> = {
    REACH_OUT: "Reach out",
    HANGOUT: "Hangout",
    CALL: "Phone call",
    VIDEO: "Video call",
    MEAL: "Meal",
    COFFEE: "Coffee",
    MESSAGE: "Message",
    EVENT: "Event",
    TRIP: "Trip",
    FAVOR: "Favor",
    OTHER: "Other",
};

export const CHANNEL_LABELS: Record<string, string> = {
    TEXT: "Text",
    CALL: "Phone call",
    EMAIL: "Email",
    DM: "Direct message",
    SOCIAL: "Social media",
    IN_PERSON: "In person",
    VIDEO: "Video call",
    LETTER: "Letter",
};

export const SENTIMENT_LABELS: Record<string, string> = {
    POSITIVE: "Positive",
    NEUTRAL: "Neutral",
    NEGATIVE: "Negative",
    MIXED: "Mixed",
};

export const SENTIMENT_COLORS: Record<string, string> = {
    POSITIVE: "success",
    NEUTRAL: "gray",
    NEGATIVE: "error",
    MIXED: "warning",
};

export const NOTE_TYPE_LABELS: Record<string, string> = {
    GENERAL: "General",
    LIKES: "Likes",
    DISLIKES: "Dislikes",
    IMPORTANT: "Important",
    CONVERSATION: "Conversation topic",
    GIFT_IDEA: "Gift idea",
};

export const REMINDER_TYPE_LABELS: Record<string, string> = {
    REACH_OUT: "Reach out",
    BIRTHDAY: "Birthday",
    ANNIVERSARY: "Anniversary",
    FOLLOW_UP: "Follow up",
    CHECK_IN: "Check in",
    OTHER: "Other",
};

export const EMAIL_LABELS = ["Personal", "Work", "Other"];
export const PHONE_LABELS = ["Mobile", "Home", "Work", "Other"];
export const ADDRESS_TYPES = ["Home", "Work", "Other"];
export const HANDLE_PLATFORMS = ["Instagram", "X", "LinkedIn", "Facebook", "TikTok", "Snapchat", "Discord", "Telegram", "WhatsApp", "Signal", "Other"];
export const DATE_TYPES = ["Birthday", "Anniversary", "Work anniversary", "Graduation", "Other"];
export const GIFT_DIRECTIONS: Record<string, string> = { given: "Given", received: "Received" };
export const OCCASIONS = ["Birthday", "Anniversary", "Holiday", "Christmas", "Wedding", "Graduation", "Just because", "Thank you", "Other"];

/** Turn a label-map into [{ value, label }] options for SelectInput. */
export function toOptions(map: Record<string, string>): { value: string; label: string }[] {
    return Object.entries(map).map(([value, label]) => ({ value, label }));
}

/** Turn a string[] into [{ value, label }] options (value === label). */
export function listOptions(list: string[]): { value: string; label: string }[] {
    return list.map((v) => ({ value: v, label: v }));
}

/** Look up a label, falling back to the raw value (handles free-text + legacy data). */
export function labelOf(map: Record<string, string>, key: string | null | undefined): string {
    if (!key) return "—";
    return map[key] ?? key;
}
