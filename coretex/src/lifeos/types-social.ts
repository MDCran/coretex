export type SocialWebCommand =
    | { type: "social:prisma"; model: string; operation: string; args: any }
    | { type: "social:action"; actionName: string; args: any[] };
