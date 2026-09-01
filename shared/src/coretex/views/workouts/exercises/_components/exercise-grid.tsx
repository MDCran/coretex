// @ts-nocheck
import { ExerciseLibraryGrid, type ExerciseLibraryItem } from "./exercise-library-picker";

export const ExerciseGrid = ({ exercises }: { exercises: ExerciseLibraryItem[] }) => {
    return <ExerciseLibraryGrid exercises={exercises} density={3} showFilters />;
};
