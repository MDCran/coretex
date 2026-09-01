export type WorkoutsCommand =
    | { type: "workouts:callDb"; model: string; operation: string; args: any };
